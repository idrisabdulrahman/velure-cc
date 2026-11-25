import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP-D — quote lifecycle (data layer).
 *
 * The public accept must create exactly ONE payable invoice from a sent
 * pro-forma quote, leave the quote itself immutable, and make a repeat accept
 * a no-op. These tests run against the no-RLS fake, so they also prove the
 * app-layer workspace filter the conversion depends on.
 */

vi.mock("./audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE } from "#/features/invoices/customer-gate";
import {
	convertQuoteToInvoice,
	mapInvoice,
	quoteAcceptanceIssue,
	rowToInvoiceDoc,
} from "./invoices";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

const USER_A = "user-a";
const WS_A = "ws-a";
const WS_B = "ws-b";
const CLIENT_A = "client-a";
const QUOTE_A = "quote-a";
const WINNER_ID = "winning-invoice";

function quoteRow(overrides: Record<string, unknown> = {}) {
	return {
		id: QUOTE_A,
		workspace_id: WS_A,
		user_id: USER_A,
		token: "quote-token-a",
		token_revoked_at: null,
		document_type: "proforma",
		corrects_invoice_id: null,
		invoice_number: "PF-2026-0001",
		customer_id: CLIENT_A,
		customer_name: "Acme Ltd",
		logo_url: null,
		customer_po_number: null,
		currency: "NGN",
		invoice_type: "one-time",
		invoice_size: "A4",
		date_format: "ng",
		payment_terms_days: 14,
		template: "Default",
		template_settings: null,
		top_block: null,
		bottom_block: null,
		issue_date: "2026-10-01",
		due_date: "2026-12-01",
		status: "unpaid",
		payment_amount: 0,
		delivered_at: "2026-10-02T00:00:00.000Z",
		canceled_at: null,
		payment_details: "Zenith 1234567890",
		payment_link: null,
		payment_provider: null,
		paid_at: null,
		payment_reference: null,
		finalized_at: null,
		scheduled_at: null,
		schedule_version: null,
		notes: null,
		internal_notes: null,
		deleted_at: null,
		line_items: [
			{
				id: "li-1",
				name: "Consulting",
				quantity: 1,
				price: 1075,
				unit: "unit",
				vatCategory: "standard",
				classificationCode: "80101500",
			},
		],
		compliance: {
			seller: { legalName: "Invoicly" },
			buyer: { legalName: "Acme Ltd" },
			subtotal: 1000,
			grandTotal: 1075,
		},
		fiscalization: { status: "not_configured" },
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: { sentAt: Date.parse("2026-10-02T00:00:00Z") },
		quote_status: "sent",
		quote_sent_at: "2026-10-02T00:00:00.000Z",
		quote_accepted_at: null,
		quote_converted_invoice_id: null,
		created_at: "2026-10-01T00:00:00.000Z",
		updated_at: "2026-10-02T00:00:00.000Z",
		...overrides,
	};
}

function seed(): FakeTables {
	return {
		workspaces: [
			{
				id: WS_A,
				name: "Alpha",
				invoice_number_prefix: "INV",
				invoice_number_mode: "prefix",
				next_invoice_sequence: 1,
			},
			{
				id: WS_B,
				name: "Beta",
				invoice_number_prefix: "INV",
				invoice_number_mode: "prefix",
				next_invoice_sequence: 1,
			},
		],
		clients: [{ id: CLIENT_A, workspace_id: WS_A, name: "Acme Ltd" }],
		invoices: [quoteRow()],
		invoice_audit_log: [],
		payment_transactions: [],
	};
}

let tables: FakeTables;
let client: Supabase;

beforeEach(() => {
	tables = seed();
	client = createFakeSupabase(tables).client;
});

function loadQuote() {
	const row = tables.invoices?.find((invoice) => invoice.id === QUOTE_A);
	if (!row) throw new Error("quote missing from seed");
	return mapInvoice(rowToInvoiceDoc(row as never));
}

function standardInvoices() {
	return (tables.invoices ?? []).filter(
		(row) => row.document_type === "standard" && row.id !== WINNER_ID,
	);
}

describe("quoteAcceptanceIssue", () => {
	it("accepts an open pro-forma quote", () => {
		expect(quoteAcceptanceIssue(loadQuote())).toBeNull();
	});

	it("refuses a non-quote document", () => {
		expect(
			quoteAcceptanceIssue(
				mapInvoice({ ...loadQuote(), documentType: "standard" }),
			),
		).toBe("not_quote");
	});

	it("reports an already-converted quote", () => {
		expect(
			quoteAcceptanceIssue(
				mapInvoice({ ...loadQuote(), convertedToInvoiceId: "x" }),
			),
		).toBe("already_accepted");
	});

	it("refuses a quote that is still a Draft", () => {
		const draft = quoteRow({
			delivered_at: null,
			status: "draft",
			lifecycle: {},
		});
		expect(
			quoteAcceptanceIssue(mapInvoice(rowToInvoiceDoc(draft as never))),
		).toBe("not_open");
	});

	it("refuses a canceled quote", () => {
		tables.invoices = [quoteRow({ canceled_at: "2026-10-03T00:00:00.000Z" })];
		expect(quoteAcceptanceIssue(loadQuote())).toBe("not_open");
	});

	it("refuses a fully paid quote", () => {
		tables.invoices = [quoteRow({ payment_amount: 1075, status: "paid" })];
		expect(quoteAcceptanceIssue(loadQuote())).toBe("not_open");
	});
});

describe("convertQuoteToInvoice", () => {
	it("creates exactly one payable standard invoice and links the quote once", async () => {
		const writer = vi.fn(async () => {});
		const quote = loadQuote();

		const result = await convertQuoteToInvoice(client, WS_A, quote, {
			writer,
			actor: { type: "system", id: "public-accept" },
			ownerUserId: USER_A,
		});

		expect(result.created).toBe(true);
		const created = tables.invoices?.find((row) => row.id === result.id);
		expect(created).toBeDefined();
		expect(created).toMatchObject({
			workspace_id: WS_A,
			user_id: USER_A,
			document_type: "standard",
			status: "unpaid",
			customer_id: CLIENT_A,
			currency: "NGN",
		});
		expect(created?.delivered_at).toEqual(expect.any(String));
		expect(created?.finalized_at).toEqual(expect.any(String));
		expect(created?.invoice_number).not.toBe("PF-2026-0001");
		expect(standardInvoices()).toHaveLength(1);
		expect(writer).toHaveBeenCalledWith(
			client,
			"public-accept",
			expect.objectContaining({
				action: "invoice.create",
				resourceId: result.id,
			}),
		);
	});

	it("links the quote without mutating its content or deleting it", async () => {
		const original = loadQuote();
		const result = await convertQuoteToInvoice(client, WS_A, original, {
			writer: vi.fn(async () => {}),
		});

		const quoteRowAfter = tables.invoices?.find((row) => row.id === QUOTE_A);
		expect(quoteRowAfter?.document_type).toBe("proforma");
		expect(quoteRowAfter?.deleted_at).toBeNull();
		expect(quoteRowAfter?.invoice_number).toBe("PF-2026-0001");
		expect(quoteRowAfter?.line_items).toEqual(original.lineItems);
		expect(quoteRowAfter?.quote_status).toBe("accepted");
		expect(quoteRowAfter?.quote_converted_invoice_id).toBe(result.id);
		expect(quoteRowAfter?.quote_accepted_at).toEqual(expect.any(String));
		expect(
			(quoteRowAfter?.lifecycle as Record<string, unknown>)
				.convertedToInvoiceId,
		).toBe(result.id);
		// The edit history the quote already carried survives the link write.
		expect((quoteRowAfter?.lifecycle as Record<string, unknown>).sentAt).toBe(
			Date.parse("2026-10-02T00:00:00Z"),
		);
	});

	it("is idempotent: a repeat accept returns the existing invoice, no second row", async () => {
		const writer = vi.fn(async () => {});
		const first = await convertQuoteToInvoice(client, WS_A, loadQuote(), {
			writer,
		});
		const second = await convertQuoteToInvoice(client, WS_A, loadQuote(), {
			writer,
		});

		expect(second).toEqual({ id: first.id, created: false });
		expect(standardInvoices()).toHaveLength(1);
	});

	it("soft-cancels the orphan when a racing accept already linked the quote", async () => {
		const writer = vi.fn(async () => {});
		// A concurrent accept won: the quote row already points at the winner.
		tables.invoices = [
			quoteRow({
				quote_converted_invoice_id: WINNER_ID,
				quote_accepted_at: "2026-10-03T00:00:00.000Z",
				quote_status: "accepted",
			}),
			{
				id: WINNER_ID,
				workspace_id: WS_A,
				document_type: "standard",
				invoice_number: "INV-2026-0001",
				status: "unpaid",
				line_items: [],
			},
		];

		// The caller holds a stale quote view (no conversion link yet).
		const stale = mapInvoice(rowToInvoiceDoc(quoteRow() as never));
		const result = await convertQuoteToInvoice(client, WS_A, stale, { writer });

		expect(result).toEqual({ id: WINNER_ID, created: false });
		const orphans = (tables.invoices ?? []).filter(
			(row) => row.document_type === "standard" && row.status === "canceled",
		);
		expect(orphans).toHaveLength(1);
		expect(orphans[0]?.canceled_at).toEqual(expect.any(String));
		// Exactly one active standard invoice survives.
		expect(
			(tables.invoices ?? []).filter(
				(row) => row.document_type === "standard" && row.status !== "canceled",
			),
		).toHaveLength(1);
		expect(writer).toHaveBeenCalledWith(
			client,
			"public-accept",
			expect.objectContaining({ action: "invoice.cancel" }),
		);
	});

	it("refuses a customer-less quote before creating anything (B2 gate)", async () => {
		tables.invoices = [quoteRow({ customer_id: null })];
		await expect(
			convertQuoteToInvoice(client, WS_A, loadQuote(), {
				writer: vi.fn(async () => {}),
			}),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(standardInvoices()).toHaveLength(0);
	});

	it("refuses a non-proforma document", async () => {
		await expect(
			convertQuoteToInvoice(
				client,
				WS_A,
				mapInvoice({ ...loadQuote(), documentType: "standard" }),
				{ writer: vi.fn(async () => {}) },
			),
		).rejects.toThrow("Only pro-forma quotes can be accepted.");
	});

	it("records the carried quote deposit exactly once on a won accept", async () => {
		tables.invoices = [quoteRow({ payment_amount: 500 })];
		const result = await convertQuoteToInvoice(client, WS_A, loadQuote(), {
			writer: vi.fn(async () => {}),
			ownerUserId: USER_A,
		});

		expect(result.created).toBe(true);
		const deposits = (tables.payment_transactions ?? []).filter(
			(row) => row.invoice_id === result.id,
		);
		expect(deposits).toHaveLength(1);
		expect(deposits[0]).toMatchObject({
			workspace_id: WS_A,
			invoice_id: result.id,
			amount: 500,
			currency: "NGN",
		});
	});

	it("leaves no stray deposit on the orphan when a racing accept wins", async () => {
		// A deposit-bearing quote we hold a stale view of; a concurrent accept
		// already linked the quote to WINNER_ID, so our insert loses the link.
		tables.invoices = [
			quoteRow({
				payment_amount: 500,
				quote_converted_invoice_id: WINNER_ID,
				quote_status: "accepted",
			}),
			{
				id: WINNER_ID,
				workspace_id: WS_A,
				document_type: "standard",
				invoice_number: "INV-2026-0001",
				status: "unpaid",
				line_items: [],
			},
		];

		const stale = mapInvoice(
			rowToInvoiceDoc(quoteRow({ payment_amount: 500 }) as never),
		);
		const result = await convertQuoteToInvoice(client, WS_A, stale, {
			writer: vi.fn(async () => {}),
		});

		expect(result).toEqual({ id: WINNER_ID, created: false });
		// No deposit points at the canceled orphan.
		expect(tables.payment_transactions ?? []).toHaveLength(0);
	});
});
