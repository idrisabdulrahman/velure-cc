import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import {
	Archive,
	BarChart3,
	Clock3,
	CreditCard,
	MoreHorizontal,
	Pencil,
	ReceiptText,
	RotateCcw,
	Star,
	Trash2,
	Upload,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { Label } from "#/components/ui/label";
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
import { api } from "#convex/_generated/api";
import type { Id } from "#convex/_generated/dataModel";

type ClientStatus = "active" | "pending" | "inactive" | "archived";

const clientStatusStamp: Record<ClientStatus, string> = {
	active: "hm-ts-stamp is-ok",
	pending: "hm-ts-stamp is-warn",
	inactive: "hm-ts-stamp is-paper",
	archived: "hm-ts-stamp is-danger",
};

type ClientRow = {
	id: Id<"clients">;
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
	id: Id<"clients">;
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

export function ClientsIndex() {
	const updateClient = useMutation(api.clients.update);
	const archiveClient = useMutation(api.clients.archive);
	const removeClient = useMutation(api.clients.remove);
	const toggleFavorite = useMutation(api.clients.toggleFavorite);
	const importClients = useMutation(api.clients.importCsv);
	const selectedClientPanelRef = useRef<HTMLElement | null>(null);
	const favoriteAnimationTimeoutRef = useRef<number | null>(null);

	const [, startTransition] = useTransition();
	const [query, setQuery] = useState("");
	const { data: queryResult, isPending: isLoading } = useQuery(
		convexQuery(api.clients.list, {
			q: query,
			status: "all",
		}),
	);
	const clientsFromQuery = useMemo(
		() => (queryResult as ClientRow[] | undefined) ?? [],
		[queryResult],
	);

	const [clients, setClients] = useState<ClientRow[]>([]);
	const [selectedId, setSelectedId] = useState<Id<"clients"> | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<Id<"clients"> | null>(
		null,
	);
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
		...convexQuery(api.clients.getIntelligence, { id: selectedId! }),
		enabled,
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

	const patchLocal = (
		id: Id<"clients">,
		updater: (client: ClientRow) => ClientRow,
	) => {
		setClients((prev) =>
			prev.map((client) => (client.id === id ? updater(client) : client)),
		);
	};

	const animateFavoriteChange = (
		id: Id<"clients">,
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
			await updateClient({
				id: selected.id,
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
			if (isRestore) {
				await updateClient({
					id: clientToUpdate.id,
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
				await archiveClient({ id: clientToUpdate.id });
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
			await removeClient({ id: deleteTargetId });
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
			await toggleFavorite({ id: clientToUpdate.id });
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
			const result = await importClients({ clients: rows });
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

	const selectClient = (id: Id<"clients">) => {
		setSelectedId(id);
	};

	const editClient = (id: Id<"clients">) => {
		selectClient(id);
		window.requestAnimationFrame(() => {
			selectedClientPanelRef.current?.focus({ preventScroll: true });
		});
	};

	const openClientMenu = (id: Id<"clients">) => {
		selectClient(id);
	};

	const onClientRowKeyDown = (
		event: KeyboardEvent<HTMLTableRowElement>,
		id: Id<"clients">,
	) => {
		if (event.key !== "Enter" && event.key !== " ") return;

		event.preventDefault();
		selectClient(id);
	};

	const archiveStatusActionLabel = (() => {
		if (busyAction === "archive") return "Archiving...";
		if (busyAction === "restore") return "Restoring...";
		return selected?.status === "archived"
			? "Restore client"
			: "Archive client";
	})();
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
							Keep contact details, billing defaults, and account status in one
							place.
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
						<Input
							value={query}
							onChange={(event) =>
								startTransition(() => setQuery(event.target.value))
							}
							placeholder="Search clients"
							className="h-10 w-full rounded-md border-rule bg-paper-2 text-sm text-ink placeholder:text-ink-3 focus-visible:ring-0 lg:w-[260px]"
						/>
						<Button
							asChild
							className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
						>
							<Link to="/clients/new">New client</Link>
						</Button>
					</div>
				</div>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
					<section className="ui-panel overflow-hidden rounded-md border border-rule bg-paper-2 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto">
						<div className="border-b border-rule px-4 py-3">
							<p className="text-sm font-medium text-ink">Client directory</p>
						</div>

						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] text-sm">
								<thead className="bg-paper-3">
									<tr className="border-b border-rule text-left text-ink-3">
										<th className="px-4 py-3 font-medium">Client</th>
										<th className="px-4 py-3 font-medium">Company</th>
										<th className="px-4 py-3 font-medium">Email</th>
										<th className="px-4 py-3 font-medium">Status</th>
										<th className="px-4 py-3 font-medium">Updated</th>
										<th className="px-4 py-3 text-right font-medium">
											Actions
										</th>
									</tr>
								</thead>
								<tbody>
									{clients.map((client) => {
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

										return (
											<tr
												key={client.id}
												tabIndex={0}
												aria-label={`Select ${client.name}`}
												aria-selected={selectedId === client.id}
												onClick={() => selectClient(client.id)}
												onKeyDown={(event) =>
													onClientRowKeyDown(event, client.id)
												}
												className={`border-b border-rule ${
													selectedId === client.id
														? "cursor-pointer bg-brand-soft outline-1 outline-brand"
														: "cursor-pointer transition-colors duration-150 hover:bg-primary/20 focus-visible:outline  focus-visible:outline-brand"
												}`}
											>
												<td className="px-4 py-3">
													<span className="inline-flex items-center gap-2 font-medium text-ink">
														<span>{client.name}</span>
														{showFavoriteStar ? (
															<Star
																aria-label="Favorite client"
																className={`client-favorite-star h-3.5 w-3.5 fill-brand text-brand ${favoriteAnimationClass}`}
															/>
														) : null}
													</span>
												</td>
												<td className="px-4 py-3 text-ink-3">
													{client.company ?? "-"}
												</td>
												<td className="px-4 py-3 text-ink-3">{client.email}</td>
												<td className="px-4 py-3">
													<span className={clientStatusStamp[client.status]}>
														{client.status}
													</span>
												</td>
												<td className="px-4 py-3 text-ink-3">
													<span
														title={formatAbsoluteDateTime(client.updatedAt)}
													>
														{timeAgo(client.updatedAt)}
													</span>
												</td>
												<td
													className="px-4 py-3 text-right"
													onClick={(event) => event.stopPropagation()}
													onKeyDown={(event) => event.stopPropagation()}
												>
													<div className="inline-flex items-center justify-end gap-2">
														<Button
															type="button"
															variant="ghost"
															size="icon"
															onClick={() => {
																void onToggleFavoriteForClient(client);
															}}
															aria-label={
																client.favorite
																	? `Remove ${client.name} from favorites`
																	: `Add ${client.name} to favorites`
															}
															className="h-9 w-9 rounded-md border border-rule bg-paper-2 hover:bg-brand-soft"
														>
															<Star
																className={`h-4 w-4 ${
																	showFavoriteStar
																		? `fill-brand text-brand ${favoriteAnimationClass}`
																		: "text-ink-3"
																}`}
															/>
														</Button>
														<DropdownMenu>
															<DropdownMenuTrigger asChild>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon"
																	onClick={() => openClientMenu(client.id)}
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
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>

						{isLoading ? (
							<PanelLoader label="Loading clients" />
						) : clients.length === 0 ? (
							<div className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-ink-3">
								<div>
									<p className="font-medium text-ink">No clients found.</p>
									<p className="mt-1">
										Add client name, email, tax ID, currency, and payment terms
										before sending invoices.
									</p>
								</div>
								<Button
									asChild
									className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
								>
									<Link to="/clients/new">New client</Link>
								</Button>
							</div>
						) : null}
					</section>

					<motion.section
						ref={selectedClientPanelRef}
						tabIndex={-1}
						className="ui-stagger-2 flex max-h-[calc(100vh-12rem)] flex-col overflow-hidden rounded-md border border-rule bg-paper-2 outline-none xl:sticky xl:top-4"
						initial={{ opacity: 0, x: 8 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
					>
						<div className="border-b border-rule px-4 py-3">
							<p className="text-sm font-medium text-ink">Selected client</p>
						</div>

						<div className="overflow-y-auto">
							{!selected ? (
								<p className="p-4 text-sm text-ink-3">
									Select a client from the table.
								</p>
							) : (
								<>
									<div className="border-b border-rule px-4 py-4">
										<p className="text-lg font-semibold text-ink">
											{selected.company || selected.name}
										</p>
										<p className="mt-1 text-sm text-ink-3">{selected.email}</p>
									</div>

									<div className="px-4 py-4">
										<ClientIntelligencePanel
											intelligence={intelligence}
											isLoading={intelligenceLoading}
										/>
									</div>

									<div className="border-t border-rule px-4 py-4">
										<p className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
											Edit details
										</p>
										<div className="space-y-3">
											<LabeledInput
												label="Name"
												value={editState.name}
												onChange={(value) =>
													setEditState((prev) => ({ ...prev, name: value }))
												}
											/>
											<LabeledInput
												label="Email"
												value={editState.email}
												onChange={(value) =>
													setEditState((prev) => ({ ...prev, email: value }))
												}
											/>
											<LabeledInput
												label="Company"
												value={editState.company}
												onChange={(value) =>
													setEditState((prev) => ({ ...prev, company: value }))
												}
											/>
											<LabeledInput
												label="Payment terms"
												value={editState.paymentTerms}
												onChange={(value) =>
													setEditState((prev) => ({
														...prev,
														paymentTerms: value,
													}))
												}
											/>
											<div className="space-y-2">
												<Label className="text-sm text-ink-3">Status</Label>
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
											</div>
										</div>
									</div>

									<div className="border-t border-rule px-4 py-4">
										<div className="space-y-2">
											<Button
												type="button"
												onClick={() => void onUpdate()}
												disabled={updateDisabled || busyAction !== null}
												className="h-10 w-full rounded-md bg-brand text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:bg-brand-line disabled:text-brand-ink"
											>
												{busyAction === "update"
													? "Updating..."
													: "Save changes"}
											</Button>
											<Button
												type="button"
												variant="outline"
												onClick={() => void onArchiveStatusChange()}
												disabled={busyAction !== null}
												className="h-10 w-full rounded-md border-rule bg-transparent text-sm font-medium text-ink-2 hover:bg-paper-3"
											>
												{archiveStatusActionLabel}
											</Button>
										</div>
									</div>

									<div className="px-4 pb-4">
										<div className="rounded-md border border-danger-line bg-danger-soft p-3">
											<p className="text-xs font-medium uppercase tracking-[0.12em] text-danger">
												Danger zone
											</p>
											<p className="mt-1 text-xs leading-5 text-ink-3">
												Delete only when this client should no longer appear in
												invoice workflows.
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
								</>
							)}
						</div>
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

function ClientIntelligencePanel({
	intelligence,
	isLoading,
}: {
	intelligence: ClientIntelligence | null;
	isLoading: boolean;
}) {
	if (isLoading) {
		return (
			<div className="rounded-md border border-rule bg-paper-3 p-4">
				<div className="flex items-center gap-2 text-sm text-ink-3">
					<Spinner className="h-4 w-4" />
					Loading client intelligence
				</div>
			</div>
		);
	}

	if (!intelligence || intelligence.invoiceCount === 0) {
		return (
			<div className="rounded-md border border-dashed border-rule bg-paper-3 p-4">
				<p className="text-sm font-medium text-ink">No billing history</p>
				<p className="mt-1 text-xs leading-5 text-ink-3">
					Metrics appear after this client has matching invoices.
				</p>
			</div>
		);
	}

	const primary = intelligence.primaryCurrency;
	const averageDelay =
		intelligence.averagePaymentDelayDays === null
			? "No paid invoices"
			: `${Math.round(intelligence.averagePaymentDelayDays)} days`;

	return (
		<div className="space-y-4 rounded-md border border-rule bg-paper-3 p-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium text-ink">Client intelligence</p>
					<p className="mt-0.5 text-xs text-ink-3">
						{intelligence.invoiceCount} matched invoices
						{intelligence.lastInvoiceDate
							? ` · last ${formatInvoiceDate(intelligence.lastInvoiceDate)}`
							: ""}
					</p>
				</div>
				<BarChart3 className="h-4 w-4 text-brand" />
			</div>

			<div className="grid grid-cols-2 gap-2">
				<IntelligenceMetric
					icon={ReceiptText}
					label="Lifetime value"
					value={formatMoney(primary.totalRevenue, primary.currency)}
				/>
				<IntelligenceMetric
					icon={CreditCard}
					label="Outstanding"
					value={formatMoney(primary.outstandingBalance, primary.currency)}
				/>
				<IntelligenceMetric
					icon={ReceiptText}
					label="Average invoice"
					value={formatMoney(primary.averageInvoiceValue, primary.currency)}
				/>
				<IntelligenceMetric
					icon={Clock3}
					label="Avg payment delay"
					value={averageDelay}
				/>
			</div>

			<div>
				<p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
					Top purchased
				</p>{" "}
				{intelligence.topProducts.length === 0 ? (
					<p className="text-xs text-ink-3">No line item history yet.</p>
				) : (
					<div className="space-y-1.5">
						{intelligence.topProducts.slice(0, 3).map((product) => (
							<div
								className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper px-3 py-2"
								key={product.name}
							>
								<div className="min-w-0">
									<p className="truncate text-sm text-ink">{product.name}</p>
									<p className="text-xs text-ink-3">
										{product.quantity} sold · {product.invoiceCount} invoices
									</p>
								</div>
								<p className="shrink-0 text-xs font-medium text-brand">
									{formatMoney(product.revenue, primary.currency, {
										maximumFractionDigits: 0,
									})}
								</p>
							</div>
						))}
					</div>
				)}
			</div>

			<div>
				<p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
					Recent invoices
				</p>
				<div className="space-y-1.5">
					{" "}
					{intelligence.recentInvoices.slice(0, 3).map((invoice) => (
						<div
							className="flex items-center justify-between gap-3 rounded-md border border-rule bg-paper px-3 py-2"
							key={invoice.id || invoice.invoiceNumber}
						>
							<div className="min-w-0">
								<p className="truncate text-sm text-ink">
									{invoice.invoiceNumber}
								</p>
								<p className="text-xs text-ink-3">
									{formatInvoiceDate(invoice.issueDate)} · {invoice.status}
								</p>
							</div>
							<p className="shrink-0 text-xs font-medium text-ink-2">
								{formatMoney(invoice.total, invoice.currency, {
									maximumFractionDigits: 0,
								})}
							</p>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function IntelligenceMetric({
	icon: Icon,
	label,
	value,
}: {
	icon: typeof BarChart3;
	label: string;
	value: string;
}) {
	return (
		<div className="rounded-md border border-rule bg-paper p-3">
			<div className="flex items-center gap-2 text-xs text-ink-3">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<p className="mt-2 break-words text-sm font-medium text-ink">{value}</p>
		</div>
	);
}

function LabeledInput({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			<Label className="text-sm text-ink-3">{label}</Label>
			<Input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-10 rounded-md border-rule bg-paper text-sm text-ink"
			/>
		</div>
	);
}

function timeAgo(timestamp: number) {
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
