import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FileText, LayoutGrid, Search, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
	Dialog,
	DialogContentFrameless,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import { listClients } from "#/server/data/clients";
import { listPage } from "#/server/data/invoices";
import { searchProducts } from "#/server/data/products";

type PaletteTarget =
	| { kind: "page"; to: string }
	| { kind: "invoice" }
	| { kind: "client" }
	| { kind: "product" };

type PaletteItem = {
	key: string;
	label: string;
	hint?: string;
	target: PaletteTarget;
};

type PaletteSection = {
	title: string;
	items: PaletteItem[];
};

const PAGE_TARGETS: Array<{ label: string; hint: string; to: string }> = [
	{ label: "Invoices", hint: "Workspace", to: "/invoices" },
	{ label: "Clients", hint: "Workspace", to: "/clients" },
	{ label: "Reports", hint: "Workspace", to: "/reports" },
	{ label: "Products", hint: "Workspace", to: "/invoices/products" },
	{ label: "Compliance", hint: "Settings", to: "/settings/compliance" },
	{
		label: "Payment reminders",
		hint: "Settings",
		to: "/settings/collections",
	},
	{
		label: "Recurring billing",
		hint: "Settings",
		to: "/settings/recurring",
	},
	{ label: "General", hint: "Settings", to: "/settings" },
];

function targetRoute(target: PaletteTarget): string {
	switch (target.kind) {
		case "page":
			return target.to;
		case "invoice":
			return "/invoices";
		case "client":
			return "/clients";
		case "product":
			return "/invoices/products";
	}
}

export function CommandPalette({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const canRead = Boolean(supabaseClient && userId);

	const [query, setQuery] = useState("");
	const [debounced, setDebounced] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);

	useEffect(() => {
		if (!open) {
			setQuery("");
			setDebounced("");
			setActiveIndex(0);
			return;
		}
		const timer = window.setTimeout(() => setDebounced(query), 200);
		return () => window.clearTimeout(timer);
	}, [open, query]);

	const searchText = debounced.trim();
	const searching = open && canRead && searchText.length >= 2;

	const { data: invoicePage, isPending: invoicesPending } = useQuery({
		queryKey: ["palette-invoices", userId, searchText],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return listPage(supabaseClient, userId, {
				q: searchText,
				status: "all",
				type: "all",
				documentType: "all",
				pageSize: 10,
			});
		},
		enabled: searching,
		staleTime: 30_000,
	});

	const { data: clientRows, isPending: clientsPending } = useQuery({
		queryKey: ["palette-clients", userId, searchText],
		queryFn: async () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			const rows = await listClients(supabaseClient, userId, {
				q: searchText,
				status: "all",
			});
			return rows.slice(0, 7);
		},
		enabled: searching,
		staleTime: 30_000,
	});

	const { data: productRows, isPending: productsPending } = useQuery({
		queryKey: ["palette-products", userId, searchText],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return searchProducts(supabaseClient, userId, searchText);
		},
		enabled: searching,
		staleTime: 30_000,
	});

	const sections = useMemo<PaletteSection[]>(() => {
		const needle = query.trim().toLowerCase();
		const pages: PaletteItem[] = PAGE_TARGETS.filter(
			(page) => !needle || page.label.toLowerCase().includes(needle),
		).map((page) => ({
			key: `page:${page.to}`,
			label: page.label,
			hint: page.hint,
			target: { kind: "page", to: page.to },
		}));

		if (searchText.length < 2) {
			return [{ title: "Pages", items: pages }];
		}

		const invoices: PaletteItem[] = (invoicePage?.page ?? []).map(
			(invoice) => ({
				key: `invoice:${invoice.id}`,
				label: invoice.invoiceNumber,
				hint: invoice.customerName || "No customer yet",
				target: { kind: "invoice" },
			}),
		);
		const clients: PaletteItem[] = (clientRows ?? []).map((client) => ({
			key: `client:${client.id}`,
			label: client.name,
			hint: client.company || client.email,
			target: { kind: "client" },
		}));
		const products: PaletteItem[] = (productRows ?? []).map((product) => ({
			key: `product:${product.id}`,
			label: product.name,
			hint: product.sku ?? product.type,
			target: { kind: "product" },
		}));

		return [
			{ title: "Pages", items: pages },
			{ title: "Invoices", items: invoices },
			{ title: "Clients", items: clients },
			{ title: "Products", items: products },
		].filter((section) => section.items.length > 0);
	}, [clientRows, invoicePage, productRows, query, searchText]);

	const flatItems = useMemo(
		() => sections.flatMap((section) => section.items),
		[sections],
	);

	useEffect(() => {
		setActiveIndex(0);
	}, [debounced, open]);

	useEffect(() => {
		if (!open) return;
		document
			.getElementById(`palette-option-${activeIndex}`)
			?.scrollIntoView({ block: "nearest" });
	}, [activeIndex, open]);

	const runItem = (item: PaletteItem) => {
		onOpenChange(false);
		void navigate({ to: targetRoute(item.target) });
	};

	const isLoading =
		searching && (invoicesPending || clientsPending || productsPending);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContentFrameless className="max-h-[70vh] overflow-hidden p-0">
				<DialogTitle className="sr-only">Search or jump to</DialogTitle>
				<DialogDescription className="sr-only">
					Jump to a page, invoice, client, or product.
				</DialogDescription>
				<div className="flex h-12 items-center gap-2 border-b border-rule px-4">
					<Search className="h-4 w-4 shrink-0 text-ink-3" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setActiveIndex((current) =>
									flatItems.length === 0
										? 0
										: Math.min(current + 1, flatItems.length - 1),
								);
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setActiveIndex((current) => Math.max(current - 1, 0));
							} else if (event.key === "Enter") {
								const item = flatItems[activeIndex];
								if (item) {
									event.preventDefault();
									runItem(item);
								}
							}
						}}
						placeholder="Search or jump to…"
						role="combobox"
						aria-expanded="true"
						aria-controls="palette-listbox"
						aria-activedescendant={`palette-option-${activeIndex}`}
						autoFocus
						className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
					/>
					<kbd className="rounded-md border border-rule bg-paper-2 px-1.5 py-0.5 font-num text-[11px] text-ink-3">
						esc
					</kbd>
				</div>
				<div
					id="palette-listbox"
					role="listbox"
					aria-label="Results"
					className="max-h-[52vh] overflow-y-auto p-2"
				>
					{isLoading ? (
						<p className="px-3 py-6 text-center text-sm text-ink-3">
							Searching…
						</p>
					) : sections.length === 0 ? (
						<p className="px-3 py-6 text-center text-sm text-ink-3">
							No matches. Try an invoice number, customer, or product name.
						</p>
					) : (
						sections.map((section) => (
							<div key={section.title} className="mb-1 last:mb-0">
								<p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
									{section.title}
								</p>
								{section.items.map((item) => {
									const index = flatItems.indexOf(item);
									const active = index === activeIndex;
									return (
										<button
											key={item.key}
											id={`palette-option-${index}`}
											type="button"
											role="option"
											aria-selected={active}
											onMouseEnter={() => setActiveIndex(index)}
											onClick={() => runItem(item)}
											className={`flex w-full items-center gap-3 rounded-[var(--hm-r-input)] px-3 py-2 text-left text-sm transition-colors ${
												active ? "bg-brand-soft text-ink" : "text-ink-2"
											}`}
										>
											{item.target.kind === "invoice" ? (
												<FileText className="h-4 w-4 shrink-0 text-ink-3" />
											) : item.target.kind === "client" ? (
												<Users className="h-4 w-4 shrink-0 text-ink-3" />
											) : item.target.kind === "product" ? (
												<LayoutGrid className="h-4 w-4 shrink-0 text-ink-3" />
											) : (
												<Search className="h-4 w-4 shrink-0 text-ink-3" />
											)}
											<span className="min-w-0 flex-1 truncate font-medium">
												{item.label}
											</span>
											{item.hint ? (
												<span className="shrink-0 truncate text-xs text-ink-3">
													{item.hint}
												</span>
											) : null}
										</button>
									);
								})}
							</div>
						))
					)}
					{searchText.length < 2 && !isLoading ? (
						<p className="px-3 py-3 text-xs text-ink-3">
							Type 2 or more characters to search invoices, clients, and
							products.
						</p>
					) : null}
				</div>
			</DialogContentFrameless>
		</Dialog>
	);
}
