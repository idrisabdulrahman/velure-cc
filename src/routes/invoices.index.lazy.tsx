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
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
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

type RevenueChartPoint = {
  key: string;
  label: string;
  paidRevenue: number;
  paidCount: number;
  unpaidRevenue: number;
  unpaidCount: number;
};

type InvoiceImportRow = {
  invoiceNumber?: string;
  customerName: string;
  currency?: string;
  status?: InvoiceStatus;
  issueDate?: string;
  dueDate?: string;
  description: string;
  quantity?: number;
  price?: number;
  notes?: string;
  paymentDetails?: string;
  paymentLink?: string;
};

const STATUS_OPTIONS: InvoiceStatus[] = [
  "draft",
  "unpaid",
  "paid",
  "overdue",
  "canceled",
  "scheduled",
];

const PENDING_STATUSES = new Set<InvoiceStatus>(["draft", "unpaid", "overdue", "scheduled"]);

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

function parseMoney(value?: string) {
  const cleaned = (value ?? "").replace(/[^\d.-]/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function parseInvoiceStatus(value?: string): InvoiceStatus | undefined {
  const status = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (status === "open") return "unpaid";
  if (status === "pending") return "unpaid";
  if (STATUS_OPTIONS.includes(status as InvoiceStatus)) return status as InvoiceStatus;
  return undefined;
}

function parseInvoiceCsv(text: string): InvoiceImportRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0] ?? "").map((header) =>
    header.toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
  const at = (cells: string[], names: string[]) => {
    const index = headers.findIndex((header) => names.includes(header));
    return index >= 0 ? cells[index]?.trim() : undefined;
  };

  const hasInvoiceShape =
    headers.some((header) => ["invoicenumber", "invoice", "invno", "number"].includes(header)) ||
    headers.some((header) => ["customername", "clientname", "customer", "client"].includes(header));

  if (!hasInvoiceShape) return [];

  return lines
    .slice(1)
    .map((line) => {
      const cells = parseCsvLine(line);
      const quantity = Math.max(1, parseMoney(at(cells, ["quantity", "qty", "units"])) || 1);
      const total = parseMoney(at(cells, ["amount", "total", "lineamount", "linetotal"]));
      const unitPrice = parseMoney(at(cells, ["price", "unitprice", "rate"]));
      const price = unitPrice > 0 ? unitPrice : total > 0 ? total / quantity : 0;

      return {
        invoiceNumber: at(cells, ["invoicenumber", "invoice", "invno", "number"]),
        customerName: at(cells, ["customername", "clientname", "customer", "client", "name"]) ?? "",
        currency: at(cells, ["currency", "curr"]),
        status: parseInvoiceStatus(at(cells, ["status", "state"])),
        issueDate: at(cells, ["issuedate", "date", "invoicedate"]),
        dueDate: at(cells, ["duedate", "due"]),
        description: at(cells, ["description", "item", "service", "product", "lineitem"]) ?? "",
        quantity,
        price,
        notes: at(cells, ["notes", "note", "memo"]),
        paymentDetails: at(cells, ["paymentdetails", "bankdetails"]),
        paymentLink: at(cells, ["paymentlink", "paylink"]),
      };
    })
    .filter((row) => row.customerName && row.description && (row.price ?? 0) > 0);
}

async function readXlsxAsCsv(file: File) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return "";
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return "";
  return XLSX.utils.sheet_to_csv(sheet);
}

function InvoicesIndex() {
  const saveInvoice = useMutation(api.invoices.save);
  const duplicateInvoice = useMutation(api.invoices.duplicate);
  const updateStatus = useMutation(api.invoices.updateStatus);
  const importInvoices = useMutation(api.invoices.importCsv);

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
        amount:
          invoice.compliance?.grandTotal !== undefined
            ? invoice.compliance.grandTotal - (invoice.compliance.withholdingTaxAmount ?? 0)
            : invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
      })),
    [invoices],
  );

  const customers = useMemo(() => {
    const names = invoices.map((invoice) => invoice.customerName.trim());
    return Array.from(new Set(names)).filter((customer) => customer.length > 0);
  }, [invoices]);
  const summaryCurrency = rows[0]?.currency ?? "USD";
  const revenueChartData = useMemo(() => buildRevenueChartData(rows), [rows]);

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
    await duplicateInvoice({ id: id as Id<"invoices"> });
    toast({ title: "Invoice duplicated", variant: "success" });
  };

  const onStatusChange = async (
    id: string,
    status: InvoiceStatus,
    details?: { paidAt?: number; paymentReference?: string },
  ) => {
    await updateStatus({ id: id as Id<"invoices">, status, ...details });
    toast({
      title: "Status updated",
      description: `Marked as ${status}.`,
      variant: "success",
    });
  };

  const onInvoiceImport = async (file: File | undefined) => {
    if (!file) return;

    try {
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
      const csvText = isXlsx ? await readXlsxAsCsv(file) : await file.text();
      const rows = parseInvoiceCsv(csvText);
      if (rows.length === 0) {
        toast({
          title: "No invoice rows found",
          description: "File needs customer/client, description/item, and price/amount columns.",
          variant: "error",
        });
        return;
      }

      const result = await importInvoices({ rows });
      toast({
        title: "Invoice import finished",
        description: `${result.created} created, ${result.skipped} skipped.`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Invoice import failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    }
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
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[#2b2d30] bg-[#17191b] px-3 text-sm font-medium text-[#d5d0c7] transition-colors hover:bg-[#1d2023]">
            <Upload className="h-4 w-4 text-[#a7bc62]" />
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv,.xlsx"
              className="hidden"
              onChange={(event) => {
                void onInvoiceImport(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard
          label="Open"
          value={formatMoney(summary?.open ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "draft" || invoice.status === "unpaid").length} invoices`}
          isLoading={summary === undefined}
        />
        <SummaryCard
          label="Overdue"
          value={formatMoney(summary?.overdue ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "overdue").length} invoices`}
          isLoading={summary === undefined}
        />
        <SummaryCard
          label="Paid"
          value={formatMoney(summary?.paid ?? 0, summaryCurrency)}
          meta={`${rows.filter((invoice) => invoice.status === "paid").length} invoices`}
          isLoading={summary === undefined}
        />
      </div>

      <RevenueTrendCard data={revenueChartData} currency={summaryCurrency} />

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
                                href={`/i/${encodeURIComponent(invoice.token)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex cursor-pointer items-center"
                              >
                                <Download className="mr-2 h-4 w-4" />
                                Preview download
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
          <div className="flex flex-col items-start gap-3 px-4 py-10 text-sm text-[#a29b90]">
            <div>
              <p className="font-medium text-[#ece7de]">No invoices yet.</p>
              <p className="mt-1">
                Create an invoice, add a client email, then share the Paystack-enabled public link.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="h-9 rounded-md bg-[#a7bc62] px-3 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
            >
              New invoice
            </Button>
          </div>
        ) : null}
      </div>

      <InvoiceDetailsSheet
        open={activeInvoiceId !== null}
        onOpenChange={(open) => {
          if (!open) setActiveInvoiceId(null);
        }}
        invoice={activeInvoice}
        onSave={async (invoice) => {
          const {
            createdAt: _createdAt,
            updatedAt: _updatedAt,
            ...saveable
          } = invoice;
          await saveInvoice({
            ...saveable,
            id: invoice.id as Id<"invoices">,
          });
        }}
        onStatusChange={async (id, status, details) => {
          await onStatusChange(id, status, details);
        }}
      />

      <CreateInvoiceSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  meta,
  isLoading,
}: {
  label: string;
  value: string;
  meta: string;
  isLoading?: boolean;
}) {
  return (
    <div className="ui-panel rounded-md border border-[#2b2d30] bg-[#17191b] px-4 py-4">
      <p className="text-sm text-[#8a857d]">{label}</p>
      {isLoading ? (
        <>
          <div className="mt-2 h-8 w-32 animate-pulse rounded bg-[#22252a]" />
          <div className="mt-2 h-5 w-24 animate-pulse rounded bg-[#22252a]" />
        </>
      ) : (
        <>
          <p className="mt-2 text-2xl font-semibold text-[#ece7de]">{value}</p>
          <p className="mt-1 text-sm text-[#a29b90]">{meta}</p>
        </>
      )}
    </div>
  );
}

function RevenueTrendCard({ data, currency }: { data: RevenueChartPoint[]; currency: string }) {
  return (
    <section className="ui-panel rounded-md border border-[#41463b] bg-[#17191b]/90 p-4 shadow-[0_0_0_rgba(167,188,98,0)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 hover:border-[#5f6d41] hover:shadow-[0_18px_60px_rgba(167,188,98,0.08)]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-[#ece7de]">Paid Invoices Over Time</h2>
          <p className="mt-1 text-xs text-[#8a857d]">Paid and open invoice value by month.</p>
        </div>
        <div className="flex items-center gap-4 text-xs font-medium">
          <span className="text-[#a7bc62]">● Paid</span>
          <span className="text-[#d48f8f]">● Unpaid</span>
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#2b2d30" strokeOpacity={0.35} vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#8a857d", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              width={72}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#8a857d", fontSize: 12 }}
              tickFormatter={(value) => formatCompactMoney(Number(value), currency)}
              domain={[0, "dataMax"]}
            />
            <Tooltip
              cursor={{ stroke: "#41463b", strokeWidth: 1 }}
              content={<RevenueTooltip currency={currency} />}
            />
            <Line
              type="monotone"
              dataKey="paidRevenue"
              stroke="#a7bc62"
              strokeWidth={3}
              dot={false}
              activeDot={{
                r: 5,
                fill: "#a7bc62",
                stroke: "#20241e",
                strokeWidth: 2,
              }}
              style={{ filter: "drop-shadow(0 0 8px rgba(167,188,98,0.42))" }}
            />
            <Line
              type="monotone"
              dataKey="unpaidRevenue"
              stroke="#d48f8f"
              strokeWidth={2.5}
              strokeDasharray="6 6"
              dot={false}
              activeDot={{
                r: 5,
                fill: "#d48f8f",
                stroke: "#2a1f1f",
                strokeWidth: 2,
              }}
              style={{ filter: "drop-shadow(0 0 8px rgba(212,143,143,0.28))" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function RevenueTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number | string;
    payload?: RevenueChartPoint;
  }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="min-w-[190px] rounded-md border border-[#2b2d30] bg-[#121314]/95 px-3 py-3 text-xs shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md">
      <p className="mb-2 font-medium text-[#ece7de]">{label}</p>
      <div className="space-y-2">
        <TooltipRow
          label="Paid"
          revenue={point.paidRevenue}
          count={point.paidCount}
          currency={currency}
          tone="paid"
        />
        <TooltipRow
          label="Unpaid"
          revenue={point.unpaidRevenue}
          count={point.unpaidCount}
          currency={currency}
          tone="unpaid"
        />
      </div>
    </div>
  );
}

function TooltipRow({
  label,
  revenue,
  count,
  currency,
  tone,
}: {
  label: string;
  revenue: number;
  count: number;
  currency: string;
  tone: "paid" | "unpaid";
}) {
  const toneClass = tone === "paid" ? "text-[#a7bc62]" : "text-[#d48f8f]";

  return (
    <div>
      <div className={`flex items-center justify-between gap-4 font-medium ${toneClass}`}>
        <span>{label}</span>
        <span>{formatMoney(revenue, currency)}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-4 text-[#a29b90]">
        <span>Revenue</span>
        <span>Count: {count} Invoices</span>
      </div>
    </div>
  );
}

function buildRevenueChartData(rows: InvoiceRow[]) {
  const months = new Map<string, RevenueChartPoint>();

  for (const month of getRecentMonthKeys(6)) {
    months.set(month.key, createEmptyPoint(month.key, month.label));
  }

  for (const invoice of rows) {
    if (invoice.status === "canceled") continue;

    const date = new Date(invoice.issueDate);
    if (Number.isNaN(date.getTime())) continue;

    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const point = months.get(key) ?? createEmptyPoint(key, formatMonthLabel(date));

    if (invoice.status === "paid") {
      point.paidRevenue += invoice.amount;
      point.paidCount += 1;
    } else if (PENDING_STATUSES.has(invoice.status)) {
      point.unpaidRevenue += invoice.amount;
      point.unpaidCount += 1;
    }

    months.set(key, point);
  }

  return Array.from(months.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function getRecentMonthKeys(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: formatMonthLabel(date) };
  });
}

function createEmptyPoint(key: string, label: string): RevenueChartPoint {
  return {
    key,
    label,
    paidRevenue: 0,
    paidCount: 0,
    unpaidRevenue: 0,
    unpaidCount: 0,
  };
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
}

function formatCompactMoney(value: number, currency: string) {
  if (value >= 1000) {
    return `${formatMoney(value / 1000, currency)}k`;
  }

  return formatMoney(value, currency);
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
  return formatInvoiceDate(value, "ng");
}
