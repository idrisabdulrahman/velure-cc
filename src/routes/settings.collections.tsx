import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	CheckCircle2,
	History,
	Inbox,
	Loader2,
	MailCheck,
	SearchCheck,
	Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Callout } from "#/components/redesign/callout";
import { EmptyState } from "#/components/redesign/empty-state";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { StatusPill } from "#/components/redesign/status-pill";
import { Toggle } from "#/components/redesign/toggle";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Sheet, SheetContent } from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import type { InvoiceStatus } from "#/features/invoices/types";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	getCollectionOverview,
	getInvoiceTimeline,
	getReminderSettings,
	markManualException as markManualExceptionSupabase,
	pauseInvoiceReminders,
	queueReminderEvent as queueReminderEventSupabase,
	resumeInvoiceReminders,
	runReminderBatch as runReminderBatchSupabase,
	saveReminderSettings,
	sendQueuedEmails as sendQueuedEmailsSupabase,
} from "#/server/data/reminders";
export const Route = createFileRoute("/settings/collections")({
	component: PaymentRemindersSettingsPage,
});

type ReminderPolicyErrors = Partial<{
	daysBeforeDue: string;
	overdueCadenceDays: string;
	maxOverdueReminders: string;
	escalateAfterCount: string;
	businessSignature: string;
}>;

type QueueFilter = "ready" | "overdue" | "noemail" | "paused";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

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
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const canRead = Boolean(supabaseClient && userId);
	const requireSupabase = () => {
		if (!supabaseClient || !userId)
			throw new Error("Supabase session unavailable.");
		return { client: supabaseClient, userId };
	};
	const { data: settings, isError: settingsError } = useQuery({
		queryKey: ["supabase-reminder-settings", userId ?? "none"],
		queryFn: () => {
			const context = requireSupabase();
			return getReminderSettings(context.client, context.userId);
		},
		enabled: canRead,
	});
	const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
		null,
	);
	const [filter, setFilter] = useState<QueueFilter | null>(null);
	const timelineEnabled = selectedInvoiceId !== null;
	const { data: timeline } = useQuery({
		queryKey: [
			"supabase-reminder-timeline",
			userId ?? "none",
			selectedInvoiceId ?? "none",
		],
		queryFn: () => {
			const context = requireSupabase();
			return getInvoiceTimeline(
				context.client,
				context.userId,
				selectedInvoiceId as string,
			);
		},
		enabled: timelineEnabled && canRead,
	});
	const saveSettings = async (
		args: Parameters<typeof saveReminderSettings>[2],
	) => {
		const context = requireSupabase();
		return saveReminderSettings(context.client, context.userId, args);
	};
	const pauseReminders = async (
		args: Parameters<typeof pauseInvoiceReminders>[2],
	) => {
		const context = requireSupabase();
		return pauseInvoiceReminders(context.client, context.userId, args);
	};
	const resumeReminders = async (
		args: Parameters<typeof resumeInvoiceReminders>[2],
	) => {
		const context = requireSupabase();
		return resumeInvoiceReminders(context.client, context.userId, args);
	};
	const markManualException = async (
		args: Parameters<typeof markManualExceptionSupabase>[2],
	) => {
		const context = requireSupabase();
		return markManualExceptionSupabase(context.client, context.userId, args);
	};
	const queueReminderEvent = async (
		args: Parameters<typeof queueReminderEventSupabase>[2],
	) => {
		const context = requireSupabase();
		return queueReminderEventSupabase(context.client, context.userId, args);
	};
	const runReminderBatch = async (_args: Record<string, never> = {}) => {
		const context = requireSupabase();
		return runReminderBatchSupabase(context.client, context.userId);
	};
	const sendQueuedEmails = async (_args: Record<string, never> = {}) => {
		const context = requireSupabase();
		return sendQueuedEmailsSupabase(context.client, context.userId);
	};
	const [note, setNote] = useState("");
	const [scheduleOpen, setScheduleOpen] = useState(false);
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
	const {
		data: collectionOverview,
		isPending: overviewPending,
		isError: overviewError,
	} = useQuery({
		queryKey: [
			"supabase-collection-overview",
			userId ?? "none",
			policy.daysBeforeDue,
		],
		queryFn: () => {
			const context = requireSupabase();
			return getCollectionOverview(context.client, context.userId, {
				daysBeforeDue: policy.daysBeforeDue,
			});
		},
		enabled: canRead,
	});
	const invoices = (collectionOverview?.invoices ?? []) as CollectionsInvoice[];

	useEffect(() => {
		if (selectedInvoiceId === null && invoices.length > 0) {
			setSelectedInvoiceId(invoices[0].id);
		}
	}, [invoices, selectedInvoiceId]);

	const filteredInvoices = useMemo(() => {
		if (filter === null) return invoices;
		if (filter === "ready")
			return invoices.filter((invoice) =>
				isActionable(invoice, policy.daysBeforeDue),
			);
		if (filter === "overdue")
			return invoices.filter((invoice) => isOverdue(invoice));
		if (filter === "noemail")
			return invoices.filter((invoice) => isMissingEmail(invoice));
		return invoices.filter((invoice) => isPausedOrManual(invoice));
	}, [filter, invoices, policy.daysBeforeDue]);

	const selectedInvoice = useMemo(
		() => invoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null,
		[invoices, selectedInvoiceId],
	);
	const selectedInvoiceBuyerEmail = selectedInvoice
		? buyerEmailForInvoice(selectedInvoice)
		: "";
	const selectedMissingEmail = selectedInvoice
		? isMissingEmail(selectedInvoice)
		: false;
	const selectedIsDraftUnsent = selectedInvoice
		? !selectedInvoice.lifecycle?.sentAt
		: false;
	const selectedIsPaused = selectedInvoice
		? isPausedOrManual(selectedInvoice)
		: false;
	const sendDisabledReason = !selectedInvoice
		? "Select an invoice to send a reminder."
		: selectedMissingEmail
			? "Add a buyer email to send reminders."
			: selectedIsDraftUnsent
				? "Drafts are not reminded until they are sent."
				: selectedIsPaused
					? "Resume automatic reminders to send."
					: null;
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

	if (settingsError) {
		return (
			<div className="mx-auto max-w-6xl">
				<Callout tone="bad" title="Could not load reminder settings">
					Check your connection and try again.
				</Callout>
			</div>
		);
	}

	if (!settings) {
		return (
			<div className="flex min-h-80 items-center justify-center">
				<div className="flex items-center gap-2 text-sm text-ink-3">
					<Loader2 className="h-5 w-5 animate-spin text-brand" />
					<span>Loading payment reminder settings</span>
				</div>
			</div>
		);
	}

	const queueEmpty = invoices.length === 0;

	return (
		<div className="mx-auto max-w-6xl space-y-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Payment reminders
					</h1>
					<p className="mt-2 text-sm text-ink-3">
						Find unpaid invoices, queue polite customer emails, and move
						exceptions into internal review. This stays inside invoicing; Velure
						does not add legal escalation tools.
					</p>
				</div>
				<Button
					className="min-w-fit whitespace-nowrap bg-brand px-4 text-brand-ink hover:bg-brand-hi"
					onClick={() => setScheduleOpen(true)}
				>
					<Settings2 className="mr-2 h-4 w-4" /> Reminder schedule
				</Button>
			</div>

			<KpiStrip>
				<Kpi
					label="Ready for scan"
					value={String(reminderStats.actionableCount)}
					sub="Sent, unpaid invoices inside the reminder window."
					tone="brand"
					selected={filter === "ready"}
					onClick={() =>
						setFilter((current) => (current === "ready" ? null : "ready"))
					}
				/>
				<Kpi
					label="Overdue unpaid"
					value={String(reminderStats.overdueCount)}
					sub="Needs a clear follow-up, not pressure."
					tone="warn"
					selected={filter === "overdue"}
					onClick={() =>
						setFilter((current) => (current === "overdue" ? null : "overdue"))
					}
				/>
				<Kpi
					label="Missing buyer email"
					value={String(reminderStats.missingEmailCount)}
					sub="Cannot receive reminder emails yet."
					tone="danger"
					selected={filter === "noemail"}
					onClick={() =>
						setFilter((current) => (current === "noemail" ? null : "noemail"))
					}
				/>
				<Kpi
					label="Paused / manual"
					value={String(reminderStats.pausedOrManualCount)}
					sub="Excluded from automatic sending."
					tone="mute"
					selected={filter === "paused"}
					onClick={() =>
						setFilter((current) => (current === "paused" ? null : "paused"))
					}
				/>
			</KpiStrip>

			{reminderStats.missingEmailCount > 0 ? (
				<Callout tone="warn">
					{reminderStats.missingEmailCount} invoices have no buyer email, so no
					reminder can reach them. Pick an invoice below and add one in the side
					panel.
				</Callout>
			) : null}

			<Panel>
				<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
					<Toggle
						label={`Automatic reminders are ${policy.enabled ? "on" : "off"}`}
						description={`First reminder ${policy.daysBeforeDue} days before due, then every ${policy.overdueCadenceDays} days.`}
						checked={policy.enabled}
						disabled={busyAction !== null}
						onChange={async (checked) => {
							const next = { ...policy, enabled: checked };
							setPolicy(next);
							setBusyAction("save");
							try {
								await saveSettings({
									enabled: next.enabled,
									daysBeforeDue: next.daysBeforeDue,
									onDueDate: next.onDueDate,
									overdueCadenceDays: next.overdueCadenceDays,
									maxOverdueReminders: next.maxOverdueReminders,
									escalateAfterCount: next.escalateAfterCount,
									businessSignature: next.businessSignature,
								});
								toast({
									title: `Automatic reminders ${checked ? "on" : "off"}`,
									variant: "success",
								});
							} finally {
								setBusyAction(null);
							}
						}}
					/>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							className="border-rule bg-paper"
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
							<SearchCheck className="mr-2 h-4 w-4" />
							{busyAction === "find" ? "Scanning…" : "Scan invoices"}
						</Button>
						<Button
							variant="outline"
							className="border-rule bg-paper"
							disabled={busyAction !== null || queueEmpty}
							title={queueEmpty ? "Nothing is ready to send" : undefined}
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
							<MailCheck className="mr-2 h-4 w-4" />
							{busyAction === "send" ? "Sending…" : "Send queue"}
						</Button>
					</div>
				</div>
			</Panel>

			{lastRunResult ? (
				<div className="flex items-start gap-3 rounded-md border border-ok-line bg-ok-soft px-4 py-3 text-sm text-ok">
					<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
					<span>{lastRunResult}</span>
				</div>
			) : null}

			<Sheet open={scheduleOpen} onOpenChange={setScheduleOpen}>
				<SheetContent
					title="Automatic reminder schedule"
					contentClassName="sm:max-w-[620px]"
					className="overflow-y-auto p-5 sm:p-7"
				>
					<div className="flex flex-col gap-1">
						<h2 className="text-sm font-medium text-ink">
							Automatic reminder schedule
						</h2>
						<p className="text-sm text-ink-3">
							Set when automatic customer reminders are sent.
						</p>
					</div>
					<div className="mt-6 grid gap-5 sm:grid-cols-2">
						<div className="space-y-2">
							<p className="text-xs uppercase tracking-[0.18em] text-ink-3">
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
								className={`${errors.daysBeforeDue ? "border-danger" : "border-rule"} bg-paper`}
							/>
							<p className="text-xs text-ink-3">
								Days before the due date to send the first reminder.
							</p>
						</div>
						<div className="space-y-2">
							<p className="text-xs uppercase tracking-[0.18em] text-ink-3">
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
								className={`${errors.overdueCadenceDays ? "border-danger" : "border-rule"} bg-paper`}
							/>
							<p className="text-xs text-ink-3">
								Days to wait between each overdue follow-up email.
							</p>
						</div>
						<div className="space-y-2">
							<p className="text-xs uppercase tracking-[0.18em] text-ink-3">
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
								className={`${errors.maxOverdueReminders ? "border-danger" : "border-rule"} bg-paper`}
							/>
							<p className="text-xs text-ink-3">
								Maximum number of overdue emails to send automatically, up to
								the three built-in overdue stages.
							</p>
						</div>
						<div className="space-y-2">
							<p className="text-xs uppercase tracking-[0.18em] text-ink-3">
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
								className={`${errors.escalateAfterCount ? "border-danger" : "border-rule"} bg-paper`}
							/>
							<p className="text-xs text-ink-3">
								Move to internal review after this many overdue emails. Set it
								equal to the limit to review after the final automatic email.
							</p>
						</div>
					</div>
					<div className="mt-4 space-y-2">
						<p className="text-xs uppercase tracking-[0.18em] text-ink-3">
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
							className={`${errors.businessSignature ? "border-danger" : "border-rule"} bg-paper`}
						/>
						<p className="text-xs text-ink-3">
							Printed at the end of reminder emails so customers know who is
							following up.
						</p>
					</div>
					{Object.values(errors).some(Boolean) ? (
						<div className="mt-4 space-y-1 rounded-md border border-danger-line bg-danger-soft px-4 py-3 text-xs text-danger">
							{Object.entries(errors).map(([field, message]) =>
								message ? <p key={field}>{message}</p> : null,
							)}
						</div>
					) : null}
					<div className="mt-6">
						<Button
							type="button"
							className="w-full bg-brand text-brand-ink hover:bg-brand-hi"
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
									toast({
										title: "Reminder schedule saved",
										variant: "success",
									});
								} finally {
									setBusyAction(null);
								}
							}}
						>
							{busyAction === "save" ? "Saving..." : "Save reminder schedule"}
						</Button>
					</div>
					{lastRunResult ? (
						<div className="mt-4 flex items-start gap-3 rounded-md border border-ok-line bg-ok-soft px-4 py-3 text-sm text-ok">
							<CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
							<span>{lastRunResult}</span>
						</div>
					) : null}
					<p className="mt-3 text-xs text-ink-3">
						Customer reminders use the buyer email saved on the invoice. Velure
						will not send a reminder when that email is missing.
					</p>
				</SheetContent>
			</Sheet>

			<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
				<Panel
					title="Queue"
					sub={`${filteredInvoices.length} invoice${filteredInvoices.length === 1 ? "" : "s"}`}
				>
					{overviewPending ? (
						<div className="flex items-center gap-2 py-6 text-sm text-ink-3">
							<Loader2 className="h-4 w-4 animate-spin text-brand" />
							<span>Loading reminder queue</span>
						</div>
					) : overviewError ? (
						<Callout tone="bad" title="Could not load the queue">
							Check your connection and try again.
						</Callout>
					) : filteredInvoices.length === 0 ? (
						<EmptyState
							icon={<Inbox />}
							title="Nothing here"
							copy="No invoices match this view."
						/>
					) : (
						<ul className="-m-2 space-y-1">
							{filteredInvoices.map((invoice) => {
								const overdue = isOverdue(invoice);
								const missingEmail = isMissingEmail(invoice);
								const paused = isPausedOrManual(invoice);
								const draft = !invoice.lifecycle?.sentAt;
								const amount = invoiceAmount(invoice);
								const dueLabel = dueDateLabel(invoice);
								return (
									<li key={invoice.id}>
										<button
											type="button"
											onClick={() => setSelectedInvoiceId(invoice.id)}
											aria-current={
												selectedInvoiceId === invoice.id ? "true" : undefined
											}
											className={`flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-paper-2 ${
												selectedInvoiceId === invoice.id ? "bg-paper-3" : ""
											}`}
										>
											<span className="min-w-0 flex-1">
												<span className="block truncate font-mono text-[13px] font-medium text-ink">
													{invoice.invoiceNumber}
												</span>
												<span className="mt-0.5 block truncate text-xs text-ink-3">
													{invoice.customerName || "No customer yet"}
												</span>
												<span className="mt-1.5 flex flex-wrap gap-1.5">
													{overdue ? (
														<StatusPill tone="bad">
															{daysOverdueLabel(invoice)}
														</StatusPill>
													) : (
														<StatusPill tone="mute">{dueLabel}</StatusPill>
													)}
													{missingEmail ? (
														<StatusPill tone="warn">No email</StatusPill>
													) : null}
													{draft ? (
														<StatusPill tone="mute">Draft</StatusPill>
													) : null}
													{paused ? (
														<StatusPill tone="info">Paused</StatusPill>
													) : null}
												</span>
											</span>
											<span className="flex-none text-right">
												{amount !== null ? (
													<span className="block font-num text-[13px] font-medium tabular-nums text-ink">
														{formatMoney(amount)}
													</span>
												) : null}
												<span className="mt-0.5 block text-[11px] text-ink-3">
													due {formatInvoiceDate(invoice.dueDate)}
												</span>
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</Panel>

				<Panel title="Details">
					{!selectedInvoice ? (
						<EmptyState
							icon={<MailCheck />}
							title="Select an invoice"
							copy="Its reminder actions and history appear here."
						/>
					) : (
						<div className="space-y-6">
							<div>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="truncate font-mono text-sm font-medium text-ink">
											{selectedInvoice.invoiceNumber}
										</p>
										<p className="mt-1 truncate text-xs text-ink-3">
											{selectedInvoice.customerName || "No customer yet"}
											{selectedInvoiceBuyerEmail
												? ` · ${selectedInvoiceBuyerEmail}`
												: ""}
										</p>
									</div>
									{invoiceAmount(selectedInvoice) !== null ? (
										<p className="flex-none font-num text-base font-medium tabular-nums text-ink">
											{formatMoney(invoiceAmount(selectedInvoice) as number)}
										</p>
									) : null}
								</div>
								<div className="mt-3 flex flex-wrap gap-1.5">
									{isOverdue(selectedInvoice) ? (
										<StatusPill tone="bad">
											{daysOverdueLabel(selectedInvoice)}
										</StatusPill>
									) : (
										<StatusPill tone="mute">
											{dueDateLabel(selectedInvoice)}
										</StatusPill>
									)}
									<StatusPill tone={selectedIsDraftUnsent ? "mute" : "info"}>
										{selectedIsDraftUnsent ? "Draft" : "Sent"}
									</StatusPill>
									{selectedInvoice.reminder?.paused ? (
										<StatusPill tone="info">Paused</StatusPill>
									) : null}
									{selectedInvoice.reminder?.escalationStatus ===
									"manual_review" ? (
										<StatusPill tone="warn">Manual review</StatusPill>
									) : null}
								</div>
							</div>

							{selectedMissingEmail ? (
								<div key={selectedInvoice.id}>
									<label
										htmlFor="reminder-buyer-email"
										className="mb-1.5 block text-xs font-medium text-ink-2"
									>
										Buyer email
									</label>
									<BuyerEmailCapture />
									<p className="mt-1.5 text-[11.5px] text-ink-3">
										email capture needs a server mutation (follow-up)
									</p>
								</div>
							) : null}

							<div>
								<p className="mb-2 text-xs font-medium text-ink-2">Actions</p>
								<div className="grid gap-2">
									<Button
										type="button"
										className="bg-brand text-brand-ink hover:bg-brand-hi"
										disabled={
											sendDisabledReason !== null || busyAction !== null
										}
										title={sendDisabledReason ?? undefined}
										onClick={async () => {
											if (!selectedInvoice) return;
											setBusyAction("single");
											try {
												const result = await queueReminderEvent({
													invoiceId: selectedInvoice.id,
													stage: "before_due",
													channel: "email",
													meta: "Manual queue from payment reminders page",
												});
												if (result.skipped) {
													const reason =
														result.reason ?? "Reminder was skipped.";
													setLastRunResult(
														`${selectedInvoice.invoiceNumber}: ${reason}`,
													);
													toast({
														title: "Reminder not queued",
														description: reason,
														variant: "error",
													});
													return;
												}
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
										{busyAction === "single"
											? "Queueing..."
											: "Send reminder now"}
									</Button>
									{sendDisabledReason ? (
										<p className="text-xs text-ink-3">{sendDisabledReason}</p>
									) : null}
									<Button
										type="button"
										variant="outline"
										className="border-rule bg-transparent"
										disabled={busyAction !== null}
										onClick={async () => {
											if (!selectedInvoice) return;
											if (selectedInvoice.reminder?.paused) {
												setBusyAction("resume");
												try {
													await resumeReminders({
														invoiceId: selectedInvoice.id,
													});
													setLastRunResult(
														`Automatic reminders resumed for ${selectedInvoice.invoiceNumber}.`,
													);
													toast({
														title: "Reminders resumed",
														variant: "success",
													});
												} finally {
													setBusyAction(null);
												}
												return;
											}
											setBusyAction("pause");
											try {
												await pauseReminders({
													invoiceId: selectedInvoice.id,
													note: note || undefined,
												});
												setLastRunResult(
													`Automatic reminders paused for ${selectedInvoice.invoiceNumber}.`,
												);
												toast({
													title: "Reminders paused",
													variant: "success",
												});
											} finally {
												setBusyAction(null);
											}
										}}
									>
										{busyAction === "pause"
											? "Pausing..."
											: busyAction === "resume"
												? "Resuming..."
												: selectedInvoice.reminder?.paused
													? "Resume automatic"
													: "Pause automatic"}
									</Button>
								</div>
							</div>

							<div>
								<label
									htmlFor="reminder-manual-note"
									className="mb-1.5 block text-xs font-medium text-ink-2"
								>
									Manual follow-up
								</label>
								<Textarea
									id="reminder-manual-note"
									value={note}
									onChange={(event) => setNote(event.target.value)}
									placeholder="Note for your team, e.g. customer promised payment on Friday."
									className="border-rule bg-paper"
								/>
								<Button
									type="button"
									variant="outline"
									className="mt-2 border-rule bg-transparent"
									disabled={note.trim().length === 0 || busyAction !== null}
									onClick={async () => {
										if (!selectedInvoice) return;
										setBusyAction("manual");
										try {
											await markManualException({
												invoiceId: selectedInvoice.id,
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
										: "Mark for manual follow-up"}
								</Button>
							</div>

							<div>
								<p className="mb-2 text-xs font-medium text-ink-2">Activity</p>
								{(timeline ?? []).length === 0 ? (
									<EmptyState
										icon={<History />}
										title="No reminder activity yet"
										copy="Every reminder and note appears here with its exact date."
										dashed
									/>
								) : (
									<ol className="space-y-3">
										{(timeline ?? []).map((event) => (
											<li
												key={event._id}
												className="flex gap-3 rounded-md border border-rule bg-paper-2 px-4 py-3"
											>
												<span
													aria-hidden="true"
													className="mt-1.5 size-2 flex-none rounded-full bg-brand"
												/>
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center justify-between gap-2">
														<p className="text-sm font-medium capitalize text-ink">
															{event.stage.replaceAll("_", " ")}
														</p>
														<StatusPill
															tone={
																event.status === "sent"
																	? "ok"
																	: event.status === "failed"
																		? "bad"
																		: "mute"
															}
														>
															{event.status}
														</StatusPill>
													</div>
													<p className="mt-1 text-xs text-ink-3">
														{event.channel}
														{event.meta ? ` • ${event.meta}` : ""}
													</p>
													<p
														className="mt-1 text-xs text-ink-3"
														title={formatExactDateTime(
															event.sentAt ??
																event.scheduledFor ??
																event.createdAt,
														)}
													>
														{formatInvoiceDate(
															event.sentAt ??
																event.scheduledFor ??
																event.createdAt,
														)}
													</p>
												</div>
											</li>
										))}
									</ol>
								)}
							</div>
						</div>
					)}
				</Panel>
			</div>
		</div>
	);
}

type CollectionsInvoice = {
	id: string;
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
		grandTotal?: number;
	};
};

function buyerEmailForInvoice(invoice: CollectionsInvoice) {
	return invoice.compliance?.buyer?.email?.trim() ?? "";
}

function invoiceAmount(invoice: CollectionsInvoice): number | null {
	const total = invoice.compliance?.grandTotal;
	return typeof total === "number" && Number.isFinite(total) ? total : null;
}

function isActiveInvoice(invoice: CollectionsInvoice) {
	return invoice.status !== "paid" && invoice.status !== "canceled";
}

function parseDueDate(value: string | null | undefined) {
	if (!value) return null;
	const parsed = new Date(`${value}T00:00:00`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfToday() {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return today;
}

function isOverdue(invoice: CollectionsInvoice) {
	if (!isActiveInvoice(invoice)) return false;
	const dueDate = parseDueDate(invoice.dueDate);
	if (!dueDate) return invoice.status === "overdue";
	return invoice.status === "overdue" || dueDate < startOfToday();
}

function isMissingEmail(invoice: CollectionsInvoice) {
	return isActiveInvoice(invoice) && buyerEmailForInvoice(invoice) === "";
}

function isPausedOrManual(invoice: CollectionsInvoice) {
	return Boolean(
		invoice.reminder?.paused ||
			invoice.reminder?.escalationStatus === "manual_review",
	);
}

function isInReminderWindow(
	invoice: CollectionsInvoice,
	daysBeforeDue: number,
) {
	if (!isActiveInvoice(invoice)) return false;
	if (invoice.reminder?.paused) return false;
	if (!invoice.lifecycle?.sentAt) return false;
	const dueDate = parseDueDate(invoice.dueDate);
	if (!dueDate) return false;
	const daysUntilDue = Math.ceil(
		(dueDate.getTime() - startOfToday().getTime()) / (24 * 60 * 60 * 1000),
	);
	return daysUntilDue <= daysBeforeDue;
}

function isActionable(invoice: CollectionsInvoice, daysBeforeDue: number) {
	return (
		isInReminderWindow(invoice, daysBeforeDue) &&
		!isMissingEmail(invoice) &&
		!isPausedOrManual(invoice)
	);
}

function daysOverdueLabel(invoice: CollectionsInvoice) {
	const dueDate = parseDueDate(invoice.dueDate);
	if (!dueDate) return "Overdue";
	const days = Math.floor(
		(startOfToday().getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000),
	);
	if (days <= 0) return "Overdue";
	return `${days} day${days === 1 ? "" : "s"} overdue`;
}

function dueDateLabel(invoice: CollectionsInvoice) {
	const dueDate = parseDueDate(invoice.dueDate);
	if (!dueDate) return `Due ${formatInvoiceDate(invoice.dueDate)}`;
	const days = Math.ceil(
		(dueDate.getTime() - startOfToday().getTime()) / (24 * 60 * 60 * 1000),
	);
	if (days < 0) return "Overdue";
	if (days === 0) return "Due today";
	return `Due in ${days} day${days === 1 ? "" : "s"}`;
}

function BuyerEmailCapture() {
	const [draft, setDraft] = useState("");
	const invalid = draft.trim() !== "" && !EMAIL_PATTERN.test(draft.trim());
	return (
		<div>
			<div className="flex flex-col gap-2 sm:flex-row">
				<Input
					id="reminder-buyer-email"
					type="email"
					autoComplete="off"
					placeholder="name@company.com"
					value={draft}
					aria-invalid={invalid}
					onChange={(event) => setDraft(event.target.value)}
					className={`${invalid ? "border-danger" : "border-rule"} bg-paper`}
				/>
				<Button
					type="button"
					className="bg-brand text-brand-ink hover:bg-brand-hi sm:flex-none"
					disabled
					title="email capture needs a server mutation (follow-up)"
				>
					Save
				</Button>
			</div>
			{invalid ? (
				<p role="alert" className="mt-1.5 text-[11.5px] text-danger">
					Enter a valid email address.
				</p>
			) : null}
			<p className="mt-1.5 text-[11.5px] text-ink-3">
				Reminders can&apos;t be queued for this invoice until it has an email.
			</p>
		</div>
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
