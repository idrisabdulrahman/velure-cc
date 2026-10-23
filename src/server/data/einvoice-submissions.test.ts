import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMockProviderAdapter } from "#/features/einvoicing/provider-adapter";
import {
	dispatchDueInvoiceSubmissions,
	queueInvoiceSubmission,
	submissionBackoffMs,
} from "./einvoice-submissions";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const migration = readFileSync(
	"supabase/migrations/20261024000000_einvoice_d4_d6_submission_queue.sql",
	"utf8",
);

const compliance = {
	seller: {
		legalName: "Seller Ltd",
		countryCode: "NG",
		address: "1 Seller Road",
		taxId: "1234567891",
	},
	buyer: {
		legalName: "Buyer Ltd",
		countryCode: "NG",
		address: "2 Buyer Road",
		taxId: "1234567892",
	},
	placeOfSupply: "NG",
	taxRuleSetVersion: "ng-v1",
	taxTreatment: "exclusive_rate",
	taxRate: 7.5,
	taxLabel: "VAT",
	taxLines: [
		{
			label: "VAT",
			rate: 7.5,
			amount: 7.5,
			treatment: "exclusive_rate",
			jurisdictionCode: "NG",
		},
	],
	warnings: [],
	templateVariant: "vat_ready",
	subtotal: 100,
	totalTax: 7.5,
	grandTotal: 107.5,
	netPayable: 107.5,
	withholdingTaxAmount: 0,
	withholding: {
		mode: "rule_based",
		category: "none",
		recipientEntityType: "corporate",
		recipientResidency: "resident",
		rate: 0,
		amount: 0,
		ruleVersion: "ng-v1",
		manualOverride: false,
	},
};

function submissionFixture(): FakeTables {
	return {
		active_workspaces: [{ user_id: "user-a", workspace_id: "workspace-a" }],
		workspace_members: [
			{ user_id: "user-a", workspace_id: "workspace-a", role: "owner" },
		],
		workspaces: [
			{
				id: "workspace-a",
				name: "Workspace",
				legal_name: null,
				email: null,
				invoice_number_mode: "prefix",
				invoice_number_prefix: "INV",
				next_invoice_sequence: 1,
			},
		],
		invoices: [
			{
				id: "invoice-a",
				workspace_id: "workspace-a",
				token: "secret-token",
				token_revoked_at: null,
				document_type: "standard",
				corrects_invoice_id: null,
				invoice_number: "INV-2026-0001",
				customer_id: "client-a",
				customer_name: "Buyer Ltd",
				currency: "NGN",
				invoice_type: "one-time",
				invoice_size: "A4",
				date_format: "iso",
				payment_terms_days: 14,
				template: "Default",
				issue_date: "2026-01-01",
				due_date: "2026-01-15",
				status: "unpaid",
				total: 107.5,
				balance: 107.5,
				payment_amount: 0,
				payment_details: null,
				payment_link: null,
				payment_provider: null,
				paid_at: null,
				payment_reference: null,
				finalized_at: null,
				scheduled_at: null,
				delivered_at: null,
				canceled_at: null,
				deleted_at: null,
				notes: null,
				internal_notes: null,
				line_items: [
					{
						id: "line-a",
						name: "Service",
						quantity: 1,
						price: 100,
						unit: "hour",
						vatCategory: "standard",
						classificationCode: "SVC-01",
					},
				],
				logo_url: null,
				customer_po_number: null,
				template_settings: null,
				top_block: null,
				bottom_block: null,
				compliance,
				fiscalization: null,
				reminder: null,
				sync: null,
				lifecycle: null,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
		],
		clients: [
			{
				id: "client-a",
				workspace_id: "workspace-a",
				buyer_type: "b2b",
				tax_id: "1234567892",
			},
		],
		invoice_submission_queue: [],
		invoice_submission_attempts: [],
	};
}

function testOptions(
	client: ReturnType<typeof createFakeSupabase>["client"],
	now: () => Date,
	extra: Record<string, unknown> = {},
) {
	return {
		adminClient: client,
		audit: async () => {},
		now,
		...extra,
	} as Parameters<typeof queueInvoiceSubmission>[3];
}

describe("WP14 submission queue controls", () => {
	it("recovers a process crash after provider response with the persisted key and never changes invoice status/lifecycle", async () => {
		const { client, tables } = createFakeSupabase(submissionFixture());
		let instant = new Date("2026-01-01T00:00:00Z");
		const now = () => new Date(instant);
		const adapter = createMockProviderAdapter();
		let firstReference = "";
		const recordingAdapter = {
			...adapter,
			submit: async (input: Parameters<typeof adapter.submit>[0]) => {
				const result = await adapter.submit(input);
				firstReference = result.reference;
				return result;
			},
		};
		await expect(
			queueInvoiceSubmission(
				client,
				"user-a",
				"invoice-a",
				testOptions(client, now, {
					adapter: recordingAdapter,
					afterAdapterCall: () => {
						throw new Error("simulated process crash");
					},
				}),
			),
		).rejects.toThrow("simulated process crash");
		expect(tables.invoice_submission_queue).toHaveLength(1);
		expect(tables.invoice_submission_queue[0].status).toBe("processing");
		expect(tables.invoice_submission_attempts).toHaveLength(0);
		const key = tables.invoice_submission_queue[0].idempotency_key;
		instant = new Date("2026-01-01T00:02:00Z"); // expired persisted worker lease
		const replay = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, now, { adapter: recordingAdapter }),
		);
		expect(replay.status).toBe("completed");
		expect(replay.message).toContain("Mock sandbox");
		expect(JSON.stringify(replay)).not.toContain("secret-token");
		expect(JSON.stringify(replay)).not.toContain("Seller Ltd");
		expect(tables.invoice_submission_queue[0].idempotency_key).toBe(key);
		expect(tables.invoice_submission_attempts).toHaveLength(1);
		expect(
			(
				tables.invoice_submission_attempts[0].response_snapshot as Record<
					string,
					unknown
				>
			).reference,
		).toBe(firstReference);
		expect(tables.invoices[0].status).toBe("unpaid");
		expect(tables.invoices[0].lifecycle).toBe(null);
		const duplicateCall = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, now, { adapter }),
		);
		expect(duplicateCall.status).toBe("completed");
		expect(tables.invoice_submission_attempts).toHaveLength(1);
	});

	it("scopes invoice reads and refuses invalid snapshots before queue writes", async () => {
		const foreign = submissionFixture();
		foreign.invoices[0].workspace_id = "workspace-b";
		let db = createFakeSupabase(foreign);
		let result = await queueInvoiceSubmission(
			db.client,
			"user-a",
			"invoice-a",
			testOptions(db.client, () => new Date()),
		);
		expect(result.status).toBe("not_found");
		expect(foreign.invoice_submission_queue).toHaveLength(0);
		const invalid = submissionFixture();
		invalid.invoices[0].compliance = null;
		db = createFakeSupabase(invalid);
		result = await queueInvoiceSubmission(
			db.client,
			"user-a",
			"invoice-a",
			testOptions(db.client, () => new Date()),
		);
		expect(result.status).toBe("invalid");
		expect(invalid.invoice_submission_queue).toHaveLength(0);
	});

	it("coalesces concurrent enqueue and claim requests into one attempt", async () => {
		const { client, tables } = createFakeSupabase(submissionFixture());
		const now = () => new Date("2026-01-01T00:00:00Z");
		const mock = createMockProviderAdapter();
		let submitCalls = 0;
		const adapter = {
			...mock,
			submit: async (input: Parameters<typeof mock.submit>[0]) => {
				submitCalls += 1;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return mock.submit(input);
			},
		};
		const results = await Promise.all([
			queueInvoiceSubmission(
				client,
				"user-a",
				"invoice-a",
				testOptions(client, now, { adapter }),
			),
			queueInvoiceSubmission(
				client,
				"user-a",
				"invoice-a",
				testOptions(client, now, { adapter }),
			),
		]);
		expect(results.map((result) => result.status).sort()).toEqual([
			"completed",
			"processing",
		]);
		expect(tables.invoice_submission_queue).toHaveLength(1);
		expect(tables.invoice_submission_attempts).toHaveLength(1);
		expect(submitCalls).toBe(1);
	});

	it("retries timeout with bounded schedule and dead-letters after the maximum", async () => {
		const { client, tables } = createFakeSupabase(submissionFixture());
		let instant = new Date("2026-01-01T00:00:00Z");
		const now = () => new Date(instant);
		const adapter = createMockProviderAdapter({ scenario: "timeout" });
		let result = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, now, { adapter }),
		);
		for (let attempt = 1; attempt < 4; attempt += 1) {
			expect(result.nextAttemptAt).toBeDefined();
			instant = new Date(result.nextAttemptAt ?? "invalid");
			result = await queueInvoiceSubmission(
				client,
				"user-a",
				"invoice-a",
				testOptions(client, now, { adapter }),
			);
			expect(result.status).toBe("queued");
		}
		expect(result.nextAttemptAt).toBeDefined();
		instant = new Date(result.nextAttemptAt ?? "invalid");
		result = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, now, { adapter }),
		);
		expect(result.status).toBe("dead_letter");
		expect(result.message).toContain("manual review");
		expect(tables.invoice_submission_attempts).toHaveLength(5);
		expect(tables.invoice_submission_queue[0].status).toBe("dead_letter");
		expect(tables.invoices[0].status).toBe("unpaid");
	});

	it("records a mock rejection as terminal without changing delivery status", async () => {
		const { client, tables } = createFakeSupabase(submissionFixture());
		const result = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, () => new Date("2026-01-01T00:00:00Z"), {
				adapter: createMockProviderAdapter({ scenario: "rejection" }),
			}),
		);
		expect(result.status).toBe("rejected");
		expect(tables.invoice_submission_attempts[0].outcome).toBe("rejected");
		expect(tables.invoice_submission_queue[0].last_error_code).toBe(
			"MOCK_REJECTION",
		);
		expect(tables.invoices[0].status).toBe("unpaid");
	});

	it("scheduler drains a due row from its immutable validated snapshot and persisted key", async () => {
		const { client, tables } = createFakeSupabase(submissionFixture());
		let instant = new Date("2026-01-01T00:00:00Z");
		const now = () => new Date(instant);
		const timeoutAdapter = createMockProviderAdapter({ scenario: "timeout" });
		const queued = await queueInvoiceSubmission(
			client,
			"user-a",
			"invoice-a",
			testOptions(client, now, { adapter: timeoutAdapter }),
		);
		expect(queued.status).toBe("queued");
		instant = new Date(queued.nextAttemptAt ?? "invalid");
		let replayedKey = "";
		let replayedInvoiceId = "";
		const mock = createMockProviderAdapter();
		const result = await dispatchDueInvoiceSubmissions({
			now,
			adminClient: client,
			audit: async () => {},
			adapter: {
				...mock,
				submit: async ({ invoice, validation, idempotencyKey }) => {
					replayedKey = idempotencyKey;
					replayedInvoiceId = invoice.id;
					return mock.submit({ invoice, validation, idempotencyKey });
				},
			},
		});
		expect(result).toEqual({
			processed: 1,
			queued: 0,
			completed: 1,
			rejected: 0,
			manualReview: 0,
			skipped: 0,
		});
		expect(replayedKey).toBe(
			tables.invoice_submission_queue[0].idempotency_key,
		);
		expect(replayedInvoiceId).toBe("invoice-a");
		expect(tables.invoice_submission_attempts).toHaveLength(2);
		expect(tables.invoices[0].status).toBe("unpaid");
		expect(tables.invoices[0].lifecycle).toBe(null);
	});

	it("uses bounded exponential backoff", () => {
		expect([1, 2, 3, 4, 5, 6].map(submissionBackoffMs)).toEqual([
			30_000, 60_000, 120_000, 240_000, 480_000, 960_000,
		]);
		expect(submissionBackoffMs(20)).toBe(30 * 60_000);
		expect(() => submissionBackoffMs(0)).toThrow(RangeError);
	});

	it("keeps provider results server-written and workspace-scoped", () => {
		expect(migration).toContain("unique (workspace_id, invoice_id)");
		expect(migration).toContain("unique (workspace_id, idempotency_key)");
		expect(migration).toContain("submission_snapshot jsonb not null");
		expect(migration).toContain(
			"new.submission_snapshot <> old.submission_snapshot",
		);
		expect(migration).toContain("foreign key (invoice_id, workspace_id)");
		expect(migration).toContain("app.is_workspace_member(workspace_id)");
		expect(migration).toMatch(
			/revoke all on public\.invoice_submission_queue, public\.invoice_submission_attempts from anon, authenticated/i,
		);
		expect(migration).toContain(
			"grant select on public.invoice_submission_queue, public.invoice_submission_attempts to authenticated",
		);
	});

	it("retains immutable per-attempt snapshots", () => {
		expect(migration).toContain("request_snapshot jsonb not null");
		expect(migration).toContain("response_snapshot jsonb");
		expect(migration).toContain(
			"unique (workspace_id, submission_id, attempt_number)",
		);
		expect(migration).toContain(
			"before update on public.invoice_submission_attempts",
		);
		expect(migration).toContain(
			"before truncate on public.invoice_submission_attempts",
		);
		expect(migration).toContain(
			"if tg_op = 'DELETE' and pg_trigger_depth() > 1 then",
		);
	});
});
