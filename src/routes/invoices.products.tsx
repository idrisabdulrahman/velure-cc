import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Outlet,
	useMatches,
	useNavigate,
} from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import {
	Archive,
	BarChart3,
	Copy,
	Eye,
	Pencil,
	Plus,
	Repeat2,
	Search,
	TrendingDown,
	Users,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { toast } from "#/components/ui/use-toast";
import { formatCompactMoney, formatMoney } from "#/features/invoices/format";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createFileRoute("/invoices/products")({
	beforeLoad: async ({ context }) => {
		await Promise.all([
			context.queryClient.prefetchQuery(
				convexQuery(api.products.list, {
					q: "",
					type: "all",
					status: "all",
				}),
			),
			context.queryClient.prefetchQuery(
				convexQuery(api.products.getAnalytics, {}),
			),
		]);
	},
	component: ProductsPage,
});

type ProductRow = {
	id: Id<"products">;
	workspaceId: Id<"workspaces">;
	type: "product" | "service";
	name: string;
	description?: string;
	sku?: string;
	unitName?: string;
	defaultUnitPrice: number;
	defaultTaxId?: string;
	isActive: boolean;
	createdAt: number;
	updatedAt: number;
};

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

	const { data: productsQuery, isPending: isProductsLoading } = useQuery(
		convexQuery(api.products.list, {
			q: search,
			type: typeFilter,
			status: statusFilter,
		}),
	);

	const { data: analyticsQuery, isPending: isAnalyticsLoading } = useQuery(
		convexQuery(api.products.getAnalytics, {}),
	);

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

	const filteredAnalytics = useMemo(() => {
		let result = analytics;
		if (search) {
			const q = search.toLowerCase();
			result = result.filter((a) => a.name.toLowerCase().includes(q));
		}
		return result;
	}, [analytics, search]);

	return (
		<motion.div
			className="mx-auto flex h-full w-full max-w-6xl flex-col gap-6"
			initial={{ opacity: 0, y: 10 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
		>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#f2efe7]">
						Products & Services
					</h1>
					<p className="mt-2 text-sm text-[#aaa294]">
						Manage your product catalog and view sales analytics.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<div className="flex h-10 w-full min-w-[260px] items-center gap-2 rounded-md border border-[#30352f] bg-[#171a18] px-3 lg:w-[320px]">
						<Search className="h-4 w-4 text-[#817d72]" />
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Search products..."
							className="h-full w-full bg-transparent text-sm text-[#f2efe7] outline-none placeholder:text-[#817d72]"
						/>
					</div>
					{activeTab === "catalog" && (
						<>
							<Select
								value={typeFilter}
								onValueChange={(value) =>
									setTypeFilter(value as "all" | "product" | "service")
								}
							>
								<SelectTrigger className="h-10 w-[140px] rounded-md border border-[#30352f] bg-[#171a18] text-sm text-[#d8d1c4]">
									<SelectValue placeholder="Type" />
								</SelectTrigger>
								<SelectContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
									<SelectItem value="all">All Types</SelectItem>
									<SelectItem value="product">Products</SelectItem>
									<SelectItem value="service">Services</SelectItem>
								</SelectContent>
							</Select>
							<Select
								value={statusFilter}
								onValueChange={(value) =>
									setStatusFilter(value as "all" | "active" | "archived")
								}
							>
								<SelectTrigger className="h-10 w-[140px] rounded-md border border-[#30352f] bg-[#171a18] text-sm text-[#d8d1c4]">
									<SelectValue placeholder="Status" />
								</SelectTrigger>
								<SelectContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
									<SelectItem value="all">All Status</SelectItem>
									<SelectItem value="active">Active</SelectItem>
									<SelectItem value="archived">Archived</SelectItem>
								</SelectContent>
							</Select>
						</>
					)}
				</div>
			</div>

			<div className="flex gap-1 border-b border-[#30352f]">
				<button
					type="button"
					onClick={() => setActiveTab("catalog")}
					className={`px-4 py-2 text-sm font-medium transition-colors ${
						activeTab === "catalog"
							? "border-b-2 border-[#c8ff62] text-[#c8ff62]"
							: "text-[#817d72] hover:text-[#f2efe7]"
					}`}
				>
					Catalog
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("analytics")}
					className={`px-4 py-2 text-sm font-medium transition-colors ${
						activeTab === "analytics"
							? "border-b-2 border-[#c8ff62] text-[#c8ff62]"
							: "text-[#817d72] hover:text-[#f2efe7]"
					}`}
				>
					Analytics
				</button>
			</div>

			{activeTab === "catalog" ? (
				<CatalogTab
					products={products}
					analyticsByProduct={analyticsByProduct}
					isLoading={isProductsLoading}
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
					analytics={filteredAnalytics}
					summary={summary}
					isLoading={isAnalyticsLoading}
				/>
			)}
		</motion.div>
	);
}

function CatalogTab({
	products,
	analyticsByProduct,
	isLoading,
	onCreate,
	onEdit,
}: {
	products: ProductRow[];
	analyticsByProduct: Map<string, AnalyticsRow>;
	isLoading: boolean;
	onCreate: () => void;
	onEdit: (id: Id<"products">) => void;
}) {
	const archiveProduct = useMutation(api.products.archive);
	const duplicateProduct = useMutation(api.products.duplicate);

	const handleArchive = async (id: Id<"products">) => {
		try {
			await archiveProduct({ id });
			toast({ title: "Product archived", variant: "success" });
		} catch (error) {
			toast({
				title: "Archive failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	const handleDuplicate = async (id: Id<"products">) => {
		try {
			await duplicateProduct({ id });
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
		<div className="ui-panel overflow-hidden rounded-md border border-[#30352f] bg-[#171a18]">
			<div className="flex items-center justify-between border-b border-[#30352f] px-4 py-3">
				<p className="text-sm font-medium text-[#f2efe7]">Product catalog</p>
				<Button
					type="button"
					onClick={onCreate}
					className="h-9 rounded-md bg-[#c8ff62] px-3 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
				>
					<Plus className="mr-1.5 h-4 w-4" />
					New Product
				</Button>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full min-w-[800px] text-sm">
					<thead className="bg-[#15171a]">
						<tr className="border-b border-[#30352f] text-left text-[#817d72]">
							<th className="px-4 py-3 font-medium">Name</th>
							<th className="px-4 py-3 font-medium">Type</th>
							<th className="px-4 py-3 font-medium">Unit Price</th>
							<th className="px-4 py-3 font-medium">Usage</th>
							<th className="px-4 py-3 font-medium">Status</th>
							<th className="px-4 py-3 text-right font-medium">Actions</th>
						</tr>
					</thead>
					<tbody>
						{products.map((product) => {
							const insight = analyticsByProduct.get(product.id);
							return (
								<tr
									key={product.id}
									className="border-b border-[#30352f] text-[#d8d1c4] hover:bg-[#1c1f22]"
								>
									<td className="px-4 py-3 font-medium text-[#f2efe7]">
										{product.name}
									</td>
									<td className="px-4 py-3">
										<span
											className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${
												product.type === "product"
													? "border-[#2b313b] bg-[#151b23] text-[#d8dde7]"
													: "border-[#3c4740] bg-[#1a1f1c] text-[#b9c3b8]"
											}`}
										>
											{product.type}
										</span>
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{formatMoney(product.defaultUnitPrice, "NGN")}
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{insight && insight.usageCount > 0 ? (
											<div>
												<p className="text-[#f2efe7]">
													{insight.usageCount} uses
												</p>
												<p className="mt-0.5 text-xs text-[#817d72]">
													{formatCompactMoney(insight.revenue, "NGN")}
												</p>
											</div>
										) : (
											<span>-</span>
										)}
									</td>
									<td className="px-4 py-3">
										<span
											className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
												product.isActive
													? "border-[#425033] bg-[#1e2418] text-[#b7ca7c]"
													: "border-[#5d4747] bg-[#261c1c] text-[#d4a0a0]"
											}`}
										>
											{product.isActive ? "Active" : "Archived"}
										</span>
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

			{isLoading ? (
				<PanelLoader label="Loading products" />
			) : products.length === 0 ? (
				<div className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-[#aaa294]">
					<div>
						<p className="font-medium text-[#f2efe7]">No products yet.</p>
						<p className="mt-1">
							Create products and services to speed up invoice creation.
						</p>
					</div>
					<Button
						type="button"
						onClick={onCreate}
						className="h-9 rounded-md bg-[#c8ff62] px-3 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
					>
						<Plus className="mr-1.5 h-4 w-4" />
						New Product
					</Button>
				</div>
			) : null}
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
						className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#30352f] bg-[#171a18] text-[#beb6a8] transition-colors hover:bg-[#1a2117] ${
							danger ? "hover:text-[#d48f8f]" : "hover:text-[#f2efe7]"
						}`}
						aria-label={label}
					>
						{children}
					</button>
				</TooltipTrigger>
				<TooltipContent className="rounded-md border-[#30352f] bg-[#101211]/95 px-3 py-2 text-xs text-[#f2efe7] shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
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
}: {
	analytics: AnalyticsRow[];
	summary: ProductSummary;
	isLoading: boolean;
}) {
	return (
		<>
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<InsightCard
					icon={BarChart3}
					label="Product revenue"
					value={formatCompactMoney(summary?.totalRevenue ?? 0, "NGN")}
					detail={`${summary?.usedProductCount ?? 0} products used`}
				/>
				<InsightCard
					icon={Repeat2}
					label="Invoice usage"
					value={`${summary?.totalUsageCount ?? 0}`}
					detail={`${summary?.activeProductCount ?? 0} active catalog items`}
				/>
				<InsightCard
					icon={Users}
					label="Repeat-client products"
					value={`${summary?.repeatClientProductCount ?? 0}`}
					detail="Sold to more than one client"
				/>
				<InsightCard
					icon={TrendingDown}
					label="Declining signals"
					value={`${summary?.decliningProductCount ?? 0}`}
					detail="Lower recent revenue"
				/>
			</div>

			<div className="ui-panel overflow-hidden rounded-md border border-[#30352f] bg-[#171a18]">
				<div className="border-b border-[#30352f] px-4 py-3">
					<p className="text-sm font-medium text-[#f2efe7]">
						Product intelligence
					</p>
					<p className="mt-1 text-xs text-[#817d72]">
						Generated from invoice line items.
					</p>
				</div>

				<div className="overflow-x-auto">
					<table className="w-full min-w-[1080px] text-sm">
						<thead className="bg-[#15171a]">
							<tr className="border-b border-[#30352f] text-left text-[#817d72]">
								<th className="px-4 py-3 font-medium">Name</th>
								<th className="px-4 py-3 font-medium">Usage</th>
								<th className="px-4 py-3 font-medium">Clients</th>
								<th className="px-4 py-3 text-right font-medium">Revenue</th>
								<th className="px-4 py-3 text-right font-medium">Avg Price</th>
								<th className="px-4 py-3 font-medium">Top Client</th>
								<th className="px-4 py-3 font-medium">Signal</th>
								<th className="px-4 py-3 font-medium">Last Sold</th>
							</tr>
						</thead>
						<tbody>
							{analytics.map((item) => (
								<tr
									key={item.productId}
									className="border-b border-[#30352f] text-[#d8d1c4] hover:bg-[#1c1f22]"
								>
									<td className="px-4 py-3">
										<p className="font-medium text-[#f2efe7]">{item.name}</p>
										<p className="mt-0.5 text-xs capitalize text-[#817d72]">
											{item.type ?? "catalog item"}
											{item.sku ? ` / SKU ${item.sku}` : ""}
										</p>
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{item.usageCount} uses
										<span className="ml-1 text-[#817d72]">
											/ {item.quantitySold} sold
										</span>
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{item.customerCount ?? "-"}
									</td>
									<td className="px-4 py-3 text-right font-medium text-[#f2efe7]">
										<span title={formatMoney(item.revenue, "NGN")}>
											{formatCompactMoney(item.revenue, "NGN")}
										</span>
									</td>
									<td className="px-4 py-3 text-right text-[#beb6a8]">
										{formatMoney(item.averagePrice, "NGN")}
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{item.topClients?.[0]?.customerName ?? "-"}
									</td>
									<td className="px-4 py-3">
										<TrendBadge trend={item.trend ?? "steady"} />
									</td>
									<td className="px-4 py-3 text-[#beb6a8]">
										{item.lastSoldAt
											? new Date(item.lastSoldAt).toLocaleDateString()
											: "-"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{isLoading ? (
					<PanelLoader label="Loading product intelligence" />
				) : analytics.length === 0 ? (
					<div className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-[#aaa294]">
						<div>
							<p className="font-medium text-[#f2efe7]">
								No product intelligence yet.
							</p>
							<p className="mt-1">
								Signals will appear once catalog products are used in invoices.
							</p>
						</div>
					</div>
				) : null}
			</div>
		</>
	);
}

function InsightCard({
	icon: Icon,
	label,
	value,
	detail,
}: {
	icon: typeof BarChart3;
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-md border border-[#30352f] bg-[#171a18] p-4">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs uppercase tracking-[0.12em] text-[#817d72]">
					{label}
				</p>
				<Icon className="h-4 w-4 text-[#c8ff62]" />
			</div>
			<p className="mt-3 text-2xl font-semibold text-[#f2efe7]">{value}</p>
			<p className="mt-1 text-xs text-[#aaa294]">{detail}</p>
		</div>
	);
}

function TrendBadge({ trend }: { trend: AnalyticsRow["trend"] }) {
	const classes =
		trend === "declining"
			? "border-[#5d4747] bg-[#261c1c] text-[#d4a0a0]"
			: trend === "rising" || trend === "new"
				? "border-[#425033] bg-[#1e2418] text-[#b7ca7c]"
				: "border-[#30352f] bg-[#15171a] text-[#beb6a8]";

	return (
		<span
			className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${classes}`}
		>
			{trend}
		</span>
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

function PanelLoader({ label }: { label: string }) {
	return (
		<motion.div
			className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-10 text-sm text-[#aaa294]"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.18 }}
		>
			<Spinner size={24} className="text-[#c8ff62] !stroke-[#c8ff62]" />
			<span>{label}</span>
		</motion.div>
	);
}
