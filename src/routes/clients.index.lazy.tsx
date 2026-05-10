import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Pencil, Star, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { toast } from "#/components/ui/use-toast";

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

  const [query, setQuery] = useState("");
  const queryResult = useQuery(api.clients.list, {
    q: query,
    status: "all",
  });
  const isLoading = queryResult === undefined;
  const clientsFromQuery = (queryResult as ClientRow[] | undefined) ?? [];

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [selectedId, setSelectedId] = useState<Id<"clients"> | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<Id<"clients"> | null>(null);
  const [busyAction, setBusyAction] = useState<"update" | "archive" | "delete" | null>(null);

  useEffect(() => {
    setClients(clientsFromQuery);
  }, [clientsFromQuery]);

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
    !selected || editState.name.trim().length === 0 || !/^\S+@\S+\.\S+$/.test(editState.email);

  const patchLocal = (id: Id<"clients">, updater: (client: ClientRow) => ClientRow) => {
    setClients((prev) => prev.map((client) => (client.id === id ? updater(client) : client)));
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

  const onArchive = async () => {
    if (!selected) return;

    const snapshot = clients;
    patchLocal(selected.id, (client) => ({
      ...client,
      status: "archived",
      updatedAt: Date.now(),
    }));

    setBusyAction("archive");
    try {
      await archiveClient({ id: selected.id });
      toast({ title: "Client archived", variant: "success" });
    } catch (error) {
      setClients(snapshot);
      toast({
        title: "Archive failed",
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

  const onToggleFavorite = async () => {
    if (!selected) return;

    const nextFavorite = !selected.favorite;
    const snapshot = clients;
    patchLocal(selected.id, (client) => ({
      ...client,
      favorite: nextFavorite,
      updatedAt: Date.now(),
    }));

    try {
      await toggleFavorite({ id: selected.id });
    } catch (error) {
      setClients(snapshot);
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
      toast({
        title: "Client import finished",
        description: `${result.created} created, ${result.skipped} skipped.`,
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

  return (
    <>
      <div className="flex h-full w-full flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Clients</h1>
            <p className="mt-2 text-sm text-[#a29b90]">
              Keep contact details, billing defaults, and account status in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#2b2d30] bg-[#17191b] px-3 text-sm text-[#d5d0c7] hover:bg-[#1d2023]">
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search clients"
              className="h-10 w-full rounded-md border-[#2b2d30] bg-[#17191b] text-sm text-[#ece7de] placeholder:text-[#7f7a72] focus-visible:ring-0 lg:w-[260px]"
            />
            <Button
              asChild
              className="h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
            >
              <Link to="/clients/new">New client</Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="ui-panel overflow-hidden rounded-md border border-[#2b2d30] bg-[#17191b]">
            <div className="border-b border-[#2b2d30] px-4 py-3">
              <p className="text-sm font-medium text-[#ece7de]">Client directory</p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[#15171a]">
                  <tr className="border-b border-[#2b2d30] text-left text-[#8a857d]">
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Company</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client) => (
                    <tr
                      key={client.id}
                      className={`border-b border-[#2b2d30] ${
                        selectedId === client.id
                          ? "bg-[#1d2023]"
                          : "transition-colors duration-150 hover:bg-[#1c1f22]"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(client.id)}
                          className="text-left font-medium text-[#ece7de] hover:text-white"
                        >
                          {client.name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-[#b7b1a7]">{client.company ?? "—"}</td>
                      <td className="px-4 py-3 text-[#b7b1a7]">{client.email}</td>
                      <td className="px-4 py-3">
                        <StatusChip status={client.status} />
                      </td>
                      <td className="px-4 py-3 text-[#a29b90]">{timeAgo(client.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-md border border-[#2b2d30] bg-[#17191b] hover:bg-[#20241e]"
                            >
                              <MoreHorizontal className="h-4 w-4 text-[#d5d0c7]" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="border-[#2b2d30] bg-[#17191b] text-[#ece7de]">
                            <DropdownMenuItem
                              className="gap-2 focus:bg-[#20241e]"
                              onClick={() => setSelectedId(client.id)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {isLoading ? (
              <div className="flex px-4 py-8 text-sm text-[#a29b90]">Loading clients...</div>
            ) : clients.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-4 py-8 text-sm text-[#a29b90]">
                <div>
                  <p className="font-medium text-[#ece7de]">No clients found.</p>
                  <p className="mt-1">
                    Add client name, email, tax ID, currency, and payment terms before sending
                    invoices.
                  </p>
                </div>
                <Button
                  asChild
                  className="h-9 rounded-md bg-[#a7bc62] px-3 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
                >
                  <Link to="/clients/new">New client</Link>
                </Button>
              </div>
            ) : null}
          </section>

          <section className="ui-stagger-2 rounded-md border border-[#2b2d30] bg-[#17191b]">
            <div className="border-b border-[#2b2d30] px-4 py-3">
              <p className="text-sm font-medium text-[#ece7de]">Selected client</p>
            </div>

            <div className="space-y-4 p-4">
              {!selected ? (
                <p className="text-sm text-[#a29b90]">Select a client from the table.</p>
              ) : (
                <>
                  <div className="border-b border-[#2b2d30] pb-4">
                    <p className="text-lg font-medium text-[#ece7de]">
                      {selected.company || selected.name}
                    </p>
                    <p className="mt-1 text-sm text-[#a29b90]">{selected.email}</p>
                  </div>

                  <LabeledInput
                    label="Name"
                    value={editState.name}
                    onChange={(value) => setEditState((prev) => ({ ...prev, name: value }))}
                  />
                  <LabeledInput
                    label="Email"
                    value={editState.email}
                    onChange={(value) => setEditState((prev) => ({ ...prev, email: value }))}
                  />
                  <LabeledInput
                    label="Company"
                    value={editState.company}
                    onChange={(value) => setEditState((prev) => ({ ...prev, company: value }))}
                  />
                  <LabeledInput
                    label="Payment terms"
                    value={editState.paymentTerms}
                    onChange={(value) => setEditState((prev) => ({ ...prev, paymentTerms: value }))}
                  />

                  <div className="space-y-2">
                    <Label className="text-sm text-[#b7b1a7]">Status</Label>
                    <Select
                      value={editState.status}
                      onValueChange={(value) =>
                        setEditState((prev) => ({ ...prev, status: value as ClientStatus }))
                      }
                    >
                      <SelectTrigger className="h-10 rounded-md border-[#2b2d30] bg-[#121314] text-sm text-[#ece7de]">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className="border-[#2b2d30] bg-[#17191b] text-[#ece7de]">
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="inactive">inactive</SelectItem>
                        <SelectItem value="archived">archived</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2 border-t border-[#2b2d30] pt-4">
                    <Button
                      type="button"
                      onClick={() => void onUpdate()}
                      disabled={updateDisabled || busyAction !== null}
                      className="h-10 w-full rounded-md bg-[#a7bc62] text-sm font-medium text-[#121314] hover:bg-[#b5c97a] disabled:bg-[#66704e] disabled:text-[#121314]"
                    >
                      {busyAction === "update" ? "Updating..." : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onArchive()}
                      disabled={busyAction !== null}
                      className="h-10 w-full rounded-md border-[#2b2d30] bg-transparent text-sm font-medium text-[#d5d0c7] hover:bg-[#1d2023]"
                    >
                      {busyAction === "archive" ? "Archiving..." : "Archive client"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteTargetId(selected.id)}
                      disabled={busyAction !== null}
                      className="h-10 w-full rounded-md border-[#5d4747] bg-transparent text-sm font-medium text-[#d48f8f] hover:bg-[#2a1f1f]"
                    >
                      Delete client
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void onToggleFavorite()}
                      className="h-10 w-full rounded-md border-[#2b2d30] bg-transparent text-sm font-medium text-[#d5d0c7] hover:bg-[#1d2023]"
                    >
                      <Star className="mr-2 h-4 w-4" />
                      {selected.favorite ? "Remove favorite" : "Save as favorite"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </div>

      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => !open && setDeleteTargetId(null)}
      >
        <AlertDialogContent className="border-[#2b2d30] bg-[#17191b] text-[#ece7de]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#ece7de]">Delete client?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#a29b90]">
              This will permanently remove the client from your list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-[#2b2d30] bg-transparent text-[#d5d0c7] hover:bg-[#1d2023]">
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
      <Label className="text-sm text-[#b7b1a7]">{label}</Label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border-[#2b2d30] bg-[#121314] text-sm text-[#ece7de]"
      />
    </div>
  );
}

function StatusChip({ status }: { status: ClientStatus }) {
  const styles: Record<ClientStatus, string> = {
    active: "border-[#425033] bg-[#1e2418] text-[#b7ca7c]",
    pending: "border-[#5b4e34] bg-[#262016] text-[#d7bc7f]",
    inactive: "border-[#373b40] bg-[#1c1f22] text-[#b7b1a7]",
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
