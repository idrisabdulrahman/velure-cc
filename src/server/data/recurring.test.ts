import { describe, expect, it } from "vitest";
import { listRecurringRuns } from "./recurring";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * T1 — the recurring ledger read behind the Settings last-run panel.
 *
 * `recurring_invoice_runs` is workspace-owned, so the read resolves the
 * caller's active workspace and filters by it (RLS is the second line of
 * defence, not the only one). One workspace must never see another's runs.
 */

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";

function runRow(
	id: string,
	workspaceId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		workspace_id: workspaceId,
		schedule_id: `sched-${id}`,
		period_key: "2026-10-01",
		invoice_id: null,
		status: "created",
		error: null,
		created_at: "2026-10-01T09:00:00.000Z",
		updated_at: "2026-10-01T09:00:00.000Z",
		...overrides,
	};
}

function seed(): FakeTables {
	return {
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
		],
		recurring_invoice_runs: [
			runRow("a-old", WS_A, {
				period_key: "2026-09-01",
				created_at: "2026-09-01T09:00:00.000Z",
			}),
			runRow("b-only", WS_B, { created_at: "2026-10-02T09:00:00.000Z" }),
			runRow("a-new", WS_A, {
				status: "failed",
				error: "CBN settlement warning",
				created_at: "2026-10-02T10:00:00.000Z",
			}),
		],
	};
}

describe("listRecurringRuns", () => {
	it("returns only the caller's workspace runs, newest first", async () => {
		const { client } = createFakeSupabase(seed());

		const runs = await listRecurringRuns(client, USER_A);

		expect(runs.map((run) => run._id)).toEqual(["a-new", "a-old"]);
		expect(runs[0]).toMatchObject({
			scheduleId: "sched-a-new",
			periodKey: "2026-10-01",
			status: "failed",
			error: "CBN settlement warning",
		});
	});

	it("caps the read at the requested limit", async () => {
		const { client } = createFakeSupabase(seed());

		await expect(listRecurringRuns(client, USER_A, 1)).resolves.toHaveLength(1);
	});
});
