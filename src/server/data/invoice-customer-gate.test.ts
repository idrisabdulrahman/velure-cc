import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP6 / spec fix B2 — the customer gate on leaving Draft.
 *
 * Every probe runs against the in-memory Supabase double (`testing/fake-db.ts`)
 * with NO RLS, seeded with workspace-A and workspace-B rows, so the assertions
 * pin the app-layer rule itself: a draft may stay customer-less, but any
 * transition out of Draft into paid / unpaid / overdue (or a finalize that
 * lands outside Draft) requires a linked customer record that resolves inside
 * the caller's workspace.
 *
 * The browser-safe audit transport posts to a server route that does not
 * exist in Node; it is replaced by a no-op so the lifecycle mutations under
 * test can run (same treatment as `tenant-isolation.test.ts`).
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import {
	CUSTOMER_LINK_CLEARED_ON_ISSUED_MESSAGE,
	CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
} from "#/features/invoices/customer-gate";
import {
	assertCustomerForIssueTransition,
	autosaveDraft,
	convertProformaToInvoice,
	createDraft,
	markInvoiceSent,
	recordDeliveryEvent,
	save,
	updateStatus,
} from "./invoices";
import { recordPayment } from "./payments";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";
const CLIENT_A = "client-a";

function workspaceRow(id: string, ownerId: string, name: string) {
	return {
		id,
		owner_id: ownerId,
		name,
		legal_name: `${name} Legal`,
		email: `${name.toLowerCase()}@example.test`,
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
		invoice_template_defaults: { title: `${name} Template` },
		reminder_signature: "Team",
		reminders_enabled: true,
		supplier_profile_status: "complete",
		supplier_profile_issues: [],
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 5,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function invoiceRow(
	id: string,
	workspaceId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		workspace_id: workspaceId,
		token: `pub-token-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${id.toUpperCase()}`,
		customer_name: `Customer ${id}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		// Far-future due date so nothing derives `overdue` from "today".
		issue_date: "2026-01-01",
		due_date: "2099-02-01",
		status: "draft",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: null,
		finalized_at: null,
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
		compliance: { buyer: { email: `${id}@example.test` } },
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: {},
		notes: null,
		internal_notes: null,
		owner_hint: USER_A,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
		...overrides,
	};
}

function seedTables(): FakeTables {
	return {
		workspaces: [
			workspaceRow(WS_A, USER_A, "Alpha"),
			workspaceRow(WS_B, USER_B, "Beta"),
		],
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
		],
		workspace_members: [
			{ workspace_id: WS_A, user_id: USER_A, role: "owner" },
			{ workspace_id: WS_B, user_id: USER_B, role: "owner" },
		],
		clients: [
			{
				id: CLIENT_A,
				workspace_id: WS_A,
				owner_id: USER_A,
				name: "Client A",
				company: null,
				email: "client-a@example.test",
				phone: null,
				website: null,
				billing_address: "1 Buyer Way",
				tax_id: "1234567890",
				currency: "NGN",
				payment_terms: "Net 14",
				internal_notes: null,
				contact: { email: "client-a@example.test" },
				favorite: false,
				status: "active",
				buyer_type: "b2b",
				buyer_profile_status: "complete",
				buyer_profile_issues: [],
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "client-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				name: "Client B",
				company: null,
				email: "client-b@example.test",
				phone: null,
				website: null,
				billing_address: "2 Buyer Way",
				tax_id: null,
				currency: "NGN",
				payment_terms: "Net 14",
				internal_notes: null,
				contact: { email: "client-b@example.test" },
				favorite: false,
				status: "active",
				buyer_type: "b2c",
				// Legal values under the migration CHECK are
				// 'complete' | 'needs_review' — 'flagged' is not one of them.
				buyer_profile_status: "needs_review",
				buyer_profile_issues: ["address_required"],
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		invoices: [
			// Workspace A drafts.
			invoiceRow("inv-a-draft", WS_A),
			invoiceRow("inv-a-draft-linked", WS_A, { customer_id: CLIENT_A }),
			// Legacy issued row (pre-B2) that never had a customer link.
			invoiceRow("inv-a-issued", WS_A, {
				status: "unpaid",
				delivered_at: "2026-01-05T00:00:00.000Z",
				finalized_at: "2026-01-05T00:00:00.000Z",
			}),
			// Issued invoice WITH a linked buyer.
			invoiceRow("inv-a-issued-linked", WS_A, {
				invoice_number: "INV-2026-0042",
				customer_id: CLIENT_A,
				customer_name: "Client A",
				status: "unpaid",
				delivered_at: "2026-01-05T00:00:00.000Z",
				finalized_at: "2026-01-05T00:00:00.000Z",
			}),
			// Legacy non-draft row without a delivery/payment issuance marker.
			invoiceRow("inv-a-legacy-unissued-linked", WS_A, {
				invoice_number: "INV-2026-0044",
				customer_id: CLIENT_A,
				customer_name: "Client A",
				status: "unpaid",
			}),
			// Workspace B draft.
			invoiceRow("inv-b-draft", WS_B, {
				owner_hint: USER_B,
				invoice_number: "INV-2026-BDRAFT",
			}),
		],
		payment_transactions: [],
		invoice_delivery_events: [],
	};
}

let tables: FakeTables;
let client: ReturnType<typeof createFakeSupabase>["client"];

function row(id: string) {
	return (tables.invoices as Array<Record<string, unknown>>).find(
		(entry) => entry.id === id,
	);
}

const draftInput = {
	token: "pub-token-new",
	invoiceNumber: "INV-2026-0007",
	customerName: "Acme Ltd",
	currency: "NGN",
	issueDate: "2026-01-01",
	dueDate: "2099-02-01",
	lineItems: [
		{
			id: "li-1",
			name: "Service",
			quantity: 1,
			price: 5000,
			unit: "hour",
			vatCategory: "standard" as const,
			classificationCode: "SVC-001",
		},
	],
};

beforeEach(() => {
	tables = seedTables();
	client = createFakeSupabase(tables).client;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("updateStatus draft gate", () => {
	it("rejects draft → unpaid without a customer record", async () => {
		await expect(
			updateStatus(client, USER_A, { id: "inv-a-draft", status: "unpaid" }),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(row("inv-a-draft")?.status).toBe("draft");
	});

	it("rejects draft → paid / overdue without a customer record", async () => {
		await expect(
			updateStatus(client, USER_A, { id: "inv-a-draft", status: "paid" }),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		await expect(
			updateStatus(client, USER_A, { id: "inv-a-draft", status: "overdue" }),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(row("inv-a-draft")?.status).toBe("draft");
	});

	it("allows draft → unpaid when the linked customer resolves in the workspace", async () => {
		await updateStatus(client, USER_A, {
			id: "inv-a-draft-linked",
			status: "unpaid",
		});
		expect(row("inv-a-draft-linked")?.status).toBe("unpaid");
		expect(row("inv-a-draft-linked")?.customer_id).toBe(CLIENT_A);
	});

	it("still allows draft → canceled (soft discard, stays customer-less)", async () => {
		await updateStatus(client, USER_A, {
			id: "inv-a-draft",
			status: "canceled",
		});
		expect(row("inv-a-draft")?.status).toBe("canceled");
	});

	it("keeps a legacy issued invoice without a customer settleable", async () => {
		// Pre-B2 rows are not retro-blocked: an issued invoice that predates
		// the customer requirement can still be marked paid.
		await updateStatus(client, USER_A, {
			id: "inv-a-issued",
			status: "paid",
		});
		expect(row("inv-a-issued")?.status).toBe("paid");
	});

	it("rejects a draft whose customer id points at another workspace", async () => {
		const draft = row("inv-a-draft") as Record<string, unknown>;
		draft.customer_id = "client-b";
		await expect(
			updateStatus(client, USER_A, { id: "inv-a-draft", status: "unpaid" }),
		).rejects.toThrow("Customer not found.");
		expect(row("inv-a-draft")?.status).toBe("draft");
	});
});

describe("markInvoiceSent draft gate", () => {
	it("rejects marking a customer-less draft as sent", async () => {
		await expect(
			markInvoiceSent(client, USER_A, "inv-a-draft"),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(row("inv-a-draft")?.delivered_at).toBeNull();
	});

	it("sends a draft that has a linked customer", async () => {
		await markInvoiceSent(client, USER_A, "inv-a-draft-linked");
		expect(row("inv-a-draft-linked")?.delivered_at).toBeTruthy();
		expect(row("inv-a-draft-linked")?.status).toBe("unpaid");
	});
});

describe("createDraft finalize gate", () => {
	it("refuses to finalize a new invoice without a customer record", async () => {
		await expect(createDraft(client, USER_A, draftInput)).rejects.toThrow(
			CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
		);
		expect(
			(tables.invoices as Array<Record<string, unknown>>).filter(
				(entry) => entry.invoice_number === "INV-2026-0007",
			),
		).toHaveLength(0);
	});

	it("finalizes when the customer resolves in the caller's workspace", async () => {
		const created = await createDraft(client, USER_A, {
			...draftInput,
			customerId: CLIENT_A,
		});
		expect(created.status).not.toBe("draft");
		const stored = row(created.id);
		expect(stored?.customer_id).toBe(CLIENT_A);
		expect(stored?.workspace_id).toBe(WS_A);
		expect(stored?.line_items).toMatchObject([
			{
				unit: "hour",
				vatCategory: "standard",
				classificationCode: "SVC-001",
			},
		]);
	});

	it("refuses finalize when the customer id is forged across workspaces", async () => {
		await expect(
			createDraft(client, USER_A, { ...draftInput, customerId: "client-b" }),
		).rejects.toThrow("Customer not found.");
	});

	it("refuses a customer-less scheduled delivery (derived status scheduled)", async () => {
		// `deliveryType: "scheduled"` derives `scheduled`, not `unpaid` — the
		// gate must read the DERIVED status, so a schedule attempt on a
		// customer-less draft is rejected before any row is written (no
		// scheduled invoice can exist without a buyer link).
		await expect(
			createDraft(client, USER_A, {
				...draftInput,
				invoiceNumber: "INV-2026-0008",
				deliveryType: "scheduled",
				scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				compliance: { buyer: { email: "scheduled-buyer@example.test" } },
			}),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(
			(tables.invoices as Array<Record<string, unknown>>).filter(
				(entry) => entry.invoice_number === "INV-2026-0008",
			),
		).toHaveLength(0);
	});

	it("schedules the same delivery when the customer resolves in the workspace", async () => {
		const created = await createDraft(client, USER_A, {
			...draftInput,
			invoiceNumber: "INV-2026-0009",
			customerId: CLIENT_A,
			deliveryType: "scheduled",
			scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			compliance: { buyer: { email: "scheduled-buyer@example.test" } },
		});
		expect(created.status).toBe("scheduled");
		expect(row(created.id)?.customer_id).toBe(CLIENT_A);
	});
});

describe("autosave stays customer-less", () => {
	it("keeps an autosaved draft in Draft without a customer", async () => {
		const draft = await autosaveDraft(client, USER_A, {
			...draftInput,
			invoiceNumber: "",
		});
		expect(draft.status).toBe("draft");
		expect(row(draft.id)?.customer_id).toBeNull();
	});
});

describe("line classification draft-exit gate", () => {
	const invoice = {
		customerId: CLIENT_A,
		lineItems: [
			{
				id: "li-1",
				name: "Service",
				quantity: 1,
				price: 100,
				unit: "hour",
				vatCategory: "standard" as const,
				classificationCode: "SVC-01",
			},
		],
	};

	it("keeps incomplete draft lines saveable", async () => {
		await expect(
			assertCustomerForIssueTransition(
				client,
				WS_A,
				{ ...invoice, lineItems: [{ ...invoice.lineItems[0], unit: "" }] },
				"draft",
				"draft",
			),
		).resolves.toBeUndefined();
	});

	it("rejects leaving Draft when any line lacks a unit, VAT category, or code", async () => {
		await expect(
			assertCustomerForIssueTransition(
				client,
				WS_A,
				{
					...invoice,
					lineItems: [
						{
							...invoice.lineItems[0],
							unit: " ",
							vatCategory: undefined,
							classificationCode: " ",
						},
					],
				},
				"draft",
				"unpaid",
			),
		).rejects.toThrow(
			"Each invoice line needs a unit, VAT category, and goods/service code before leaving Draft.",
		);
	});

	it("rejects VAT categories outside the supported set", async () => {
		await expect(
			assertCustomerForIssueTransition(
				client,
				WS_A,
				{
					...invoice,
					lineItems: [
						{ ...invoice.lineItems[0], vatCategory: "other" as never },
					],
				},
				"draft",
				"unpaid",
			),
		).rejects.toThrow("Each invoice line needs a unit");
	});
});

describe("convertProformaToInvoice draft gate", () => {
	it("leaves a zero-deposit conversion in Draft (draft → draft is not gated)", async () => {
		tables.invoices = [
			...(tables.invoices as Array<Record<string, unknown>>),
			invoiceRow("inv-a-proforma", WS_A, { document_type: "proforma" }),
		];
		const { id } = await convertProformaToInvoice(
			client,
			USER_A,
			"inv-a-proforma",
		);
		// The landed standard invoice is still a draft, so it stays
		// customer-less and remains gated at its own finalize.
		expect(row(id)?.status).toBe("draft");
		expect(row(id)?.customer_id).toBeNull();
		expect(row(id)?.document_type).toBe("standard");
	});

	it("carries the linked customer when a deposit makes the landing invoice issued", async () => {
		tables.invoices = [
			...(tables.invoices as Array<Record<string, unknown>>),
			invoiceRow("inv-a-proforma", WS_A, {
				document_type: "proforma",
				customer_id: CLIENT_A,
				payment_amount: 500,
			}),
		];
		const { id } = await convertProformaToInvoice(
			client,
			USER_A,
			"inv-a-proforma",
		);
		expect(row(id)?.customer_id).toBe(CLIENT_A);
		expect(row(id)?.status).toBe("paid");
		expect(
			tables.payment_transactions as Array<Record<string, unknown>>,
		).toHaveLength(1);
	});
});

// Audit round-1, finding 2: B2's headline invariant is "customer required to
// leave Draft", so SETTLING a derived-Draft invoice needs a customer too.
// (This block replaces the removed pin that asserted a paid invoice with a
// null customer reached through pro-forma conversion — now pinned as
// rejections instead, while non-derived-Draft invoices stay settleable.)
describe("recordPayment draft gate", () => {
	it("rejects FULL settlement of a customer-less draft with the gate message", async () => {
		await expect(
			recordPayment(client, USER_A, { invoiceId: "inv-a-draft", amount: 100 }),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(row("inv-a-draft")?.status).toBe("draft");
		expect(row("inv-a-draft")?.payment_amount).toBe(0);
		expect(tables.payment_transactions).toHaveLength(0);
	});

	it("rejects PARTIAL settlement of a customer-less draft with the gate message", async () => {
		await expect(
			recordPayment(client, USER_A, { invoiceId: "inv-a-draft", amount: 10 }),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(row("inv-a-draft")?.status).toBe("draft");
		expect(row("inv-a-draft")?.payment_amount).toBe(0);
		expect(tables.payment_transactions).toHaveLength(0);
	});

	it("still settles a customer-less legacy issued invoice (no retro-block)", async () => {
		const result = await recordPayment(client, USER_A, {
			invoiceId: "inv-a-issued",
			amount: 100,
		});
		expect(result.ok).toBe(true);
		expect(row("inv-a-issued")?.status).toBe("paid");
		// A non-derived-Draft invoice is never re-touched by the gate.
		expect(row("inv-a-issued")?.customer_id).toBeNull();
	});

	it("still settles a draft that has a linked workspace customer", async () => {
		const result = await recordPayment(client, USER_A, {
			invoiceId: "inv-a-draft-linked",
			amount: 100,
		});
		expect(result.ok).toBe(true);
		expect(row("inv-a-draft-linked")?.status).toBe("paid");
		expect(tables.payment_transactions).toHaveLength(1);
	});
});

describe("recordDeliveryEvent draft gate", () => {
	it("rejects a sent delivery event for a customer-less draft before any write", async () => {
		await expect(
			recordDeliveryEvent(client, USER_A, {
				invoiceId: "inv-a-draft",
				channel: "email",
				recipient: "buyer@example.test",
				provider: "resend",
				status: "sent",
			}),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(tables.invoice_delivery_events).toHaveLength(0);
		expect(row("inv-a-draft")?.delivered_at).toBeNull();
		expect(row("inv-a-draft")?.status).toBe("draft");
	});

	it("records the sent delivery event for a draft with a linked customer", async () => {
		const result = await recordDeliveryEvent(client, USER_A, {
			invoiceId: "inv-a-draft-linked",
			channel: "email",
			recipient: "buyer@example.test",
			provider: "resend",
			status: "sent",
		});
		expect(result.ok).toBe(true);
		expect(tables.invoice_delivery_events).toHaveLength(1);
		expect(row("inv-a-draft-linked")?.delivered_at).toBeTruthy();
		expect(row("inv-a-draft-linked")?.status).toBe("unpaid");
	});
});

describe("tenant scoping of the gate", () => {
	it("hides workspace A's draft from workspace B before the gate runs", async () => {
		await expect(
			updateStatus(client, USER_B, { id: "inv-a-draft", status: "unpaid" }),
		).rejects.toThrow("Invoice not found.");
		await expect(
			markInvoiceSent(client, USER_B, "inv-a-draft"),
		).rejects.toThrow("Invoice not found.");
		expect(row("inv-a-draft")?.status).toBe("draft");
	});

	it("rejects workspace B's draft pointing at workspace A's customer", async () => {
		const draft = row("inv-b-draft") as Record<string, unknown>;
		draft.customer_id = CLIENT_A;
		await expect(
			updateStatus(client, USER_B, { id: "inv-b-draft", status: "unpaid" }),
		).rejects.toThrow("Customer not found.");
		expect(row("inv-b-draft")?.status).toBe("draft");
	});
});

// Audit round-2, finding 2 (LOW): `save()` patched `customer_id` straight
// from `args.customerId`, and the details-sheet payload omits `customerId`.
// WP8 now blocks all issued edits; this test pins the same buyer-link guard
// for legacy non-draft rows that have no delivery/payment issuance marker.
describe("save() buyer-link guard", () => {
	const saveInput = {
		token: "pub-token-edit",
		invoiceNumber: "INV-2026-0042",
		customerName: "Client A",
		currency: "NGN",
		issueDate: "2026-01-01",
		dueDate: "2099-02-01",
		lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 100 }],
	};

	it("threads the stored buyer link when a legacy non-draft save omits customerId", async () => {
		await save(client, USER_A, {
			...saveInput,
			invoiceNumber: "INV-2026-0044",
			id: "inv-a-legacy-unissued-linked",
		});
		expect(row("inv-a-legacy-unissued-linked")?.customer_id).toBe(CLIENT_A);
		expect(row("inv-a-legacy-unissued-linked")?.status).toBe("unpaid");
	});

	it("refuses an explicit clear of a legacy non-draft buyer link", async () => {
		await expect(
			save(client, USER_A, {
				...saveInput,
				invoiceNumber: "INV-2026-0044",
				id: "inv-a-legacy-unissued-linked",
				customerId: "",
			}),
		).rejects.toThrow(CUSTOMER_LINK_CLEARED_ON_ISSUED_MESSAGE);
		expect(row("inv-a-legacy-unissued-linked")?.customer_id).toBe(CLIENT_A);
		expect(row("inv-a-legacy-unissued-linked")?.status).toBe("unpaid");
	});

	it("still lets a draft drop its buyer link (buyer-less drafts stay legal)", async () => {
		await save(client, USER_A, {
			...saveInput,
			invoiceNumber: "INV-2026-0043",
			id: "inv-a-draft-linked",
		});
		expect(row("inv-a-draft-linked")?.customer_id).toBeNull();
		expect(row("inv-a-draft-linked")?.status).toBe("draft");
	});
});
