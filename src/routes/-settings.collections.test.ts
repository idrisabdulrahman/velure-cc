import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WP-E viewer guard for the payment-reminders settings page.
 *
 * This repo has no component-test harness (node test environment, no
 * testing-library), so the read-only wiring is pinned against the route
 * source: the role hook, the derived viewer flag, the read-only banner, and an
 * `isViewer` guard on every control that can change server state.
 */

const source = readFileSync(
	fileURLToPath(new URL("./settings.collections.tsx", import.meta.url)),
	"utf8",
);

/**
 * The `disabled` expression immediately guarding the control that owns
 * `marker`. Every mutating control puts its `disabled` prop ahead of the
 * handler/anchor we look for, so the nearest preceding `disabled={` is the
 * control's own guard — not a neighbour's.
 */
function guardBefore(marker: string): string {
	const index = source.indexOf(marker);
	expect(index, `expected to find ${marker}`).toBeGreaterThan(-1);
	const guard = source.lastIndexOf("disabled={", index);
	expect(guard, `expected a disabled guard before ${marker}`).toBeGreaterThan(
		-1,
	);
	return source.slice(guard, index);
}

function expectViewerGuard(marker: string) {
	expect(guardBefore(marker), `${marker} must be gated on isViewer`).toContain(
		"isViewer",
	);
}

describe("collections settings viewer guard", () => {
	it("reads the workspace role and derives the viewer flag", () => {
		expect(source).toContain('from "#/lib/workspace-role"');
		expect(source).toContain("useWorkspaceRole");
		expect(source).toContain("const isViewer = isWorkspaceViewer(role);");
	});

	it("renders the read-only banner for a viewer", () => {
		expect(source).toContain("Read-only access");
		expect(source).toContain("You are a viewer in this workspace");
	});

	it("keeps the current schedule values readable by a viewer", () => {
		expect(source).toContain("Current schedule:");
	});

	it("gates the reminder schedule entry point and its save", () => {
		expectViewerGuard("setScheduleOpen(true)");
		expectViewerGuard('title: "Reminder schedule saved"');
	});

	it("gates the automatic-reminders toggle", () => {
		expectViewerGuard("onChange={async (checked)");
	});

	it("gates the schedule inputs", () => {
		expectViewerGuard("daysBeforeDue: Number(event.target.value)");
		expectViewerGuard("overdueCadenceDays: Number(event.target.value)");
		expectViewerGuard("maxOverdueReminders: Number(event.target.value)");
		expectViewerGuard("escalateAfterCount: Number(event.target.value)");
		expectViewerGuard("businessSignature: event.target.value");
	});

	it("gates every scan, send, pause and manual action", () => {
		expectViewerGuard("runReminderBatch({})");
		expectViewerGuard("sendQueuedEmails({})");
		expectViewerGuard("queueReminderEvent({");
		expectViewerGuard("resumeReminders({");
		expectViewerGuard("markManualException({");
	});
});

/**
 * WS3 — the settings page distinguishes the two independent switches and reads
 * the same derived status/amount as the rest of the app.
 */
describe("collections settings balance signals", () => {
	it("shows scheduled scanning and automatic email delivery as separate signals", () => {
		expect(source).toContain("Scheduled scanning is ");
		expect(source).toContain("Automatic email delivery");
		expect(source).not.toContain("Automatic reminders are ");
	});

	it("reads the boolean automatic-send switch without exposing the secret", () => {
		expect(source).toContain('"/api/reminders/send-queue"');
		expect(source).toContain('method: "GET"');
		expect(source).toContain("automaticSendingEnabled");
		// The raw env switch must never reach the client bundle.
		expect(source).not.toContain("SCHEDULER_REMINDER_SEND_ENABLED");
	});

	it("uses the server-derived status, net amount and flags", () => {
		expect(source).toContain("invoice.netPayable");
		expect(source).toContain("return invoice.overdue;");
		expect(source).toContain("return invoice.missingEmail;");
		expect(source).toContain("return invoice.pausedOrManual;");
		expect(source).toContain('invoice.status === "draft"');
	});
});
