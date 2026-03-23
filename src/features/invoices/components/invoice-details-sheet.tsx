import {
  ArrowDownToLine,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Send,
  Share2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FaTelegram, FaWhatsapp } from "react-icons/fa6";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#/components/ui/accordion";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "#/components/ui/sheet";
import { toast } from "#/components/ui/use-toast";
import { invoiceTotal } from "#/features/invoices/calculate";
import { formatMoney } from "#/features/invoices/format";
import type { InvoiceLineItem, InvoiceRecord } from "#/features/invoices/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceRecord | null | undefined;
  onSave: (invoice: InvoiceRecord) => Promise<void> | void;
  onStatusChange?: (id: string, status: InvoiceRecord["status"]) => Promise<void> | void;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function shareLinks(invoice: InvoiceRecord) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const encodedId = encodeURIComponent(invoice.id);
  const publicUrl = `${origin}/i/${invoice.token}`;
  const pdfUrl = `${origin}/api/invoice/download/${encodedId}`;
  const text = `Invoice ${invoice.invoiceNumber} for ${invoice.customerName}`;

  const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(text)}`;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${publicUrl}`)}`;

  return { publicUrl, pdfUrl, telegramHref, whatsappHref };
}

function serializeInvoiceDraft(invoice: InvoiceRecord) {
  return JSON.stringify({
    id: invoice.id,
    token: invoice.token,
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customerName,
    logoUrl: invoice.logoUrl,
    currency: invoice.currency,
    type: invoice.type,
    invoiceSize: invoice.invoiceSize,
    dateFormat: invoice.dateFormat,
    paymentTermsDays: invoice.paymentTermsDays,
    template: invoice.template,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    paymentDetails: invoice.paymentDetails,
    notes: invoice.notes,
    lineItems: invoice.lineItems,
  });
}

function NumberStepperInput({
  value,
  disabled,
  min,
  step,
  onChange,
}: {
  value: number;
  disabled: boolean;
  min: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const apply = (next: number) => {
    const rounded = step < 1 ? Math.round(next * 100) / 100 : Math.round(next);
    onChange(Math.max(min, rounded));
  };

  return (
    <div className="relative">
      <input
        disabled={disabled}
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => apply(Number(event.target.value) || min)}
        className="h-9 w-full rounded border border-[#1A1D22] bg-[#0D1016] px-2 pr-8 text-xs text-[#F2F3F5] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />

      <div className="absolute right-1 top-1 flex h-7 flex-col justify-between">
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(value + step)}
          className="flex h-3 w-4 items-center justify-center rounded-[2px] border border-[#2A351A] bg-[#C8FF1A]/12 text-[#C8FF1A] transition-colors hover:bg-[#C8FF1A]/22 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Increase value"
        >
          <ChevronUp className="h-2.5 w-2.5" />
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply(value - step)}
          className="flex h-3 w-4 items-center justify-center rounded-[2px] border border-[#2A351A] bg-[#C8FF1A]/12 text-[#C8FF1A] transition-colors hover:bg-[#C8FF1A]/22 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Decrease value"
        >
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </div>
    </div>
  );
}

export function InvoiceDetailsSheet({
  open,
  onOpenChange,
  invoice,
  onSave,
  onStatusChange,
}: Props) {
  const [draft, setDraft] = useState<InvoiceRecord | null>(invoice ?? null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savePillState, setSavePillState] = useState<"idle" | "saved" | "error">("idle");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const lastSavedSnapshotRef = useRef("");
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(invoice ?? null);
    setEditing(false);
    setSaving(false);
    setEmailStatus(null);
    lastSavedSnapshotRef.current = invoice ? serializeInvoiceDraft(invoice) : "";
  }, [invoice?.id]);

  useEffect(() => {
    if (!editing) {
      setDraft(invoice ?? null);
      lastSavedSnapshotRef.current = invoice ? serializeInvoiceDraft(invoice) : "";
    }
  }, [invoice, editing]);

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
      if (savePillTimeoutRef.current) clearTimeout(savePillTimeoutRef.current);
    };
  }, []);

  const showSavePill = (state: "saved" | "error") => {
    if (savePillTimeoutRef.current) clearTimeout(savePillTimeoutRef.current);
    setSavePillState(state);
    savePillTimeoutRef.current = setTimeout(() => {
      setSavePillState("idle");
    }, 1400);
  };

  const persistDraft = async (nextDraft: InvoiceRecord, { closeEditing = false } = {}) => {
    const snapshot = serializeInvoiceDraft(nextDraft);
    if (snapshot === lastSavedSnapshotRef.current) {
      if (closeEditing) setEditing(false);
      return;
    }

    setSaving(true);
    try {
      await onSave(nextDraft);
      lastSavedSnapshotRef.current = snapshot;
      showSavePill("saved");
      if (closeEditing) setEditing(false);
    } catch (error) {
      showSavePill("error");
      toast({
        title: "Could not save invoice",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
      throw error;
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!editing || !draft) return;

    const snapshot = serializeInvoiceDraft(draft);
    if (snapshot === lastSavedSnapshotRef.current) return;

    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(() => {
      setSaving(true);
      void onSave(draft)
        .then(() => {
          lastSavedSnapshotRef.current = snapshot;
          showSavePill("saved");
        })
        .catch((error) => {
          showSavePill("error");
          toast({
            title: "Could not save invoice",
            description: error instanceof Error ? error.message : "Unknown error",
            variant: "error",
          });
        })
        .finally(() => {
          setSaving(false);
        });
    }, 650);

    return () => {
      if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    };
  }, [draft, editing, onSave]);

  const updateLine = (
    id: string,
    patch: Partial<Pick<InvoiceLineItem, "name" | "quantity" | "price">>,
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lineItems: prev.lineItems.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      };
    });
  };

  const addLineItem = () => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lineItems: [
          ...prev.lineItems,
          {
            id: `li-${crypto.randomUUID()}`,
            name: "",
            quantity: 1,
            price: 0,
          },
        ],
      };
    });
  };

  const onSaveDraft = async () => {
    if (!draft) return;
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    try {
      await persistDraft(draft, { closeEditing: true });
    } catch {
      return;
    }
  };

  const onSendEmail = async () => {
    if (!draft) return;
    const to = recipientEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(to)) {
      setEmailStatus("Enter a valid email address.");
      return;
    }

    setIsSendingEmail(true);
    setEmailStatus(null);

    try {
      const response = await fetch(`/api/invoice/send/${encodeURIComponent(draft.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to }),
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        setEmailStatus(payload.error ?? "Failed to send invoice email.");
        return;
      }

      setEmailStatus("Invoice email sent.");
    } catch {
      setEmailStatus("Failed to send invoice email.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  const activityItems = draft
    ? [
        {
          id: "issued",
          label: "Invoice issued",
          meta: formatDate(draft.issueDate),
          description: `Created as ${draft.status.toUpperCase()}.`,
          icon: FileText,
        },
        {
          id: "due",
          label: "Payment due",
          meta: formatDate(draft.dueDate),
          description: "Expected settlement date for this invoice.",
          icon: CalendarClock,
        },
        {
          id: "status",
          label: "Current status",
          meta: draft.status.toUpperCase(),
          description: "Latest workflow state applied to this invoice.",
          icon: CheckCircle2,
        },
      ]
    : [];

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="overflow-y-auto border-[#1A1D22] bg-[#0D1016] text-[#F2F3F5]"
          title={draft ? `Invoice ${draft.invoiceNumber}` : "Invoice details"}
        >
          {draft ? (
            <div className="space-y-6">
              <SheetHeader className="space-y-1 text-left">
                <SheetTitle className="font-serif text-[30px] italic tracking-tight text-[#F2F3F5]">
                  {draft.invoiceNumber}
                </SheetTitle>
                <SheetDescription className="text-xs text-[#8A8F99]">
                  {draft.customerName || "Untitled customer"}
                </SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap gap-2">
                {editing ? (
                  <>
                    <Button
                      disabled={saving}
                      onClick={onSaveDraft}
                      className="h-8 rounded-sm bg-[#d8d5cd] px-3 text-xs font-medium text-[#0c0d0f] hover:bg-[#e6e2d9]"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          Saving
                        </>
                      ) : (
                        "Done"
                      )}
                    </Button>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setEditing(false);
                        setDraft(invoice ?? null);
                      }}
                      variant="ghost"
                      className="h-8 rounded-sm border border-[#1A1D22] bg-[#0A0D12] px-3 text-xs"
                    >
                      Revert
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={() => setEditing(true)}
                    variant="ghost"
                    className="h-8 rounded-sm border border-[#1A1D22] bg-[#0A0D12] px-3 text-xs"
                  >
                    Edit invoice
                  </Button>
                )}
              </div>

              <div className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A8F99]">
                    Line items
                  </p>
                </div>

                <div className="space-y-2">
                  {draft.lineItems.map((item) => (
                    <div key={item.id} className="grid grid-cols-[1fr_72px_96px] gap-2">
                      <input
                        disabled={!editing}
                        value={item.name}
                        onChange={(event) => updateLine(item.id, { name: event.target.value })}
                        className="h-9 rounded border border-[#1A1D22] bg-[#0D1016] px-2 text-xs text-[#F2F3F5]"
                        placeholder="Item description"
                      />
                      <NumberStepperInput
                        disabled={!editing}
                        value={item.quantity}
                        min={1}
                        step={1}
                        onChange={(quantity) => updateLine(item.id, { quantity })}
                      />
                      <NumberStepperInput
                        disabled={!editing}
                        value={item.price}
                        min={0}
                        step={0.01}
                        onChange={(price) => updateLine(item.id, { price })}
                      />
                    </div>
                  ))}

                  {editing && (
                    <Button
                      onClick={addLineItem}
                      variant="ghost"
                      className="h-9 w-full justify-center rounded-sm border border-[#2A351A] bg-[#C8FF1A]/10 px-3 text-[11px] font-semibold text-[#C8FF1A] hover:bg-[#C8FF1A]/18 hover:text-[#D9FF66]"
                    >
                      + Add item
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A8F99]">
                    Amount
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#F2F3F5] font-mono">
                    {formatMoney(invoiceTotal(draft), draft.currency)}
                  </p>
                </div>
                <div className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A8F99]">
                      Status
                    </p>
                    {onStatusChange ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="h-6 rounded-sm border border-[#1A1D22] bg-[#0D1016] px-2 text-[10px] uppercase tracking-[0.08em] text-[#9BA3B0]"
                          >
                            Update
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5]"
                        >
                          {["draft", "unpaid", "paid", "overdue", "canceled", "scheduled"].map(
                            (status) => (
                              <DropdownMenuItem
                                key={status}
                                onClick={async () => {
                                  if (!draft) return;
                                  await onStatusChange(draft.id, status as InvoiceRecord["status"]);
                                  setDraft((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          status: status as InvoiceRecord["status"],
                                        }
                                      : prev,
                                  );
                                }}
                                className="text-xs uppercase"
                              >
                                {status}
                              </DropdownMenuItem>
                            ),
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#F2F3F5] uppercase">
                    {draft.status}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#8A8F99]">
                  Share invoice
                </p>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <input
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    type="email"
                    placeholder="client@email.com"
                    className="h-8 rounded-sm border border-[#1A1D22] bg-[#0D1016] px-2 text-xs text-[#F2F3F5] placeholder:text-[#6E7582]"
                  />
                  <Button
                    onClick={onSendEmail}
                    disabled={isSendingEmail}
                    variant="ghost"
                    className="h-8 rounded-sm border border-[#1A1D22] bg-[#0D1016] px-3 text-xs hover:bg-[#151A22]"
                  >
                    {isSendingEmail ? (
                      <>
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {emailStatus ? (
                  <p className="mt-2 text-[11px] text-[#8A8F99]">{emailStatus}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={shareLinks(draft).telegramHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Share on Telegram"
                    title="Share on Telegram"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[#1A1D22] bg-[#0D1016] text-[#AEB6C2] hover:bg-[#151A22] hover:text-[#F2F3F5]"
                  >
                    <FaTelegram className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={shareLinks(draft).whatsappHref}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Share on WhatsApp"
                    title="Share on WhatsApp"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[#1A1D22] bg-[#0D1016] text-[#AEB6C2] hover:bg-[#151A22] hover:text-[#F2F3F5]"
                  >
                    <FaWhatsapp className="h-3.5 w-3.5" />
                  </a>
                  <Button
                    onClick={async () => {
                      const links = shareLinks(draft);
                      if (navigator.share) {
                        await navigator.share({
                          title: `Invoice ${draft.invoiceNumber}`,
                          text: `Invoice for ${draft.customerName}`,
                          url: links.publicUrl,
                        });
                        return;
                      }
                      await navigator.clipboard.writeText(links.publicUrl);
                    }}
                    variant="ghost"
                    aria-label="Share invoice link"
                    title="Share invoice link"
                    className="h-8 w-8 rounded-sm border border-[#1A1D22] bg-[#0D1016] p-0 text-[#AEB6C2] hover:bg-[#151A22] hover:text-[#F2F3F5]"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                  <button
                    type="button"
                    onClick={() =>
                      window.open(`/i/${draft.token}`, "_blank", "noopener,noreferrer")
                    }
                    aria-label="Open invoice"
                    title="Open invoice"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[#1A1D22] bg-[#0D1016] text-[#AEB6C2] hover:bg-[#151A22] hover:text-[#F2F3F5]"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={shareLinks(draft).pdfUrl}
                    aria-label="Download PDF"
                    title="Download PDF"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-[#1A1D22] bg-[#0D1016] text-[#AEB6C2] hover:bg-[#151A22] hover:text-[#F2F3F5]"
                  >
                    <ArrowDownToLine className="h-3.5 w-3.5" />
                  </a>
                  <div className="ml-1 text-[11px] text-[#67707D]">
                    Use the icons to share, preview, or download.
                  </div>
                </div>
              </div>

              <Accordion type="multiple" defaultValue={["activity"]}>
                <AccordionItem value="activity" className="border-[#1A1D22]">
                  <AccordionTrigger className="py-3 text-sm font-medium">
                    Activity timeline
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="pt-2">
                      <div className="relative ml-3 border-l border-[#1F2630] pl-6">
                        {activityItems.map((item) => {
                          const Icon = item.icon;
                          return (
                            <div key={item.id} className="relative pb-5 last:pb-0">
                              <div className="absolute -left-[35px] top-1 flex h-5 w-5 items-center justify-center rounded-full border border-[#2A351A] bg-[#18210F] text-[#C8FF1A]">
                                <Icon className="h-3 w-3" />
                              </div>
                              <div className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <p className="text-xs font-medium text-[#F2F3F5]">{item.label}</p>
                                  <p className="text-[10px] font-mono uppercase tracking-[0.08em] text-[#8A8F99]">
                                    {item.meta}
                                  </p>
                                </div>
                                <p className="mt-1 text-[11px] text-[#7E8794]">
                                  {item.description}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="note" className="border-[#1A1D22]">
                  <AccordionTrigger className="py-3 text-sm font-medium">
                    Internal note
                  </AccordionTrigger>
                  <AccordionContent>
                    {editing ? (
                      <textarea
                        value={draft.notes ?? ""}
                        onChange={(event) =>
                          setDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                        }
                        className="min-h-24 w-full rounded-md border border-[#1A1D22] bg-[#0A0D12] p-3 text-sm text-[#B7BECA]"
                      />
                    ) : (
                      <p className="rounded-md border border-[#1A1D22] bg-[#0A0D12] p-3 text-sm text-[#B7BECA]">
                        {draft.notes?.trim() || "No note added yet."}
                      </p>
                    )}
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          ) : (
            <div className="py-8 text-sm text-[#8A8F99]">Loading invoice details...</div>
          )}
        </SheetContent>
      </Sheet>
      {savePillState !== "idle" ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-[110] -translate-x-1/2">
          <div
            className={`inline-flex items-center border px-3 py-1.5 text-[12px] font-medium shadow-[0_14px_30px_rgba(0,0,0,0.35)] ${
              savePillState === "saved"
                ? "border-[#2d3625] bg-[#141a12] text-[#d8e3b4]"
                : "border-[#4d2b2b] bg-[#211314] text-[#efb1b1]"
            }`}
          >
            {savePillState === "saved" ? "Saved" : "Could not save"}
          </div>
        </div>
      ) : null}
    </>
  );
}
