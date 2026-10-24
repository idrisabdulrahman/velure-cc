import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP8 (C2/C3 + C1) — issued-invoice immutability at the data layer.
 *
 * Every writer seam listed in the spec is exercised against the in-memory
 * Supabase double: an ISSUED invoice refuses save/autosave/settings/draft-
 * revert/hard-delete/renumber/reschedule/unschedule, each refusal is logged
 * through the ONE audit service, drafts stay fully editable, soft-cancel
 * keeps the row and its number, and the first issuance itself is logged.
 *
 * The audit transport is the browser-safe POST wrapper; it is mocked here
 * (no route in Node) so the entries each guard writes can be captured and
 * asserted. Identity derivation on the real route is covered by
 * `src/routes/api/invoice/-audit.test.ts`, and the DB-level floor for every
 * rule below lives in migrations 20261020000000/20261020000001 (pinned by
 * `invoice-numbering.test.ts`).
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { recordInvoiceAudit } from "./audit-client";
import { upsertWorkspaceSettings } from "./compliance";
import {
	autosaveDraft,
	bulkDeleteOrArchive,
	cancelSchedule,
	createDraft,
	duplicate,
	markInvoiceSent,
	remove,
	renumberInvoices,
	reschedule,
	save,
	saveDraftSettings,
	updateStatus,
} from "./invoices";
import { recordPayment } from "./payments";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const USER = "user-a";
const WS = "ws-a";
const ISSUED = "inv-issued";
const DRAFT = "inv-draft";

function workspaceRow(nextInvoiceSequence = 5) {
	return {
		id: WS,
		owner_id: USER,
		name: "Alpha",
		legal_name: "Alpha Legal",
		email: "alpha@example.test",
		phone: "",
		address: "1 Test Way",
		address_street: "1 Test Way",
		address_lga: "Lagos Mainland",
		address_state: "Lagos",
		website: "",
		base_currency: "NGN",
		country_code: "NG",
		default_payment_terms_days: 14,
		default_payment_link: null,
		logo_url: null,
		payment_details: null,
		tax_id: "8129473650",
		rc_number: "RC-1234567",
		seller_tax_status: "vat_registered",
		tax_rule_set_version: "ng-2026-q1",
		invoice_template_defaults: { title: "Alpha Template" },
		reminder_signature: "Team",
		reminders_enabled: true,
		supplier_profile_status: "complete",
		supplier_profile_issues: [],
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: nextInvoiceSequence,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function invoiceRow(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		workspace_id: WS,
		user_id: USER,
		token: `pub-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: id === ISSUED ? "INV-2026-000005" : "INV-2026-000006",
		customer_name: "Customer A",
		customer_id: id === DRAFT ? "client-a" : null,
		currency: "NGN",
		invoice_type: "one-time",
		invoice_size: "A4",
		date_format: "ng",
		payment_terms_days: 14,
		template: "Default",
		issue_date: "2026-01-01",
		due_date: "2027-02-01",
		status: "draft",
		payment_amount: 0,
		delivered_at: null,
		canceled_at: null,
		paid_at: null,
		payment_reference: null,
		// An autosavable draft has no finalized_at (the autosave flow writes
		// none); a create-flow invoice sets it and derives "unpaid" instead.
		finalized_at: null,
		scheduled_at: null,
		schedule_version: null,
		line_items: [
			{
				id: "li-1",
				name: "Item",
				quantity: 1,
				price: 100,
				unit: "unit",
				vatCategory: "standard",
				classificationCode: "GOOD-01",
			},
		],
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

/** An invoice that left the tenant's hands: delivered (issued per C2). */
function issuedRow(overrides: Record<string, unknown> = {}) {
	return invoiceRow(ISSUED, {
		status: "unpaid",
		delivered_at: "2026-01-05T00:00:00.000Z",
		lifecycle: { sentAt: Date.parse("2026-01-05T00:00:00Z") },
		...overrides,
	});
}

function seed(extra: Partial<FakeTables> = {}): FakeTables {
	return {
		workspaces: [workspaceRow()],
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		clients: [{ id: "client-a", workspace_id: WS, name: "Customer A" }],
		invoices: [issuedRow() as never, invoiceRow(DRAFT) as never],
		// Queried by the cleanup planner's related-records scan.
		payment_transactions: [],
		payment_charges: [],
		invoice_delivery_events: [],
		...extra,
	};
}

const invoiceInput = {
	token: "pub-token-draft",
	invoiceNumber: "INV-2026-000006",
	customerName: "Customer A",
	currency: "NGN",
	issueDate: "2026-01-01",
	dueDate: "2026-02-01",
	lineItems: [{ id: "li-1", name: "Item", quantity: 1, price: 10 }],
};

/** Captured audit entries: [action, message, resourceType?]. */
function auditEntries() {
	return vi.mocked(recordInvoiceAudit).mock.calls.map((call) => {
		const entry = call[2] as {
			action: string;
			message?: string;
			resourceType?: string;
		};
		return {
			action: entry.action,
			message: entry.message ?? "",
			resourceType: entry.resourceType ?? "invoice",
		};
	});
}

function row(tables: FakeTables, id: string) {
	return (tables.invoices as Record<string, unknown>[]).find(
		(entry) => entry.id === id,
	);
}

beforeEach(() => {
	vi.mocked(recordInvoiceAudit).mockClear();
});

describe("issued invoices are immutable", () => {
	it("refuses save and logs the blocked edit", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(
			save(client, USER, {
				...invoiceInput,
				id: ISSUED,
				invoiceNumber: "INV-2026-000005",
				customerName: "Hijacked",
			}),
		).rejects.toThrow(
			"Issued invoices are immutable; only cancellation is allowed.",
		);
		expect(row(tables, ISSUED)?.customer_name).toBe("Customer A");
		expect(row(tables, ISSUED)?.invoice_number).toBe("INV-2026-000005");
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message: "Blocked: issued invoices are immutable.",
			resourceType: "invoice",
		});
	});

	it("refuses autosave and logs the blocked edit", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(
			autosaveDraft(client, USER, {
				...invoiceInput,
				id: ISSUED,
				customerName: "Hijacked",
			}),
		).rejects.toThrow("Only draft invoices can be autosaved.");
		expect(row(tables, ISSUED)?.customer_name).toBe("Customer A");
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message: "Blocked: issued invoices are immutable.",
			resourceType: "invoice",
		});
	});

	it("refuses draft-settings changes and logs the blocked edit", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(
			saveDraftSettings(client, USER, {
				id: ISSUED,
				invoiceSize: "LETTER",
				dateFormat: "ng",
				paymentTermsDays: 30,
				template: "Hijack",
				currency: "NGN",
				type: "one-time",
			}),
		).rejects.toThrow(
			"Issued invoices are immutable; only cancellation is allowed.",
		);
		expect(row(tables, ISSUED)?.template).toBe("Default");
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message: "Blocked: issued invoices are immutable.",
			resourceType: "invoice",
		});
	});

	it("refuses to revert to draft and logs the blocked attempt", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(
			updateStatus(client, USER, { id: ISSUED, status: "draft" }),
		).rejects.toThrow(
			"Issued invoices cannot be reverted to draft; cancel instead.",
		);
		expect(row(tables, ISSUED)?.delivered_at).toBe("2026-01-05T00:00:00.000Z");
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message: "Blocked: issued invoices cannot be reverted to draft.",
			resourceType: "invoice",
		});
	});

	it("refuses hard delete, keeps the row, and logs the blocked delete", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(remove(client, USER, ISSUED)).rejects.toThrow(
			"Only untouched draft invoices can be hard deleted.",
		);
		expect(row(tables, ISSUED)).toBeDefined();
		expect(auditEntries()).toContainEqual({
			action: "invoice.delete",
			message: "Blocked: issued invoices cannot be deleted; cancel instead.",
			resourceType: "invoice",
		});
	});

	it("refuses renumbering, keeps the number, and logs the blocked attempt", async () => {
		const { client, tables } = createFakeSupabase(seed());
		const result = await renumberInvoices(client, USER, [ISSUED]);
		expect(result.renumbered).toHaveLength(0);
		expect(result.skipped[0]?.reason).toBe(
			"Issued invoices cannot be renumbered.",
		);
		expect(row(tables, ISSUED)?.invoice_number).toBe("INV-2026-000005");
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message: "Blocked: issued invoices cannot be renumbered.",
			resourceType: "invoice",
		});
	});

	it("freezes the schedule columns on an issued invoice", async () => {
		const scheduledAt = "2026-12-31T12:00:00.000Z";
		const { client, tables } = createFakeSupabase(
			seed({
				invoices: [
					issuedRow({
						scheduled_at: scheduledAt,
						schedule_version: "lease-1",
					}) as never,
					invoiceRow(DRAFT) as never,
				],
			}),
		);
		await expect(
			reschedule(client, USER, {
				invoiceId: ISSUED,
				scheduledAt: "2027-01-01T12:00:00.000Z",
			}),
		).rejects.toThrow("Issued invoices cannot be rescheduled; cancel instead.");
		await expect(cancelSchedule(client, USER, ISSUED)).rejects.toThrow(
			"Issued invoices cannot be unscheduled; cancel instead.",
		);
		expect(row(tables, ISSUED)?.scheduled_at).toBe(scheduledAt);
		expect(row(tables, ISSUED)?.schedule_version).toBe("lease-1");
		const blocked = auditEntries().filter((entry) =>
			entry.message.startsWith("Blocked:"),
		);
		expect(blocked.map((entry) => entry.message)).toEqual([
			"Blocked: issued invoices cannot be rescheduled.",
			"Blocked: issued invoices cannot be unscheduled.",
		]);
	});
});

describe("drafts stay editable", () => {
	it("saves, autosaves and restyles a draft without any blocked audit", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await save(client, USER, {
			...invoiceInput,
			id: DRAFT,
			customerName: "Draft Updated",
		});
		await autosaveDraft(client, USER, {
			...invoiceInput,
			id: DRAFT,
			customerName: "Draft Updated",
		});
		await saveDraftSettings(client, USER, {
			id: DRAFT,
			invoiceSize: "LETTER",
			dateFormat: "ng",
			paymentTermsDays: 30,
			template: "Default",
			currency: "NGN",
			type: "one-time",
		});
		expect(row(tables, DRAFT)?.customer_name).toBe("Draft Updated");
		expect(row(tables, DRAFT)?.invoice_size).toBe("LETTER");
		const blocked = auditEntries().filter((entry) =>
			entry.message.startsWith("Blocked:"),
		);
		expect(blocked).toHaveLength(0);
	});

	it("hard deletes an untouched draft and logs the delete", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await remove(client, USER, DRAFT);
		expect(row(tables, DRAFT)).toBeUndefined();
		expect(auditEntries()).toContainEqual({
			action: "invoice.delete",
			message: "Hard deleted an untouched draft invoice.",
			resourceType: "invoice",
		});
	});
});

describe("fiscalization artifacts are server-owned", () => {
	const forged = {
		status: "mock_cleared",
		provider: "mock",
		environment: "sandbox",
		mock: true,
		mockIrn: "MOCK-IRN-client-forged",
		qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|client-forged",
	};

	it("ignores client fiscalization on draft insert flows", async () => {
		for (const create of [autosaveDraft, createDraft]) {
			const { client, tables } = createFakeSupabase(seed({ invoices: [] }));
			const created = await create(client, USER, {
				...invoiceInput,
				customerId: "client-a",
				lineItems: [
					{
						...invoiceInput.lineItems[0],
						unit: "unit",
						vatCategory: "standard",
						classificationCode: "GOOD-01",
					},
				],
				fiscalization: forged,
				compliance: { fiscalization: forged },
			});
			const stored = row(tables, created.id);
			expect(stored?.fiscalization).toEqual({ status: "not_configured" });
			expect(stored?.compliance).not.toHaveProperty("fiscalization");
		}
	});

	it("preserves the server snapshot and ignores client fiscalization on save", async () => {
		const serverSnapshot = {
			status: "mock_cleared",
			provider: "mock",
			environment: "sandbox",
			mock: true,
			mockIrn: "MOCK-IRN-server-owned",
			qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|server-owned",
		};
		const { client, tables } = createFakeSupabase(
			seed({
				invoices: [
					invoiceRow(DRAFT, { fiscalization: serverSnapshot }) as never,
				],
			}),
		);
		await save(client, USER, {
			...invoiceInput,
			id: DRAFT,
			fiscalization: forged,
			compliance: { fiscalization: forged },
		});
		expect(row(tables, DRAFT)?.fiscalization).toEqual(serverSnapshot);
		expect(row(tables, DRAFT)?.compliance).not.toHaveProperty("fiscalization");
	});

	it("does not copy fiscalization artifacts when duplicating a cleared invoice", async () => {
		const serverSnapshot = {
			status: "mock_cleared",
			provider: "mock",
			environment: "sandbox",
			mock: true,
			mockIrn: "MOCK-IRN-original",
			qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|original",
		};
		const { client, tables } = createFakeSupabase(
			seed({
				invoices: [
					invoiceRow(DRAFT, {
						fiscalization: serverSnapshot,
						compliance: { fiscalization: serverSnapshot },
					}) as never,
				],
			}),
		);
		const { id } = await duplicate(client, USER, DRAFT);
		const original = row(tables, DRAFT);
		const copied = row(tables, id);
		expect(original?.fiscalization).toEqual(serverSnapshot);
		expect(copied?.fiscalization).toEqual({ status: "not_configured" });
		expect(copied?.compliance).not.toHaveProperty("fiscalization");
	});
});

describe("issuance and cancellation are logged", () => {
	it("marks a linked draft sent, issues it, and logs the issuance", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await markInvoiceSent(client, USER, DRAFT);
		expect(row(tables, DRAFT)?.delivered_at).not.toBeNull();
		expect(auditEntries()).toContainEqual({
			action: "invoice.send",
			message: "Invoice marked as sent.",
			resourceType: "invoice",
		});
	});

	it("logs the first crossing into issued when payment is recorded", async () => {
		const { client } = createFakeSupabase(seed());
		await updateStatus(client, USER, { id: DRAFT, status: "paid" });
		expect(auditEntries()).toContainEqual({
			action: "invoice.send",
			message: "Invoice issued when payment was recorded.",
			resourceType: "invoice",
		});
	});

	it("keeps the first invoice reference across later manual payments", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await recordPayment(client, USER, {
			invoiceId: ISSUED,
			amount: 20,
			reference: "manual-ref-1",
		});
		await recordPayment(client, USER, {
			invoiceId: ISSUED,
			amount: 20,
			reference: "manual-ref-2",
		});

		expect(row(tables, ISSUED)?.payment_reference).toBe("manual-ref-1");
		expect(row(tables, ISSUED)?.payment_amount).toBe(40);
		expect(
			(tables.payment_transactions as Array<Record<string, unknown>>).map(
				(transaction) => transaction.reference,
			),
		).toEqual(["manual-ref-1", "manual-ref-2"]);
	});

	it("soft-cancels an issued invoice: the row and its number survive", async () => {
		const { client, tables } = createFakeSupabase(seed());
		const result = await bulkDeleteOrArchive(client, USER, [ISSUED]);
		expect(result).toEqual({ hardDeleted: 0, archived: 1, blocked: 0 });
		const kept = row(tables, ISSUED);
		expect(kept).toBeDefined();
		expect(kept?.invoice_number).toBe("INV-2026-000005");
		expect(kept?.status).toBe("canceled");
		expect(kept?.canceled_at).not.toBeNull();
		expect(auditEntries()).toContainEqual({
			action: "invoice.cancel",
			message: "Archived invoice (bulk cleanup).",
			resourceType: "invoice",
		});
	});
});

describe("C1: the next invoice number setting", () => {
	it("refuses any change after the first issued invoice and logs it", async () => {
		const { client, tables } = createFakeSupabase(seed());
		await expect(
			upsertWorkspaceSettings(client, USER, { nextInvoiceSequence: 50 }),
		).rejects.toThrow(
			"The next invoice number is locked after the first issued invoice.",
		);
		expect(
			(tables.workspaces as Record<string, unknown>[])[0]
				?.next_invoice_sequence,
		).toBe(5);
		expect(auditEntries()).toContainEqual({
			action: "invoice.edit",
			message:
				"Blocked: The next invoice number is locked after the first issued invoice.",
			resourceType: "workspace",
		});
	});

	it("honors raising the counter before the first issued invoice", async () => {
		const { client, tables } = createFakeSupabase(
			seed({ invoices: [invoiceRow(DRAFT) as never] }),
		);
		await upsertWorkspaceSettings(client, USER, { nextInvoiceSequence: 50 });
		expect(
			(tables.workspaces as Record<string, unknown>[])[0]
				?.next_invoice_sequence,
		).toBe(50);
	});

	it("refuses to lower the counter below a number an invoice carries", async () => {
		const { client } = createFakeSupabase(
			seed({ invoices: [invoiceRow(DRAFT) as never] }),
		);
		await expect(
			upsertWorkspaceSettings(client, USER, { nextInvoiceSequence: 4 }),
		).rejects.toThrow(
			"The next invoice number cannot go below an existing invoice number (INV-2026-000006).",
		);
	});
});
