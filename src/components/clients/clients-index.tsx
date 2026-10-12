import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
	Archive,
	Copy,
	MoreHorizontal,
	Pencil,
	Plus,
	RotateCcw,
	Star,
	Trash2,
	Upload,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Callout } from "#/components/redesign/callout";
import { EmptyState } from "#/components/redesign/empty-state";
import { FormField } from "#/components/redesign/form-field";
import { SegmentedFilter } from "#/components/redesign/segmented-filter";
import { StatusPill } from "#/components/redesign/status-pill";
import { Tabs } from "#/components/redesign/tabs";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import { PanelLoader } from "#/components/ui/panel-loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	archiveClient,
	getClientIntelligence,
	importClientsCsv,
	listClients,
	removeClient,
	toggleClientFavorite,
	updateClient,
} from "#/server/data/clients";

type ClientStatus = "active" | "pending" | "inactive" | "archived";

type ListFilter = "all" | "starred" | "balance";

type DetailTab = "overview" | "invoices" | "details";

const PAYMENT_TERM_OPTIONS = [
	"Due on receipt",
	"Net 7",
	"Net 14",
	"Net 30",
	"Net 60",
];

type ClientRow = {
	id: string;
	name: string;
	company?: string;
	email: string;
	phone?: string;
	website?: string;
	billingAddress?: string;
	taxId?: string;
	currency: string;
	paymentTerms: string;
	internalNotes?: string;
	contact: {
		fullName?: string;
		role?: string;
		email?: string;
		phone?: string;
	};
	favorite: boolean;
	status: ClientStatus;
	createdAt: number;
	updatedAt: number;
};

type ClientImportRow = {
	name: string;
	company?: string;
	email: string;
	phone?: string;
	billingAddress?: string;
	taxId?: string;
	currency?: string;
	paymentTerms?: string;
};

type FavoriteAnimation = {
	id: string;
	action: "add" | "remove";
};

type ClientIntelligence = {
	primaryCurrency: {
		currency: string;
		totalRevenue: number;
		outstandingBalance: number;
		paidRevenue: number;
		averageInvoiceValue: number;
		invoiceCount: number;
		paidInvoiceCount: number;
		overdueInvoiceCount: number;
	};
	currencySummaries: Array<{
		currency: string;
		totalRevenue: number;
		outstandingBalance: number;
		invoiceCount: number;
	}>;
	invoiceCount: number;
	averagePaymentDelayDays: number | null;
	lastInvoiceDate: string | null;
	topProducts: Array<{
		name: string;
		quantity: number;
		revenue: number;
		invoiceCount: number;
	}>;
	recentInvoices: Array<{
		id: string;
		invoiceNumber: string;
		issueDate: string;
		dueDate: string;
		currency: string;
		total: number;
		balance: number;
		status: string;
	}>;
};

function parseCsvLine(line: string) {
	const cells: string[] = [];
	let cell = "";
	let quoted = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];
		if (char === '"' && quoted && next === '"') {
			cell += '"';
			index += 1;
			continue;
		}
		if (char === '"') {
			quoted = !quoted;
			continue;
		}
		if (char === "," && !quoted) {
			cells.push(cell.trim());
			cell = "";
			continue;
		}
		cell += char;
	}

	cells.push(cell.trim());
	return cells;
}

function parseClientCsv(text: string): ClientImportRow[] {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (lines.length < 2) return [];

	const headers = parseCsvLine(lines[0] ?? "").map((header) =>
		header.toLowerCase().replace(/\s+/g, ""),
	);
	const at = (cells: string[], names: string[]) => {
		const index = headers.findIndex((header) => names.includes(header));
		return index >= 0 ? cells[index]?.trim() : undefined;
	};

	return lines
		.slice(1)
		.map((line) => {
			const cells = parseCsvLine(line);
			return {
				name: at(cells, ["name", "clientname", "customername"]) ?? "",
				company: at(cells, ["company", "business", "businessname"]),
				email: at(cells, ["email", "clientemail", "customeremail"]) ?? "",
				phone: at(cells, ["phone", "telephone"]),
				billingAddress: at(cells, ["billingaddress", "address"]),
				taxId: at(cells, ["taxid", "tin"]),
				currency: at(cells, ["currency"]),
				paymentTerms: at(cells, ["paymentterms", "terms"]),
			};
		})
		.filter((row) => row.name.trim() && row.email.trim());
}

function initials(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	const first = parts[0]?.[0] ?? "?";
	const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
	return (first + second).toUpperCase();
}

function clientStatusLabel(status: ClientStatus) {
	switch (status) {
		case "active":
			return "Active";
		case "pending":
			return "Pending";
		case "inactive":
			return "Inactive";
		case "archived":
			return "Archived";
	}
}

function invoiceStatusTone(status: string): "ok" | "warn" | "mute" {
	const normalized = status.trim().toLowerCase();
	if (normalized === "paid") return "ok";
	if (
		normalized === "draft" ||
		normalized === "sent" ||
		normalized === "overdue"
	)
		return "warn";
	return "mute";
}

function invoiceStatusLabel(status: string) {
	const normalized = status.trim().toLowerCase();
	if (!normalized) return "Unknown";
	return normalized[0].toUpperCase() + normalized.slice(1);
}

export function ClientsIndex() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const canRead = Boolean(supabaseClient && userId);
	const context =
		supabaseClient && userId ? { client: supabaseClient, userId } : null;
	const selectedClientPanelRef = useRef<HTMLElement | null>(null);
	const favoriteAnimationTimeoutRef = useRef<number | null>(null);

	const [, startTransition] = useTransition();
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<ListFilter>("all");
	const [tab, setTab] = useState<DetailTab>("overview");
	const {
		data: queryResult,
		isPending: isLoading,
		isError: isQueryError,
	} = useQuery({
		queryKey: ["supabase-clients", userId ?? "none", query],
		queryFn: () => {
			if (!context) throw new Error("Supabase session unavailable.");
			return listClients(context.client, context.userId, {
				q: query,
				status: "all",
			});
		},
		enabled: canRead,
	});
	const clientsFromQuery = useMemo(
		() =>
			(queryResult ?? []).map((client) => ({
				...client,
				company: client.company ?? undefined,
				phone: client.phone ?? undefined,
				website: client.website ?? undefined,
				billingAddress: client.billingAddress ?? undefined,
				taxId: client.taxId ?? undefined,
				internalNotes: client.internalNotes ?? undefined,
				createdAt: client.createdAt ? Date.parse(client.createdAt) : 0,
				updatedAt: client.updatedAt ? Date.parse(client.updatedAt) : 0,
			})) as ClientRow[],
		[queryResult],
	);

	const [clients, setClients] = useState<ClientRow[]>([]);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const [busyAction, setBusyAction] = useState<
		"update" | "archive" | "restore" | "delete" | null
	>(null);
	const [favoriteAnimation, setFavoriteAnimation] =
		useState<FavoriteAnimation | null>(null);

	useEffect(() => {
		setClients(clientsFromQuery);
	}, [clientsFromQuery]);

	useEffect(() => {
		return () => {
			if (favoriteAnimationTimeoutRef.current !== null) {
				window.clearTimeout(favoriteAnimationTimeoutRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!selectedId && clients.length > 0) {
			setSelectedId(clients[0].id);
		}

		if (selectedId && !clients.some((client) => client.id === selectedId)) {
			setSelectedId(clients[0]?.id ?? null);
		}
	}, [clients, selectedId]);

	const selected = useMemo(
		() => clients.find((client) => client.id === selectedId) ?? null,
		[clients, selectedId],
	);
	const enabled = selectedId !== null;
	const { data: intelligenceResult } = useQuery({
		queryKey: [
			"supabase-client-intelligence",
			userId ?? "none",
			selectedId ?? "none",
		],
		queryFn: () => {
			if (!context) throw new Error("Supabase session unavailable.");
			return selectedId
				? getClientIntelligence(context.client, context.userId, selectedId)
				: null;
		},
		enabled: enabled && canRead,
	});
	const intelligence =
		(intelligenceResult as ClientIntelligence | null | undefined) ?? null;
	const intelligenceLoading = enabled && intelligenceResult === undefined;

	const [editState, setEditState] = useState({
		name: "",
		email: "",
		company: "",
		paymentTerms: "Net 14",
		status: "active" as ClientStatus,
	});

	useEffect(() => {
		if (!selected) return;
		setEditState({
			name: selected.name,
			email: selected.email,
			company: selected.company ?? "",
			paymentTerms: selected.paymentTerms,
			status: selected.status,
		});
	}, [selected]);

	const updateDisabled =
		!selected ||
		editState.name.trim().length === 0 ||
		!/^\S+@\S+\.\S+$/.test(editState.email);

	const isDirty =
		Boolean(selected) &&
		(editState.name !== selected?.name ||
			editState.email !== selected?.email ||
			editState.company !== (selected?.company ?? "") ||
			editState.paymentTerms !== selected?.paymentTerms ||
			editState.status !== selected?.status);

	const patchLocal = (
		id: string,
		updater: (client: ClientRow) => ClientRow,
	) => {
		setClients((prev) =>
			prev.map((client) => (client.id === id ? updater(client) : client)),
		);
	};

	const animateFavoriteChange = (
		id: string,
		action: FavoriteAnimation["action"],
	) => {
		if (favoriteAnimationTimeoutRef.current !== null) {
			window.clearTimeout(favoriteAnimationTimeoutRef.current);
		}

		setFavoriteAnimation({ id, action });
		favoriteAnimationTimeoutRef.current = window.setTimeout(() => {
			setFavoriteAnimation(null);
			favoriteAnimationTimeoutRef.current = null;
		}, 520);
	};

	const onUpdate = async () => {
		if (!selected || updateDisabled) return;

		const snapshot = clients;
		patchLocal(selected.id, (client) => ({
			...client,
			name: editState.name,
			company: editState.company || undefined,
			email: editState.email,
			paymentTerms: editState.paymentTerms,
			status: editState.status,
			updatedAt: Date.now(),
		}));

		setBusyAction("update");
		try {
			if (!context) throw new Error("Supabase session unavailable.");
			await updateClient(context.client, context.userId, selected.id, {
				name: editState.name,
				company: editState.company || undefined,
				email: editState.email,
				phone: selected.phone,
				website: selected.website,
				billingAddress: selected.billingAddress,
				taxId: selected.taxId,
				currency: selected.currency,
				paymentTerms: editState.paymentTerms,
				internalNotes: selected.internalNotes,
				contact: selected.contact,
				favorite: selected.favorite,
				status: editState.status,
			});
			toast({ title: "Client updated", variant: "success" });
		} catch (error) {
			setClients(snapshot);
			toast({
				title: "Update failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	};

	const onDiscard = () => {
		if (!selected) return;
		setEditState({
			name: selected.name,
			email: selected.email,
			company: selected.company ?? "",
			paymentTerms: selected.paymentTerms,
			status: selected.status,
		});
	};

	const onArchiveStatusChange = async () => {
		if (!selected) return;

		const nextStatus = selected.status === "archived" ? "active" : "archived";
		await setClientArchiveStatus(selected, nextStatus);
	};

	const setClientArchiveStatus = async (
		clientToUpdate: ClientRow,
		nextStatus: "active" | "archived",
	) => {
		const isRestore = nextStatus === "active";
		const snapshot = clients;
		patchLocal(clientToUpdate.id, (client) => ({
			...client,
			status: nextStatus,
			updatedAt: Date.now(),
		}));
		setSelectedId(clientToUpdate.id);

		setBusyAction(isRestore ? "restore" : "archive");
		try {
			if (!context) throw new Error("Supabase session unavailable.");
			if (isRestore) {
				await updateClient(context.client, context.userId, clientToUpdate.id, {
					name: clientToUpdate.name,
					company: clientToUpdate.company,
					email: clientToUpdate.email,
					phone: clientToUpdate.phone,
					website: clientToUpdate.website,
					billingAddress: clientToUpdate.billingAddress,
					taxId: clientToUpdate.taxId,
					currency: clientToUpdate.currency,
					paymentTerms: clientToUpdate.paymentTerms,
					internalNotes: clientToUpdate.internalNotes,
					contact: clientToUpdate.contact,
					favorite: clientToUpdate.favorite,
					status: "active",
				});
				toast({ title: "Client restored", variant: "success" });
			} else {
				await archiveClient(context.client, context.userId, clientToUpdate.id);
				toast({ title: "Client archived", variant: "success" });
			}
		} catch (error) {
			setClients(snapshot);
			toast({
				title: isRestore ? "Restore failed" : "Archive failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	};

	const onDeleteConfirm = async () => {
		if (!deleteTargetId) return;

		const snapshot = clients;
		setClients((prev) => prev.filter((client) => client.id !== deleteTargetId));
		if (selectedId === deleteTargetId) {
			setSelectedId(null);
		}

		setBusyAction("delete");
		try {
			if (!context) throw new Error("Supabase session unavailable.");
			await removeClient(context.client, context.userId, deleteTargetId);
			toast({ title: "Client deleted", variant: "success" });
		} catch (error) {
			setClients(snapshot);
			toast({
				title: "Delete failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
			setDeleteTargetId(null);
		}
	};

	const onToggleFavoriteForClient = async (clientToUpdate: ClientRow) => {
		const nextFavorite = !clientToUpdate.favorite;
		const snapshot = clients;
		animateFavoriteChange(clientToUpdate.id, nextFavorite ? "add" : "remove");
		patchLocal(clientToUpdate.id, (client) => ({
			...client,
			favorite: nextFavorite,
			updatedAt: Date.now(),
		}));

		try {
			if (!context) throw new Error("Supabase session unavailable.");
			await toggleClientFavorite(
				context.client,
				context.userId,
				clientToUpdate.id,
			);
		} catch (error) {
			setClients(snapshot);
			setFavoriteAnimation(null);
			toast({
				title: "Favorite update failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	const onCopyEmail = async (email: string) => {
		try {
			await navigator.clipboard.writeText(email);
			toast({ title: "Email copied", variant: "success" });
		} catch {
			toast({ title: "Copy failed", variant: "error" });
		}
	};

	const onCsvImport = async (file: File | undefined) => {
		if (!file) return;
		try {
			const rows = parseClientCsv(await file.text());
			if (rows.length === 0) {
				toast({
					title: "No clients imported",
					description: "CSV needs name and email columns.",
					variant: "error",
				});
				return;
			}
			if (!context) throw new Error("Supabase session unavailable.");
			const result = await importClientsCsv(
				context.client,
				context.userId,
				rows,
			);
			const issueCount = result.errors?.length ?? 0;
			toast({
				title: "Client import finished",
				description: `${result.created} created, ${result.skipped} skipped${
					issueCount > 0 ? `, ${issueCount} row issues reported` : ""
				}.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Client import failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	const selectClient = (id: string) => {
		setSelectedId(id);
		setTab("overview");
	};

	const editClient = (id: string) => {
		selectClient(id);
		setTab("details");
		window.requestAnimationFrame(() => {
			selectedClientPanelRef.current?.focus({ preventScroll: true });
		});
	};

	const openClientMenu = (id: string) => {
		setSelectedId(id);
		setTab((prev) => prev);
	};

	const onClientRowKeyDown = (
		event: KeyboardEvent<HTMLDivElement>,
		id: string,
	) => {
		if (event.key !== "Enter" && event.key !== " ") return;

		event.preventDefault();
		selectClient(id);
	};

	const starredCount = clients.filter((client) => client.favorite).length;
	const selectedOutstanding =
		intelligence && intelligence.invoiceCount > 0
			? intelligence.primaryCurrency.outstandingBalance
			: 0;
	const selectedCurrency = intelligence?.primaryCurrency.currency ?? "NGN";
	const balanceCount =
		selected && selectedOutstanding > 0 && selectedId !== null ? 1 : 0;

	const visibleClients = useMemo(() => {
		if (filter === "starred") {
			return clients.filter((client) => client.favorite);
		}
		if (filter === "balance") {
			return clients.filter(
				(client) =>
					client.id === selectedId &&
					intelligence !== null &&
					intelligence.invoiceCount > 0 &&
					intelligence.primaryCurrency.outstandingBalance > 0,
			);
		}
		return clients;
	}, [clients, filter, intelligence, selectedId]);

	const selectedDraftCount =
		intelligence?.recentInvoices.filter(
			(invoice) => invoice.status.trim().toLowerCase() === "draft",
		).length ?? 0;
	const selectedDraft =
		intelligence?.recentInvoices.find(
			(invoice) => invoice.status.trim().toLowerCase() === "draft",
		) ?? null;

	const billed = intelligence?.primaryCurrency.totalRevenue ?? 0;
	const collected = intelligence?.primaryCurrency.paidRevenue ?? 0;
	const collectedPct = billed > 0 ? Math.round((collected / billed) * 100) : 0;
	const topProducts = intelligence?.topProducts ?? [];
	const topRevenueMax = Math.max(1, ...topProducts.map((item) => item.revenue));
	const selectedInvoices = intelligence?.recentInvoices ?? [];
	const invoiceCountFor = (status: string) =>
		selectedInvoices.filter(
			(invoice) => invoice.status.trim().toLowerCase() === status,
		).length;

	const termOptions = PAYMENT_TERM_OPTIONS.includes(editState.paymentTerms)
		? PAYMENT_TERM_OPTIONS
		: [editState.paymentTerms, ...PAYMENT_TERM_OPTIONS];

	return (
		<>
			<motion.div
				className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6"
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
			>
				<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
							Clients
						</h1>
						<p className="mt-2 text-sm text-ink-3">
							Contact details, billing defaults and account status, with what
							each client owes you front and centre.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-rule bg-paper-2 px-3 text-sm text-ink-2 hover:bg-paper-3">
							<Upload className="h-4 w-4" />
							Import CSV
							<input
								type="file"
								accept=".csv,text/csv"
								className="hidden"
								onChange={(event) => {
									void onCsvImport(event.target.files?.[0]);
									event.target.value = "";
								}}
							/>
						</label>
						<Button
							asChild
							className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
						>
							<Link to="/clients/new">New client</Link>
						</Button>
					</div>
				</div>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
					<section
						aria-label="Client directory"
						className="overflow-hidden rounded-lg border border-rule bg-paper-2"
					>
						<div className="flex flex-col gap-3 border-b border-rule px-4 py-3">
							<Input
								value={query}
								onChange={(event) =>
									startTransition(() => setQuery(event.target.value))
								}
								placeholder="Search clients"
								aria-label="Search clients"
								className="h-10 w-full rounded-md border-rule bg-paper text-sm text-ink placeholder:text-ink-3 focus-visible:ring-0"
							/>
							<SegmentedFilter
								options={[
									{ value: "all", label: "All", count: clients.length },
									{
										value: "starred",
										label: "Starred",
										count: starredCount,
									},
									{
										value: "balance",
										label: "Has balance",
										count: balanceCount,
									},
								]}
								value={filter}
								onChange={(value) => setFilter(value as ListFilter)}
							/>
						</div>

						<div
							aria-hidden="true"
							className="hidden border-b border-rule px-4 py-2 text-xs font-medium text-ink-3 sm:grid sm:grid-cols-[minmax(0,1fr)_90px_120px_70px_36px] sm:gap-3"
						>
							<span>Client</span>
							<span>Status</span>
							<span className="text-right">Outstanding</span>
							<span className="text-right">Updated</span>
							<span />
						</div>

						<div role="listbox" aria-label="Clients">
							{visibleClients.map((client) => {
								const isSelected = selectedId === client.id;
								const favoriteAnimationAction =
									favoriteAnimation?.id === client.id
										? favoriteAnimation.action
										: null;
								const showFavoriteStar =
									client.favorite || favoriteAnimationAction === "remove";
								const favoriteAnimationClass =
									favoriteAnimationAction === "add"
										? "client-favorite-star-pop"
										: favoriteAnimationAction === "remove"
											? "client-favorite-star-remove"
											: "";
								const isIntelligenceRow =
									isSelected &&
									intelligence !== null &&
									intelligence.invoiceCount > 0;

								return (
									<div
										key={client.id}
										role="option"
										tabIndex={0}
										aria-selected={isSelected}
										aria-label={`Select ${client.name}`}
										onClick={() => selectClient(client.id)}
										onKeyDown={(event) => onClientRowKeyDown(event, client.id)}
										className={`flex cursor-pointer items-center gap-3 border-b border-rule px-4 py-3 last:border-b-0 ${
											isSelected
												? "bg-brand-soft outline-1 outline-brand"
												: "transition-colors duration-150 hover:bg-paper-3 focus-visible:outline focus-visible:outline-brand"
										}`}
									>
										<div
											aria-hidden="true"
											className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand"
										>
											{initials(client.name)}
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 items-center gap-1.5">
												<span className="truncate text-sm font-medium text-ink">
													{client.name}
												</span>
												<button
													type="button"
													onClick={(event) => {
														event.stopPropagation();
														void onToggleFavoriteForClient(client);
													}}
													aria-label={
														client.favorite
															? `Remove ${client.name} from favorites`
															: `Add ${client.name} to favorites`
													}
													aria-pressed={client.favorite}
													className="flex-none rounded p-0.5 text-brand hover:opacity-80"
												>
													<Star
														className={`h-3.5 w-3.5 ${showFavoriteStar ? `fill-brand text-brand ${favoriteAnimationClass}` : "text-ink-3"}`}
													/>
												</button>
											</div>
											<p className="mt-0.5 truncate text-xs text-ink-3">
												{client.company ? `${client.company} · ` : ""}
												{client.email}
											</p>
										</div>
										<div className="hidden flex-none sm:block">
											<StatusPill
												tone={
													client.status === "active"
														? "ok"
														: client.status === "pending"
															? "warn"
															: "mute"
												}
											>
												{clientStatusLabel(client.status)}
											</StatusPill>
										</div>
										<div className="w-[110px] flex-none text-right">
											{isIntelligenceRow ? (
												<>
													<p className="font-num text-sm font-medium tabular-nums text-ink">
														{formatMoney(
															intelligence.primaryCurrency.outstandingBalance,
															intelligence.primaryCurrency.currency,
															{ maximumFractionDigits: 0 },
														)}
													</p>
													<p className="mt-0.5 text-xs text-ink-3">
														{selectedDraftCount > 0
															? `${selectedDraftCount} draft${selectedDraftCount > 1 ? "s" : ""}`
															: "due"}
													</p>
												</>
											) : (
												<span className="text-sm text-ink-3">—</span>
											)}
										</div>
										<div className="hidden w-[64px] flex-none text-right text-xs text-ink-3 md:block">
											<span title={formatAbsoluteDateTime(client.updatedAt)}>
												{timeAgo(client.updatedAt)}
											</span>
										</div>
										<div className="flex-none">
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														onClick={(event) => {
															event.stopPropagation();
															openClientMenu(client.id);
														}}
														onKeyDown={(event) => event.stopPropagation()}
														aria-label={`Actions for ${client.name}`}
														className="h-9 w-9 rounded-md border border-rule bg-paper-2 hover:bg-brand-soft"
													>
														<MoreHorizontal className="h-4 w-4 text-ink-2" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent className="border-rule bg-paper-2 text-ink">
													<DropdownMenuItem
														className="gap-2 focus:bg-brand-soft"
														onClick={() => editClient(client.id)}
													>
														<Pencil className="h-4 w-4" />
														Edit
													</DropdownMenuItem>
													<DropdownMenuItem
														className="gap-2 focus:bg-brand-soft"
														disabled={busyAction !== null}
														onClick={() =>
															void setClientArchiveStatus(
																client,
																client.status === "archived"
																	? "active"
																	: "archived",
															)
														}
													>
														{client.status === "archived" ? (
															<RotateCcw className="h-4 w-4" />
														) : (
															<Archive className="h-4 w-4" />
														)}
														{client.status === "archived"
															? "Restore"
															: "Archive"}
													</DropdownMenuItem>
													<DropdownMenuItem
														className="gap-2 text-danger focus:bg-danger-soft focus:text-danger"
														onClick={() => setDeleteTargetId(client.id)}
													>
														<Trash2 className="h-4 w-4" />
														Delete
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</div>
								);
							})}
						</div>

						{isLoading ? (
							<PanelLoader label="Loading clients" />
						) : isQueryError ? (
							<div className="flex min-h-[156px] flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-ink-3">
								<p className="font-medium text-ink">Clients failed to load.</p>
								<p>Check your connection and try again.</p>
							</div>
						) : visibleClients.length === 0 ? (
							<div className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-ink-3">
								<div>
									<p className="font-medium text-ink">
										{clients.length === 0
											? "No clients found."
											: "No clients match."}
									</p>
									<p className="mt-1">
										{clients.length === 0
											? "Add client name, email, tax ID, currency, and payment terms before sending invoices."
											: "Try a different search or clear the filter."}
									</p>
								</div>
								{clients.length === 0 ? (
									<Button
										asChild
										className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
									>
										<Link to="/clients/new">New client</Link>
									</Button>
								) : null}
							</div>
						) : null}

						<div className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 text-xs text-ink-3">
							<span>
								Showing {visibleClients.length} of {clients.length}{" "}
								{clients.length === 1 ? "client" : "clients"}
							</span>
							<span className="hidden sm:inline">Click a row to open it</span>
						</div>
					</section>

					<motion.section
						ref={selectedClientPanelRef}
						tabIndex={-1}
						aria-label="Client detail"
						className="flex max-h-[calc(100vh-12rem)] min-h-[320px] flex-col overflow-hidden rounded-lg border border-rule bg-paper-2 outline-none xl:sticky xl:top-4"
						initial={{ opacity: 0, x: 8 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
					>
						{!selected ? (
							<div className="p-4">
								<EmptyState
									title="No client selected"
									copy="Pick one from the list."
								/>
							</div>
						) : (
							<>
								<div className="border-b border-rule px-4 py-4">
									<div className="flex items-start gap-3">
										<div
											aria-hidden="true"
											className="grid h-12 w-12 flex-none place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
										>
											{initials(selected.name)}
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex min-w-0 flex-wrap items-center gap-2">
												<h2 className="truncate text-lg font-semibold text-ink">
													{selected.name}
												</h2>
												<StatusPill
													tone={
														selected.status === "active"
															? "ok"
															: selected.status === "pending"
																? "warn"
																: "mute"
													}
												>
													{clientStatusLabel(selected.status)}
												</StatusPill>
											</div>
											<div className="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
												<span className="min-w-0 truncate">
													{selected.email}
												</span>
												<button
													type="button"
													onClick={() => void onCopyEmail(selected.email)}
													aria-label="Copy email"
													className="flex-none rounded p-1 text-ink-3 hover:bg-paper-3 hover:text-ink"
												>
													<Copy className="h-3.5 w-3.5" />
												</button>
											</div>
											<p
												className={`mt-0.5 truncate text-sm ${selected.company ? "text-ink-2" : "text-ink-3"}`}
											>
												{selected.company ?? "No company set"}
											</p>
										</div>
									</div>
									<div className="mt-3 flex flex-wrap items-center gap-2">
										<Button
											asChild
											className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
										>
											<Link to="/invoices/new">
												<Plus className="h-4 w-4" />
												New invoice
											</Link>
										</Button>
										<Button
											type="button"
											variant="outline"
											size="icon"
											onClick={() => {
												void onToggleFavoriteForClient(selected);
											}}
											aria-label={
												selected.favorite ? "Starred client" : "Star client"
											}
											aria-pressed={selected.favorite}
											className="h-9 w-9 rounded-md border-rule bg-transparent hover:bg-paper-3"
										>
											<Star
												className={`h-4 w-4 ${selected.favorite ? "fill-brand text-brand" : "text-ink-3"}`}
											/>
										</Button>
									</div>
								</div>

								<div className="px-4">
									<Tabs
										tabs={[
											{ value: "overview", label: "Overview" },
											{
												value: "invoices",
												label: "Invoices",
												count: selectedInvoices.length,
											},
											{ value: "details", label: "Details" },
										]}
										value={tab}
										onChange={(value) => setTab(value as DetailTab)}
									/>
								</div>

								<div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
									{tab === "overview" ? (
										<div className="px-4 py-4">
											{intelligenceLoading ? (
												<div className="flex items-center gap-2 rounded-md border border-rule bg-paper-3 p-4 text-sm text-ink-3">
													<Spinner className="h-4 w-4" />
													Loading client intelligence
												</div>
											) : !intelligence || intelligence.invoiceCount === 0 ? (
												<EmptyState
													dashed
													title="No invoices yet"
													copy={`Create the first one. Terms default to ${selected.paymentTerms}.`}
													action={
														<Button
															asChild
															className="h-8 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
														>
															<Link to="/invoices/new">
																<Plus className="h-4 w-4" />
																New invoice
															</Link>
														</Button>
													}
												/>
											) : (
												<div className="flex flex-col gap-5">
													<div>
														<p className="text-xs text-ink-3">
															Outstanding balance
														</p>
														<p className="font-num mt-1 text-2xl font-semibold tabular-nums text-ink">
															{formatMoney(
																selectedOutstanding,
																selectedCurrency,
																{ maximumFractionDigits: 0 },
															)}
														</p>
														<div
															role="progressbar"
															aria-valuenow={collectedPct}
															aria-valuemin={0}
															aria-valuemax={100}
															aria-label="Collected versus billed"
															className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-3"
														>
															<div
																className="h-full rounded-full bg-brand"
																style={{ width: `${collectedPct}%` }}
															/>
														</div>
														<p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
															<span>
																<span className="font-num tabular-nums text-ink-2">
																	{formatMoney(collected, selectedCurrency, {
																		maximumFractionDigits: 0,
																	})}
																</span>{" "}
																collected
															</span>
															<span>
																of{" "}
																<span className="font-num tabular-nums text-ink-2">
																	{formatMoney(billed, selectedCurrency, {
																		maximumFractionDigits: 0,
																	})}
																</span>{" "}
																billed
															</span>
														</p>
													</div>

													{selectedDraft ? (
														<Callout tone="warn">
															<span className="font-num text-xs tabular-nums">
																{selectedDraft.invoiceNumber}
															</span>{" "}
															is still a draft, so nothing has been sent. The{" "}
															{selected.paymentTerms} clock starts the day you
															send it.
														</Callout>
													) : null}

													<div className="grid grid-cols-3 gap-2">
														<div className="rounded-md border border-rule bg-paper p-3">
															<p className="text-xs text-ink-3">Lifetime</p>
															<p className="font-num mt-1 truncate text-sm font-medium tabular-nums text-ink">
																{formatMoney(billed, selectedCurrency, {
																	maximumFractionDigits: 0,
																})}
															</p>
															<p className="mt-1 text-[11px] text-ink-3">
																{intelligence.invoiceCount} matched invoices
															</p>
														</div>
														<div className="rounded-md border border-rule bg-paper p-3">
															<p className="text-xs text-ink-3">Avg invoice</p>
															<p className="font-num mt-1 truncate text-sm font-medium tabular-nums text-ink">
																{formatMoney(
																	intelligence.primaryCurrency
																		.averageInvoiceValue,
																	selectedCurrency,
																	{ maximumFractionDigits: 0 },
																)}
															</p>
															<p className="mt-1 text-[11px] text-ink-3">
																per invoice
															</p>
														</div>
														<div className="rounded-md border border-rule bg-paper p-3">
															<p className="text-xs text-ink-3">Pays in</p>
															<p className="font-num mt-1 truncate text-sm font-medium tabular-nums text-ink">
																{intelligence.averagePaymentDelayDays === null
																	? "—"
																	: `${Math.round(intelligence.averagePaymentDelayDays)} days`}
															</p>
															<p className="mt-1 text-[11px] text-ink-3">
																{intelligence.averagePaymentDelayDays === null
																	? "no paid invoices"
																	: "avg delay"}
															</p>
														</div>
													</div>

													{topProducts.length > 0 ? (
														<div>
															<div className="mb-2 flex items-baseline justify-between gap-2">
																<p className="text-xs font-medium text-ink-2">
																	Top purchased
																</p>
																<p className="text-[11px] text-ink-3">
																	by revenue
																</p>
															</div>
															<div className="flex flex-col gap-3">
																{topProducts.slice(0, 3).map((product) => (
																	<div key={product.name}>
																		<div className="flex items-baseline justify-between gap-3">
																			<span className="min-w-0 truncate text-sm text-ink">
																				{product.name}
																			</span>
																			<span className="font-num flex-none text-sm tabular-nums text-ink">
																				{formatMoney(
																					product.revenue,
																					selectedCurrency,
																					{ maximumFractionDigits: 0 },
																				)}
																			</span>
																		</div>
																		<p className="mt-0.5 text-xs text-ink-3">
																			{product.quantity} sold ·{" "}
																			{product.invoiceCount} invoice
																			{product.invoiceCount === 1 ? "" : "s"}
																		</p>
																		<div
																			role="progressbar"
																			aria-valuenow={Math.round(
																				(product.revenue / topRevenueMax) * 100,
																			)}
																			aria-valuemin={0}
																			aria-valuemax={100}
																			aria-label={`${product.name} share of revenue`}
																			className="mt-1.5 h-1 overflow-hidden rounded-full bg-paper-3"
																		>
																			<div
																				className="h-full rounded-full bg-brand"
																				style={{
																					width: `${((product.revenue / topRevenueMax) * 100).toFixed(1)}%`,
																				}}
																			/>
																		</div>
																	</div>
																))}
															</div>
														</div>
													) : null}

													{selectedInvoices.length > 0 ? (
														<div>
															<div className="mb-2 flex items-center justify-between gap-2">
																<p className="text-xs font-medium text-ink-2">
																	Recent invoices
																</p>
																<button
																	type="button"
																	onClick={() => setTab("invoices")}
																	className="text-xs font-medium text-brand hover:underline"
																>
																	View all
																</button>
															</div>
															<div className="flex flex-col gap-1.5">
																{selectedInvoices.slice(0, 3).map((invoice) => (
																	<div
																		key={invoice.id || invoice.invoiceNumber}
																		className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper px-3 py-2"
																	>
																		<div className="min-w-0">
																			<p className="truncate text-sm text-ink">
																				{invoice.invoiceNumber}
																			</p>
																			<p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
																				{formatInvoiceDate(invoice.issueDate)}
																				<StatusPill
																					tone={invoiceStatusTone(
																						invoice.status,
																					)}
																				>
																					{invoiceStatusLabel(invoice.status)}
																				</StatusPill>
																			</p>
																		</div>
																		<p className="font-num flex-none text-sm tabular-nums text-ink">
																			{formatMoney(
																				invoice.total,
																				invoice.currency,
																				{ maximumFractionDigits: 0 },
																			)}
																		</p>
																	</div>
																))}
															</div>
														</div>
													) : null}
												</div>
											)}
										</div>
									) : null}

									{tab === "invoices" ? (
										<div className="px-4 py-4">
											{intelligenceLoading ? (
												<div className="flex items-center gap-2 rounded-md border border-rule bg-paper-3 p-4 text-sm text-ink-3">
													<Spinner className="h-4 w-4" />
													Loading invoices
												</div>
											) : selectedInvoices.length === 0 ? (
												<EmptyState
													dashed
													title="No invoices yet"
													copy={`Invoices for ${selected.name} will show up here.`}
												/>
											) : (
												<>
													<p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3">
														<span>
															Draft{" "}
															<b className="font-num tabular-nums text-ink">
																{invoiceCountFor("draft")}
															</b>
														</span>
														<span>
															Sent{" "}
															<b className="font-num tabular-nums text-ink">
																{invoiceCountFor("sent")}
															</b>
														</span>
														<span>
															Paid{" "}
															<b className="font-num tabular-nums text-ink">
																{invoiceCountFor("paid")}
															</b>
														</span>
														<span>
															Canceled{" "}
															<b className="font-num tabular-nums text-ink">
																{invoiceCountFor("canceled")}
															</b>
														</span>
													</p>
													<div className="flex flex-col gap-1.5">
														{selectedInvoices.map((invoice) => (
															<div
																key={invoice.id || invoice.invoiceNumber}
																className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper px-3 py-2"
															>
																<div className="min-w-0">
																	<p className="truncate text-sm text-ink">
																		{invoice.invoiceNumber}
																	</p>
																	<p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
																		{formatInvoiceDate(invoice.issueDate)}
																		<StatusPill
																			tone={invoiceStatusTone(invoice.status)}
																		>
																			{invoiceStatusLabel(invoice.status)}
																		</StatusPill>
																	</p>
																</div>
																<p className="font-num flex-none text-sm tabular-nums text-ink">
																	{formatMoney(
																		invoice.total,
																		invoice.currency,
																		{
																			maximumFractionDigits: 0,
																		},
																	)}
																</p>
															</div>
														))}
													</div>
												</>
											)}
										</div>
									) : null}

									{tab === "details" ? (
										<div className="flex min-h-full flex-col">
											<form
												autoComplete="off"
												onSubmit={(event) => event.preventDefault()}
												className="flex flex-col gap-4 px-4 py-4"
											>
												<FormField label="Name">
													<Input
														value={editState.name}
														onChange={(event) =>
															setEditState((prev) => ({
																...prev,
																name: event.target.value,
															}))
														}
														className="h-10 rounded-md border-rule bg-paper text-sm text-ink"
													/>
												</FormField>
												<FormField label="Email">
													<Input
														type="email"
														value={editState.email}
														onChange={(event) =>
															setEditState((prev) => ({
																...prev,
																email: event.target.value,
															}))
														}
														className="h-10 rounded-md border-rule bg-paper text-sm text-ink"
													/>
												</FormField>
												<FormField label="Company">
													<Input
														value={editState.company}
														placeholder="Add a company name"
														onChange={(event) =>
															setEditState((prev) => ({
																...prev,
																company: event.target.value,
															}))
														}
														className="h-10 rounded-md border-rule bg-paper text-sm text-ink"
													/>
												</FormField>
												<FormField
													label="Payment terms"
													hint="Applied to every new invoice for this client."
												>
													<Select
														value={editState.paymentTerms}
														onValueChange={(value) =>
															setEditState((prev) => ({
																...prev,
																paymentTerms: value,
															}))
														}
													>
														<SelectTrigger className="h-10 rounded-md border-rule bg-paper text-sm text-ink">
															<SelectValue placeholder="Payment terms" />
														</SelectTrigger>
														<SelectContent className="border-rule bg-paper-2 text-ink">
															{termOptions.map((term) => (
																<SelectItem key={term} value={term}>
																	{term}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
												</FormField>
												<FormField label="Status">
													<Select
														value={editState.status}
														onValueChange={(value) =>
															setEditState((prev) => ({
																...prev,
																status: value as ClientStatus,
															}))
														}
													>
														<SelectTrigger className="h-10 rounded-md border-rule bg-paper text-sm text-ink">
															<SelectValue placeholder="Status" />
														</SelectTrigger>
														<SelectContent className="border-rule bg-paper-2 text-ink">
															<SelectItem value="active">Active</SelectItem>
															<SelectItem value="pending">Pending</SelectItem>
															<SelectItem value="inactive">Inactive</SelectItem>
															<SelectItem value="archived">Archived</SelectItem>
														</SelectContent>
													</Select>
												</FormField>
											</form>

											<div className="px-4 pb-2">
												<button
													type="button"
													onClick={() => void onArchiveStatusChange()}
													disabled={busyAction !== null}
													className="text-sm text-ink-3 hover:text-ink hover:underline disabled:opacity-50"
												>
													{busyAction === "archive"
														? "Archiving..."
														: busyAction === "restore"
															? "Restoring..."
															: selected.status === "archived"
																? "Restore client"
																: "Archive client"}
												</button>
											</div>

											<div className="px-4 pb-4">
												<div className="rounded-md border border-danger-line bg-danger-soft p-3">
													<p className="text-xs font-medium uppercase tracking-[0.12em] text-danger">
														Danger zone
													</p>
													<p className="mt-1 text-xs leading-5 text-ink-3">
														Delete only when this client should no longer appear
														in invoice workflows.
													</p>
													<Button
														type="button"
														variant="outline"
														onClick={() => setDeleteTargetId(selected.id)}
														disabled={busyAction !== null}
														className="mt-3 h-10 w-full rounded-md border-danger-line bg-transparent text-sm font-medium text-danger hover:bg-danger-soft"
													>
														Delete client
													</Button>
												</div>
											</div>

											<div className="sticky bottom-0 mt-auto flex items-center justify-between gap-3 border-t border-rule bg-paper-2 px-4 py-3">
												<span className="text-xs text-ink-3">
													{isDirty ? "Unsaved changes" : "All changes saved"}
												</span>
												<span className="flex items-center gap-2">
													<Button
														type="button"
														variant="outline"
														onClick={onDiscard}
														disabled={!isDirty || busyAction !== null}
														className="h-9 rounded-md border-rule bg-transparent px-3 text-sm text-ink-2 hover:bg-paper-3"
													>
														Discard
													</Button>
													<Button
														type="button"
														onClick={() => void onUpdate()}
														disabled={
															!isDirty || updateDisabled || busyAction !== null
														}
														className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:bg-brand-line disabled:text-brand-ink"
													>
														{busyAction === "update"
															? "Saving..."
															: "Save changes"}
													</Button>
												</span>
											</div>
										</div>
									) : null}
								</div>
							</>
						)}
					</motion.section>
				</div>
			</motion.div>

			<AlertDialog
				open={deleteTargetId !== null}
				onOpenChange={(open) => !open && setDeleteTargetId(null)}
			>
				<AlertDialogContent className="border-rule bg-paper-2 text-ink">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-ink">
							Delete client?
						</AlertDialogTitle>
						<AlertDialogDescription className="text-ink-3">
							This will permanently remove the client from your list.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="border-rule bg-transparent text-ink-2 hover:bg-paper-3">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void onDeleteConfirm()}
							className="bg-danger-soft text-danger hover:bg-danger-soft"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function timeAgo(timestamp: number) {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
	const deltaMs = Date.now() - timestamp;
	const minutes = Math.max(1, Math.floor(deltaMs / 60000));

	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ago`;
	const weeks = Math.floor(days / 7);
	return `${weeks}w ago`;
}

function formatAbsoluteDateTime(timestamp: number) {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(timestamp));
}
