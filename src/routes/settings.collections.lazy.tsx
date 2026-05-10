import { createLazyFileRoute } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate } from "#/features/invoices/format";
import { api } from "../../convex/_generated/api";

export const Route = createLazyFileRoute("/settings/collections")({
  component: CollectionsSettingsPage,
});

function CollectionsSettingsPage() {
  const settings = useQuery(api.reminders.getReminderSettings, {});
  const invoices = useQuery(api.invoices.list, { q: "", status: "all" }) ?? [];
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const timeline = useQuery(
    api.reminders.getInvoiceTimeline,
    selectedInvoiceId ? { invoiceId: selectedInvoiceId as any } : "skip",
  );
  const saveSettings = useMutation(api.reminders.saveReminderSettings);
  const pauseReminders = useMutation(api.reminders.pauseInvoiceReminders);
  const resumeReminders = useMutation(api.reminders.resumeInvoiceReminders);
  const markManualException = useMutation(api.reminders.markManualException);
  const queueReminderEvent = useMutation(api.reminders.queueReminderEvent);
  const runReminderBatch = useAction(api.reminders.runReminderBatch);
  const sendQueuedEmails = useAction(api.reminders.sendQueuedEmails);
  const [note, setNote] = useState("");
  const [policy, setPolicy] = useState({
    enabled: true,
    daysBeforeDue: 3,
    onDueDate: true,
    overdueCadenceDays: 3,
    maxOverdueReminders: 3,
    escalateAfterCount: 2,
    businessSignature: "Velure Finance Team",
  });

  const selectedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
    [invoices, selectedInvoiceId],
  );

  useEffect(() => {
    if (!settings) return;
    setPolicy({
      enabled: settings.enabled,
      daysBeforeDue: settings.daysBeforeDue,
      onDueDate: settings.onDueDate,
      overdueCadenceDays: settings.overdueCadenceDays,
      maxOverdueReminders: settings.maxOverdueReminders,
      escalateAfterCount: settings.escalateAfterCount,
      businessSignature: settings.businessSignature,
    });
  }, [settings]);

  if (!settings) {
    return <div className="text-sm text-[#a29b90]">Loading collections settings…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Collections</h1>
        <p className="mt-2 text-sm text-[#a29b90]">
          Manage customer follow-ups for unpaid invoices. Reminders go to the buyer email saved on
          each invoice.
        </p>
      </div>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-[#ece7de]">Automatic reminder schedule</h2>
          <p className="text-sm text-[#a29b90]">
            Set the default follow-up timing once, then use the actions below to check invoices,
            send reminders, and escalate overdue ones.
          </p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">1. Find due invoices</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              Scan today’s invoices and queue the ones that need a reminder.
            </p>
          </div>
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">2. Email the customer</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              Reminder emails go straight to the buyer email saved on the invoice.
            </p>
          </div>
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">3. Review exceptions</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              Pause reminders or mark invoices for manual follow-up when a customer needs special
              handling.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">First reminder</p>
            <Input
              type="number"
              value={policy.daysBeforeDue}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  daysBeforeDue: Number(event.target.value) || 0,
                }))
              }
              className="border-[#2b2d30] bg-[#121314]"
            />
            <p className="text-xs text-[#a29b90]">
              Days before the due date to send the first reminder.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">Overdue gap</p>
            <Input
              type="number"
              value={policy.overdueCadenceDays}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  overdueCadenceDays: Number(event.target.value) || 0,
                }))
              }
              className="border-[#2b2d30] bg-[#121314]"
            />
            <p className="text-xs text-[#a29b90]">
              Days to wait between each overdue follow-up email.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
              Overdue email limit
            </p>
            <Input
              type="number"
              value={policy.maxOverdueReminders}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  maxOverdueReminders: Number(event.target.value) || 0,
                }))
              }
              className="border-[#2b2d30] bg-[#121314]"
            />
            <p className="text-xs text-[#a29b90]">
              Maximum number of overdue emails to send automatically.
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">Review after</p>
            <Input
              type="number"
              value={policy.escalateAfterCount}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  escalateAfterCount: Number(event.target.value) || 0,
                }))
              }
              className="border-[#2b2d30] bg-[#121314]"
            />
            <p className="text-xs text-[#a29b90]">
              After this many overdue reminders, treat the invoice as manual follow-up.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button
            type="button"
            className="bg-[#a7bc62] text-[#121314] hover:bg-[#b5c97a]"
            onClick={async () => {
              await saveSettings({
                enabled: policy.enabled,
                daysBeforeDue: policy.daysBeforeDue,
                onDueDate: policy.onDueDate,
                overdueCadenceDays: policy.overdueCadenceDays,
                maxOverdueReminders: policy.maxOverdueReminders,
                escalateAfterCount: policy.escalateAfterCount,
                businessSignature: policy.businessSignature,
              });
              toast({ title: "Reminder schedule saved", variant: "success" });
            }}
          >
            Save reminder schedule
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            onClick={async () => {
              const result = await runReminderBatch({});
              toast({
                title: "Reminder batch completed",
                description: `${result.queuedCount} reminders queued for ${result.date}.`,
                variant: "success",
              });
            }}
          >
            Find invoices that need reminders
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            onClick={async () => {
              const result = await sendQueuedEmails({});
              toast({
                title: "Email reminder run finished",
                description: result.reason ?? `${result.sent} email reminders processed.`,
                variant: "success",
              });
            }}
          >
            Send queued customer emails
          </Button>
        </div>
        <p className="mt-3 text-xs text-[#a29b90]">
          Customer reminders use the buyer email saved on the invoice. Velure will not send a
          reminder when that email is missing.
        </p>
      </section>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-[#ece7de]">Single invoice actions</h2>
          <p className="text-sm text-[#a29b90]">
            Use this when one invoice needs special handling outside the automatic schedule.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <select
            value={selectedInvoiceId ?? ""}
            onChange={(event) => setSelectedInvoiceId(event.target.value || null)}
            className="h-10 min-w-[260px] rounded-md border border-[#2b2d30] bg-[#121314] px-3 text-sm text-[#ece7de] outline-none"
          >
            <option value="">Select invoice</option>
            {invoices.map((invoice) => (
              <option key={invoice.id} value={invoice.id}>
                {invoice.invoiceNumber} • {invoice.customerName}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            disabled={!selectedInvoice}
            onClick={async () => {
              if (!selectedInvoice) return;
              await queueReminderEvent({
                invoiceId: selectedInvoice.id as any,
                stage: "before_due",
                channel: "email",
                meta: "Manual queue from collections page",
              });
              toast({ title: "Reminder queued", variant: "success" });
            }}
          >
            Send one reminder now
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            disabled={!selectedInvoice}
            onClick={async () => {
              if (!selectedInvoice) return;
              await pauseReminders({
                invoiceId: selectedInvoice.id as any,
                note: note || undefined,
              });
              toast({ title: "Reminders paused", variant: "success" });
            }}
          >
            Pause automatic reminders
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            disabled={!selectedInvoice}
            onClick={async () => {
              if (!selectedInvoice) return;
              await resumeReminders({ invoiceId: selectedInvoice.id as any });
              toast({ title: "Reminders resumed", variant: "success" });
            }}
          >
            Resume automatic reminders
          </Button>
        </div>
        {selectedInvoice ? (
          <p className="mt-3 text-xs text-[#a29b90]">
            Customer reminders will be sent to{" "}
            {selectedInvoice.compliance?.buyer?.email ??
              "the buyer email on this invoice once it is added"}
            .
          </p>
        ) : null}
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a note for your team, for example: customer promised payment on Friday."
          className="mt-4 border-[#2b2d30] bg-[#121314]"
        />
        <div className="mt-3">
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            disabled={!selectedInvoice || note.trim().length === 0}
            onClick={async () => {
              if (!selectedInvoice) return;
              await markManualException({
                invoiceId: selectedInvoice.id as any,
                note: note.trim(),
              });
              toast({ title: "Marked for manual review", variant: "success" });
            }}
          >
            Mark this invoice for manual follow-up
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          <div className="pb-1">
            <p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">Activity history</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              Shows what reminder actions have already happened for the selected invoice.
            </p>
          </div>
          {(timeline ?? []).map((event) => (
            <div
              key={event._id}
              className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3"
            >
              <p className="text-sm font-medium capitalize text-[#ece7de]">
                {event.stage.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs text-[#a29b90]">
                {event.channel} • {event.status} {event.meta ? `• ${event.meta}` : ""}
              </p>
              <p className="mt-1 text-xs text-[#7d7b74]">
                {formatInvoiceDate(event.sentAt ?? event.scheduledFor ?? event.createdAt)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
