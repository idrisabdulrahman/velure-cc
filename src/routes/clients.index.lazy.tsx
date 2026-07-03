import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
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
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createLazyFileRoute("/clients/")({
	component: ClientsIndex,
});

type ClientStatus = "active" | "pending" | "inactive" | "archived";

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

function ClientsIndex() {
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
	const clientsFromQuery = (queryResult as ClientRow[] | undefined) ?? [];

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
			selectedClientPanelRef.current?.scrollIntoView({
				behavior: "smooth",
				block: "start",
			});
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
						<h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#f2efe7]">
							Clients
						</h1>
						<p className="mt-2 text-sm text-[#aaa294]">
							Keep contact details, billing defaults, and account status in one
							place.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#30352f] bg-[#171a18] px-3 text-sm text-[#d8d1c4] hover:bg-[#20241f]">
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
							className="h-10 w-full rounded-md border-[#30352f] bg-[#171a18] text-sm text-[#f2efe7] placeholder:text-[#817d72] focus-visible:ring-0 lg:w-[260px]"
						/>
						<Button
							asChild
							className="h-10 rounded-md bg-[#c8ff62] px-4 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
						>
							<Link to="/clients/new">New client</Link>
						</Button>
					</div>
				</div>

				<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
					<section className="ui-panel overflow-hidden rounded-md border border-[#30352f] bg-[#171a18]">
						<div className="border-b border-[#30352f] px-4 py-3">
							<p className="text-sm font-medium text-[#f2efe7]">
								Client directory
							</p>
						</div>

						<div className="overflow-x-auto">
							<table className="w-full min-w-[760px] text-sm">
								<thead className="bg-[#15171a]">
									<tr className="border-b border-[#30352f] text-left text-[#817d72]">
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
												className={`border-b border-[#30352f] ${
													selectedId === client.id
														? "cursor-pointer bg-[#1a2117] outline outline-1 outline-[#566438]"
														: "cursor-pointer transition-colors duration-150 hover:bg-[#1c1f22]"
												}`}
											>
												<td className="px-4 py-3">
													<span className="inline-flex items-center gap-2 font-medium text-[#f2efe7]">
														<span>{client.name}</span>
														{showFavoriteStar ? (
															<Star
																aria-label="Favorite client"
																className={`client-favorite-star h-3.5 w-3.5 fill-[#c8ff62] text-[#c8ff62] ${favoriteAnimationClass}`}
															/>
														) : null}
													</span>
												</td>
												<td className="px-4 py-3 text-[#beb6a8]">
													{client.company ?? "-"}
												</td>
												<td className="px-4 py-3 text-[#beb6a8]">
													{client.email}
												</td>
												<td className="px-4 py-3">
													<StatusChip status={client.status} />
												</td>
												<td className="px-4 py-3 text-[#aaa294]">
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
															className="h-9 w-9 rounded-md border border-[#30352f] bg-[#171a18] hover:bg-[#1a2117]"
														>
															<Star
																className={`h-4 w-4 ${
																	showFavoriteStar
																		? `fill-[#c8ff62] text-[#c8ff62] ${favoriteAnimationClass}`
																		: "text-[#817d72]"
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
																	className="h-9 w-9 rounded-md border border-[#30352f] bg-[#171a18] hover:bg-[#1a2117]"
																>
																	<MoreHorizontal className="h-4 w-4 text-[#d8d1c4]" />
																</Button>
															</DropdownMenuTrigger>
															<DropdownMenuContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
																<DropdownMenuItem
																	className="gap-2 focus:bg-[#1a2117]"
																	onClick={() => editClient(client.id)}
																>
																	<Pencil className="h-4 w-4" />
																	Edit
																</DropdownMenuItem>
																<DropdownMenuItem
																	className="gap-2 focus:bg-[#1a2117]"
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
																	className="gap-2 text-[#d48f8f] focus:bg-[#2a1f1f] focus:text-[#efb1b1]"
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
							<div className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-[#aaa294]">
								<div>
									<p className="font-medium text-[#f2efe7]">
										No clients found.
									</p>
									<p className="mt-1">
										Add client name, email, tax ID, currency, and payment terms
										before sending invoices.
									</p>
								</div>
								<Button
									asChild
									className="h-9 rounded-md bg-[#c8ff62] px-3 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
								>
									<Link to="/clients/new">New client</Link>
								</Button>
							</div>
						) : null}
					</section>

					<motion.section
						ref={selectedClientPanelRef}
						tabIndex={-1}
						className="ui-stagger-2 rounded-md border border-[#30352f] bg-[#171a18] outline-none"
						initial={{ opacity: 0, x: 8 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
					>
						<div className="border-b border-[#30352f] px-4 py-3">
							<p className="text-sm font-medium text-[#f2efe7]">
								Selected client
							</p>
						</div>

						<div className="space-y-4 p-4">
							{!selected ? (
								<p className="text-sm text-[#aaa294]">
									Select a client from the table.
								</p>
							) : (
								<>
									<div className="border-b border-[#30352f] pb-4">
										<p className="text-lg font-medium text-[#f2efe7]">
											{selected.company || selected.name}
										</p>
										<p className="mt-1 text-sm text-[#aaa294]">
											{selected.email}
										</p>
									</div>

									<ClientIntelligencePanel
										intelligence={intelligence}
										isLoading={intelligenceLoading}
									/>

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
											setEditState((prev) => ({ ...prev, paymentTerms: value }))
										}
									/>

									<div className="space-y-2">
										<Label className="text-sm text-[#beb6a8]">Status</Label>
										<Select
											value={editState.status}
											onValueChange={(value) =>
												setEditState((prev) => ({
													...prev,
													status: value as ClientStatus,
												}))
											}
										>
											<SelectTrigger className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7]">
												<SelectValue placeholder="Status" />
											</SelectTrigger>
											<SelectContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
												<SelectItem value="active">active</SelectItem>
												<SelectItem value="pending">pending</SelectItem>
												<SelectItem value="inactive">inactive</SelectItem>
												<SelectItem value="archived">archived</SelectItem>
											</SelectContent>
										</Select>
									</div>

									<div className="space-y-2 border-t border-[#30352f] pt-4">
										<Button
											type="button"
											onClick={() => void onUpdate()}
											disabled={updateDisabled || busyAction !== null}
											className="h-10 w-full rounded-md bg-[#c8ff62] text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a] disabled:bg-[#4f642f] disabled:text-[#0f1111]"
										>
											{busyAction === "update" ? "Updating..." : "Save changes"}
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={() => void onArchiveStatusChange()}
											disabled={busyAction !== null}
											className="h-10 w-full rounded-md border-[#30352f] bg-transparent text-sm font-medium text-[#d8d1c4] hover:bg-[#20241f]"
										>
											{archiveStatusActionLabel}
										</Button>
									</div>
									<div className="rounded-md border border-[#5d4747] bg-[#1a1515] p-3">
										<p className="text-xs font-medium uppercase tracking-[0.12em] text-[#d48f8f]">
											Danger zone
										</p>
										<p className="mt-1 text-xs leading-5 text-[#aaa294]">
											Delete only when this client should no longer appear in
											invoice workflows.
										</p>
										<Button
											type="button"
											variant="outline"
											onClick={() => setDeleteTargetId(selected.id)}
											disabled={busyAction !== null}
											className="mt-3 h-10 w-full rounded-md border-[#5d4747] bg-transparent text-sm font-medium text-[#d48f8f] hover:bg-[#2a1f1f]"
										>
											Delete client
										</Button>
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
				<AlertDialogContent className="border-[#30352f] bg-[#171a18] text-[#f2efe7]">
					<AlertDialogHeader>
						<AlertDialogTitle className="text-[#f2efe7]">
							Delete client?
						</AlertDialogTitle>
						<AlertDialogDescription className="text-[#aaa294]">
							This will permanently remove the client from your list.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel className="border-[#30352f] bg-transparent text-[#d8d1c4] hover:bg-[#20241f]">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void onDeleteConfirm()}
							className="bg-[#563333] text-[#f0d1d1] hover:bg-[#6a4040]"
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
			<div className="rounded-md border border-[#30352f] bg-[#111413] p-4">
				<div className="flex items-center gap-2 text-sm text-[#aaa294]">
					<Spinner className="h-4 w-4" />
					Loading client intelligence
				</div>
			</div>
		);
	}

	if (!intelligence || intelligence.invoiceCount === 0) {
		return (
			<div className="rounded-md border border-dashed border-[#30352f] bg-[#111413] p-4">
				<p className="text-sm font-medium text-[#f2efe7]">No billing history</p>
				<p className="mt-1 text-xs leading-5 text-[#aaa294]">
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
		<div className="space-y-3 rounded-md border border-[#30352f] bg-[#111413] p-4">
			<div className="flex items-center justify-between gap-3">
				<div>
					<p className="text-sm font-medium text-[#f2efe7]">
						Client intelligence
					</p>
					<p className="mt-1 text-xs text-[#817d72]">
						{intelligence.invoiceCount} matched invoices
						{intelligence.lastInvoiceDate
							? ` · last ${formatInvoiceDate(intelligence.lastInvoiceDate)}`
							: ""}
					</p>
				</div>
				<BarChart3 className="h-4 w-4 text-[#c8ff62]" />
			</div>

			<div className="grid gap-2 sm:grid-cols-2">
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
				<p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[#817d72]">
					Top purchased
				</p>
				{intelligence.topProducts.length === 0 ? (
					<p className="text-xs text-[#aaa294]">No line item history yet.</p>
				) : (
					<div className="space-y-2">
						{intelligence.topProducts.slice(0, 3).map((product) => (
							<div
								className="flex items-center justify-between gap-3 rounded-md border border-[#262b28] bg-[#0f1111] px-3 py-2"
								key={product.name}
							>
								<div className="min-w-0">
									<p className="truncate text-sm text-[#f2efe7]">
										{product.name}
									</p>
									<p className="text-xs text-[#817d72]">
										{product.quantity} sold · {product.invoiceCount} invoices
									</p>
								</div>
								<p className="shrink-0 text-xs font-medium text-[#c8ff62]">
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
				<p className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-[#817d72]">
					Recent invoices
				</p>
				<div className="space-y-2">
					{intelligence.recentInvoices.slice(0, 3).map((invoice) => (
						<div
							className="flex items-center justify-between gap-3 rounded-md border border-[#262b28] bg-[#0f1111] px-3 py-2"
							key={invoice.id || invoice.invoiceNumber}
						>
							<div className="min-w-0">
								<p className="truncate text-sm text-[#f2efe7]">
									{invoice.invoiceNumber}
								</p>
								<p className="text-xs text-[#817d72]">
									{formatInvoiceDate(invoice.issueDate)} · {invoice.status}
								</p>
							</div>
							<p className="shrink-0 text-xs font-medium text-[#d8d1c4]">
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
		<div className="rounded-md border border-[#262b28] bg-[#0f1111] p-3">
			<div className="flex items-center gap-2 text-xs text-[#817d72]">
				<Icon className="h-3.5 w-3.5" />
				{label}
			</div>
			<p className="mt-2 break-words text-sm font-medium text-[#f2efe7]">
				{value}
			</p>
		</div>
	);
}

function PanelLoader({ label }: { label: string }) {
	return (
		<motion.div
			className="flex min-h-[156px] flex-col items-center justify-center gap-3 px-4 py-8 text-sm text-[#aaa294]"
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
			<Label className="text-sm text-[#beb6a8]">{label}</Label>
			<Input
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7]"
			/>
		</div>
	);
}

function StatusChip({ status }: { status: ClientStatus }) {
	const styles: Record<ClientStatus, string> = {
		active: "border-[#425033] bg-[#1e2418] text-[#b7ca7c]",
		pending: "border-[#5b4e34] bg-[#262016] text-[#d7bc7f]",
		inactive: "border-[#373b40] bg-[#1c1f22] text-[#beb6a8]",
		archived: "border-[#4b4343] bg-[#231d1d] text-[#c1b2b2]",
	};

	return (
		<span
			className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium capitalize ${styles[status]}`}
		>
			{status}
		</span>
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
