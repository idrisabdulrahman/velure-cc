import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Supabase } from "#/server/data/workspaces";
import { getInvoiceUserContext } from "#/server/invoice-repository";
import { getSupabaseAdminClient } from "#/server/supabase";
import { handle } from "./audit";

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: vi.fn(),
}));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

/**
 * G1 — contract tests for POST /api/invoice/audit, the ONLY server entry
 * point for browser-initiated audit writes.
 *
 * The session and the database are faked; the handler, its validation
 * schema and the real `recordInvoiceAudit` service run unmocked, so these
 * tests exercise the real server path a UI-driven write takes.
 */

const USER_ID = "session-user-1";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";

function createSessionClient(
	activeWorkspaces: Array<{ data: { workspace_id: string } | null } | null>,
) {
	const client = {
		from: () => {
			const next = () =>
				activeWorkspaces.shift() ?? { data: null, error: null };
			const builder: Record<string, unknown> = {};
			builder.select = () => builder;
			builder.eq = () => builder;
			builder.maybeSingle = async () => next();
			return builder;
		},
	};
	return client as unknown as Supabase;
}

function installAdminCapture() {
	const rows: Array<Record<string, unknown>> = [];
	let failure: { message: string } | null = null;
	vi.mocked(getSupabaseAdminClient).mockReturnValue({
		from: () => ({
			insert: (row: Record<string, unknown>) => {
				if (!failure) rows.push(row);
				return Promise.resolve({ error: failure });
			},
		}),
	} as never);
	return {
		rows,
		failWith(message: string) {
			failure = { message };
		},
	};
}

function post(body: string, headers: Record<string, string> = {}) {
	return new Request("http://velure.test/api/invoice/audit", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});
}

beforeEach(() => {
	vi.mocked(getInvoiceUserContext).mockReset();
	vi.mocked(getSupabaseAdminClient).mockReset();
});

describe("POST /api/invoice/audit", () => {
	it("writes exactly one row with the session actor and resolved workspace", async () => {
		const admin = installAdminCapture();
		const client = createSessionClient([
			{ data: { workspace_id: WORKSPACE_ID } },
		]);
		vi.mocked(getInvoiceUserContext).mockResolvedValue({
			userId: USER_ID,
			client,
		} as never);

		const response = await handle({
			request: post(
				JSON.stringify({
					action: "invoice.edit",
					resourceId: "inv-1",
					before: { id: "inv-1", status: "draft" },
					after: { id: "inv-1", customerName: "Acme Ltd" },
					message: "Saved invoice changes.",
				}),
			),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toEqual({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			actor_type: "user",
			action: "invoice.edit",
			resource_type: "invoice",
			resource_id: "inv-1",
			before_payload: { id: "inv-1", status: "draft" },
			after_payload: { id: "inv-1", customerName: "Acme Ltd" },
			message: "Saved invoice changes.",
		});
	});

	it("derives identity server-side: client-supplied actor, workspace and user ids are dropped", async () => {
		const admin = installAdminCapture();
		const client = createSessionClient([
			{ data: { workspace_id: WORKSPACE_ID } },
		]);
		vi.mocked(getInvoiceUserContext).mockResolvedValue({
			userId: USER_ID,
			client,
		} as never);

		const response = await handle({
			request: post(
				JSON.stringify({
					action: "invoice.cancel",
					resourceId: "inv-1",
					actor: { type: "system", id: "service-role" },
					actorId: "someone-else",
					actor_id: "someone-else",
					actorType: "system",
					workspaceId: "00000000-0000-4000-8000-0000000000ff",
					workspace_id: "00000000-0000-4000-8000-0000000000ff",
					userId: "forged-user",
					created_at: "2020-01-01T00:00:00.000Z",
				}),
			),
		});

		expect(response.status).toBe(200);
		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			actor_type: "user",
			action: "invoice.cancel",
		});
	});

	it("rejects unauthenticated writes without touching the table", async () => {
		const admin = installAdminCapture();
		vi.mocked(getInvoiceUserContext).mockResolvedValue(null);

		const response = await handle({
			request: post(JSON.stringify({ action: "invoice.create" })),
		});

		expect(response.status).toBe(401);
		expect(admin.rows).toHaveLength(0);
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON and unknown actions with 400", async () => {
		const admin = installAdminCapture();
		const client = createSessionClient([]);
		vi.mocked(getInvoiceUserContext).mockResolvedValue({
			userId: USER_ID,
			client,
		} as never);

		const malformed = await handle({ request: post("{oops") });
		expect(malformed.status).toBe(400);

		const unknownAction = await handle({
			request: post(JSON.stringify({ action: "invoice.delete" })),
		});
		expect(unknownAction.status).toBe(400);

		const oversizedMessage = await handle({
			request: post(
				JSON.stringify({ action: "invoice.edit", message: "x".repeat(501) }),
			),
		});
		expect(oversizedMessage.status).toBe(400);

		expect(admin.rows).toHaveLength(0);
	});

	it("refuses bodies over the request limit", async () => {
		const admin = installAdminCapture();
		const client = createSessionClient([]);
		vi.mocked(getInvoiceUserContext).mockResolvedValue({
			userId: USER_ID,
			client,
		} as never);

		const response = await handle({
			request: post("{}", { "content-length": String(512 * 1024) }),
		});

		expect(response.status).toBe(413);
		expect(admin.rows).toHaveLength(0);
	});

	it("fails closed with 500 when the append-only insert is refused", async () => {
		const admin = installAdminCapture();
		admin.failWith("audit insert refused");
		const client = createSessionClient([
			{ data: { workspace_id: WORKSPACE_ID } },
		]);
		vi.mocked(getInvoiceUserContext).mockResolvedValue({
			userId: USER_ID,
			client,
		} as never);

		const response = await handle({
			request: post(JSON.stringify({ action: "invoice.create" })),
		});

		expect(response.status).toBe(500);
		expect(admin.rows).toHaveLength(0);
	});
});
