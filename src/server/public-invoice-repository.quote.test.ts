import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdminClient } from "#/server/supabase";
import { createFakeSupabase, type FakeTables } from "./data/testing/fake-db";
import type { Supabase } from "./data/workspaces";
import { submitPublicQuoteAcceptance } from "./public-invoice-repository";

/**
 * WP-D — public "Accept quote" repository.
 *
 * The token is the only identity input: the workspace and the quote are read
 * from the bearer token, never the request body. These tests run the real
 * rate-limit + audit code against the no-RLS fake, with the admin client
 * stubbed to answer the rate-limit RPC.
 */

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

const USER_A = "user-a";
const WS_A = "ws-a";
const CLIENT_A = "client-a";
const QUOTE_A = "quote-a";
const QUOTE_TOKEN = "quote-token-a";

function quoteRow(overrides: Record<string, unknown> = {}) {
	return {
		id: QUOTE_A,
		workspace_id: WS_A,
		user_id: USER_A,
		token: QUOTE_TOKEN,
		token_revoked_at: null,
		document_type: "proforma",
		corrects_invoice_id: null,
		invoice_number: "PF-2026-0001",
		customer_id: CLIENT_A,
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
		delivered_at: "2026-10-02T00:00:00.000Z",
		canceled_at: null,
		payment_details: null,
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
		compliance: { seller: { legalName: "Invoicly" }, grandTotal: 1075 },
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
		],
		clients: [{ id: CLIENT_A, workspace_id: WS_A, name: "Acme Ltd" }],
		invoices: [quoteRow()],
		invoice_audit_log: [],
		payment_transactions: [],
	};
}

/**
 * The repository holds the Supabase admin client, so the fake answers the
 * rate-limit RPC (which the no-RLS fake does not model) and delegates
 * everything else.
 */
function adminClient(
	tables: FakeTables,
	options: { rateAllowed?: boolean } = {},
): Supabase {
	const base = createFakeSupabase(tables).client as unknown as {
		rpc: (name: string, args?: Record<string, unknown>) => unknown;
	};
	const baseRpc = base.rpc.bind(base);
	return {
		...base,
		rpc: (name: string, args?: Record<string, unknown>) => {
			if (name === "consume_public_rate_limit") {
				return Promise.resolve({
					data: options.rateAllowed !== false,
					error: null,
				});
			}
			return baseRpc(name, args);
		},
	} as unknown as Supabase;
}

let tables: FakeTables;

beforeEach(() => {
	tables = seed();
	vi.mocked(getSupabaseAdminClient).mockReturnValue(adminClient(tables));
	vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

function createdInvoices() {
	return (tables.invoices ?? []).filter(
		(row) => row.document_type === "standard" && row.id !== QUOTE_A,
	);
}

describe("submitPublicQuoteAcceptance", () => {
	it("creates one payable invoice from the bearer token and links the quote", async () => {
		const result = await submitPublicQuoteAcceptance(QUOTE_TOKEN, {
			clientIp: "203.0.113.9",
		});

		expect(result).toMatchObject({ ok: true, alreadyAccepted: false });
		if (!result.ok) throw new Error("expected success");
		expect(result.invoiceId).toEqual(expect.any(String));
		expect(createdInvoices()).toHaveLength(1);
		const quote = tables.invoices?.find((row) => row.id === QUOTE_A);
		expect(quote?.quote_status).toBe("accepted");
		expect(quote?.quote_converted_invoice_id).toBe(result.invoiceId);
		expect(quote?.document_type).toBe("proforma");
	});

	it("is a no-op on a repeat accept", async () => {
		const first = await submitPublicQuoteAcceptance(QUOTE_TOKEN);
		const second = await submitPublicQuoteAcceptance(QUOTE_TOKEN);

		if (!first.ok || !second.ok) throw new Error("expected success");
		expect(second.alreadyAccepted).toBe(true);
		expect(second.invoiceId).toBe(first.invoiceId);
		expect(createdInvoices()).toHaveLength(1);
	});

	it("returns not_found for an unknown token", async () => {
		await expect(submitPublicQuoteAcceptance("nope")).resolves.toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(createdInvoices()).toHaveLength(0);
	});

	it("returns not_found for a revoked token", async () => {
		tables.invoices = [
			quoteRow({ token_revoked_at: "2026-10-03T00:00:00.000Z" }),
		];
		await expect(submitPublicQuoteAcceptance(QUOTE_TOKEN)).resolves.toEqual({
			ok: false,
			reason: "not_found",
		});
	});

	it("refuses a non-quote document", async () => {
		tables.invoices = [
			quoteRow({ document_type: "standard", quote_status: null }),
		];
		await expect(submitPublicQuoteAcceptance(QUOTE_TOKEN)).resolves.toEqual({
			ok: false,
			reason: "not_quote",
		});
		expect(createdInvoices()).toHaveLength(0);
	});

	it("refuses a quote that is not open", async () => {
		tables.invoices = [
			quoteRow({ delivered_at: null, status: "draft", lifecycle: {} }),
		];
		await expect(submitPublicQuoteAcceptance(QUOTE_TOKEN)).resolves.toEqual({
			ok: false,
			reason: "not_open",
		});
		expect(createdInvoices()).toHaveLength(0);
	});

	it("rate-limits before touching the quote", async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			adminClient(tables, { rateAllowed: false }),
		);
		await expect(submitPublicQuoteAcceptance(QUOTE_TOKEN)).resolves.toEqual({
			ok: false,
			reason: "rate_limited",
		});
		expect(createdInvoices()).toHaveLength(0);
	});
});
