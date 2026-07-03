import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	AlertCircle,
	CheckCircle2,
	Loader2,
	type LucideIcon,
	MailCheck,
	PauseCircle,
	SearchCheck,
	UserCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate } from "#/features/invoices/format";
import type { InvoiceStatus } from "#/features/invoices/types";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createFileRoute("/settings/collections")({
	beforeLoad: async ({ context }) => {
		await Promise.all([
			context.queryClient.prefetchQuery(
				convexQuery(api.reminders.getReminderSettings, {}),
			),
			context.queryClient.prefetchQuery(
				convexQuery(api.reminders.getCollectionOverview, {
					daysBeforeDue: 3,
				}),
			),
		]);
	},
	component: PaymentRemindersSettingsPage,
});

type ReminderPolicyErrors = Partial<{
	daysBeforeDue: string;
	overdueCadenceDays: string;
	maxOverdueReminders: string;
	escalateAfterCount: string;
	businessSignature: string;
}>;

function validateReminderPolicy(policy: {
	daysBeforeDue: number;
	overdueCadenceDays: number;
	maxOverdueReminders: number;
	escalateAfterCount: number;
	businessSignature: string;
}): ReminderPolicyErrors {
	const errors: ReminderPolicyErrors = {};

	if (!Number.isInteger(policy.daysBeforeDue) || policy.daysBeforeDue < 0) {
		errors.daysBeforeDue = "First reminder must be 0 or more days before due.";
	}
	if (
		!Number.isInteger(policy.overdueCadenceDays) ||
		policy.overdueCadenceDays < 1
	) {
		errors.overdueCadenceDays = "Overdue gap must be at least 1 day.";
	}
	if (
		!Number.isInteger(policy.maxOverdueReminders) ||
		policy.maxOverdueReminders < 0 ||
		policy.maxOverdueReminders > 3
	) {
		errors.maxOverdueReminders = "Overdue email limit must be between 0 and 3.";
	}
	if (
		!Number.isInteger(policy.escalateAfterCount) ||
		policy.escalateAfterCount < 0 ||
		policy.escalateAfterCount > policy.maxOverdueReminders
	) {
		errors.escalateAfterCount =
			"Review threshold must be between 0 and the email limit.";
	}
	if (policy.businessSignature.trim().length > 80) {
		errors.businessSignature = "Signature must be 80 characters or less.";
	}

	return errors;
}

function PaymentRemindersSettingsPage() {
	const { data: settings } = useQuery(
		convexQuery(api.reminders.getReminderSettings, {}),
	);
	const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
		null,
	);
	const timelineEnabled = selectedInvoiceId !== null;
	const { data: timeline } = useQuery({
		...convexQuery(api.reminders.getInvoiceTimeline, {
			invoiceId: selectedInvoiceId as Id<"invoices">,
		}),
		enabled: timelineEnabled,
	});
	const saveSettings = useMutation(api.reminders.saveReminderSettings);
	const pauseReminders = useMutation(api.reminders.pauseInvoiceReminders);
	const resumeReminders = useMutation(api.reminders.resumeInvoiceReminders);
	const markManualException = useMutation(api.reminders.markManualException);
	const queueReminderEvent = useMutation(api.reminders.queueReminderEvent);
	const runReminderBatch = useAction(api.reminders.runReminderBatch);
	const sendQueuedEmails = useAction(api.reminders.sendQueuedEmails);
	const [note, setNote] = useState("");
	const [lastRunResult, setLastRunResult] = useState<string | null>(null);
	const [errors, setErrors] = useState<ReminderPolicyErrors>({});
	const [busyAction, setBusyAction] = useState<
		"save" | "find" | "send" | "single" | "pause" | "resume" | "manual" | null
	>(null);
	const [policy, setPolicy] = useState({
		enabled: true,
		daysBeforeDue: 3,
		onDueDate: true,
		overdueCadenceDays: 3,
		maxOverdueReminders: 3,
		escalateAfterCount: 3,
		businessSignature: "Velure Finance Team",
	});
	const { data: collectionOverview } = useQuery(
		convexQuery(api.reminders.getCollectionOverview, {
			daysBeforeDue: policy.daysBeforeDue,
		}),
	);
	const invoices = (collectionOverview?.invoices ?? []) as CollectionsInvoice[];

	const selectedInvoice = useMemo(
		() => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
		[invoices, selectedInvoiceId],
	);
	const selectedInvoiceBuyerEmail = selectedInvoice
		? buyerEmailForInvoice(selectedInvoice)
		: "";
	const reminderStats = collectionOverview?.stats ?? {
		actionableCount: 0,
		overdueCount: 0,
		missingEmailCount: 0,
		pausedOrManualCount: 0,
	};

	useEffect(() => {
		if (!settings) return;
		setPolicy({
			enabled: settings.enabled,
			daysBeforeDue: settings.daysBeforeDue,
			onDueDate: settings.onDueDate,
			overdueCadenceDays: settings.overdueCadenceDays,
			maxOverdueReminders: settings.maxOverdueReminders,
			escalateAfterCount: settings.escalateAfterCount,
			businessSignature: settings.businessSignature ?? "Velure Finance Team",
		});
	}, [settings]);

	if (!settings) {
		return (
			<div className="flex min-h-80 items-center justify-center">
				<div className="flex items-center gap-2 text-sm text-[#aaa294]">
					<Loader2 className="h-5 w-5 animate-spin text-[#c8ff62]" />
					<span>Loading payment reminder settings</span>
				</div>
			</div>
		);
	}

	return (
		<div className="mx-auto max-w-6xl space-y-6">
			<div>
				<h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#f2efe7]">
					Payment reminders
				</h1>
				<p className="mt-2 text-sm text-[#aaa294]">
					Find unpaid invoices, queue polite customer emails, and move
					exceptions into internal review. This stays inside invoicing; Velure
					does not add legal escalation tools.
				</p>
			</div>

			<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<CollectionsMetric
					icon={SearchCheck}
					label="Ready for scan"
					value={String(reminderStats.actionableCount)}
					helper="Sent, unpaid invoices inside the reminder window."
					tone="neutral"
				/>
				<CollectionsMetric
					icon={AlertCircle}
					label="Overdue unpaid"
					value={String(reminderStats.overdueCount)}
					helper="Needs clear payment follow-up, not pressure."
					tone="warning"
				/>
				<CollectionsMetric
					icon={MailCheck}
					label="Missing buyer email"
					value={String(reminderStats.missingEmailCount)}
					helper="Cannot receive reminder emails yet."
					tone="danger"
				/>
				<CollectionsMetric
					icon={PauseCircle}
					label="Paused / manual"
					value={String(reminderStats.pausedOrManualCount)}
					helper="Excluded from automatic sending."
					tone="muted"
				/>
			</section>

			<section className="rounded-md border border-[#30352f] bg-[#171a18] p-5">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-[#f2efe7]">
						Automatic reminder schedule
					</h2>
					<p className="text-sm text-[#aaa294]">
						Set the default follow-up timing once, then use the actions below to
						check invoices, send reminders, and route exceptions for internal
						review.
					</p>
				</div>
				<div className="mt-4 grid gap-3 lg:grid-cols-3">
					<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-3">
						<p className="text-sm font-medium text-[#f2efe7]">
							1. Find due invoices
						</p>
						<p className="mt-1 text-xs text-[#aaa294]">
							Scan today's invoices and queue the ones that need a reminder.
						</p>
					</div>
					<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-3">
						<p className="text-sm font-medium text-[#f2efe7]">
							2. Email the customer
						</p>
						<p className="mt-1 text-xs text-[#aaa294]">
							Reminder emails go straight to the buyer email saved on the
							invoice.
						</p>
					</div>
					<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-3">
						<p className="text-sm font-medium text-[#f2efe7]">
							3. Review exceptions
						</p>
						<p className="mt-1 text-xs text-[#aaa294]">
							Pause reminders or mark invoices for manual follow-up when a
							customer needs special handling.
						</p>
					</div>
				</div>
				<div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
							First reminder
						</p>
						<Input
							type="number"
							min={0}
							step={1}
							value={policy.daysBeforeDue}
							aria-invalid={Boolean(errors.daysBeforeDue)}
							onChange={(event) => {
								setPolicy((current) => ({
									...current,
									daysBeforeDue: Number(event.target.value) || 0,
								}));
								setErrors((current) => ({
									...current,
									daysBeforeDue: undefined,
								}));
							}}
							className={`${errors.daysBeforeDue ? "border-[#c76f5b]" : "border-[#30352f]"} bg-[#0f1111]`}
						/>
						<p className="text-xs text-[#aaa294]">
							Days before the due date to send the first reminder.
						</p>
					</div>
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
							Overdue gap
						</p>
						<Input
							type="number"
							min={1}
							step={1}
							value={policy.overdueCadenceDays}
							aria-invalid={Boolean(errors.overdueCadenceDays)}
							onChange={(event) => {
								setPolicy((current) => ({
									...current,
									overdueCadenceDays: Number(event.target.value) || 0,
								}));
								setErrors((current) => ({
									...current,
									overdueCadenceDays: undefined,
								}));
							}}
							className={`${errors.overdueCadenceDays ? "border-[#c76f5b]" : "border-[#30352f]"} bg-[#0f1111]`}
						/>
						<p className="text-xs text-[#aaa294]">
							Days to wait between each overdue follow-up email.
						</p>
					</div>
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
							Overdue email limit
						</p>
						<Input
							type="number"
							min={0}
							max={3}
							step={1}
							value={policy.maxOverdueReminders}
							aria-invalid={Boolean(errors.maxOverdueReminders)}
							onChange={(event) => {
								setPolicy((current) => ({
									...current,
									maxOverdueReminders: Number(event.target.value) || 0,
								}));
								setErrors((current) => ({
									...current,
									maxOverdueReminders: undefined,
								}));
							}}
							className={`${errors.maxOverdueReminders ? "border-[#c76f5b]" : "border-[#30352f]"} bg-[#0f1111]`}
						/>
						<p className="text-xs text-[#aaa294]">
							Maximum number of overdue emails to send automatically, up to the
							three built-in overdue stages.
						</p>
					</div>
					<div className="space-y-2">
						<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
							Review after
						</p>
						<Input
							type="number"
							min={0}
							max={3}
							step={1}
							value={policy.escalateAfterCount}
							aria-invalid={Boolean(errors.escalateAfterCount)}
							onChange={(event) => {
								setPolicy((current) => ({
									...current,
									escalateAfterCount: Number(event.target.value) || 0,
								}));
								setErrors((current) => ({
									...current,
									escalateAfterCount: undefined,
								}));
							}}
							className={`${errors.escalateAfterCount ? "border-[#c76f5b]" : "border-[#30352f]"} bg-[#0f1111]`}
						/>
						<p className="text-xs text-[#aaa294]">
							Move to internal review after this many overdue emails. Set it
							equal to the limit to review after the final automatic email.
						</p>
					</div>
				</div>
				<div className="mt-4 space-y-2">
					<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
						Email signature
					</p>
					<Input
						value={policy.businessSignature}
						aria-invalid={Boolean(errors.businessSignature)}
						onChange={(event) => {
							setPolicy((current) => ({
								...current,
								businessSignature: event.target.value,
							}));
							setErrors((current) => ({
								...current,
								businessSignature: undefined,
							}));
						}}
						placeholder="Velure Finance Team"
						className={`${errors.businessSignature ? "border-[#c76f5b]" : "border-[#30352f]"} bg-[#0f1111]`}
					/>
					<p className="text-xs text-[#aaa294]">
						Printed at the end of reminder emails so customers know who is
						following up.
					</p>
				</div>
				{Object.values(errors).some(Boolean) ? (
					<div className="mt-4 space-y-1 rounded-md border border-[#5d302b] bg-[#211513] px-4 py-3 text-xs text-[#f0a8a0]">
						{Object.entries(errors).map(([field, message]) =>
							message ? <p key={field}>{message}</p> : null,
						)}
					</div>
				) : null}
				<div className="mt-4 flex gap-3">
					<Button
						type="button"
						className="bg-[#c8ff62] text-[#0f1111] hover:bg-[#d5ff7a]"
						disabled={busyAction !== null}
						onClick={async () => {
							const nextErrors = validateReminderPolicy(policy);
							setErrors(nextErrors);
							if (Object.keys(nextErrors).length > 0) return;
							setBusyAction("save");
							try {
								await saveSettings({
									enabled: policy.enabled,
									daysBeforeDue: policy.daysBeforeDue,
									onDueDate: policy.onDueDate,
									overdueCadenceDays: policy.overdueCadenceDays,
									maxOverdueReminders: policy.maxOverdueReminders,
									escalateAfterCount: policy.escalateAfterCount,
									businessSignature: policy.businessSignature,
								});
								setLastRunResult("Reminder schedule saved.");
								toast({ title: "Reminder schedule saved", variant: "success" });
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "save" ? "Saving..." : "Save reminder schedule"}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="border-[#30352f] bg-transparent"
						disabled={busyAction !== null}
						onClick={async () => {
							setBusyAction("find");
							try {
								const result = await runReminderBatch({});
								const message = `${result.scannedCount} invoices scanned, ${result.queuedCount} reminders queued, ${result.escalatedCount} internal reviews queued for ${result.date}.`;
								setLastRunResult(message);
								toast({
									title:
										result.queuedCount > 0
											? "Reminder scan queued emails"
											: "Reminder scan found nothing to queue",
									description: message,
									variant: "success",
								});
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "find"
							? "Checking invoices..."
							: `Find invoices that need reminders (${reminderStats.actionableCount})`}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="border-[#30352f] bg-transparent"
						disabled={busyAction !== null}
						onClick={async () => {
							setBusyAction("send");
							try {
								const result = await sendQueuedEmails({});
								const message =
									result.reason ??
									`${result.sent} sent, ${result.skipped} skipped.`;
								setLastRunResult(message);
								toast({
									title:
										result.sent > 0
											? "Customer reminder emails sent"
											: "No reminder emails sent",
									description: message,
									variant: "success",
								});
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "send"
							? "Sending emails..."
							: "Send queued customer emails"}
					</Button>
				</div>
				{lastRunResult ? (
					<div className="mt-4 flex items-start gap-3 rounded-md border border-[#425033] bg-[#1e2418] px-4 py-3 text-sm text-[#b7ca7c]">
						<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
						<span>{lastRunResult}</span>
					</div>
				) : null}
				<p className="mt-3 text-xs text-[#aaa294]">
					Customer reminders use the buyer email saved on the invoice. Velure
					will not send a reminder when that email is missing.
				</p>
			</section>

			<section className="rounded-md border border-[#30352f] bg-[#171a18] p-5">
				<div className="flex flex-col gap-1">
					<h2 className="text-sm font-medium text-[#f2efe7]">
						Single invoice actions
					</h2>
					<p className="text-sm text-[#aaa294]">
						Use this when one invoice needs special handling outside the
						automatic schedule.
					</p>
				</div>
				<div className="mt-4 flex flex-wrap gap-3">
					<select
						value={selectedInvoiceId ?? ""}
						onChange={(event) =>
							setSelectedInvoiceId(event.target.value || null)
						}
						className="h-10 min-w-[260px] rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
						className="border-[#30352f] bg-transparent"
						disabled={!selectedInvoice || busyAction !== null}
						onClick={async () => {
							if (!selectedInvoice) return;
							if (!selectedInvoiceBuyerEmail) {
								toast({
									title: "Buyer email missing",
									description:
										"Add a buyer email to this invoice before queueing a reminder.",
									variant: "error",
								});
								return;
							}
							setBusyAction("single");
							try {
								await queueReminderEvent({
									invoiceId: selectedInvoice.id as Id<"invoices">,
									stage: "before_due",
									channel: "email",
									meta: "Manual queue from payment reminders page",
								});
								setLastRunResult(
									`${selectedInvoice.invoiceNumber} was queued for ${selectedInvoiceBuyerEmail}.`,
								);
								toast({
									title: "Reminder queued for customer",
									description: `${selectedInvoice.invoiceNumber} will send to ${selectedInvoiceBuyerEmail}.`,
									variant: "success",
								});
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "single" ? "Queueing..." : "Send one reminder now"}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="border-[#30352f] bg-transparent"
						disabled={!selectedInvoice || busyAction !== null}
						onClick={async () => {
							if (!selectedInvoice) return;
							setBusyAction("pause");
							try {
								await pauseReminders({
									invoiceId: selectedInvoice.id as Id<"invoices">,
									note: note || undefined,
								});
								setLastRunResult(
									`Automatic reminders paused for ${selectedInvoice.invoiceNumber}.`,
								);
								toast({ title: "Reminders paused", variant: "success" });
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "pause"
							? "Pausing..."
							: "Pause automatic reminders"}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="border-[#30352f] bg-transparent"
						disabled={!selectedInvoice || busyAction !== null}
						onClick={async () => {
							if (!selectedInvoice) return;
							setBusyAction("resume");
							try {
								await resumeReminders({
									invoiceId: selectedInvoice.id as Id<"invoices">,
								});
								setLastRunResult(
									`Automatic reminders resumed for ${selectedInvoice.invoiceNumber}.`,
								);
								toast({ title: "Reminders resumed", variant: "success" });
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "resume"
							? "Resuming..."
							: "Resume automatic reminders"}
					</Button>
				</div>
				{selectedInvoice ? (
					<div className="mt-4 rounded-md border border-[#30352f] bg-[#0f1111] p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="font-mono text-sm font-medium text-[#f2efe7]">
									{selectedInvoice.invoiceNumber}
								</p>
								<p className="mt-1 text-xs text-[#aaa294]">
									{selectedInvoice.customerName || "Unnamed customer"} · Due{" "}
									{formatInvoiceDate(selectedInvoice.dueDate)}
								</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<InvoiceReminderChip
									label={selectedInvoice.status}
									tone={
										selectedInvoice.status === "overdue"
											? "danger"
											: selectedInvoice.status === "paid"
												? "success"
												: "neutral"
									}
								/>
								<InvoiceReminderChip
									label={
										selectedInvoice.reminder?.paused
											? "Paused"
											: selectedInvoice.reminder?.escalationStatus ===
													"manual_review"
												? "Manual review"
												: "Automatic"
									}
									tone={
										selectedInvoice.reminder?.paused ||
										selectedInvoice.reminder?.escalationStatus ===
											"manual_review"
											? "warning"
											: "success"
									}
								/>
							</div>
						</div>
						<div className="mt-3 flex items-start gap-2 text-xs text-[#aaa294]">
							<UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#c8ff62]" />
							<span>
								{selectedInvoiceBuyerEmail
									? `Customer reminders will be sent to ${selectedInvoiceBuyerEmail}.`
									: "This invoice is missing a buyer email, so Velure will not send customer reminders yet."}
							</span>
						</div>
					</div>
				) : null}
				<Textarea
					value={note}
					onChange={(event) => setNote(event.target.value)}
					placeholder="Add a note for your team, for example: customer promised payment on Friday."
					className="mt-4 border-[#30352f] bg-[#0f1111]"
				/>
				<div className="mt-3">
					<Button
						type="button"
						variant="outline"
						className="border-[#30352f] bg-transparent"
						disabled={
							!selectedInvoice ||
							note.trim().length === 0 ||
							busyAction !== null
						}
						onClick={async () => {
							if (!selectedInvoice) return;
							setBusyAction("manual");
							try {
								await markManualException({
									invoiceId: selectedInvoice.id as Id<"invoices">,
									note: note.trim(),
								});
								setLastRunResult(
									`${selectedInvoice.invoiceNumber} was marked for manual follow-up.`,
								);
								toast({
									title: "Marked for manual review",
									variant: "success",
								});
							} finally {
								setBusyAction(null);
							}
						}}
					>
						{busyAction === "manual"
							? "Marking..."
							: "Mark this invoice for manual follow-up"}
					</Button>
				</div>

				<div className="mt-5 space-y-3">
					<div className="pb-1">
						<p className="text-xs uppercase tracking-[0.18em] text-[#7d7b74]">
							Activity history
						</p>
						<p className="mt-1 text-xs text-[#aaa294]">
							Shows what reminder actions have already happened for the selected
							invoice.
						</p>
					</div>
					{selectedInvoice && (timeline ?? []).length === 0 ? (
						<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-5 text-sm text-[#aaa294]">
							<p className="font-medium text-[#f2efe7]">No activity yet.</p>
							<p className="mt-1">
								Queue a reminder or mark an exception to start this invoice
								history.
							</p>
						</div>
					) : null}
					{!selectedInvoice ? (
						<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-5 text-sm text-[#aaa294]">
							<p className="font-medium text-[#f2efe7]">
								Select an invoice to view activity.
							</p>
							<p className="mt-1">
								Reminder history appears here with exact dates for audit review.
							</p>
						</div>
					) : null}
					{selectedInvoice
						? (timeline ?? []).map((event) => (
								<div
									key={event._id}
									className="rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-3"
								>
									<div className="flex flex-wrap items-start justify-between gap-3">
										<p className="text-sm font-medium capitalize text-[#f2efe7]">
											{event.stage.replaceAll("_", " ")}
										</p>
										<InvoiceReminderChip
											label={event.status}
											tone={
												event.status === "sent"
													? "success"
													: event.status === "failed"
														? "danger"
														: "neutral"
											}
										/>
									</div>
									<p className="mt-1 text-xs text-[#aaa294]">
										{event.channel}
										{event.meta ? ` • ${event.meta}` : ""}
									</p>
									<p
										className="mt-1 text-xs text-[#7d7b74]"
										title={formatExactDateTime(
											event.sentAt ?? event.scheduledFor ?? event.createdAt,
										)}
									>
										{formatInvoiceDate(
											event.sentAt ?? event.scheduledFor ?? event.createdAt,
										)}
									</p>
								</div>
							))
						: null}
				</div>
			</section>
		</div>
	);
}

type CollectionsInvoice = {
	id: Id<"invoices">;
	invoiceNumber: string;
	customerName: string;
	dueDate: string;
	status: InvoiceStatus;
	reminder?: {
		paused?: boolean;
		escalationStatus?: "idle" | "manual_review" | "slack_sent";
	};
	lifecycle?: {
		sentAt?: number;
	};
	compliance?: {
		buyer?: {
			email?: string;
		};
	};
};
type ChipTone = "danger" | "neutral" | "success" | "warning";
type MetricTone = ChipTone | "muted";

function buyerEmailForInvoice(invoice: CollectionsInvoice) {
	return invoice.compliance?.buyer?.email?.trim() ?? "";
}

function CollectionsMetric({
	icon: Icon,
	label,
	value,
	helper,
	tone,
}: {
	icon: LucideIcon;
	label: string;
	value: string;
	helper: string;
	tone: MetricTone;
}) {
	const toneClass = {
		danger: "border-[#5d302b] bg-[#211513] text-[#f0a8a0]",
		muted: "border-[#30352f] bg-[#141517] text-[#aaa294]",
		neutral: "border-[#30352f] bg-[#171a18] text-[#f2efe7]",
		success: "border-[#425033] bg-[#1e2418] text-[#b7ca7c]",
		warning: "border-[#594b25] bg-[#211c12] text-[#e7c76b]",
	}[tone];

	return (
		<div className={`rounded-md border p-4 ${toneClass}`}>
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs uppercase tracking-[0.18em] opacity-75">
					{label}
				</p>
				<Icon className="h-4 w-4 shrink-0 opacity-80" />
			</div>
			<p className="mt-3 text-2xl font-semibold text-[#f2efe7]">{value}</p>
			<p className="mt-1 text-xs leading-5 opacity-80">{helper}</p>
		</div>
	);
}

function InvoiceReminderChip({
	label,
	tone,
}: {
	label: string;
	tone: ChipTone;
}) {
	const toneClass = {
		danger: "border-[#5d302b] bg-[#2a1714] text-[#f0a8a0]",
		neutral: "border-[#343638] bg-[#1b1d1f] text-[#d5cfc4]",
		success: "border-[#425033] bg-[#1e2418] text-[#b7ca7c]",
		warning: "border-[#594b25] bg-[#211c12] text-[#e7c76b]",
	}[tone];

	return (
		<span
			className={`inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium capitalize ${toneClass}`}
		>
			{label.replaceAll("_", " ")}
		</span>
	);
}

function formatExactDateTime(value: string | number | Date) {
	return new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}
