import type { ReactNode } from "react";

/* Shared sample reminder queue, used by the landing page's reminders section
 * and the /reminders marketing page. Every figure here is illustrative
 * product UI and carries the explicit sample note — no mock figure ships
 * unlabelled. The rules panel copy stays honest about what the app does
 * today: reminder rules run, but each run is sent manually. */

export function SampleNote() {
	return (
		<p className="mt-3 text-center text-[12px] text-[var(--hm-ink-3)]">
			Sample data shown for illustration.
		</p>
	);
}

export function StatusPill({
	tone,
	children,
}: {
	tone: "warn" | "bad" | "ok" | "info" | "mute";
	children: ReactNode;
}) {
	const tones = {
		warn: "text-[var(--hm-warn)] bg-[var(--hm-warn-soft)]",
		bad: "text-[var(--hm-danger)] bg-[var(--hm-danger-soft)]",
		ok: "text-[var(--hm-ok)] bg-[var(--hm-ok-soft)]",
		info: "text-[var(--hm-info)] bg-[var(--hm-info-soft)]",
		mute: "text-[var(--hm-ink-2)] bg-black/[0.06]",
	} as const;
	return (
		<span
			className={`inline-flex h-[22px] w-max items-center gap-1.5 rounded-full px-[9px] text-[11.5px] font-medium ${tones[tone]}`}
		>
			<i className="h-1.5 w-1.5 rounded-full bg-current" />
			{children}
		</span>
	);
}

export function ReminderQueue() {
	const rows = [
		{
			initials: "KS",
			no: "INV-2026-0041",
			who: "Kwara Solar Supply",
			amount: "₦812,500",
			due: "due 12/09/2026",
			tags: [{ label: "12 days overdue", tone: "bad" as const }],
			selected: true,
		},
		{
			initials: "AF",
			no: "INV-2026-0042",
			who: "Adaeze Foods Ltd",
			amount: "₦2,418,750",
			due: "due 21/10/2026",
			tags: [
				{ label: "Due in 3 days", tone: "mute" as const },
				{ label: "Reminder queued", tone: "info" as const },
			],
			selected: false,
		},
		{
			initials: "?",
			no: "INV-2026-0036",
			who: "No buyer email",
			amount: "₦150,000",
			due: "due 24/10/2026",
			tags: [{ label: "Needs email", tone: "warn" as const }],
			selected: false,
		},
	];

	return (
		<div data-fade-scroll>
			<div className="overflow-hidden rounded-2xl border border-[var(--hm-rule)] bg-[var(--hm-paper-2)] shadow-[0_28px_70px_-24px_rgba(23,20,18,0.2)]">
				<div className="flex items-center justify-between border-b border-[var(--hm-rule-soft)] px-[18px] py-3.5 text-[13.5px] font-medium">
					Queue
					<span className="text-xs font-normal text-[var(--hm-ink-3)]">
						3 invoices
					</span>
				</div>
				<div className="flex items-center gap-3 border-b border-[var(--hm-rule-soft)] px-[18px] py-3 text-[12.5px] text-[var(--hm-ink-2)]">
					<span
						aria-hidden="true"
						className="relative h-5 w-10 flex-none rounded-full border border-[var(--hm-accent-line)] bg-[var(--hm-accent-soft)]"
					>
						<span className="absolute left-4 top-[2px] h-3.5 w-3.5 rounded-full bg-[var(--hm-accent)]" />
					</span>
					<div>
						<b className="font-medium text-[var(--hm-ink)]">
							Reminder rules are on
						</b>
						<br />
						First reminder 3 days before due — sent automatically.
					</div>
				</div>
				{rows.map((row) => (
					<div
						key={row.no}
						className={`relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-[var(--hm-rule-soft)] px-[18px] py-3.5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${row.selected ? "bg-[linear-gradient(90deg,var(--hm-accent-soft),rgba(229,72,59,.015)_80%)]" : ""}`}
					>
						{row.selected ? (
							<span
								aria-hidden="true"
								className="absolute inset-y-3 left-0 w-0.5 rounded-sm bg-[var(--hm-accent)]"
							/>
						) : null}
						<span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-[var(--hm-accent-soft)] text-[11px] font-semibold text-[var(--hm-accent-on-soft)] shadow-[inset_0_0_0_1px_var(--hm-accent-line)]">
							{row.initials}
						</span>
						<div className="min-w-0">
							<div className="hm-num text-[12.5px]">{row.no}</div>
							<div className="mt-0.5 text-[12.5px] text-[var(--hm-ink-2)]">
								{row.who}
							</div>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{row.tags.map((tag) => (
									<StatusPill key={tag.label} tone={tag.tone}>
										{tag.label}
									</StatusPill>
								))}
							</div>
						</div>
						<div className="hm-num col-start-2 text-[13px] sm:col-start-3 sm:text-right">
							{row.amount}{" "}
							<small className="mt-0.5 block text-[11.5px] text-[var(--hm-ink-3)] sm:inline sm:mt-0">
								{row.due}
							</small>
						</div>
					</div>
				))}
			</div>
			<SampleNote />
		</div>
	);
}
