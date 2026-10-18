import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle as handleAuditWrite } from "#/routes/api/invoice/audit";
import { getInvoiceUserContext } from "#/server/invoice-repository";
import { getSupabaseAdminClient } from "#/server/supabase";
import {
	buildInvoiceAuditRow,
	INVOICE_AUDIT_ACTIONS,
	recordInvoiceAudit,
	sanitizeAuditPayload,
} from "./audit";
import { createInvoiceExport } from "./compliance";
import {
	cancelSchedule,
	convertProformaToInvoice,
	createDraft,
	duplicate,
	markInvoiceSent,
	updateStatus,
} from "./invoices";
import { recordPayment } from "./payments";
import type { Supabase } from "./workspaces";

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));
vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: vi.fn(),
}));

const USER_ID = "user-1";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";

// ---------------------------------------------------------------------------
// Fakes: a per-table, in-call-order canned Supabase client for the user-scoped
// RLS side, and a capturing admin client for the audit writes.
// ---------------------------------------------------------------------------

type CannedResult = { data?: unknown; error?: unknown };

function createFakeUserClient(
	tables: Record<string, CannedResult[]>,
	options: {
		inserts?: Array<{ table: string; row: Record<string, unknown> }>;
	} = {},
) {
	const inserts = options.inserts ?? [];
	const builder = (table: string) => {
		const next = () => tables[table]?.shift() ?? { data: null, error: null };
		const b: Record<string, unknown> = {};
		for (const method of [
			"select",
			"eq",
			"neq",
			"is",
			"limit",
			"order",
			"gte",
			"lte",
			"update",
			"delete",
		]) {
			b[method] = () => b;
		}
		b.insert = (row: Record<string, unknown>) => {
			inserts.push({ table, row });
			return b;
		};
		b.maybeSingle = async () => next();
		b.single = async () => next();
		// biome-ignore lint/suspicious/noThenProperty: supabase query builders are thenables; the fake must be awaitable the same way.
		b.then = (
			onFulfilled: (value: CannedResult) => unknown,
			onRejected: (reason: unknown) => unknown,
		) => Promise.resolve(next()).then(onFulfilled, onRejected);
		return b;
	};
	const client = { from: (table: string) => builder(table) };
	return { client: client as unknown as Supabase, inserts };
}

function createFakeAdminClient() {
	const rows: Array<Record<string, unknown>> = [];
	let failure: { message: string } | null = null;
	const client = {
		from: () => ({
			insert: (row: Record<string, unknown>) => {
				if (!failure) rows.push(row);
				return Promise.resolve({ error: failure });
			},
		}),
	};
	return {
		client: client as unknown as Supabase,
		rows,
		failWith(message: string) {
			failure = { message };
		},
	};
}

function installAdminFake() {
	const fake = createFakeAdminClient();
	vi.mocked(getSupabaseAdminClient).mockReturnValue(fake.client);
	return fake;
}

/**
 * Run an audit write through the REAL server path.
 *
 * The lifecycle function under test writes via `./audit-client`, which POSTs
 * to POST /api/invoice/audit; the fetch stub below dispatches that request to
 * the real route handler, which derives the actor from the verified session,
 * validates the body and writes through the real `recordInvoiceAudit`
 * service into the captured admin client. Only the session and the database
 * are faked — exactly the boundary a browser-driven create/edit/cancel/
 * export action crosses.
 */
function installAuditEndpoint(client: Supabase) {
	const admin = installAdminFake();
	vi.mocked(getInvoiceUserContext).mockResolvedValue({
		userId: USER_ID,
		client,
	} as never);
	vi.stubGlobal("fetch", (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	) =>
		handleAuditWrite({
			request: new Request(new URL(String(input), "http://velure.test"), init),
		})) as typeof fetch);
	return admin;
}

beforeEach(() => {
	vi.mocked(getSupabaseAdminClient).mockReset();
	vi.mocked(getInvoiceUserContext).mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Row builder + payload sanitizer (pure)
// ---------------------------------------------------------------------------

describe("audit row construction", () => {
	it("records actor, action, resource and before/after with the resolved workspace", () => {
		const row = buildInvoiceAuditRow({
			workspaceId: WORKSPACE_ID,
			userId: USER_ID,
			entry: {
				action: "invoice.edit",
				resourceId: "inv-1",
				before: { id: "inv-1", status: "draft" },
				after: { id: "inv-1", status: "unpaid" },
				message: "Saved invoice changes.",
			},
		});
		expect(row).toEqual({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			actor_type: "user",
			action: "invoice.edit",
			resource_type: "invoice",
			resource_id: "inv-1",
			before_payload: { id: "inv-1", status: "draft" },
			after_payload: { id: "inv-1", status: "unpaid" },
			message: "Saved invoice changes.",
		});
	});

	it("supports explicit system actors for job/webhook paths", () => {
		const row = buildInvoiceAuditRow({
			workspaceId: WORKSPACE_ID,
			userId: USER_ID,
			entry: {
				action: "invoice.export",
				actor: { type: "system", id: "recurring-job" },
			},
		});
		expect(row.actor_type).toBe("system");
		expect(row.actor_id).toBe("recurring-job");
	});

	it("strips the public invoice token and secret-shaped keys from payloads", () => {
		const payload = sanitizeAuditPayload({
			id: "inv-1",
			token: "pub-secret-token",
			tokenRevokedAt: 123,
			nested: { apiKey: "sk-live", keep: "value", total: 1500 },
			lineItems: [{ name: "Item", quantity: 2, price: "500" }],
		});
		expect(payload).toEqual({
			id: "inv-1",
			nested: { keep: "value", total: 1500 },
			lineItems: [{ name: "Item", quantity: 2, price: "500" }],
		});
	});

	it("keeps every action inside the DB check constraint list", () => {
		const migration = readFileSync(
			new URL(
				"../../../supabase/migrations/20261016000000_einvoice_g1_invoice_audit_log.sql",
				import.meta.url,
			),
			"utf8",
		);
		for (const action of INVOICE_AUDIT_ACTIONS) {
			expect(migration).toContain(`'${action}'`);
		}
	});
});

// ---------------------------------------------------------------------------
// Service: tenancy, fail-closed behavior, append-only surface
// ---------------------------------------------------------------------------

describe("recordInvoiceAudit", () => {
	it("resolves the workspace server-side and writes one row", async () => {
		const admin = installAdminFake();
		const { client } = createFakeUserClient({
			active_workspaces: [{ data: { workspace_id: WORKSPACE_ID } }],
		});

		await recordInvoiceAudit(client, USER_ID, {
			action: "invoice.send",
			resourceId: "inv-1",
			message: "Invoice marked as sent.",
		});

		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			actor_type: "user",
			action: "invoice.send",
			resource_id: "inv-1",
		});
	});

	it("fails closed when no workspace can be resolved, writing nothing", async () => {
		const admin = installAdminFake();
		const { client } = createFakeUserClient({
			active_workspaces: [{ data: null }],
		});

		await expect(
			recordInvoiceAudit(client, USER_ID, { action: "invoice.create" }),
		).rejects.toThrow(/No active workspace/);
		expect(admin.rows).toHaveLength(0);
	});

	it("fails closed when the audit insert fails", async () => {
		const admin = installAdminFake();
		admin.failWith("audit insert refused");
		const { client } = createFakeUserClient({
			active_workspaces: [{ data: { workspace_id: WORKSPACE_ID } }],
		});

		await expect(
			recordInvoiceAudit(client, USER_ID, { action: "invoice.edit" }),
		).rejects.toMatchObject({ message: "audit insert refused" });
	});

	it("exposes no update or delete call path", async () => {
		const source = readFileSync(new URL("./audit.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/\.update\(/);
		expect(source).not.toMatch(/\.delete\(/);
		expect(source).toContain("getSupabaseAdminClient");
	});
});

// ---------------------------------------------------------------------------
// The audit table definition: insert+select-only floor, no update/delete path
// ---------------------------------------------------------------------------

describe("invoice_audit_log migration contract", () => {
	const sql = readFileSync(
		new URL(
			"../../../supabase/migrations/20261016000000_einvoice_g1_invoice_audit_log.sql",
			import.meta.url,
		),
		"utf8",
	);

	it("enables RLS and scopes member reads to their workspace", () => {
		expect(sql).toContain(
			"alter table public.invoice_audit_log enable row level security;",
		);
		expect(sql).toMatch(
			/create policy invoice_audit_log_member_select[\s\S]*for select[\s\S]*app\.is_workspace_member\(workspace_id\)/,
		);
	});

	it("defines no UPDATE or DELETE policy for any role", () => {
		expect(sql).not.toMatch(/\bfor update\b/i);
		expect(sql).not.toMatch(/\bfor delete\b/i);
	});

	it("keeps writes server-only: no insert/update/delete grant for public roles", () => {
		expect(sql).toContain(
			"revoke all on table public.invoice_audit_log from anon, authenticated;",
		);
		expect(sql).toMatch(
			/grant select on table public\.invoice_audit_log to authenticated;/,
		);
		expect(sql).not.toMatch(
			/grant\s+(insert|update|delete)[^;]*invoice_audit_log/is,
		);
	});

	it("blocks in-place rewrites for every role via an append-only trigger", () => {
		expect(sql).toContain("create trigger invoice_audit_log_append_only");
		expect(sql).toMatch(
			/before update on public\.invoice_audit_log\s+for each row\s+execute function public\.invoice_audit_log_append_only\(\);/,
		);
		expect(sql).toContain("is append-only");
	});

	it("ships a documented, reversible down section", () => {
		expect(sql).toContain("-- down (reversible)");
		expect(sql).toContain("drop table if exists public.invoice_audit_log;");
	});
});

// ---------------------------------------------------------------------------
// Wiring: every lifecycle path writes exactly one audit record
// ---------------------------------------------------------------------------

const invoiceRow = {
	id: "inv-1",
	token: "pub-token-secret",
	document_type: "standard",
	invoice_number: "INV-2026-0007",
	customer_id: null,
	customer_name: "Acme Ltd",
	currency: "NGN",
	invoice_type: "one-time",
	invoice_size: "A4",
	date_format: "ng",
	payment_terms_days: 14,
	template: "Default",
	issue_date: "2026-10-01",
	due_date: "2026-12-01",
	status: "unpaid",
	payment_amount: 0,
	delivered_at: "2026-10-02T10:00:00.000Z",
	canceled_at: null,
	line_items: [{ id: "li-1", name: "Service", quantity: 1, price: 5000 }],
	compliance: null,
	lifecycle: {},
	created_at: "2026-10-01T09:00:00.000Z",
	updated_at: "2026-10-02T10:00:00.000Z",
};

function workspaceResolutions(count: number): CannedResult[] {
	return Array.from({ length: count }, () => ({
		data: { workspace_id: WORKSPACE_ID },
	}));
}

describe("invoice lifecycle wiring", () => {
	it("createDraft records invoice.create with a sanitized after snapshot", async () => {
		const { client, inserts } = createFakeUserClient({
			active_workspaces: workspaceResolutions(2),
			workspaces: [
				{
					data: {
						name: "Velure",
						invoice_number_mode: "prefix",
						invoice_number_prefix: "INV",
						next_invoice_sequence: 7,
					},
				},
				{ data: null },
			],
			invoices: [{ data: [] }, { data: null }, { data: { id: "inv-new" } }],
		});
		const admin = installAuditEndpoint(client);

		const invoice = await createDraft(client, USER_ID, {
			token: "pub-draft-token",
			invoiceNumber: "INV-2026-0007",
			customerName: "Acme Ltd",
			currency: "NGN",
			issueDate: "2026-10-16",
			dueDate: "2026-11-01",
			lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 5000 }],
		});

		expect(invoice.id).toBe("inv-new");
		// One UI action, one audit row, written through the server endpoint.
		expect(admin.rows).toHaveLength(1);
		expect(getInvoiceUserContext).toHaveBeenCalledTimes(1);
		const auditRow = admin.rows[0] as Record<string, unknown>;
		expect(auditRow).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			action: "invoice.create",
			resource_type: "invoice",
			resource_id: "inv-new",
		});
		expect(auditRow.before_payload).toBeNull();
		const after = auditRow.after_payload as Record<string, unknown>;
		expect(after).toMatchObject({ id: "inv-new", customerName: "Acme Ltd" });
		// The draft's share token must never reach the audit trail.
		expect(JSON.stringify(auditRow)).not.toContain("pub-draft-token");
		// The invoice insert itself happened exactly once.
		expect(inserts.filter((entry) => entry.table === "invoices")).toHaveLength(
			1,
		);
	});

	it("markInvoiceSent records invoice.send", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(3),
			invoices: [{ data: invoiceRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await markInvoiceSent(client, USER_ID, "inv-1");

		expect(admin.rows).toHaveLength(1);
		const auditRow = admin.rows[0] as Record<string, unknown>;
		expect(auditRow).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			action: "invoice.send",
			resource_id: "inv-1",
			message: "Invoice marked as sent.",
		});
		const before = auditRow.before_payload as Record<string, unknown>;
		const after = auditRow.after_payload as Record<string, unknown>;
		expect(before).toMatchObject({ id: "inv-1", status: "unpaid" });
		expect(after).toMatchObject({ status: "unpaid" });
		expect(after.lifecycle).toMatchObject({ sentAt: expect.any(Number) });
		expect(JSON.stringify(auditRow)).not.toContain("pub-token-secret");
	});

	it("updateStatus(canceled) records invoice.cancel and fails closed on update errors", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(3),
			invoices: [{ data: invoiceRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await updateStatus(client, USER_ID, { id: "inv-1", status: "canceled" });

		expect(admin.rows).toHaveLength(1);
		const auditRow = admin.rows[0] as Record<string, unknown>;
		expect(auditRow).toMatchObject({
			action: "invoice.cancel",
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			resource_id: "inv-1",
			message: "Invoice canceled.",
		});
		expect(auditRow.before_payload).toMatchObject({ id: "inv-1" });
		expect(auditRow.after_payload).toMatchObject({
			status: "canceled",
			canceledAt: expect.any(Number),
		});

		// A failing invoice update must abort before any audit row is written.
		const broken = createFakeUserClient({
			active_workspaces: workspaceResolutions(3),
			invoices: [
				{ data: invoiceRow },
				{ data: null, error: { message: "update refused" } },
			],
		});
		const failing = installAuditEndpoint(broken.client);
		await expect(
			updateStatus(broken.client, USER_ID, {
				id: "inv-1",
				status: "canceled",
			}),
		).rejects.toMatchObject({ message: "update refused" });
		expect(failing.rows).toHaveLength(0);
	});

	it("cancelSchedule records invoice.edit for the schedule state change", async () => {
		const scheduledRow = {
			...invoiceRow,
			scheduled_at: "2026-12-01T10:00:00.000Z",
			schedule_version: "schedule-1",
		};
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(3),
			invoices: [{ data: scheduledRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await cancelSchedule(client, USER_ID, "inv-1");

		expect(admin.rows).toHaveLength(1);
		const auditRow = admin.rows[0] as Record<string, unknown>;
		expect(auditRow).toMatchObject({
			action: "invoice.edit",
			resource_id: "inv-1",
			message: "Canceled the scheduled send; invoice returned to draft.",
		});
		expect(auditRow.before_payload).toMatchObject({
			id: "inv-1",
			status: "scheduled",
		});
		expect(auditRow.after_payload).toMatchObject({
			scheduledAt: null,
			status: "draft",
		});
	});

	it("createInvoiceExport records invoice.export on the export resource", async () => {
		const { client, inserts } = createFakeUserClient({
			active_workspaces: workspaceResolutions(2),
			workspaces: [
				{
					data: {
						id: WORKSPACE_ID,
						name: "Acme Ltd",
						legal_name: "Acme Limited",
					},
				},
			],
			invoices: [{ data: [] }],
			invoice_exports: [
				{
					data: {
						id: "exp-1",
						file_name: "ACME-tax_summary_csv-1.csv",
						content: "invoiceNumber,total",
					},
				},
			],
		});
		const admin = installAuditEndpoint(client);

		const result = await createInvoiceExport(
			client,
			USER_ID,
			"tax_summary_csv",
		);

		expect(result.id).toBe("exp-1");
		expect(
			inserts.filter((entry) => entry.table === "invoice_exports"),
		).toHaveLength(1);
		expect(admin.rows).toHaveLength(1);
		const auditRow = admin.rows[0] as Record<string, unknown>;
		expect(auditRow).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			action: "invoice.export",
			resource_type: "invoice_export",
			resource_id: "exp-1",
		});
		expect(auditRow.after_payload).toMatchObject({
			kind: "tax_summary_csv",
			rowCount: 0,
		});
	});

	it("covers every required action across the wired call sites", () => {
		const invoicesSource = readFileSync(
			new URL("./invoices.ts", import.meta.url),
			"utf8",
		);
		const complianceSource = readFileSync(
			new URL("./compliance.ts", import.meta.url),
			"utf8",
		);
		for (const action of [
			"invoice.create",
			"invoice.edit",
			"invoice.send",
			"invoice.cancel",
		]) {
			expect(invoicesSource).toContain(`action: "${action}"`);
		}
		expect(complianceSource).toContain('action: "invoice.export"');
	});
});

// ---------------------------------------------------------------------------
// G1 fix round: previously unaudited material transitions, the create-event
// `before` shape, and the cancel transition guard
// ---------------------------------------------------------------------------

describe("material state transitions", () => {
	it("updateStatus(paid) appends invoice.edit with the settled money state", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [{ data: invoiceRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await updateStatus(client, USER_ID, {
			id: "inv-1",
			status: "paid",
			paymentReference: "REF-99",
		});

		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			action: "invoice.edit",
			resource_id: "inv-1",
			message: "Invoice marked as paid.",
		});
		expect(admin.rows[0].before_payload).toMatchObject({ id: "inv-1" });
		const paidAfter = admin.rows[0].after_payload as Record<string, unknown>;
		expect(paidAfter).toMatchObject({
			status: "paid",
			paidAt: expect.any(Number),
			paymentReference: "REF-99",
		});
		// The invoice is settled to its full total (tax inclusive), never below.
		expect(paidAfter.paymentAmount).toBeGreaterThanOrEqual(5000);
	});

	it("updateStatus(unpaid) appends invoice.edit for the issued → unpaid transition", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [{ data: invoiceRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await updateStatus(client, USER_ID, { id: "inv-1", status: "unpaid" });

		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			actor_id: USER_ID,
			action: "invoice.edit",
			resource_id: "inv-1",
			message: "Invoice marked as unpaid.",
		});
		expect(admin.rows[0].after_payload).toMatchObject({
			status: "unpaid",
			deliveredAt: expect.any(Number),
		});
	});

	it("updateStatus(draft) appends invoice.edit for the revert to draft", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [{ data: invoiceRow }, { data: null, error: null }],
		});
		const admin = installAuditEndpoint(client);

		await updateStatus(client, USER_ID, { id: "inv-1", status: "draft" });

		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			actor_id: USER_ID,
			action: "invoice.edit",
			resource_id: "inv-1",
			message: "Invoice reverted to draft.",
		});
		expect(admin.rows[0].before_payload).toMatchObject({ id: "inv-1" });
		expect(admin.rows[0].after_payload).toMatchObject({
			status: "draft",
			deliveredAt: null,
		});
	});

	it("recordPayment appends invoice.edit for the money it applied", async () => {
		const paidRow = {
			...invoiceRow,
			payment_amount: 5000,
			paid_at: "2026-10-17T10:00:00.000Z",
			status: "paid",
		};
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [
				{ data: invoiceRow },
				{ data: null, error: null },
				{ data: paidRow },
			],
		});
		const admin = installAuditEndpoint(client);

		const result = await recordPayment(client, USER_ID, {
			invoiceId: "inv-1",
			amount: 5000,
		});

		expect(result).toEqual({ ok: true, duplicate: false, invoiceId: "inv-1" });
		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			workspace_id: WORKSPACE_ID,
			actor_id: USER_ID,
			action: "invoice.edit",
			resource_id: "inv-1",
			message: "Recorded a payment.",
		});
		expect(admin.rows[0].before_payload).toMatchObject({
			id: "inv-1",
			paymentAmount: 0,
		});
		expect(admin.rows[0].after_payload).toMatchObject({
			id: "inv-1",
			paymentAmount: 5000,
			status: "paid",
		});
	});

	it("duplicate appends invoice.create with before: null (finding: no prior state)", async () => {
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			workspaces: [
				{
					data: {
						name: "Velure",
						invoice_number_mode: "prefix",
						invoice_number_prefix: "INV",
						next_invoice_sequence: 7,
					},
				},
				{ data: null },
			],
			invoices: [
				{ data: invoiceRow },
				{ data: [] },
				{ data: { id: "inv-dup" } },
			],
		});
		const admin = installAuditEndpoint(client);

		const created = await duplicate(client, USER_ID, "inv-1");

		expect(created.id).toBe("inv-dup");
		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			action: "invoice.create",
			resource_id: "inv-dup",
		});
		expect(admin.rows[0].before_payload).toBeNull();
		expect(admin.rows[0].after_payload).toMatchObject({
			duplicatedFrom: "inv-1",
		});
	});

	it("convertProformaToInvoice appends invoice.create with before: null", async () => {
		const proformaRow = {
			...invoiceRow,
			document_type: "proforma",
			invoice_number: "PF-2026-0001",
		};
		const { client } = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			workspaces: [
				{
					data: {
						name: "Velure",
						invoice_number_mode: "prefix",
						invoice_number_prefix: "INV",
						next_invoice_sequence: 7,
					},
				},
				{ data: null },
			],
			invoices: [
				{ data: proformaRow },
				{ data: [] },
				{ data: { id: "inv-converted" } },
			],
		});
		const admin = installAuditEndpoint(client);

		const created = await convertProformaToInvoice(client, USER_ID, "inv-1");

		expect(created.id).toBe("inv-converted");
		expect(admin.rows).toHaveLength(1);
		expect(admin.rows[0]).toMatchObject({
			action: "invoice.create",
			resource_id: "inv-converted",
		});
		expect(admin.rows[0].before_payload).toBeNull();
		expect(admin.rows[0].after_payload).toMatchObject({
			convertedFromProformaId: "inv-1",
			documentType: "standard",
		});
	});

	it("refuses a redundant or money-settling cancel without appending a row", async () => {
		const canceled = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [
				{
					data: {
						...invoiceRow,
						status: "canceled",
						canceled_at: "2026-10-05T10:00:00.000Z",
					},
				},
			],
		});
		const canceledAdmin = installAuditEndpoint(canceled.client);
		await expect(
			updateStatus(canceled.client, USER_ID, {
				id: "inv-1",
				status: "canceled",
			}),
		).rejects.toThrow(/already canceled/);
		expect(canceledAdmin.rows).toHaveLength(0);

		const paid = createFakeUserClient({
			active_workspaces: workspaceResolutions(6),
			invoices: [
				{
					data: {
						...invoiceRow,
						status: "paid",
						payment_amount: 100000,
						paid_at: "2026-10-05T10:00:00.000Z",
					},
				},
			],
		});
		const paidAdmin = installAuditEndpoint(paid.client);
		await expect(
			updateStatus(paid.client, USER_ID, { id: "inv-1", status: "canceled" }),
		).rejects.toThrow(/paid invoice cannot be canceled/);
		expect(paidAdmin.rows).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// G1 fix round: service-role DELETEs are rejected at the database, while the
// workspaces FK ON DELETE CASCADE (account deletion) still works
// ---------------------------------------------------------------------------

describe("invoice_audit_log delete guard migration", () => {
	const guard = readFileSync(
		new URL(
			"../../../supabase/migrations/20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql",
			import.meta.url,
		),
		"utf8",
	);
	const original = readFileSync(
		new URL(
			"../../../supabase/migrations/20261016000000_einvoice_g1_invoice_audit_log.sql",
			import.meta.url,
		),
		"utf8",
	);

	it("rejects a direct removal of an audit row for every role", () => {
		expect(guard).toMatch(
			/create trigger invoice_audit_log_block_delete\s+before delete on public\.invoice_audit_log\s+for each row\s+execute function public\.invoice_audit_log_append_only_delete\(\);/,
		);
		expect(guard).toContain(
			"create or replace function public.invoice_audit_log_append_only_delete()",
		);
		// Inside a BEFORE ROW trigger `pg_trigger_depth()` is 1 when the
		// statement came straight from a client (service-role included) and
		// greater than 1 when a parent trigger caused it — so `<= 1` is the
		// "not nested" check that rejects every direct removal.
		expect(guard).toMatch(/if pg_trigger_depth\(\) <= 1 then/);
		expect(guard).toMatch(
			/raise exception[\s\S]*append-only; deletes are not permitted[\s\S]*using errcode = 'insufficient_privilege';/,
		);
	});

	it("lets the workspaces FK ON DELETE CASCADE through (nested removal only)", () => {
		// The guard returns `old` (row passes) only for the nested case; it
		// never blocks the cascade that account deletion depends on.
		expect(guard).toMatch(/-- nested delete[\s\S]*return old;/);
		expect(guard).not.toMatch(/return null;/);
	});

	it("touches only the guard objects and ships a reversible down section", () => {
		expect(guard).not.toMatch(/^\s*grant\s/im);
		expect(guard).not.toMatch(/^\s*create policy/im);
		expect(guard).not.toMatch(/^\s*alter table/im);
		expect(guard).toContain("-- down (reversible)");
		expect(guard).toContain(
			"drop trigger if exists invoice_audit_log_block_delete on public.invoice_audit_log;",
		);
		expect(guard).toContain(
			"drop function if exists public.invoice_audit_log_append_only_delete();",
		);
	});

	it("corrects the misleading delete claim in the original migration header", () => {
		// The header used to claim that only the FK cascade could remove a
		// row; it now points at the guard that enforces that.
		expect(original).not.toContain(
			"method. The only delete that can touch rows",
		);
		expect(original).toContain(
			"20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql",
		);
		// Comment-only correction: the original migration's SQL is untouched.
		expect(original).toContain("create table public.invoice_audit_log (");
		expect(original).toContain("create trigger invoice_audit_log_append_only");
	});
});
