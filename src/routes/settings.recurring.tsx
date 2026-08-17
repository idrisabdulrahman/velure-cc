import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useAction, useMutation } from "convex/react";
import {
	CalendarClock,
	Loader2,
	type LucideIcon,
	PauseCircle,
	Pencil,
	PlayCircle,
	RefreshCcw,
	Repeat2,
	StopCircle,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { DatePicker } from "#/components/navigation/DatePicker";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Sheet, SheetContent } from "#/components/ui/sheet";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
export const Route = createFileRoute("/settings/recurring")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition.
		void context.queryClient
			.prefetchQuery(convexQuery(api.compliance.getWorkspaceSettings, {}))
			.catch(() => undefined);
	},
	component: RecurringBillingSettingsPage,
});

type Frequency = "monthly" | "quarterly";
type BusyAction =
	| "create"
	| "update"
	| "run"
	| `delete:${string}`
	| `status:${string}`
	| null;

type ScheduleForm = {
	name: string;
	customerName: string;
	frequency: Frequency;
	interval: number;
	startDate: string;
	endDate: string;
	autoSend: boolean;
	currency: string;
	paymentTermsDays: number;
	paymentDetails: string;
	notes: string;
	lineItemName: string;
	lineItemQuantity: number;
	lineItemPrice: number;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const initialForm = (workspace?: {
	baseCurrency?: string;
	defaultPaymentTermsDays?: number;
	paymentDetails?: string;
}): ScheduleForm => ({
	name: "",
	customerName: "",
	frequency: "monthly",
	interval: 1,
	startDate: todayIso(),
	endDate: "",
	autoSend: false,
	currency: workspace?.baseCurrency ?? "NGN",
	paymentTermsDays: workspace?.defaultPaymentTermsDays ?? 14,
	paymentDetails: workspace?.paymentDetails ?? "",
	notes: "",
	lineItemName: "Monthly service",
	lineItemQuantity: 1,
	lineItemPrice: 0,
});

function RecurringBillingSettingsPage() {
	const { data: workspace } = useQuery(
		convexQuery(api.compliance.getWorkspaceSettings, {}),
	);
	const { data: schedulesRaw } = useQuery(
		convexQuery(api.recurring.listSchedules, { status: "all" }),
	);
	const schedules = schedulesRaw ?? [];
	const createSchedule = useMutation(api.recurring.createSchedule);
	const updateSchedule = useMutation(api.recurring.updateSchedule);
	const deleteSchedule = useMutation(api.recurring.deleteSchedule);
	const setScheduleStatus = useMutation(api.recurring.setScheduleStatus);
	const runRecurringGeneration = useAction(
		api.recurring.runRecurringGeneration,
	);
	const [form, setForm] = useState<ScheduleForm>(() => initialForm());
	const [editingScheduleId, setEditingScheduleId] =
		useState<Id<"recurring_invoice_schedules"> | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [busyAction, setBusyAction] = useState<BusyAction>(null);

	const stats = useMemo(() => {
		const activeCount = schedules.filter(
			(schedule) => schedule.status === "active",
		).length;
		const dueTodayCount = schedules.filter(
			(schedule) =>
				schedule.status === "active" && schedule.nextRunDate <= todayIso(),
		).length;
		const generatedCount = schedules.reduce(
			(sum, schedule) => sum + schedule.generatedCount,
			0,
		);
		return { activeCount, dueTodayCount, generatedCount };
	}, [schedules]);

	const schedulePayload = () => ({
		name: form.name,
		customerName: form.customerName,
		frequency: form.frequency,
		interval: Number(form.interval),
		startDate: form.startDate,
		endDate: form.endDate || undefined,
		autoSend: form.autoSend,
		currency: form.currency,
		paymentTermsDays: Number(form.paymentTermsDays),
		paymentDetails: form.paymentDetails || undefined,
		notes: form.notes || undefined,
		lineItems: [
			{
				id: crypto.randomUUID(),
				name: form.lineItemName,
				quantity: Number(form.lineItemQuantity),
				price: Number(form.lineItemPrice),
			},
		],
	});

	async function handleSaveSchedule() {
		setBusyAction(editingScheduleId ? "update" : "create");
		try {
			if (editingScheduleId) {
				await updateSchedule({
					scheduleId: editingScheduleId,
					...schedulePayload(),
				});
			} else {
				await createSchedule(schedulePayload());
			}
			setForm(initialForm(workspace));
			setEditingScheduleId(null);
			setEditorOpen(false);
			toast({
				title: editingScheduleId
					? "Recurring invoice schedule updated"
					: "Recurring invoice schedule created",
				description: "Velure will generate invoices when the schedule is due.",
			});
		} catch (error) {
			toast({
				title: "Could not create schedule",
				description:
					error instanceof Error ? error.message : "Please check the form.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	function handleEditSchedule(schedule: (typeof schedules)[number]) {
		const firstLineItem = schedule.lineItems[0];
		setEditingScheduleId(schedule._id);
		setForm({
			name: schedule.name,
			customerName: schedule.customerName,
			frequency: schedule.frequency,
			interval: schedule.interval,
			startDate: schedule.startDate,
			endDate: schedule.endDate ?? "",
			autoSend: schedule.autoSend,
			currency: schedule.currency,
			paymentTermsDays: schedule.paymentTermsDays,
			paymentDetails: schedule.paymentDetails ?? "",
			notes: schedule.notes ?? "",
			lineItemName: firstLineItem?.name ?? "Monthly service",
			lineItemQuantity: firstLineItem?.quantity ?? 1,
			lineItemPrice: firstLineItem?.price ?? 0,
		});
		setEditorOpen(true);
	}

	async function handleDeleteSchedule(
		scheduleId: Id<"recurring_invoice_schedules">,
	) {
		setBusyAction(`delete:${scheduleId}`);
		try {
			const result = await deleteSchedule({ scheduleId });
			if (editingScheduleId === scheduleId) {
				setEditingScheduleId(null);
				setForm(initialForm(workspace));
			}
			toast({
				title: result.deleted ? "Schedule deleted" : "Schedule ended",
				description: result.deleted
					? "The unused recurring schedule was removed."
					: "Generated invoices were kept, so the schedule was ended.",
			});
		} catch (error) {
			toast({
				title: "Could not delete schedule",
				description:
					error instanceof Error ? error.message : "Please try again later.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleRunDueSchedules() {
		setBusyAction("run");
		try {
			const result = await runRecurringGeneration({});
			toast({
				title: "Recurring invoice scan complete",
				description: `${result.createdCount} created, ${result.skippedCount} skipped, ${result.failedCount} failed.`,
			});
		} catch (error) {
			toast({
				title: "Could not run recurring scan",
				description:
					error instanceof Error ? error.message : "Please try again later.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleStatusChange(
		scheduleId: Id<"recurring_invoice_schedules">,
		status: "active" | "paused" | "ended",
	) {
		setBusyAction(`status:${scheduleId}`);
		try {
			await setScheduleStatus({ scheduleId, status });
			toast({
				title: "Schedule updated",
				description: `Schedule is now ${status}.`,
			});
		} catch (error) {
			toast({
				title: "Could not update schedule",
				description:
					error instanceof Error ? error.message : "Please try again later.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	return (
		<div className="mx-auto max-w-6xl space-y-6">
			<div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
				<div>
					<h1 className="text-3xl font-semibold text-ink">Recurring billing</h1>
					<p className="mt-2 max-w-2xl text-sm text-ink-3">
						Schedule repeat invoices for retainers, monthly services, and
						maintenance billing. Generated invoices stay in the normal Velure
						invoice flow.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						className="border-rule bg-paper"
						disabled={busyAction === "run"}
						onClick={handleRunDueSchedules}
					>
						{busyAction === "run" ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<RefreshCcw className="mr-2 h-4 w-4" />
						)}
						Run due scan
					</Button>
					<Button
						className="bg-brand text-brand-ink hover:bg-brand-hi"
						onClick={() => {
							setEditingScheduleId(null);
							setForm(initialForm(workspace));
							setEditorOpen(true);
						}}
					>
						<Repeat2 className="mr-2 h-4 w-4" /> New schedule
					</Button>
				</div>
			</div>

			<section className="grid gap-3 md:grid-cols-3">
				<Metric
					icon={Repeat2}
					label="Active schedules"
					value={stats.activeCount}
				/>
				<Metric
					icon={CalendarClock}
					label="Due now"
					value={stats.dueTodayCount}
				/>
				<Metric
					icon={PlayCircle}
					label="Generated invoices"
					value={stats.generatedCount}
				/>
			</section>

			<Sheet open={editorOpen} onOpenChange={setEditorOpen}>
				<SheetContent
					title={editingScheduleId ? "Edit schedule" : "New schedule"}
					className="overflow-y-auto p-5 sm:p-7"
				>
					<div className="mb-5">
						<h2 className="text-lg font-semibold text-ink">
							{editingScheduleId ? "Edit schedule" : "New schedule"}
						</h2>
						<p className="mt-1 text-sm text-ink-3">
							{editingScheduleId
								? "Update the reusable invoice template for future runs."
								: "Create one reusable invoice template for repeat billing."}
						</p>
					</div>

					<div className="space-y-4">
						<Field label="Schedule name">
							<Input
								value={form.name}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="Monthly support retainer"
							/>
						</Field>
						<Field label="Customer name">
							<Input
								value={form.customerName}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										customerName: event.target.value,
									}))
								}
								placeholder="Acme Services Ltd"
							/>
						</Field>
						<div className="grid gap-3 sm:grid-cols-2">
							<Field label="Frequency">
								<Select
									value={form.frequency}
									onValueChange={(value) =>
										setForm((current) => ({
											...current,
											frequency: value as Frequency,
										}))
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="monthly">Monthly</SelectItem>
										<SelectItem value="quarterly">Quarterly</SelectItem>
									</SelectContent>
								</Select>
							</Field>
							<Field label="Every">
								<Input
									min={1}
									max={12}
									type="number"
									value={form.interval}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											interval: Number(event.target.value),
										}))
									}
								/>
							</Field>
						</div>
						<div className="grid gap-3 sm:grid-cols-2">
							<DatePicker
								label="Start date"
								value={form.startDate}
								onChange={(v) =>
									setForm((current) => ({ ...current, startDate: v }))
								}
							/>
							<DatePicker
								label="End date"
								value={form.endDate}
								onChange={(v) =>
									setForm((current) => ({ ...current, endDate: v }))
								}
							/>
						</div>
						<div className="grid gap-3 sm:grid-cols-3">
							<Field label="Currency">
								<Input
									value={form.currency}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											currency: event.target.value.toUpperCase(),
										}))
									}
								/>
							</Field>
							<Field label="Terms days">
								<Input
									min={0}
									max={365}
									type="number"
									value={form.paymentTermsDays}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											paymentTermsDays: Number(event.target.value),
										}))
									}
								/>
							</Field>
						</div>
						<div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
							<Field label="Line item">
								<Input
									value={form.lineItemName}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											lineItemName: event.target.value,
										}))
									}
								/>
							</Field>
							<Field label="Qty">
								<Input
									min={1}
									type="number"
									value={form.lineItemQuantity}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											lineItemQuantity: Number(event.target.value),
										}))
									}
								/>
							</Field>
							<Field label="Price">
								<Input
									min={0}
									type="number"
									value={form.lineItemPrice}
									onChange={(event) =>
										setForm((current) => ({
											...current,
											lineItemPrice: Number(event.target.value),
										}))
									}
								/>
							</Field>
						</div>
						<Field label="Payment details">
							<Textarea
								className="min-h-20"
								value={form.paymentDetails}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										paymentDetails: event.target.value,
									}))
								}
								placeholder="Uses the payment details saved in General settings"
							/>
							<p className="text-xs text-ink-3">
								Prefilled from General settings. Edit here only to override this
								schedule.
							</p>
						</Field>
						<Field label="Notes">
							<Textarea
								className="min-h-20"
								value={form.notes}
								onChange={(event) =>
									setForm((current) => ({
										...current,
										notes: event.target.value,
									}))
								}
							/>
						</Field>
						<div className="flex items-start gap-3 rounded-md border border-rule bg-paper p-3 text-sm text-ink-2">
							<Checkbox
								id="recurring-auto-send"
								checked={form.autoSend}
								onCheckedChange={(checked) =>
									setForm((current) => ({
										...current,
										autoSend: checked === true,
									}))
								}
								className="mt-1"
							/>
							<label htmlFor="recurring-auto-send">
								<span className="block font-medium text-ink">
									Auto-send generated invoices
								</span>
								<span className="mt-1 block text-xs leading-5 text-ink-3">
									Store the preference for recurring invoices. Delivery still
									uses the normal invoice email flow.
								</span>
							</label>
						</div>
						<Button
							className="h-10 w-full bg-brand text-sm font-medium text-brand-ink hover:bg-brand-hi"
							disabled={busyAction === "create" || busyAction === "update"}
							onClick={handleSaveSchedule}
						>
							{busyAction === "create" || busyAction === "update" ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Repeat2 className="mr-2 h-4 w-4" />
							)}
							{editingScheduleId ? "Save schedule" : "Create schedule"}
						</Button>
						{editingScheduleId ? (
							<Button
								className="h-10 w-full border-rule bg-paper text-sm text-ink hover:bg-brand-soft"
								onClick={() => {
									setEditingScheduleId(null);
									setForm(initialForm(workspace));
								}}
								type="button"
								variant="outline"
							>
								Cancel edit
							</Button>
						) : null}
					</div>
				</SheetContent>
			</Sheet>

			<section className="space-y-3 border-t border-rule pt-2">
				<div className="flex items-center justify-between py-3">
					<div>
						<h2 className="text-base font-medium text-ink">Schedules</h2>
						<p className="text-sm text-ink-3">
							Reusable invoice plans and their next run.
						</p>
					</div>
					<span className="text-sm text-ink-3">{schedules.length} total</span>
				</div>
				{schedules.length === 0 ? (
					<div className="border border-dashed border-rule bg-paper-2 p-6 text-sm text-ink-3">
						No recurring schedules yet.
					</div>
				) : (
					schedules.map((schedule) => (
						<div
							className="border border-rule bg-paper-2 p-5"
							key={schedule._id}
						>
							<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div>
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="text-lg font-semibold text-ink">
											{schedule.name}
										</h2>
										<StatusBadge status={schedule.status} />
									</div>
									<p className="mt-1 text-sm text-ink-3">
										{schedule.customerName} · {schedule.frequency} · every{" "}
										{schedule.interval}
									</p>
								</div>
								<div className="flex flex-wrap gap-2">
									<ScheduleButton
										busy={busyAction === `status:${schedule._id}`}
										icon={Pencil}
										label="Edit"
										onClick={() => handleEditSchedule(schedule)}
									/>
									{schedule.status === "paused" ? (
										<ScheduleButton
											busy={busyAction === `status:${schedule._id}`}
											icon={PlayCircle}
											label="Resume"
											onClick={() => handleStatusChange(schedule._id, "active")}
										/>
									) : (
										<ScheduleButton
											busy={busyAction === `status:${schedule._id}`}
											icon={PauseCircle}
											label="Pause"
											onClick={() => handleStatusChange(schedule._id, "paused")}
										/>
									)}
									<ScheduleButton
										busy={busyAction === `status:${schedule._id}`}
										icon={StopCircle}
										label="End"
										onClick={() => handleStatusChange(schedule._id, "ended")}
									/>
									<ScheduleButton
										busy={busyAction === `delete:${schedule._id}`}
										icon={Trash2}
										label="Delete"
										onClick={() => {
											void handleDeleteSchedule(schedule._id);
										}}
									/>
								</div>
							</div>

							<div className="mt-4 grid gap-3 sm:grid-cols-3">
								<ScheduleDatum label="Next run" value={schedule.nextRunDate} />
								<ScheduleDatum
									label="Generated"
									value={String(schedule.generatedCount)}
								/>
								<ScheduleDatum
									label="Last period"
									value={schedule.lastGeneratedPeriod ?? "None"}
								/>
							</div>
							<div className="mt-4 border-t border-rule pt-4">
								<p className="text-sm text-ink">
									{schedule.currency}{" "}
									{schedule.lineItems
										.reduce((sum, item) => sum + item.quantity * item.price, 0)
										.toLocaleString()}
								</p>
								<p className="mt-1 text-xs text-ink-3">
									{schedule.lineItems.map((item) => item.name).join(", ")}
								</p>
							</div>
						</div>
					))
				)}
			</section>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="block space-y-1.5">
			<span className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
				{label}
			</span>
			{children}
		</div>
	);
}

function Metric({
	icon: Icon,
	label,
	value,
}: {
	icon: LucideIcon;
	label: string;
	value: number;
}) {
	return (
		<div className="border border-rule bg-paper-2 p-4">
			<div className="flex items-center gap-2 text-xs uppercase tracking-[0.08em] text-ink-3">
				<Icon className="h-4 w-4" />
				{label}
			</div>
			<p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
		</div>
	);
}

function StatusBadge({ status }: { status: "active" | "paused" | "ended" }) {
	const className =
		status === "active"
			? "border-ok-line bg-ok-soft text-ok"
			: status === "paused"
				? "border-warn-line/40 bg-warn-soft/10 text-warn"
				: "border-ink-3/40 bg-paper-3 text-ink-3";

	return (
		<Badge className={`border ${className}`} variant="outline">
			{status}
		</Badge>
	);
}

function ScheduleButton({
	busy,
	icon: Icon,
	label,
	onClick,
}: {
	busy: boolean;
	icon: LucideIcon;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			className="h-9 border-rule bg-paper px-3 text-xs text-ink hover:bg-brand-soft"
			disabled={busy}
			onClick={onClick}
			variant="outline"
		>
			{busy ? (
				<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
			) : (
				<Icon className="mr-2 h-3.5 w-3.5" />
			)}
			{label}
		</Button>
	);
}

function ScheduleDatum({ label, value }: { label: string; value: string }) {
	return (
		<div className="border border-rule bg-paper p-3">
			<p className="text-xs uppercase tracking-[0.08em] text-ink-3">{label}</p>
			<p className="mt-1 text-sm font-medium text-ink">{value}</p>
		</div>
	);
}
