import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useMatches,
	useNavigate,
} from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
	Archive,
	Copy,
	Eye,
	Package,
	Pencil,
	Plus,
	Search,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Callout } from "#/components/redesign/callout";
import { EmptyState } from "#/components/redesign/empty-state";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { StatusPill } from "#/components/redesign/status-pill";
import { Tabs } from "#/components/redesign/tabs";
import { Button } from "#/components/ui/button";
import { PanelLoader } from "#/components/ui/panel-loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { toast } from "#/components/ui/use-toast";
import { formatCompactMoney, formatMoney } from "#/features/invoices/format";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	archiveProduct,
	duplicateProduct,
	getProductAnalytics,
	listProducts,
	type ProductRecord,
} from "#/server/data/products";
export const Route = createFileRoute("/invoices/products")({
	component: ProductsPage,
});

type ProductRow = ProductRecord;

type AnalyticsRow = {
	productId: string;
	name: string;
	type?: "product" | "service";
	sku?: string;
	unitName?: string;
	defaultUnitPrice?: number;
	isActive?: boolean;
	usageCount: number;
	invoiceCount?: number;
	customerCount?: number;
	quantitySold: number;
	revenue: number;
	averagePrice: number;
	lastSoldAt: number | null;
	lastInvoiceNumber?: string | null;
	topClients?: Array<{
		customerName: string;
		usageCount: number;
		quantitySold: number;
		revenue: number;
		lastSoldAt: number | null;
	}>;
	coSoldProducts?: Array<{
		productId: string;
		name: string;
		coInvoiceCount: number;
	}>;
	trend?: "new" | "rising" | "steady" | "declining" | "inactive";
};

type ProductSummary = {
	totalRevenue: number;
	totalUsageCount: number;
	activeProductCount: number;
	usedProductCount: number;
	repeatClientProductCount: number;
	decliningProductCount: number;
};

type Tab = "catalog" | "analytics";

const COPY_SUFFIX_PATTERN = /(\s*\(copy\))+$/i;

function duplicateBaseName(name: string): string {
	return name.replace(COPY_SUFFIX_PATTERN, "").toLowerCase().trim();
}

type DuplicateGroup = {
	key: string;
	price: number;
	members: ProductRow[];
};

function findDuplicateGroups(products: ProductRow[]): DuplicateGroup[] {
	const byKey = new Map<string, ProductRow[]>();
	for (const product of products) {
		if (!product.isActive) continue;
		const base = duplicateBaseName(product.name);
		if (base.length === 0) continue;
		const key = `${base}||${product.defaultUnitPrice}`;
		const members = byKey.get(key);
		if (members) {
			members.push(product);
		} else {
			byKey.set(key, [product]);
		}
	}
	return [...byKey.values()]
		.filter((members) => members.length > 1)
		.map((members) => ({
			key: `${duplicateBaseName(members[0].name)}||${members[0].defaultUnitPrice}`,
			price: members[0].defaultUnitPrice,
			members,
		}));
}

function copyForGroup(group: DuplicateGroup): ProductRow {
	return (
		group.members.find((member) => COPY_SUFFIX_PATTERN.test(member.name)) ??
		group.members[1]
	);
}

function ProductsPage() {
	const matches = useMatches();
	const hasNestedProductRoute = matches.some((match) =>
		String(match.routeId).startsWith("/invoices/products/"),
	);

	if (hasNestedProductRoute) {
		return <Outlet />;
	}

	return <ProductCatalogPage />;
}

function ProductCatalogPage() {
	const navigate = useNavigate();
	const [activeTab, setActiveTab] = useState<Tab>("catalog");
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<"all" | "product" | "service">(
		"all",
	);
	const [statusFilter, setStatusFilter] = useState<
		"all" | "active" | "archived"
	>("all");

	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const {
		data: productsQuery,
		isPending: isProductsLoading,
		isError: isProductsError,
		error: productsError,
	} = useQuery({
		queryKey: ["products", userId, search, typeFilter, statusFilter],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return listProducts(supabaseClient, userId, {
				q: search,
				type: typeFilter,
				status: statusFilter,
			});
		},
		enabled: Boolean(supabaseClient && userId),
	});

	const {
		data: analyticsQuery,
		isPending: isAnalyticsLoading,
		isError: isAnalyticsError,
		error: analyticsError,
	} = useQuery({
		queryKey: ["product-analytics", userId],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return getProductAnalytics(supabaseClient, userId);
		},
		enabled: Boolean(supabaseClient && userId),
	});

	const products = (productsQuery ?? []) as ProductRow[];
	const analytics = (analyticsQuery ?? []) as AnalyticsRow[];
	const summary = useMemo(
		() => buildProductSummary(analytics, products),
		[analytics, products],
	);
	const analyticsByProduct = useMemo(
		() => new Map(analytics.map((item) => [item.productId, item])),
		[analytics],
	);
	const activeCount = useMemo(
		() => products.filter((product) => product.isActive).length,
		[products],
	);

	return (
		<motion.div
			className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6"
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
		>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Products & Services
					</h1>
					<p className="mt-2 text-sm text-ink-3">
						Manage your product catalog and view sales analytics.
					</p>
				</div>
				<Button
					type="button"
					onClick={() => navigate({ to: "/invoices/products/new" })}
					className="h-10 shrink-0 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
				>
					<Plus className="mr-1.5 h-4 w-4" />
					New Product
				</Button>
			</div>

			<Tabs
				tabs={[
					{ value: "catalog", label: "Catalog", count: activeCount },
					{ value: "analytics", label: "Analytics" },
				]}
				value={activeTab}
				onChange={(value) => setActiveTab(value as Tab)}
			/>

			{activeTab === "catalog" ? (
				<CatalogTab
					products={products}
					analyticsByProduct={analyticsByProduct}
					isLoading={isProductsLoading}
					loadError={
						isProductsError
							? productsError instanceof Error
								? productsError.message
								: "Unknown error"
							: null
					}
					search={search}
					onSearchChange={setSearch}
					typeFilter={typeFilter}
					onTypeChange={setTypeFilter}
					statusFilter={statusFilter}
					onStatusChange={setStatusFilter}
					onCreate={() => navigate({ to: "/invoices/products/new" })}
					onEdit={(id) =>
						navigate({
							to: "/invoices/products/$id",
							params: { id },
						})
					}
				/>
			) : (
				<AnalyticsTab
					analytics={analytics}
					summary={summary}
					isLoading={isAnalyticsLoading}
					loadError={
						isAnalyticsError
							? analyticsError instanceof Error
								? analyticsError.message
								: "Unknown error"
							: null
					}
				/>
			)}
		</motion.div>
	);
}

function CatalogTab({
	products,
	analyticsByProduct,
	isLoading,
	loadError,
	search,
	onSearchChange,
	typeFilter,
	onTypeChange,
	statusFilter,
	onStatusChange,
	onCreate,
	onEdit,
}: {
	products: ProductRow[];
	analyticsByProduct: Map<string, AnalyticsRow>;
	isLoading: boolean;
	loadError: string | null;
	search: string;
	onSearchChange: (value: string) => void;
	typeFilter: "all" | "product" | "service";
	onTypeChange: (value: "all" | "product" | "service") => void;
	statusFilter: "all" | "active" | "archived";
	onStatusChange: (value: "all" | "active" | "archived") => void;
	onCreate: () => void;
	onEdit: (id: string) => void;
}) {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);

	const duplicateGroups = useMemo(
		() => findDuplicateGroups(products),
		[products],
	);
	const duplicateHintById = useMemo(() => {
		const hints = new Map<string, string>();
		for (const group of duplicateGroups) {
			for (const member of group.members) {
				const other = group.members.find((item) => item.id !== member.id);
				if (other) hints.set(member.id, other.name);
			}
		}
		return hints;
	}, [duplicateGroups]);
	const singleCopy =
		duplicateGroups.length === 1 ? copyForGroup(duplicateGroups[0]) : undefined;
	const filtersActive =
		search.trim() !== "" || typeFilter !== "all" || statusFilter !== "all";

	const handleArchive = async (id: string) => {
		try {
			if (!supabaseClient || !userId) throw new Error("Session is not ready.");
			await archiveProduct(supabaseClient, userId, id);
			toast({ title: "Product archived", variant: "success" });
		} catch (error) {
			toast({
				title: "Archive failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	const handleDuplicate = async (id: string) => {
		try {
			if (!supabaseClient || !userId) throw new Error("Session is not ready.");
			await duplicateProduct(supabaseClient, userId, id);
			toast({ title: "Product duplicated", variant: "success" });
		} catch (error) {
			toast({
				title: "Duplicate failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	return (
		<div className="flex flex-col gap-4">
			{duplicateGroups.length > 0 ? (
				<Callout
					tone="warn"
					title="Possible duplicates"
					action={
						singleCopy
							? {
									label: "Archive the copy",
									onClick: () => void handleArchive(singleCopy.id),
								}
							: undefined
					}
				>
					<div className="flex flex-col gap-2">
						{duplicateGroups.map((group) => {
							const copy = copyForGroup(group);
							const original = group.members.find(
								(member) => member.id !== copy.id,
							);
							return (
								<div
									key={group.key}
									className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
								>
									<p>
										<span className="font-medium text-ink">{copy.name}</span>{" "}
										looks like a duplicate of{" "}
										<span className="font-medium text-ink">
											{original?.name ?? group.members[0].name}
										</span>
										: same name, same {formatMoney(group.price, "NGN")}.
									</p>
									{singleCopy ? null : (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => void handleArchive(copy.id)}
										>
											Archive the copy
										</Button>
									)}
								</div>
							);
						})}
					</div>
				</Callout>
			) : null}

			<Panel title="Product catalog">
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<div className="flex h-10 w-full items-center gap-2 rounded-md border border-rule bg-paper-2 px-3">
							<Search
								className="h-4 w-4 flex-none text-ink-3"
								aria-hidden="true"
							/>
							<input
								value={search}
								onChange={(event) => onSearchChange(event.target.value)}
								placeholder="Search products"
								aria-label="Search products"
								className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
							/>
						</div>
						<div className="flex flex-col gap-2 sm:flex-row sm:flex-none sm:items-center">
							<Select
								value={typeFilter}
								onValueChange={(value) =>
									onTypeChange(value as "all" | "product" | "service")
								}
							>
								<SelectTrigger
									aria-label="Type"
									className="h-10 w-full rounded-md border border-rule bg-paper-2 text-sm text-ink-2 sm:w-35"
								>
									<SelectValue placeholder="Type" />
								</SelectTrigger>
								<SelectContent className="border-rule bg-paper-2 text-ink">
									<SelectItem value="all">All Types</SelectItem>
									<SelectItem value="product">Products</SelectItem>
									<SelectItem value="service">Services</SelectItem>
								</SelectContent>
							</Select>
							<Select
								value={statusFilter}
								onValueChange={(value) =>
									onStatusChange(value as "all" | "active" | "archived")
								}
							>
								<SelectTrigger
									aria-label="Status"
									className="h-10 w-full rounded-md border border-rule bg-paper-2 text-sm text-ink-2 sm:w-35"
								>
									<SelectValue placeholder="Status" />
								</SelectTrigger>
								<SelectContent className="border-rule bg-paper-2 text-ink">
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="archived">Archived</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					{isLoading ? (
						<PanelLoader label="Loading products" />
					) : loadError ? (
						<EmptyState title="Couldn't load products" copy={loadError} />
					) : products.length === 0 ? (
						filtersActive ? (
							<EmptyState
								icon={<Search aria-hidden="true" />}
								title="No products match"
								copy="Adjust the search or filters."
							/>
						) : (
							<EmptyState
								icon={<Package aria-hidden="true" />}
								title="No products yet."
								copy="Create products and services to speed up invoice creation."
								action={
									<Button
										type="button"
										onClick={onCreate}
										className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
									>
										<Plus className="mr-1.5 h-4 w-4" />
										New Product
									</Button>
								}
							/>
						)
					) : (
						<>
							<div className="overflow-x-auto rounded-md border border-rule">
								<table className="w-full min-w-[800px] text-sm">
									<thead className="bg-paper-3">
										<tr className="border-b border-rule text-left text-ink-3">
											<th className="px-4 py-3 font-medium">Name</th>
											<th className="px-4 py-3 font-medium">Type</th>
											<th className="px-4 py-3 text-right font-medium">
												Unit Price
											</th>
											<th className="px-4 py-3 font-medium">Usage</th>
											<th className="px-4 py-3 font-medium">Status</th>
											<th className="px-4 py-3 text-right font-medium">
												Actions
											</th>
										</tr>
									</thead>
									<tbody>
										{products.map((product) => {
											const insight = analyticsByProduct.get(product.id);
											const duplicateHint = product.isActive
												? duplicateHintById.get(product.id)
												: undefined;
											return (
												<tr
													key={product.id}
													className="border-b border-rule text-ink-2 last:border-b-0 hover:bg-paper-3"
												>
													<td className="px-4 py-3">
														<p className="font-medium text-ink">
															{product.name}
														</p>
														{duplicateHint ? (
															<p className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
																<Copy
																	className="h-3 w-3 flex-none"
																	aria-hidden="true"
																/>
																<span>
																	Same price as {duplicateHint} — duplicate?
																</span>
															</p>
														) : null}
													</td>
													<td className="px-4 py-3">
														<span className="rounded bg-paper-3 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-ink-2 uppercase">
															{product.type}
														</span>
													</td>
													<td className="hm-num-cell px-4 py-3 text-right font-num text-ink-3 tabular-nums">
														{formatMoney(product.defaultUnitPrice, "NGN")}
													</td>
													<td className="hm-num-cell px-4 py-3 text-ink-3">
														{insight && insight.usageCount > 0 ? (
															<div>
																<p className="text-ink">
																	{insight.usageCount} uses
																</p>
																<p className="mt-0.5 text-xs text-ink-3">
																	{formatCompactMoney(insight.revenue, "NGN")}
																</p>
															</div>
														) : (
															<span>Not used yet</span>
														)}
													</td>
													<td className="px-4 py-3">
														<StatusPill tone={product.isActive ? "ok" : "mute"}>
															{product.isActive ? "Active" : "Archived"}
														</StatusPill>
													</td>
													<td className="px-4 py-3 text-right">
														<div className="flex items-center justify-end gap-1">
															<ProductAction
																label="View product"
																tooltip="Open product details"
																onClick={() => onEdit(product.id)}
															>
																<Eye className="h-4 w-4" />
															</ProductAction>
															<ProductAction
																label="Edit product"
																tooltip="Edit price and catalog information"
																onClick={() => onEdit(product.id)}
															>
																<Pencil className="h-4 w-4" />
															</ProductAction>
															<ProductAction
																label="Duplicate product"
																tooltip="Duplicate this catalog item"
																onClick={() => void handleDuplicate(product.id)}
															>
																<Copy className="h-4 w-4" />
															</ProductAction>
															{product.isActive && (
																<ProductAction
																	label="Archive product"
																	tooltip="Archive this product"
																	onClick={() => void handleArchive(product.id)}
																	danger
																>
																	<Archive className="h-4 w-4" />
																</ProductAction>
															)}
														</div>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
							<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
								<span>
									Showing {products.length} of {products.length} products
								</span>
							</div>
						</>
					)}
				</div>
			</Panel>
		</div>
	);
}

function ProductAction({
	label,
	tooltip,
	danger,
	onClick,
	children,
}: {
	label: string;
	tooltip: string;
	danger?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<TooltipProvider delayDuration={180}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={onClick}
						className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-rule bg-paper-2 text-ink-3 transition-colors hover:bg-brand-soft ${
							danger ? "hover:text-danger" : "hover:text-ink"
						}`}
						aria-label={label}
					>
						{children}
					</button>
				</TooltipTrigger>
				<TooltipContent className="rounded-md border-rule bg-paper/95 px-3 py-2 text-xs text-ink shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
					{tooltip}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function AnalyticsTab({
	analytics,
	summary,
	isLoading,
	loadError,
}: {
	analytics: AnalyticsRow[];
	summary: ProductSummary;
	isLoading: boolean;
	loadError: string | null;
}) {
	return (
		<div className="flex flex-col gap-4">
			<KpiStrip>
				<Kpi
					label="Product revenue"
					value={formatCompactMoney(summary.totalRevenue, "NGN")}
					sub={`${summary.usedProductCount} products used`}
					tone="brand"
				/>
				<Kpi
					label="Invoice usage"
					value={`${summary.totalUsageCount}`}
					sub={`${summary.activeProductCount} active catalog items`}
					tone="info"
				/>
				<Kpi
					label="Repeat-client products"
					value={`${summary.repeatClientProductCount}`}
					sub="Sold to more than one client"
					tone="ok"
				/>
				<Kpi
					label="Declining signals"
					value={`${summary.decliningProductCount}`}
					sub="Lower recent revenue"
					tone="warn"
				/>
			</KpiStrip>

			<Callout tone="info">
				Product intelligence is generated from invoice line items. Items typed
				by hand instead of picked from the catalog carry no catalog reference,
				so usage can be undercounted — picking catalog items when building an
				invoice fills the Usage column.
			</Callout>

			<Panel
				title="Product intelligence"
				sub="Generated from invoice line items."
			>
				{isLoading ? (
					<PanelLoader label="Loading product intelligence" />
				) : loadError ? (
					<EmptyState
						title="Couldn't load product intelligence"
						copy={loadError}
					/>
				) : analytics.length === 0 ? (
					<EmptyState
						title="No product intelligence yet."
						copy="Signals will appear once catalog products are used in invoices."
					/>
				) : (
					<div className="overflow-x-auto rounded-md border border-rule">
						<table className="hm-ts-board w-full min-w-[1080px] text-sm">
							<thead className="bg-paper-3">
								<tr className="border-b border-rule text-left text-ink-3">
									<th className="px-4 py-3 font-medium">Name</th>
									<th className="px-4 py-3 font-medium">Usage</th>
									<th className="px-4 py-3 font-medium">Clients</th>
									<th className="px-4 py-3 text-right font-medium">Revenue</th>
									<th className="px-4 py-3 text-right font-medium">
										Avg Price
									</th>
									<th className="px-4 py-3 font-medium">Top Client</th>
									<th className="px-4 py-3 font-medium">Signal</th>
									<th className="px-4 py-3 font-medium">Last Sold</th>
								</tr>
							</thead>
							<tbody>
								{analytics.map((item) => (
									<tr
										key={item.productId}
										className="border-b border-rule text-ink-2 last:border-b-0 hover:bg-paper-3"
									>
										<td className="px-4 py-3">
											<p className="font-medium text-ink">{item.name}</p>
											<p className="mt-0.5 text-xs capitalize text-ink-3">
												{item.type ?? "catalog item"}
												{item.sku ? ` / SKU ${item.sku}` : ""}
											</p>
										</td>
										<td className="px-4 py-3 text-ink-3">
											{item.usageCount} uses
											<span className="ml-1 text-ink-3">
												/ {item.quantitySold} sold
											</span>
										</td>
										<td className="px-4 py-3 text-ink-3">
											{item.customerCount ?? "-"}
										</td>
										<td className="hm-num-cell px-4 py-3 text-right font-medium font-num text-ink tabular-nums">
											<span title={formatMoney(item.revenue, "NGN")}>
												{formatCompactMoney(item.revenue, "NGN")}
											</span>
										</td>
										<td className="hm-num-cell px-4 py-3 text-right font-num text-ink-3 tabular-nums">
											{formatMoney(item.averagePrice, "NGN")}
										</td>
										<td className="px-4 py-3 text-ink-3">
											{item.topClients?.[0]?.customerName ?? "-"}
										</td>
										<td className="px-4 py-3">
											<StatusPill
												tone={
													item.trend === "declining"
														? "bad"
														: item.trend === "rising" || item.trend === "new"
															? "ok"
															: "mute"
												}
											>
												{item.trend ?? "steady"}
											</StatusPill>
										</td>
										<td className="px-4 py-3 text-ink-3">
											{item.lastSoldAt
												? new Date(item.lastSoldAt).toLocaleDateString()
												: "-"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Panel>
		</div>
	);
}

function buildProductSummary(
	analytics: AnalyticsRow[],
	products: ProductRow[],
): ProductSummary {
	return {
		totalRevenue: analytics.reduce((sum, item) => sum + item.revenue, 0),
		totalUsageCount: analytics.reduce((sum, item) => sum + item.usageCount, 0),
		activeProductCount: products.filter((item) => item.isActive).length,
		usedProductCount: analytics.filter((item) => item.usageCount > 0).length,
		repeatClientProductCount: analytics.filter(
			(item) => (item.customerCount ?? 0) > 1,
		).length,
		decliningProductCount: analytics.filter(
			(item) => item.trend === "declining",
		).length,
	};
}
