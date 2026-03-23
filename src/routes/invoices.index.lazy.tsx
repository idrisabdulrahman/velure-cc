import { createLazyFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  CalendarDays,
  Copy,
  Download,
  ExternalLink,
  FileEdit,
  MoreHorizontal,
  Repeat2,
  Search,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Skeleton } from "#/components/ui/skeleton";
import { toast } from "#/components/ui/use-toast";
import { CreateInvoiceSheet } from "#/features/invoices/components/create-invoice-sheet";
import { InvoiceDetailsSheet } from "#/features/invoices/components/invoice-details-sheet";
import { formatMoney } from "#/features/invoices/format";
import type { InvoiceRecord, InvoiceStatus } from "#/features/invoices/types";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createLazyFileRoute("/invoices/")({
  component: InvoicesIndex,
});

type InvoiceTypeFilter = "all" | "one-time" | "recurring";

type InvoiceRow = InvoiceRecord & {
  amount: number;
};

const STATUS_OPTIONS: InvoiceStatus[] = [
  "draft",
  "unpaid",
  "paid",
  "overdue",
  "canceled",
  "scheduled",
];

function InvoicesIndex() {
  const saveInvoice = useMutation(api.invoices.save);
  const duplicateInvoice = useMutation(api.invoices.duplicate);
  const updateStatus = useMutation(api.invoices.updateStatus);

  const summary = useQuery(api.invoices.summary, {});

  const [activeInvoiceId, setActiveInvoiceId] = useState<Id<"invoices"> | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>("all");
  const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>("all");
  const [customerFilter, setCustomerFilter] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");

  const invoicesQuery = useQuery(api.invoices.list, {
    q: query,
    status: statusFilter,
    type: typeFilter,
    customer: customerFilter || undefined,
    dueDateFrom: dueDateFrom || undefined,
    dueDateTo: dueDateTo || undefined,
  });

  const invoices = (invoicesQuery ?? []) as InvoiceRecord[];
  const isInvoicesLoading = invoicesQuery === undefined;

  const activeInvoice = useQuery(
    api.invoices.getById,
    activeInvoiceId ? { id: activeInvoiceId } : "skip",
  );

  const rows: InvoiceRow[] = useMemo(
    () =>
      invoices.map((invoice: InvoiceRecord) => ({
        ...invoice,
        amount: invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
      })),
    [invoices],
  );

  const customers = useMemo(() => {
    const names = invoices.map((invoice) => invoice.customerName.trim());
    return Array.from(new Set(names)).filter((customer) => customer.length > 0);
  }, [invoices]);
  const summaryCurrency = rows[0]?.currency ?? "USD";

  const duePreset = (preset: "this-month" | "next-month" | "clear") => {
    if (preset === "clear") {
      setDueDateFrom("");
      setDueDateTo("");
      return;
    }

    const now = new Date();
    if (preset === "this-month") {
      setDueDateFrom(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
      setDueDateTo(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
      return;
    }

    setDueDateFrom(new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10));
    setDueDateTo(new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10));
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setCustomerFilter("");
    setDueDateFrom("");
    setDueDateTo("");
  };

  const hasActiveFilters =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    customerFilter.length > 0 ||
    dueDateFrom.length > 0 ||
    dueDateTo.length > 0;

  const copyPublicLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/i/${token}`);
      toast({
        title: "Invoice link copied",
        description: "Public preview URL copied to clipboard.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Could not copy link",
        description: "Clipboard permission denied.",
        variant: "error",
      });
    }
  };

  const onDuplicate = async (id: string) => {
    await duplicateInvoice({ id });
    toast({ title: "Invoice duplicated", variant: "success" });
  };

  const onStatusChange = async (id: string, status: InvoiceStatus) => {
    await updateStatus({ id, status });
    toast({
      title: "Status updated",
      description: `Marked as ${status}.`,
      variant: "success",
    });
  };

  return (
    <div className="flex h-full w-full flex-col gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Invoices</h1>
          <p className="mt-2 text-sm text-[#a29b90]">
            Review invoice status, search by customer, and keep the list moving.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-full min-w-[260px] items-center gap-2 rounded-md border border-[#2b2d30] bg-[#17191b] px-3 lg:w-[320px]">
            <Search className="h-4 w-4 text-[#8a857d]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search invoices"
              className="h-full w-full bg-transparent text-sm text-[#ece7de] outline-none placeholder:text-[#7f7a72]"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-10 rounded-md border border-[#2b2d30] bg-[#17191b] px-3 text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filters
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[220px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]"
            >
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="focus:bg-[#20241e]">
                  Due date
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[180px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]">
                  <DropdownMenuItem
                    onClick={() => duePreset("this-month")}
                    className="focus:bg-[#20241e]"
                  >
                    This month
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => duePreset("next-month")}
                    className="focus:bg-[#20241e]"
                  >
                    Next month
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => duePreset("clear")}
                    className="focus:bg-[#20241e]"
                  >
                    Clear
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="focus:bg-[#20241e]">
                  Customer
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-64 min-w-[220px] overflow-y-auto border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]">
                  <DropdownMenuItem
                    onClick={() => setCustomerFilter("")}
                    className="focus:bg-[#20241e]"
                  >
                    All customers
                  </DropdownMenuItem>
                  {customers.map((customer) => (
                    <DropdownMenuItem
                      key={customer}
                      onClick={() => setCustomerFilter(customer)}
                      className="focus:bg-[#20241e]"
                    >
                      {customer}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="focus:bg-[#20241e]">
                  Status
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[180px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]">
                  <DropdownMenuItem
                    onClick={() => setStatusFilter("all")}
                    className="focus:bg-[#20241e]"
                  >
                    All
                  </DropdownMenuItem>
                  {STATUS_OPTIONS.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => setStatusFilter(status)}
                      className="capitalize focus:bg-[#20241e]"
                    >
                      {status}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="focus:bg-[#20241e]">Type</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-[180px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]">
                  <DropdownMenuItem
                    onClick={() => setTypeFilter("all")}
                    className="focus:bg-[#20241e]"
                  >
                    All
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTypeFilter("one-time")}
                    className="focus:bg-[#20241e]"
                  >
                    One-time
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTypeFilter("recurring")}
                    className="focus:bg-[#20241e]"
                  >
                    Recurring
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
          >
            New invoice
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="Open"
          value={formatMoney(summary?.open ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "draft" || invoice.status === "unpaid").length} invoices`}
        />
        <SummaryCard
          label="Overdue"
          value={formatMoney(summary?.overdue ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "overdue").length} invoices`}
        />
        <SummaryCard
          label="Paid"
          value={formatMoney(summary?.paid ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "paid").length} invoices`}
        />
      </div>

      <div className="ui-panel overflow-hidden rounded-md border border-[#2b2d30] bg-[#17191b]">
        <div className="flex items-center justify-between border-b border-[#2b2d30] px-4 py-3">
          <p className="text-sm font-medium text-[#ece7de]">Invoice list</p>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="text-sm text-[#a7bc62] hover:text-[#b5c97a]"
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-[#15171a]">
              <tr className="border-b border-[#2b2d30] text-left text-[#8a857d]">
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Due date</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Issue date</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isInvoicesLoading
                ? ["row-1", "row-2", "row-3", "row-4", "row-5"].map((rowKey) => (
                    <tr key={rowKey} className="border-b border-[#2b2d30]">
                      {["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].map((cellKey) => (
                        <td key={`${rowKey}-${cellKey}`} className="px-4 py-3">
                          <Skeleton className="h-4 w-20 bg-[#22252a]" />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((invoice) => (
                    <tr
                      key={invoice.id}
                      className="border-b border-[#2b2d30] text-[#d5d0c7] transition-colors duration-150 hover:bg-[#1c1f22]"
                    >
                      <td className="px-4 py-3 font-medium text-[#ece7de]">
                        {invoice.invoiceNumber}
                      </td>
                      <td className="px-4 py-3">
                        <StatusChip status={invoice.status} />
                      </td>
                      <td className="px-4 py-3 text-[#b7b1a7]">{formatDate(invoice.dueDate)}</td>
                      <td className="px-4 py-3 text-[#ece7de]">{invoice.customerName || "-"}</td>
                      <td className="px-4 py-3 font-medium text-[#ece7de]">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </td>
                      <td className="px-4 py-3 text-[#b7b1a7]">{formatDate(invoice.issueDate)}</td>
                      <td className="px-4 py-3 text-[#b7b1a7] capitalize">
                        {invoice.type.replace("-", " ")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-8 w-8 rounded-md border border-[#2b2d30] bg-[#17191b] p-0 hover:bg-[#20241e]"
                            >
                              <MoreHorizontal className="h-4 w-4 text-[#d5d0c7]" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-[188px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]"
                          >
                            <DropdownMenuItem
                              onClick={() => setActiveInvoiceId(invoice.id as Id<"invoices">)}
                              className="focus:bg-[#20241e]"
                            >
                              <FileEdit className="mr-2 h-4 w-4" />
                              Edit invoice
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                window.open(`/i/${invoice.token}`, "_blank", "noopener,noreferrer")
                              }
                              className="focus:bg-[#20241e]"
                            >
                              <ExternalLink className="mr-2 h-4 w-4" />
                              Open invoice
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void copyPublicLink(invoice.token)}
                              className="focus:bg-[#20241e]"
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy link
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                              <a
                                href={`/api/invoice/download/${encodeURIComponent(invoice.id)}`}
                                className="flex cursor-pointer items-center"
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Download
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void onDuplicate(invoice.id)}
                              className="focus:bg-[#20241e]"
                            >
                              <Repeat2 className="mr-2 h-4 w-4" />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger className="focus:bg-[#20241e]">
                                <CalendarDays className="mr-2 h-4 w-4" />
                                Mark as paid
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent className="min-w-[250px] border-[#2b2d30] bg-[#17191b] p-2 text-[#ece7de]">
                                <button
                                  type="button"
                                  onClick={() => void onStatusChange(invoice.id, "paid")}
                                  className="mb-2 flex h-8 w-full items-center justify-center border border-[#2b2d30] bg-[#15171a] px-3 text-xs text-[#d5d0c7] transition-colors hover:bg-[#20241e]"
                                >
                                  Mark paid today
                                </button>
                                <Calendar
                                  mode="single"
                                  selected={new Date()}
                                  onSelect={(date) => {
                                    if (!date) return;
                                    void onStatusChange(invoice.id, "paid");
                                  }}
                                />
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>
                            <DropdownMenuItem
                              onClick={() => void onStatusChange(invoice.id, "canceled")}
                              className="text-[#d48f8f] focus:bg-[#2a1f1f] focus:text-[#efb1b1]"
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!isInvoicesLoading && rows.length === 0 ? (
          <div className="px-4 py-10 text-sm text-[#a29b90]">No invoices yet.</div>
        ) : null}
      </div>

      <InvoiceDetailsSheet
        open={activeInvoiceId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveInvoiceId(null);
        }}
        invoice={activeInvoice}
        onSave={async (invoice) => {
          await saveInvoice({
            ...invoice,
            id: invoice.id as Id<"invoices">,
          });
        }}
        onStatusChange={async (id, status) => {
          await onStatusChange(id, status);
        }}
      />

      <CreateInvoiceSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function SummaryCard({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="ui-panel rounded-md border border-[#2b2d30] bg-[#17191b] px-4 py-4">
      <p className="text-sm text-[#8a857d]">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-[#ece7de]">{value}</p>
      <p className="mt-1 text-sm text-[#a29b90]">{meta}</p>
    </div>
  );
}

function StatusChip({ status }: { status: InvoiceStatus }) {
  const styles: Record<InvoiceStatus, string> = {
    paid: "border-[#425033] bg-[#1e2418] text-[#b7ca7c]",
    unpaid: "border-[#5b4e34] bg-[#262016] text-[#d7bc7f]",
    overdue: "border-[#6b3f3f] bg-[#2c1b1b] text-[#df9b9b]",
    scheduled: "border-[#3c4740] bg-[#1a1f1c] text-[#b9c3b8]",
    canceled: "border-[#5d4747] bg-[#261c1c] text-[#d4a0a0]",
    draft: "border-[#373b40] bg-[#1c1f22] text-[#b7b1a7]",
  };

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium capitalize ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
