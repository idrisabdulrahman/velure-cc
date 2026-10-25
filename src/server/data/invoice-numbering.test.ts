import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	assertInvoiceNumberAvailable,
	assertSequenceCounterChangeAllowed,
	candidateInvoiceNumber,
	commitInvoiceNumber,
	invoiceNumberForSequence,
	isInvoiceIssued,
	planInvoiceNumber,
	reserveInvoiceNumber,
	resolveInvoiceNumberPrefix,
	sequenceFromInvoiceNumber,
	workspaceNumberingLocked,
} from "./invoice-numbering";
import {
	buildInvoiceListSummary,
	mapInvoice,
	mapPublicInvoice,
	rowToInvoiceDoc,
} from "./invoices";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * WP8 (C1/C2) — the invoice-number authority and the issued predicate.
 *
 * These tests pin three things the spec makes load-bearing:
 *   1. the pure helpers (format, parse, prefix, candidate resolution);
 *   2. the DETERMINISTIC concurrency contract: two plans read the same floor,
 *      the allocator hands out distinct numbers no matter the commit order,
 *      and the unique index backstops every other writer;
 *   3. the migration sources: the allocator is ONE atomic statement, the
 *      unique index exists, and both migrations ship a working down section.
 */

const USER = "user-a";
const WS = "ws-a";

function workspaceRow(nextInvoiceSequence = 5) {
	return {
		id: WS,
		owner_id: USER,
		name: "Alpha Ventures Ltd",
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: nextInvoiceSequence,
	};
}

function seed(extra: Partial<FakeTables> = {}): FakeTables {
	return {
		workspaces: [workspaceRow()],
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		invoices: [],
		...extra,
	};
}

/** Minimal snake-case invoice row in the shape `rowToInvoiceDoc` consumes. */
function invoiceRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inv-1",
		workspace_id: WS,
		user_id: USER,
		token: "pub-token-1",
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: "INV-2026-0005",
		customer_name: "Customer A",
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		invoice_size: "A4",
		date_format: "ng",
		payment_terms_days: 14,
		template: "Default",
		issue_date: "2026-01-01",
		due_date: "2026-02-01",
		status: "draft",
		payment_amount: 0,
		delivered_at: null,
		canceled_at: null,
		paid_at: null,
		payment_reference: null,
		finalized_at: "2026-01-01T00:00:00.000Z",
		scheduled_at: null,
		schedule_version: null,
		line_items: [{ id: "li-1", name: "Item", quantity: 1, price: 100 }],
		compliance: { buyer: { email: "buyer-a@example.test" } },
		fiscalization: null,
		reminder: null,
		sync: null,
		lifecycle: {},
		notes: null,
		internal_notes: null,
		deleted_at: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-02T00:00:00.000Z",
		...overrides,
	};
}

const MIGRATION_C1 = readFileSync(
	new URL(
		"../../../supabase/migrations/20261020000000_einvoice_c1_invoice_number_sequence.sql",
		import.meta.url,
	),
	"utf8",
);
const MIGRATION_B6 = readFileSync(
	new URL(
		"../../../supabase/migrations/20261023000000_einvoice_b6_document_types.sql",
		import.meta.url,
	),
	"utf8",
);
const MIGRATION_C2_C3 = readFileSync(
	new URL(
		"../../../supabase/migrations/20261020000001_einvoice_c2_c3_invoice_lock_guard.sql",
		import.meta.url,
	),
	"utf8",
);
const MIGRATION_C3_AUDIT = readFileSync(
	new URL(
		"../../../supabase/migrations/20261020000002_einvoice_c3_audit_action_delete.sql",
		import.meta.url,
	),
	"utf8",
);

describe("number formatting helpers", () => {
	it("parses and formats PREFIX-YYYY-NNNN", () => {
		expect(sequenceFromInvoiceNumber("INV-2026-0042", "INV", 2026)).toBe(42);
		expect(sequenceFromInvoiceNumber("ACME-2026-0042", "INV", 2026)).toBe(null);
		expect(sequenceFromInvoiceNumber("INV-2025-0042", "INV", 2026)).toBe(null);
		expect(invoiceNumberForSequence("INV", 2026, 42)).toBe("INV-2026-000042");
		expect(invoiceNumberForSequence("ACME", 2026, 42)).toBe("ACME-2026-0042");
	});

	it("sanitizes the numbering prefix", () => {
		expect(
			resolveInvoiceNumberPrefix({
				name: "Alpha Ventures Ltd!",
				invoice_number_mode: "business_name",
			}),
			// "ALPHAVENTURESLTD" clipped to the 12-character prefix limit.
		).toBe("ALPHAVENTURE");
		expect(
			resolveInvoiceNumberPrefix({
				name: "Ignored",
				invoice_number_mode: "prefix",
				invoice_number_prefix: "  av-2 ",
			}),
		).toBe("AV2");
		expect(resolveInvoiceNumberPrefix(null)).toBe("INV");
	});
});

describe("isInvoiceIssued (mirror of public.invoice_is_issued)", () => {
	it("keeps a created-but-unsent invoice unissued", () => {
		// The exact shape the create flow writes: derived status "unpaid" and
		// finalizedAt set, but nothing ever left the tenant's hands.
		const createdButUnsent = {
			status: "unpaid",
			finalizedAt: 1,
			paymentAmount: 0,
		};
		expect(isInvoiceIssued(createdButUnsent)).toBe(false);
		expect(isInvoiceIssued({ status: "draft" })).toBe(false);
		expect(
			isInvoiceIssued({
				status: "unpaid",
				lifecycle: { firstViewedAt: 1 },
				paymentAmount: 0,
			}),
		).toBe(false);
	});

	it("treats delivery and money movement as issued", () => {
		expect(isInvoiceIssued({ deliveredAt: 1 })).toBe(true);
		expect(isInvoiceIssued({ paidAt: 1 })).toBe(true);
		expect(isInvoiceIssued({ paymentReference: "bank-x" })).toBe(true);
		expect(isInvoiceIssued({ paymentAmount: 1 })).toBe(true);
		expect(isInvoiceIssued({ status: "paid" })).toBe(true);
		expect(isInvoiceIssued({ lifecycle: { sentAt: 1 } })).toBe(true);
		expect(isInvoiceIssued({ lifecycle: { emailDeliveredAt: 1 } })).toBe(true);
		expect(isInvoiceIssued({ lifecycle: { paymentReceivedAt: 1 } })).toBe(true);
	});
});

describe("mapInvoice exposes truthful delivery evidence", () => {
	it("has a guarded reversible enum and issued-source down migration", () => {
		expect(MIGRATION_B6).toContain(
			"('standard', 'credit_note', 'debit_note', 'proforma')",
		);
		expect(MIGRATION_B6).toContain(
			"Cannot rollback B6 while credit/debit notes exist",
		);
		expect(MIGRATION_B6).toContain("invoices_corrects_source_immutable");
		expect(MIGRATION_B6).toContain("invoice_is_issued(old)");
		expect(MIGRATION_B6).toContain(
			"references public.invoices (id, workspace_id)",
		);
		expect(MIGRATION_B6).toContain("invoices_correction_source_type_check");
	});

	it("round-trips correction types and their private source reference", () => {
		for (const documentType of ["credit_note", "debit_note"] as const) {
			const mapped = mapInvoice(
				rowToInvoiceDoc(
					invoiceRow({
						document_type: documentType,
						corrects_invoice_id: "source-1",
					}) as never,
				),
			);
			expect(mapped.documentType).toBe(documentType);
			expect(mapped.correctsInvoiceId).toBe("source-1");
			expect(mapPublicInvoice(mapped)).not.toHaveProperty("correctsInvoiceId");
		}
	});

	it("keeps correction values out of ordinary receivable and revenue totals", () => {
		const summary = buildInvoiceListSummary([
			{
				documentType: "credit_note",
				status: "paid",
				total: 500,
				balance: 0,
				paymentAmount: 500,
				currency: "NGN",
				issueDate: "2026-01-01",
			},
			{
				documentType: "debit_note",
				status: "unpaid",
				total: 900,
				balance: 900,
				paymentAmount: 0,
				currency: "NGN",
				issueDate: "2026-01-01",
			},
		]);
		expect(summary.currencySummaries[0]).toMatchObject({
			paidAmount: 0,
			openAmount: 0,
			overdueAmount: 0,
		});
		expect(summary.paymentScore.status).toBe("no_data");
		expect(
			summary.chartDataByCurrency.NGN?.every(
				(point) => point.paidRevenue === 0 && point.unpaidRevenue === 0,
			),
		).toBe(true);
	});

	it("does not fabricate deliveredAt for a created-but-unsent invoice", () => {
		// Regression pin: the mapped `deliveredAt` used to fall back to
		// `updatedAt` for any stored status !== "draft", so every ordinary
		// created invoice (stored status "unpaid") read as ISSUED and got
		// locked by the C2/C3 guards. The mapped field must mirror the SQL
		// predicate: only real delivery evidence counts.
		const mapped = mapInvoice(
			rowToInvoiceDoc(invoiceRow({ status: "unpaid" }) as never),
		);
		expect(mapped.deliveredAt).toBeUndefined();
		expect(isInvoiceIssued(mapped)).toBe(false);
	});

	it("keeps a delivered invoice issued with its real delivery time", () => {
		const deliveredAt = Date.parse("2026-01-05T10:00:00.000Z");
		const mapped = mapInvoice(
			rowToInvoiceDoc(
				invoiceRow({
					status: "unpaid",
					delivered_at: new Date(deliveredAt).toISOString(),
				}) as never,
			),
		);
		expect(mapped.deliveredAt).toBe(deliveredAt);
		expect(isInvoiceIssued(mapped)).toBe(true);
	});
});

describe("allocator: plan/commit under concurrency", () => {
	const year = new Date().getFullYear();

	it("two issuances planned from the same floor receive distinct numbers", async () => {
		const { client, tables } = createFakeSupabase(seed());

		// Both sessions plan BEFORE either commits — the pre-WP8 race.
		const planA = await planInvoiceNumber(client, { workspaceId: WS });
		const planB = await planInvoiceNumber(client, { workspaceId: WS });
		expect(planA.minimumSequence).toBe(5);
		expect(planB.minimumSequence).toBe(5);
		expect(candidateInvoiceNumber(planA).invoiceNumber).toBe(
			`INV-${year}-000005`,
		);

		// Whichever order the commits serialize in, the numbers differ: the
		// allocator's `greatest(last_value + 1, minimum)` is evaluated against
		// the committed counter, never against the stale plan.
		const numberA = await commitInvoiceNumber(
			client,
			planA,
			candidateInvoiceNumber(planA),
		);
		const numberB = await commitInvoiceNumber(
			client,
			planB,
			candidateInvoiceNumber(planB),
		);
		expect(numberA).toBe(`INV-${year}-000005`);
		expect(numberB).toBe(`INV-${year}-000006`);

		// A third writer holding the SAME stale plan still gets a fresh number.
		const numberC = await commitInvoiceNumber(
			client,
			planA,
			candidateInvoiceNumber(planA),
		);
		expect(numberC).toBe(`INV-${year}-000007`);

		// Both rows insert cleanly under the unique index …
		const { error } = await client.from("invoices").insert([
			{ workspace_id: WS, invoice_number: numberA },
			{ workspace_id: WS, invoice_number: numberB },
		] as never);
		expect(error).toBeNull();

		// … while a duplicate number is rejected for ANY writer (the index is
		// the backstop for scripts and service-role keys too).
		const duplicate = await client
			.from("invoices")
			.insert({ workspace_id: WS, invoice_number: numberA } as never);
		expect((duplicate.error as { code?: string } | null)?.code).toBe("23505");
		expect(tables.invoices).toHaveLength(2);
	});

	it("keeps the commit order irrelevant (B commits before A)", async () => {
		const { client } = createFakeSupabase(seed());
		const planA = await planInvoiceNumber(client, { workspaceId: WS });
		const planB = await planInvoiceNumber(client, { workspaceId: WS });
		const numberB = await commitInvoiceNumber(
			client,
			planB,
			candidateInvoiceNumber(planB),
		);
		const numberA = await commitInvoiceNumber(
			client,
			planA,
			candidateInvoiceNumber(planA),
		);
		expect(new Set([numberA, numberB]).size).toBe(2);
	});

	it("never reissues below the committed counter, even when the human-facing floor is lowered", async () => {
		const { client, tables } = createFakeSupabase(seed());
		const plan = await planInvoiceNumber(client, { workspaceId: WS });
		const first = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		expect(first).toBe(`INV-${year}-000005`);

		// A user lowers the workspace counter to 1 (allowed pre-issuance) —
		// the allocator still floors at last_value + 1.
		(tables.workspaces as Record<string, unknown>[])[0] = workspaceRow(1);
		const loweredPlan = await planInvoiceNumber(client, { workspaceId: WS });
		expect(loweredPlan.minimumSequence).toBe(1);
		const next = await commitInvoiceNumber(
			client,
			loweredPlan,
			candidateInvoiceNumber(loweredPlan),
		);
		expect(next).toBe(`INV-${year}-000006`);
	});

	it("reserves custom numbers without burning the next one", async () => {
		const { client } = createFakeSupabase(seed());
		await reserveInvoiceNumber(client, {
			workspaceId: WS,
			invoiceNumber: `INV-${year}-000009`,
		});
		const plan = await planInvoiceNumber(client, { workspaceId: WS });
		const next = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		expect(next).toBe(`INV-${year}-000010`);
	});

	it("continues from a backfilled counter row (last_value = last allocated), no skipped number", async () => {
		// C1 backfill regression: the corrected migration seeds each bucket at
		// max(sequence) — the last ALLOCATED number — because the allocator's
		// existing-row path hands out `greatest(last_value + 1, minimum)`.
		// A "+ 1" seed made every workspace permanently skip one number at
		// cutover (invoices through …-000005 + counter 6 → first new invoice
		// …-000007).
		const { client } = createFakeSupabase(
			seed({
				workspaces: [workspaceRow(6)],
				invoice_number_sequences: [
					{ workspace_id: WS, prefix: "INV", year, last_value: 5 },
				],
			}),
		);
		const plan = await planInvoiceNumber(client, { workspaceId: WS });
		expect(plan.minimumSequence).toBe(6);
		const first = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		expect(first).toBe(`INV-${year}-000006`);
		// Contiguous: the very next allocation is 000007, never 000008.
		const second = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		expect(second).toBe(`INV-${year}-000007`);
	});

	it("hands an untouched default workspace 000001, not 000002", async () => {
		// The backfill seeds NOTHING for a workspace still on the default
		// counter (next_invoice_sequence = 1); the allocator's no-row insert
		// path must then hand out 1 exactly.
		const { client } = createFakeSupabase(
			seed({ workspaces: [workspaceRow(1)] }),
		);
		const plan = await planInvoiceNumber(client, { workspaceId: WS });
		expect(plan.minimumSequence).toBe(1);
		const first = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		expect(first).toBe(`INV-${year}-000001`);
	});
});

describe("C1: the next-invoice-number counter guard", () => {
	it("locks only once the workspace has an issued invoice", async () => {
		const { client, tables } = createFakeSupabase(
			seed({
				invoices: [invoiceRow({ id: "inv-draft", status: "unpaid" }) as never],
			}),
		);
		expect(await workspaceNumberingLocked(client, WS)).toBe(false);

		(tables.invoices as Record<string, unknown>[]).push(
			invoiceRow({
				id: "inv-issued",
				invoice_number: "INV-2026-0004",
				delivered_at: "2026-01-05T00:00:00.000Z",
			}) as never,
		);
		expect(await workspaceNumberingLocked(client, WS)).toBe(true);
	});

	it("honors raising and safe lowering before the first issued invoice", async () => {
		const { client } = createFakeSupabase(seed());
		// Raising: always fine.
		await expect(
			assertSequenceCounterChangeAllowed(client, {
				workspaceId: WS,
				current: 5,
				proposed: 50,
			}),
		).resolves.toBeUndefined();

		// Lowering that stays above every number an invoice already carries.
		const { client: clientWithDraft } = createFakeSupabase(
			seed({
				invoices: [invoiceRow({ invoice_number: "INV-2026-0003" }) as never],
			}),
		);
		await expect(
			assertSequenceCounterChangeAllowed(clientWithDraft, {
				workspaceId: WS,
				current: 10,
				proposed: 5,
			}),
		).resolves.toBeUndefined();
	});

	it("never allows lowering below a number an invoice already carries", async () => {
		const { client } = createFakeSupabase(
			seed({
				invoices: [invoiceRow({ invoice_number: "INV-2026-0007" }) as never],
			}),
		);
		await expect(
			assertSequenceCounterChangeAllowed(client, {
				workspaceId: WS,
				current: 10,
				proposed: 7,
			}),
		).rejects.toThrow(
			"The next invoice number cannot go below an existing invoice number (INV-2026-0007).",
		);
	});

	it("rejects every change — raising included — after the first issued invoice", async () => {
		const { client } = createFakeSupabase(
			seed({
				invoices: [
					invoiceRow({
						id: "inv-issued",
						delivered_at: "2026-01-05T00:00:00.000Z",
					}) as never,
				],
			}),
		);
		const locked =
			"The next invoice number is locked after the first issued invoice.";
		await expect(
			assertSequenceCounterChangeAllowed(client, {
				workspaceId: WS,
				current: 5,
				proposed: 6,
			}),
		).rejects.toThrow(locked);
		await expect(
			assertSequenceCounterChangeAllowed(client, {
				workspaceId: WS,
				current: 5,
				proposed: 1,
			}),
		).rejects.toThrow(locked);
		// An unchanged value is not a change.
		await expect(
			assertSequenceCounterChangeAllowed(client, {
				workspaceId: WS,
				current: 5,
				proposed: 5,
			}),
		).resolves.toBeUndefined();
	});
});

describe("C1: custom invoice number year bounds", () => {
	const YEAR_ERROR = "Invoice number year must be between 2000 and 2100.";

	it("refuses an out-of-range year with the repo validation error, before any allocator write", async () => {
		const { client, tables } = createFakeSupabase(seed());
		// `save` path: the availability assert refuses before the reserve RPC
		// that follows it.
		await expect(
			assertInvoiceNumberAvailable(client, {
				workspaceId: WS,
				invoiceNumber: "INV-1999-0001",
			}),
		).rejects.toThrow(YEAR_ERROR);
		// `createDraft` path: the reserve itself refuses before the RPC —
		// this is the seam the raw Postgres `invoice_number_sequences_year_check`
		// message used to escape through.
		await expect(
			reserveInvoiceNumber(client, {
				workspaceId: WS,
				invoiceNumber: "INV-2101-0001",
			}),
		).rejects.toThrow(YEAR_ERROR);
		// Nothing was consumed and nothing was written.
		expect(tables.invoice_number_sequences ?? []).toHaveLength(0);
		expect(tables.invoices).toHaveLength(0);
	});

	it("accepts the boundary years and leaves format errors to the format checks", async () => {
		const { client } = createFakeSupabase(seed());
		await expect(
			assertInvoiceNumberAvailable(client, {
				workspaceId: WS,
				invoiceNumber: "INV-2000-0001",
			}),
		).resolves.toBeUndefined();
		await expect(
			assertInvoiceNumberAvailable(client, {
				workspaceId: WS,
				invoiceNumber: "INV-2100-0001",
			}),
		).resolves.toBeUndefined();
		// A number that is not PREFIX-YYYY-NNNN at all is not this guard's
		// business (the format checks own it), and the reserve stays a no-op.
		await expect(
			assertInvoiceNumberAvailable(client, {
				workspaceId: WS,
				invoiceNumber: "not-a-number",
			}),
		).resolves.toBeUndefined();
		await expect(
			reserveInvoiceNumber(client, {
				workspaceId: WS,
				invoiceNumber: "not-a-number",
			}),
		).resolves.toBeUndefined();
	});
});

describe("WP8 migrations pin the database authority", () => {
	it("C1: the allocator is ONE atomic, monotone statement behind a membership check", () => {
		expect(MIGRATION_C1).toContain(
			"create unique index invoices_workspace_number_unique",
		);
		expect(MIGRATION_C1).toContain(
			"on public.invoices (workspace_id, invoice_number)",
		);
		expect(MIGRATION_C1).toContain("on conflict (workspace_id, prefix, year)");
		expect(MIGRATION_C1).toContain(
			"greatest(seq.last_value + 1, excluded.last_value)",
		);
		expect(MIGRATION_C1).toContain(
			"greatest(seq.last_value, excluded.last_value)",
		);
		expect(MIGRATION_C1).toContain("app.is_workspace_member(p_workspace_id)");
		expect(MIGRATION_C1).toContain("security definer");
		// The human-facing preview write is monotone and flagged for the guard.
		expect(MIGRATION_C1).toContain("velure.sequence_preview");
		expect(MIGRATION_C1).toContain(
			"greatest(v_sequence + 1, coalesce(next_invoice_sequence, 1))",
		);
	});

	it("C1: the dedupe step runs before the unique index and never renumbers issued rows", () => {
		const dedupeAt = MIGRATION_C1.indexOf("having count(*) > 1");
		const indexAt = MIGRATION_C1.indexOf(
			"create unique index invoices_workspace_number_unique",
		);
		expect(dedupeAt).toBeGreaterThan(-1);
		expect(indexAt).toBeGreaterThan(dedupeAt);
		// Two issued copies abort the migration instead of renumbering history.
		expect(MIGRATION_C1).toContain("Duplicate issued invoice numbers");
		// The backfill seeds each bucket at max(sequence): `last_value` is the
		// LAST ALLOCATED number (the allocator adds 1 back on the conflict
		// path), so a "+ 1" seed would permanently skip one number per
		// workspace at cutover (invoices through 000005 + next 6 → first new
		// invoice 000007; empty workspace → starts at 000002).
		expect(MIGRATION_C1).toContain(")::integer)::integer as last_value");
		expect(MIGRATION_C1).not.toContain("+ 1 as last_value");
		// The workspace's own bucket seeds next - 1 so the first allocation
		// lands exactly on the human-facing next number; a workspace still on
		// the default counter (1) seeds nothing — the allocator's no-row
		// insert path already hands it 1.
		expect(MIGRATION_C1).toContain(
			"greatest(coalesce(w.next_invoice_sequence, 1) - 1, 0)",
		);
		expect(MIGRATION_C1).toContain(
			"where coalesce(w.next_invoice_sequence, 1) > 1",
		);
	});

	it("C1: invoice_is_issued excludes finalized_at and bare unpaid status", () => {
		const body = MIGRATION_C1.slice(
			MIGRATION_C1.indexOf(
				"create or replace function public.invoice_is_issued",
			),
			MIGRATION_C1.indexOf("$$;", MIGRATION_C1.indexOf("invoice_is_issued")),
		);
		expect(body).toContain("r.delivered_at is not null");
		expect(body).toContain("r.paid_at is not null");
		expect(body).not.toContain("finalized_at");
		expect(body).not.toMatch(/status = 'unpaid'/);
		expect(body).not.toContain("firstViewedAt");
		// The app mirror must exist and stay in the same module.
		const appSource = readFileSync(
			new URL("./invoice-numbering.ts", import.meta.url),
			"utf8",
		);
		expect(appSource).toContain("public.invoice_is_issued");
	});

	it("C1: the down section restores the pre-WP8 surface", () => {
		expect(MIGRATION_C1).toContain("-- down (reversible)");
		expect(MIGRATION_C1).toContain(
			"drop table if exists public.invoice_number_sequences;",
		);
		expect(MIGRATION_C1).toContain(
			"create index invoices_workspace_number_idx",
		);
	});

	it("C2/C3: the lock triggers guard updates, deletes and the sequence counter", () => {
		expect(MIGRATION_C2_C3).toContain(
			"create trigger invoices_issued_guard_update",
		);
		expect(MIGRATION_C2_C3).toContain("'invoice_number'");
		expect(MIGRATION_C2_C3).toContain("'delivered_at'");
		expect(MIGRATION_C2_C3).toContain("payment_amount cannot decrease");
		// A paid invoice can still soft-cancel (bulk archival path).
		expect(MIGRATION_C2_C3).toContain("new.status <> 'canceled'");
		// Top-level deletes are refused; the workspaces cascade still works.
		expect(MIGRATION_C2_C3).toContain("pg_trigger_depth() <= 1");
		// C1 second half: user edits to the counter are rejected post-issuance,
		// while the allocator's flagged system write passes.
		expect(MIGRATION_C2_C3).toContain(
			"create trigger workspaces_invoice_sequence_guard",
		);
		expect(MIGRATION_C2_C3).toContain(
			"The next invoice number is locked after the first issued invoice (C1).",
		);
		// The read helper is SECURITY INVOKER (no `security definer`) so the
		// EXISTS scan runs under the caller's own RLS.
		const helper = MIGRATION_C2_C3.slice(
			MIGRATION_C2_C3.indexOf(
				"create or replace function public.has_issued_invoice",
			),
		);
		expect(helper).toContain("language sql");
		expect(helper).not.toContain("security definer");
	});

	it("C2/C3: the down section drops exactly what the up created", () => {
		expect(MIGRATION_C2_C3).toContain("-- down (reversible)");
		expect(MIGRATION_C2_C3).toContain(
			"drop function if exists public.invoices_issued_guard_update();",
		);
		expect(MIGRATION_C2_C3).toContain(
			"drop function if exists public.invoices_issued_guard_delete();",
		);
		expect(MIGRATION_C2_C3).toContain(
			"drop function if exists public.workspaces_invoice_sequence_guard();",
		);
	});

	it("C3: the audit action set grows by invoice.delete and its down keeps history", () => {
		expect(MIGRATION_C3_AUDIT).toContain("'invoice.delete'");
		expect(MIGRATION_C3_AUDIT).toContain("-- down (reversible)");
		// The down restores the five-action CHECK as NOT VALID so existing
		// invoice.delete rows survive the rollback.
		expect(MIGRATION_C3_AUDIT).toMatch(/\)\) not valid;/);
	});
});
