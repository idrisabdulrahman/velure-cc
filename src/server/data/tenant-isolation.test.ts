import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP3 — systematic tenant isolation at the data (app) layer.
 *
 * Every probe here runs against an in-memory Supabase double with NO RLS
 * (`testing/fake-db.ts`), seeded with parallel workspace-A and workspace-B
 * rows. Workspace B's verified identity (user B + B's resolved active
 * workspace) then attacks every app-scoped handle belonging to workspace A:
 * row ids, invoice tokens, foreign keys (invoice_id), and bulk id lists.
 *
 * A green run proves the app-layer filter alone — the
 * `resolveActiveWorkspaceId` / owner-id predicates in each query — blocks
 * cross-tenant reads, updates and deletes for the functions exercised here.
 * Functions that deliberately rely on RLS alone are classified in
 * `tenant-isolation-coverage.test.ts` and proven by the real policies in
 * `tenant-isolation.live.test.ts` (A10_LIVE=1).
 *
 * The browser-safe audit transport posts to a server route that does not
 * exist in Node; it is replaced by a no-op so the lifecycle mutations under
 * test can run. Audit identity derivation is covered by
 * `src/routes/api/invoice/-audit.test.ts`.
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import {
	archiveClient,
	createClient,
	getClientById,
	getClientIntelligence,
	importClientsCsv,
	listClients,
	removeClient,
	toggleClientFavorite,
	updateClient,
} from "./clients";
import {
	createInvoiceExport,
	getComplianceDashboard,
	getWorkspaceSettings,
	listExportHistory,
	listTaxProfiles,
	retryInvoiceExport,
	saveTaxProfile,
	upsertWorkspaceSettings,
} from "./compliance";
import {
	disconnect,
	getConnectionSecret,
	listConnections,
	recordSyncJobResult,
	updateConnectionTokens,
	updateInvoiceSyncState,
	upsertConnection,
} from "./integrations";
import {
	autosaveDraft,
	bulkDeleteOrArchive,
	cancelSchedule,
	convertProformaToInvoice,
	createDraft,
	deleteEmptyDrafts,
	duplicate,
	getById,
	getByToken,
	getInvoiceLifecycle,
	getPublicByToken,
	getTemplateDefaults,
	importCsv,
	list,
	listPage,
	listSummary,
	listWithSummary,
	markInvoiceSent,
	previewBulkCleanup,
	recordDeliveryEvent,
	remove,
	renumberInvoices,
	reschedule,
	save,
	saveDraftSettings,
	saveTemplateDefaults,
	updateStatus,
} from "./invoices";
import { listInvoicePayments, recordPayment } from "./payments";
import {
	archiveProduct,
	createProduct,
	duplicateProduct,
	getProductAnalytics,
	getProductById,
	listProducts,
	searchProducts,
	updateProduct,
} from "./products";
import {
	createSchedule,
	deleteSchedule,
	listSchedules,
	setScheduleStatus,
	updateSchedule,
} from "./recurring";
import {
	getCollectionOverview,
	getInvoiceTimeline,
	markManualException,
	pauseInvoiceReminders,
	queueReminderEvent,
	resumeInvoiceReminders,
	runReminderBatch,
	sendQueuedEmails,
} from "./reminders";
import { getRevenueCashFlow } from "./reports";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import {
	getInvoiceWorkspaceSettings,
	listWorkspaces,
	resolveActiveWorkspaceId,
	type Supabase,
} from "./workspaces";

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";
const INV_A = "inv-a";
const INV_B = "inv-b";
const TOKEN_A = "pub-token-a";
const TOKEN_B = "pub-token-b";

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
	ownerId: string,
	name: string,
) {
	return {
		id,
		workspace_id: workspaceId,
		token: id === INV_A ? TOKEN_A : TOKEN_B,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${name}`,
		customer_name: `Customer ${name}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-01-01",
		due_date: "2026-02-01",
		status: "unpaid",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: null,
		line_items: [{ id: "li-1", name: `Item ${name}`, quantity: 1, price: 100 }],
		compliance: { buyer: { email: `buyer-${name}@example.test` } },
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: { sentAt: Date.parse("2026-01-05T00:00:00Z") },
		notes: null,
		internal_notes: null,
		owner_hint: ownerId,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
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
				id: "client-a",
				workspace_id: WS_A,
				owner_id: USER_A,
				name: "Client A",
				company: null,
				email: "client-a@example.test",
				phone: null,
				website: null,
				billing_address: null,
				tax_id: null,
				currency: "NGN",
				payment_terms: "Net 14",
				internal_notes: null,
				contact: { email: "client-a@example.test" },
				favorite: false,
				status: "active",
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
				billing_address: null,
				tax_id: null,
				currency: "NGN",
				payment_terms: "Net 14",
				internal_notes: null,
				contact: { email: "client-b@example.test" },
				favorite: false,
				status: "active",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		products: [
			{
				id: "product-a",
				workspace_id: WS_A,
				owner_id: USER_A,
				type: "service",
				name: "Widget A",
				description: null,
				sku: "WIDGET-A",
				unit_name: "unit",
				default_unit_price: 1000,
				default_tax_id: null,
				default_vat_category: "standard",
				default_classification_code: "SVC-01",
				is_active: true,
				deleted_at: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "product-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				type: "service",
				name: "Widget B",
				description: null,
				sku: "WIDGET-B",
				unit_name: "unit",
				default_unit_price: 2000,
				default_tax_id: null,
				default_vat_category: "exempt",
				default_classification_code: "SVC-02",
				is_active: true,
				deleted_at: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		invoices: [
			invoiceRow(INV_A, WS_A, USER_A, "A"),
			invoiceRow(INV_B, WS_B, USER_B, "B"),
		],
		invoice_delivery_events: [
			{
				id: "delivery-a",
				workspace_id: WS_A,
				owner_id: USER_A,
				invoice_id: INV_A,
				channel: "email",
				provider: "resend",
				recipient: "buyer-a@example.test",
				status: "sent",
				created_at: "2026-01-05T00:00:00.000Z",
			},
			{
				id: "delivery-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				invoice_id: INV_B,
				channel: "email",
				provider: "resend",
				recipient: "buyer-b@example.test",
				status: "sent",
				created_at: "2026-01-05T00:00:00.000Z",
			},
		],
		payment_transactions: [
			{
				id: "payment-a",
				workspace_id: WS_A,
				owner_id: USER_A,
				invoice_id: INV_A,
				source: "manual",
				provider: null,
				reference: "ref-a-1",
				amount: 100,
				currency: "NGN",
				recorded_by: USER_A,
				created_at: "2026-01-07T00:00:00.000Z",
			},
			{
				id: "payment-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				invoice_id: INV_B,
				source: "manual",
				provider: null,
				reference: "ref-b-1",
				amount: 100,
				currency: "NGN",
				recorded_by: USER_B,
				created_at: "2026-01-07T00:00:00.000Z",
			},
		],
		payment_charges: [
			{
				id: "charge-a",
				workspace_id: WS_A,
				invoice_id: INV_A,
				provider: "paystack",
				reference: "velure-charge-a",
				amount: 100,
				currency: "NGN",
				status: "pending",
				expires_at: "2099-01-01T00:00:00.000Z",
				created_at: "2026-01-07T00:00:00.000Z",
			},
			{
				id: "charge-b",
				workspace_id: WS_B,
				invoice_id: INV_B,
				provider: "paystack",
				reference: "velure-charge-b",
				amount: 100,
				currency: "NGN",
				status: "pending",
				expires_at: "2099-01-01T00:00:00.000Z",
				created_at: "2026-01-07T00:00:00.000Z",
			},
		],
		recurring_invoice_schedules: [
			{
				id: "schedule-a",
				workspace_id: WS_A,
				owner_id: USER_A,
				name: "Schedule A",
				status: "active",
				frequency: "monthly",
				interval: 1,
				start_date: "2026-01-01",
				next_run_date: "2026-02-01",
				end_date: null,
				auto_send: false,
				customer_name: "Customer A",
				currency: "NGN",
				payment_terms_days: 14,
				payment_details: null,
				notes: null,
				template: "default",
				line_items: [{ id: "li-1", name: "Item", quantity: 1, price: 100 }],
				last_generated_period: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "schedule-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				name: "Schedule B",
				status: "active",
				frequency: "monthly",
				interval: 1,
				start_date: "2026-01-01",
				next_run_date: "2026-02-01",
				end_date: null,
				auto_send: false,
				customer_name: "Customer B",
				currency: "NGN",
				payment_terms_days: 14,
				payment_details: null,
				notes: null,
				template: "default",
				line_items: [{ id: "li-1", name: "Item", quantity: 1, price: 100 }],
				last_generated_period: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		reminder_rules: [
			{
				id: "rule-a",
				owner_id: USER_A,
				enabled: true,
				days_before_due: 3,
				on_due_date: true,
				overdue_cadence_days: 3,
				max_overdue_reminders: 3,
				escalate_after_count: 3,
				business_signature: "Alpha Team",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "rule-b",
				owner_id: USER_B,
				enabled: true,
				days_before_due: 3,
				on_due_date: true,
				overdue_cadence_days: 3,
				max_overdue_reminders: 3,
				escalate_after_count: 3,
				business_signature: "Beta Team",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		reminder_events: [
			{
				id: "event-a",
				owner_id: USER_A,
				invoice_id: INV_A,
				stage: "before_due",
				channel: "email",
				scheduled_for: "2026-01-29T00:00:00.000Z",
				sent_at: null,
				status: "queued",
				error: null,
				meta: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "event-b",
				owner_id: USER_B,
				invoice_id: INV_B,
				stage: "before_due",
				channel: "email",
				scheduled_for: "2026-01-29T00:00:00.000Z",
				sent_at: null,
				status: "queued",
				error: null,
				meta: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		collections_cases: [
			{
				id: "case-a",
				owner_id: USER_A,
				invoice_id: INV_A,
				status: "open",
				note: null,
				escalation_status: "idle",
				last_action_at: "2026-01-01T00:00:00.000Z",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		tax_profiles: [
			{
				id: "tax-a",
				owner_id: USER_A,
				name: "VAT A",
				jurisdiction_code: "NG",
				tax_treatment: "exclusive_rate",
				rate: 7.5,
				label: "VAT A",
				is_default: true,
				active: true,
				notes: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "tax-b",
				owner_id: USER_B,
				name: "VAT B",
				jurisdiction_code: "NG",
				tax_treatment: "exclusive_rate",
				rate: 7.5,
				label: "VAT B",
				is_default: true,
				active: true,
				notes: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		invoice_exports: [
			{
				id: "export-a",
				owner_id: USER_A,
				workspace_id: WS_A,
				kind: "invoices_csv",
				status: "failed",
				file_name: "alpha.csv",
				content: "secret-export-a",
				error: "boom",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "export-b",
				owner_id: USER_B,
				workspace_id: WS_B,
				kind: "invoices_csv",
				status: "failed",
				file_name: "beta.csv",
				content: "export-b-content",
				error: "boom",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		integration_connections: [
			{
				id: "conn-a",
				owner_id: USER_A,
				provider: "xero",
				status: "connected",
				auth_type: "oauth",
				external_account_id: "ext-a",
				access_token: "token-a",
				refresh_token: "refresh-a",
				expires_at: null,
				webhook_url: null,
				default_revenue_account: null,
				default_tax_code: null,
				config_json: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "conn-b",
				owner_id: USER_B,
				provider: "xero",
				status: "connected",
				auth_type: "oauth",
				external_account_id: "ext-b",
				access_token: "token-b",
				refresh_token: "refresh-b",
				expires_at: null,
				webhook_url: null,
				default_revenue_account: null,
				default_tax_code: null,
				config_json: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00.000Z",
			},
		],
		integration_sync_jobs: [
			{
				id: "job-a",
				owner_id: USER_A,
				provider: "xero",
				entity_type: "invoice",
				entity_id: INV_A,
				direction: "push",
				status: "success",
				request_payload: null,
				response_payload: null,
				error: null,
				retry_count: 0,
				last_attempt_at: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "job-b",
				owner_id: USER_B,
				provider: "xero",
				entity_type: "invoice",
				entity_id: INV_B,
				direction: "push",
				status: "success",
				request_payload: null,
				response_payload: null,
				error: null,
				retry_count: 0,
				last_attempt_at: null,
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		integration_logs: [
			{
				id: "log-a",
				owner_id: USER_A,
				provider: "xero",
				level: "info",
				message: "alpha sync completed.",
				entity_type: "invoice",
				entity_id: INV_A,
				created_at: "2026-01-01T00:00:00.000Z",
			},
			{
				id: "log-b",
				owner_id: USER_B,
				provider: "xero",
				level: "info",
				message: "beta sync completed.",
				entity_type: "invoice",
				entity_id: INV_B,
				created_at: "2026-01-01T00:00:00.000Z",
			},
		],
		invoice_audit_log: [
			{
				id: "audit-a",
				workspace_id: WS_A,
				actor_id: USER_A,
				actor_type: "user",
				action: "invoice.edit",
				resource_type: "invoice",
				resource_id: INV_A,
				before_payload: null,
				after_payload: null,
				message: null,
				created_at: "2026-01-01T00:00:00.000Z",
			},
		],
	};
}

let tables: FakeTables;
let clientB: Supabase;

function row(table: string, id: string) {
	return (tables[table] as Array<Record<string, unknown>>).find(
		(entry) => entry.id === id,
	);
}

const clientInput = {
	name: "Beta Fresh",
	company: undefined,
	email: "beta-fresh@example.test",
	phone: undefined,
	website: undefined,
	billingAddress: undefined,
	taxId: undefined,
	currency: "NGN",
	paymentTerms: "Net 14",
	internalNotes: undefined,
	contact: {
		fullName: undefined,
		role: undefined,
		email: "beta-fresh@example.test",
		phone: undefined,
	},
	favorite: false,
	status: "active",
} as const;

const productInput = {
	type: "service" as const,
	name: "Beta Fresh Product",
	description: undefined,
	sku: "BETA-FRESH",
	unitName: "unit",
	defaultUnitPrice: 500,
	defaultTaxId: undefined,
	defaultVatCategory: "zero_rated" as const,
	defaultClassificationCode: "GOOD-01",
	isActive: true,
};

const scheduleInput = {
	name: "Beta Fresh Schedule",
	frequency: "monthly" as const,
	interval: 1,
	startDate: "2026-03-01",
	endDate: undefined,
	autoSend: false,
	customerName: "Customer B",
	currency: "NGN",
	paymentTermsDays: 14,
	paymentDetails: undefined,
	notes: undefined,
	lineItems: [{ id: "li-1", name: "Item", quantity: 1, price: 100 }],
};

const invoiceInput = {
	token: "pub-token-b-forged-id",
	invoiceNumber: "INV-2026-B-NEW",
	customerName: "Beta Fresh Co",
	currency: "NGN",
	issueDate: "2026-01-01",
	dueDate: "2026-02-01",
	lineItems: [{ id: "li-1", name: "Item", quantity: 1, price: 10 }],
};

beforeEach(() => {
	tables = seedTables();
	clientB = createFakeSupabase(tables).client;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("workspaces and settings", () => {
	it("resolves B's active workspace and lists only B's workspaces", async () => {
		expect(await resolveActiveWorkspaceId(clientB, USER_B)).toBe(WS_B);
		const listed = await listWorkspaces(clientB, USER_B);
		expect(listed.map((entry) => entry.id)).toEqual([WS_B]);
	});

	it("returns B's workspace context and invoice settings, never A's", async () => {
		const context = await getInvoiceWorkspaceSettings(clientB, USER_B);
		expect(context?.workspaceId).toBe(WS_B);
		expect(context?.name).toBe("Beta");
		expect(context?.invoiceTemplateDefaults).toEqual({
			title: "Beta Template",
		});
	});

	it("keeps workspace A's row untouched when B saves settings", async () => {
		const returned = await upsertWorkspaceSettings(clientB, USER_B, {
			// Forged tenant handles in the payload must be ignored: the
			// update target is the caller's resolved workspace, and the
			// input schema is a whitelist.
			workspaceId: WS_A,
			id: WS_A,
			ownerId: USER_A,
			name: "Beta Renamed",
		});
		expect(returned).toBe(WS_B);
		expect(row("workspaces", WS_B)?.name).toBe("Beta Renamed");
		expect(row("workspaces", WS_A)?.name).toBe("Alpha");
	});
});

describe("clients", () => {
	it("lists only B's clients", async () => {
		const listed = await listClients(clientB, USER_B);
		expect(listed.map((entry) => entry.name)).toEqual(["Client B"]);
	});

	it("does not read A's client by id", async () => {
		expect(await getClientById(clientB, USER_B, "client-a")).toBeNull();
		expect((await getClientById(clientB, USER_B, "client-b"))?.name).toBe(
			"Client B",
		);
	});

	it("does not update, archive, favorite or delete A's client by id", async () => {
		await updateClient(clientB, USER_B, "client-a", {
			...clientInput,
			name: "Hijacked",
		});
		await archiveClient(clientB, USER_B, "client-a");
		expect(row("clients", "client-a")?.name).toBe("Client A");
		expect(row("clients", "client-a")?.status).toBe("active");

		await removeClient(clientB, USER_B, "client-a");
		expect(row("clients", "client-a")).toBeDefined();

		await expect(
			toggleClientFavorite(clientB, USER_B, "client-a"),
		).rejects.toThrow("Client not found.");
		expect(row("clients", "client-a")?.favorite).toBe(false);
	});

	it("creates B's client inside B's workspace with B as owner", async () => {
		const id = await createClient(clientB, USER_B, clientInput);
		const created = row("clients", id);
		expect(created?.workspace_id).toBe(WS_B);
		expect(created?.owner_id).toBe(USER_B);
	});

	it("lets B reuse A's client email — uniqueness is per workspace", async () => {
		const id = await createClient(clientB, USER_B, {
			...clientInput,
			email: "client-a@example.test",
		});
		expect(row("clients", id)?.workspace_id).toBe(WS_B);
	});

	it("cannot profile A's client through client intelligence", async () => {
		expect(await getClientIntelligence(clientB, USER_B, "client-a")).toBeNull();
		const own = await getClientIntelligence(clientB, USER_B, "client-b");
		expect(own).not.toBeNull();
		expect(JSON.stringify(own)).not.toContain("INV-2026-A");
	});

	it("imports CSV clients into B's workspace with B as owner", async () => {
		const result = await importClientsCsv(clientB, USER_B, [
			{ name: "Imported Co", email: "imported-co@example.test" },
		]);
		expect(result.created).toBe(1);
		const created = (tables.clients as Array<Record<string, unknown>>).find(
			(entry) => entry.email === "imported-co@example.test",
		);
		expect(created?.workspace_id).toBe(WS_B);
		expect(created?.owner_id).toBe(USER_B);
	});
});

describe("products", () => {
	it("lists and searches only B's products", async () => {
		const listed = await listProducts(clientB, USER_B);
		expect(listed.map((entry) => entry.name)).toEqual(["Widget B"]);
		const searched = await searchProducts(clientB, USER_B, "Widget");
		expect(searched.map((entry) => entry.name)).toEqual(["Widget B"]);
		expect(searched[0]).toMatchObject({
			defaultVatCategory: "exempt",
			defaultClassificationCode: "SVC-02",
		});
	});

	it("does not read A's product by id", async () => {
		expect(await getProductById(clientB, USER_B, "product-a")).toBeNull();
	});

	it("does not update or archive A's product by id", async () => {
		await updateProduct(clientB, USER_B, "product-a", {
			...productInput,
			name: "Hijacked",
		});
		await archiveProduct(clientB, USER_B, "product-a");
		expect(row("products", "product-a")?.name).toBe("Widget A");
		expect(row("products", "product-a")?.deleted_at).toBeNull();
	});

	it("does not duplicate A's product", async () => {
		await expect(
			duplicateProduct(clientB, USER_B, "product-a"),
		).rejects.toThrow();
	});

	it("creates B's product inside B's workspace", async () => {
		const id = await createProduct(clientB, USER_B, productInput);
		expect(row("products", id)?.workspace_id).toBe(WS_B);
		expect(row("products", id)).toMatchObject({
			default_vat_category: "zero_rated",
			default_classification_code: "GOOD-01",
		});
	});

	it("duplicates the product's VAT category and classification code", async () => {
		const id = await duplicateProduct(clientB, USER_B, "product-b");
		expect(row("products", id)).toMatchObject({
			workspace_id: WS_B,
			default_vat_category: "exempt",
			default_classification_code: "SVC-02",
		});
	});

	it("aggregates product analytics from B's workspace only", async () => {
		const analytics = await getProductAnalytics(clientB, USER_B);
		expect(analytics).toHaveLength(1);
		const serialized = JSON.stringify(analytics);
		expect(serialized).toContain("Widget B");
		expect(serialized).not.toContain("Widget A");
		expect(serialized).not.toContain("INV-2026-A");
	});
});

describe("invoices", () => {
	it("lists only B's invoices across every list surface", async () => {
		const rows = await list(clientB, USER_B);
		expect(rows.map((invoice) => invoice.id)).toEqual([INV_B]);

		const page = await listPage(clientB, USER_B, { pageSize: 25 });
		expect(page.page.map((invoice) => invoice.id)).toEqual([INV_B]);

		const summary = await listSummary(clientB, USER_B);
		expect(JSON.stringify(summary)).not.toContain("INV-2026-A");

		const combined = await listWithSummary(clientB, USER_B);
		expect(combined.rows.map((invoice) => invoice.id)).toEqual([INV_B]);
	});

	it("does not read A's invoice by id, token or lifecycle handle", async () => {
		expect(await getById(clientB, USER_B, INV_A)).toBeNull();
		expect(await getByToken(clientB, USER_B, TOKEN_A)).toBeNull();
		expect(await getInvoiceLifecycle(clientB, USER_B, INV_A)).toBeNull();
		expect((await getById(clientB, USER_B, INV_B))?.id).toBe(INV_B);
	});

	it("does not update A's invoice status, draft settings or send state", async () => {
		await expect(
			updateStatus(clientB, USER_B, { id: INV_A, status: "paid" }),
		).rejects.toThrow("Invoice not found.");
		await expect(
			saveDraftSettings(clientB, USER_B, {
				id: INV_A,
				invoiceSize: "A4",
				dateFormat: "ng",
				paymentTermsDays: 14,
				template: "Default",
				currency: "NGN",
				type: "one-time",
			}),
		).rejects.toThrow("Invoice not found.");
		await expect(markInvoiceSent(clientB, USER_B, INV_A)).rejects.toThrow(
			"Invoice not found.",
		);
		await expect(cancelSchedule(clientB, USER_B, INV_A)).rejects.toThrow();
		await expect(
			reschedule(clientB, USER_B, {
				invoiceId: INV_A,
				scheduledAt: "2026-09-01T10:00:00.000Z",
			}),
		).rejects.toThrow();

		expect(row("invoices", INV_A)?.status).toBe("unpaid");
		expect(row("invoices", INV_A)?.deleted_at).toBeNull();
	});

	it("does not duplicate or convert A's invoice", async () => {
		await expect(duplicate(clientB, USER_B, INV_A)).rejects.toThrow(
			"Invoice not found.",
		);
		await expect(
			convertProformaToInvoice(clientB, USER_B, INV_A),
		).rejects.toThrow("Invoice not found.");
	});

	it("blocks hard-delete, bulk cleanup and renumbering of A's invoice", async () => {
		await expect(remove(clientB, USER_B, INV_A)).rejects.toThrow(
			"Invoice not found.",
		);

		const preview = await previewBulkCleanup(clientB, USER_B, [INV_A]);
		expect(preview.blocked).toHaveLength(1);
		expect(preview.hardDelete).toHaveLength(0);

		const bulk = await bulkDeleteOrArchive(clientB, USER_B, [INV_A]);
		expect(bulk.hardDeleted).toBe(0);
		expect(bulk.archived).toBe(0);
		expect(row("invoices", INV_A)?.deleted_at).toBeNull();

		await renumberInvoices(clientB, USER_B, [INV_A]);
		expect(row("invoices", INV_A)?.invoice_number).toBe("INV-2026-A");
		expect(row("workspaces", WS_A)?.next_invoice_sequence).toBe(5);
	});

	it("does not sweep A's empty drafts from B's cleanup run", async () => {
		const emptyDraft = (
			id: string,
			workspaceId: string,
			ownerId: string,
			name: string,
		) => ({
			...invoiceRow(id, workspaceId, ownerId, name),
			status: "draft",
			lifecycle: {},
			payment_amount: 0,
			line_items: [],
		});
		(tables.invoices as Array<Record<string, unknown>>).push(
			emptyDraft("inv-a-empty", WS_A, USER_A, "A-Empty"),
		);
		(tables.invoices as Array<Record<string, unknown>>).push(
			emptyDraft("inv-b-empty", WS_B, USER_B, "B-Empty"),
		);
		await deleteEmptyDrafts(clientB, USER_B);
		expect(row("invoices", "inv-a-empty")).toBeDefined();
		expect(row("invoices", "inv-b-empty")).toBeUndefined();
	});

	it("reads and writes only B's template defaults", async () => {
		const defaults = await getTemplateDefaults(clientB, USER_B);
		expect(defaults).toEqual({ title: "Beta Template" });
		await saveTemplateDefaults(clientB, USER_B, { title: "Updated" });
		expect(row("workspaces", WS_B)?.invoice_template_defaults).toEqual({
			title: "Updated",
		});
		expect(row("workspaces", WS_A)?.invoice_template_defaults).toEqual({
			title: "Alpha Template",
		});
	});

	it("does not record delivery events for A's invoice", async () => {
		await expect(
			recordDeliveryEvent(clientB, USER_B, {
				invoiceId: INV_A,
				channel: "email",
				recipient: "attacker@example.test",
				provider: "resend",
				status: "sent",
			}),
		).rejects.toThrow("Invoice not found.");
		expect(
			(tables.invoice_delivery_events as Array<Record<string, unknown>>).filter(
				(entry) => entry.invoice_id === INV_A,
			),
		).toHaveLength(1);
	});

	it("creates new drafts inside B's workspace", async () => {
		const draft = await autosaveDraft(clientB, USER_B, {
			token: "pub-token-b-new",
			invoiceNumber: "",
			customerName: "Beta Co",
			currency: "NGN",
			issueDate: "2026-01-01",
			dueDate: "2026-02-01",
			lineItems: [{ id: "li-1", name: "Item", quantity: 1, price: 10 }],
		});
		expect(row("invoices", draft.id)?.workspace_id).toBe(WS_B);
	});

	it("refuses to finalize, autosave or save into A's invoice by forged id", async () => {
		await expect(
			createDraft(clientB, USER_B, { ...invoiceInput, id: INV_A }),
		).rejects.toThrow("Draft invoice not found.");
		await expect(
			autosaveDraft(clientB, USER_B, { ...invoiceInput, id: INV_A }),
		).rejects.toThrow("Draft invoice not found.");
		await expect(
			save(clientB, USER_B, { ...invoiceInput, id: INV_A }),
		).rejects.toThrow("Invoice not found.");

		expect(row("invoices", INV_A)?.customer_name).toBe("Customer A");
		expect(row("invoices", INV_A)?.line_items as Array<unknown>).toHaveLength(
			1,
		);
		expect(row("invoices", INV_A)?.invoice_number).toBe("INV-2026-A");
	});

	it("refuses a B draft that points at A's customer id (forged foreign key)", async () => {
		await expect(
			createDraft(clientB, USER_B, { ...invoiceInput, customerId: "client-a" }),
		).rejects.toThrow("Customer not found.");
		expect(
			(tables.invoices as Array<Record<string, unknown>>).filter(
				(entry) => entry.customer_id === "client-a",
			),
		).toHaveLength(0);
	});

	it("imports CSV rows into B's workspace only", async () => {
		const result = await importCsv(clientB, USER_B, [
			{
				customerName: "Imported CSV Co",
				description: "Consulting",
				quantity: 2,
				price: 500,
			},
		]);
		expect(result.created).toBe(1);
		const created = (tables.invoices as Array<Record<string, unknown>>).filter(
			(entry) => entry.customer_name === "Imported CSV Co",
		);
		expect(created).toHaveLength(1);
		expect(created[0]?.workspace_id).toBe(WS_B);
	});
});

describe("public invoice token paths", () => {
	it("resolves A's invoice by its public token with public fields only", async () => {
		const doc = await getPublicByToken(clientB, TOKEN_A);
		expect(doc?.id).toBe(INV_A);
		// Public payload contract: no tenant-private fields may cross the
		// token boundary, even though the row belongs to workspace A and the
		// caller's identity is workspace B's (or anonymous).
		expect(doc).not.toHaveProperty("internalNotes");
		expect(doc).not.toHaveProperty("ownerHint");
		expect(doc).not.toHaveProperty("customerId");
		expect(doc).not.toHaveProperty("workspaceId");
		expect(doc).not.toHaveProperty("userId");
		expect(doc).not.toHaveProperty("tokenRevokedAt");
		expect(doc).not.toHaveProperty("reminder");
		expect(doc).not.toHaveProperty("sync");
		expect(doc).not.toHaveProperty("deletedAt");
	});

	it("returns null for an unknown token", async () => {
		expect(await getPublicByToken(clientB, "no-such-token")).toBeNull();
	});

	it("refuses revoked, canceled and deleted invoices on the public path", async () => {
		const invoiceA = row("invoices", INV_A);
		expect(invoiceA).toBeDefined();

		Object.assign(invoiceA ?? {}, {
			token_revoked_at: "2026-01-10T00:00:00.000Z",
		});
		expect(await getPublicByToken(clientB, TOKEN_A)).toBeNull();

		Object.assign(invoiceA ?? {}, {
			token_revoked_at: null,
			canceled_at: "2026-01-10T00:00:00.000Z",
		});
		expect(await getPublicByToken(clientB, TOKEN_A)).toBeNull();

		Object.assign(invoiceA ?? {}, {
			canceled_at: null,
			deleted_at: "2026-01-10T00:00:00.000Z",
		});
		expect(await getPublicByToken(clientB, TOKEN_A)).toBeNull();
	});
});

describe("payments", () => {
	it("does not read A's payment transactions", async () => {
		expect(await listInvoicePayments(clientB, USER_B, INV_A)).toEqual([]);
		const own = await listInvoicePayments(clientB, USER_B, INV_B);
		expect(own.map((payment) => payment._id)).toEqual(["payment-b"]);
	});

	it("does not record a payment against A's invoice", async () => {
		await expect(
			recordPayment(clientB, USER_B, { invoiceId: INV_A, amount: 500 }),
		).rejects.toThrow("Invoice not found.");
		expect(
			(tables.payment_transactions as Array<Record<string, unknown>>).filter(
				(entry) => entry.invoice_id === INV_A,
			),
		).toHaveLength(1);
	});

	it("records B's payment into B's workspace", async () => {
		const result = await recordPayment(clientB, USER_B, {
			invoiceId: INV_B,
			amount: 100,
			reference: "manual-b-1",
		});
		expect(result.ok).toBe(true);
		const inserted = (
			tables.payment_transactions as Array<Record<string, unknown>>
		).find((entry) => entry.reference === "manual-b-1");
		expect(inserted?.workspace_id).toBe(WS_B);
		expect(inserted?.owner_id).toBe(USER_B);
	});
});

describe("reminders and collections", () => {
	it("does not expose A's invoice in the collections overview", async () => {
		const overview = await getCollectionOverview(clientB, USER_B);
		expect(overview.invoices.map((invoice) => invoice.id)).toEqual([INV_B]);
	});

	it("gates every invoice-keyed reminder action on the scoped invoice read", async () => {
		await expect(getInvoiceTimeline(clientB, USER_B, INV_A)).rejects.toThrow(
			"Invoice not found.",
		);
		await expect(
			pauseInvoiceReminders(clientB, USER_B, { invoiceId: INV_A }),
		).rejects.toThrow("Invoice not found.");
		await expect(
			resumeInvoiceReminders(clientB, USER_B, { invoiceId: INV_A }),
		).rejects.toThrow("Invoice not found.");
		await expect(
			markManualException(clientB, USER_B, { invoiceId: INV_A, note: "x" }),
		).rejects.toThrow("Invoice not found.");
		await expect(
			queueReminderEvent(clientB, USER_B, {
				invoiceId: INV_A,
				stage: "before_due",
				channel: "email",
			}),
		).rejects.toThrow("Invoice not found.");

		expect(row("invoices", INV_A)?.reminder).toMatchObject({ paused: false });
		expect(row("collections_cases", "case-a")?.status).toBe("open");
		expect(
			(tables.reminder_events as Array<Record<string, unknown>>).filter(
				(entry) => entry.invoice_id === INV_A,
			),
		).toHaveLength(1);
	});

	it("scans only B's invoices in the reminder batch", async () => {
		const result = await runReminderBatch(clientB, USER_B, {
			date: "2026-01-02",
		});
		expect(result.scannedCount).toBe(1);
	});

	it("drains only B's queued reminder events in send-queue", async () => {
		const previousKey = process.env.RESEND_API_KEY;
		process.env.RESEND_API_KEY = "";
		try {
			const result = await sendQueuedEmails(clientB, USER_B);
			// Without a provider key the route-level function reports the
			// number of queued events it can see; only B's event counts.
			expect(result.skipped).toBe(1);
		} finally {
			process.env.RESEND_API_KEY = previousKey;
		}
	});
});

describe("recurring schedules", () => {
	it("lists only B's schedules", async () => {
		const listed = await listSchedules(clientB, USER_B);
		expect(listed.map((schedule) => schedule._id)).toEqual(["schedule-b"]);
	});

	it("does not update, end or delete A's schedule by id", async () => {
		await updateSchedule(clientB, USER_B, "schedule-a", {
			...scheduleInput,
			name: "Hijacked",
		});
		expect(row("recurring_invoice_schedules", "schedule-a")?.name).toBe(
			"Schedule A",
		);

		await setScheduleStatus(clientB, USER_B, "schedule-a", "ended");
		expect(row("recurring_invoice_schedules", "schedule-a")?.status).toBe(
			"active",
		);

		await expect(
			deleteSchedule(clientB, USER_B, "schedule-a"),
		).rejects.toThrow();
		expect(row("recurring_invoice_schedules", "schedule-a")).toBeDefined();
	});

	it("creates B's schedule inside B's workspace", async () => {
		const id = await createSchedule(clientB, USER_B, scheduleInput);
		expect(row("recurring_invoice_schedules", id)?.workspace_id).toBe(WS_B);
	});
});

describe("compliance exports and tax profiles", () => {
	it("reads B's settings and export history only", async () => {
		const settings = await getWorkspaceSettings(clientB, USER_B);
		expect(settings?.workspaceId).toBe(WS_B);

		const history = await listExportHistory(clientB, USER_B);
		expect(history.map((entry) => entry._id)).toEqual(["export-b"]);
	});

	it("does not retry A's export by id", async () => {
		await expect(
			retryInvoiceExport(clientB, USER_B, "export-a"),
		).rejects.toThrow();
		expect(row("invoice_exports", "export-a")?.status).toBe("failed");
	});

	it("generates B's export from B's invoices only", async () => {
		const created = await createInvoiceExport(clientB, USER_B, "invoices_csv");
		expect(created.content).toContain("INV-2026-B");
		expect(created.content).not.toContain("INV-2026-A");
		const inserted = row("invoice_exports", created.id);
		expect(inserted?.workspace_id).toBe(WS_B);
		expect(inserted?.owner_id).toBe(USER_B);
	});

	it("lists only B's tax profiles and cannot update A's by id", async () => {
		const listed = await listTaxProfiles(clientB, USER_B);
		expect(listed.map((profile) => profile._id)).toEqual(["tax-b"]);

		await expect(
			saveTaxProfile(clientB, USER_B, {
				id: "tax-a",
				name: "Hijacked",
				jurisdictionCode: "NG",
				taxTreatment: "exclusive_rate",
				rate: 7.5,
				label: "Hijacked",
				isDefault: false,
				active: true,
			}),
		).rejects.toThrow();
		expect(row("tax_profiles", "tax-a")?.name).toBe("VAT A");
	});

	it("scopes the compliance dashboard to B's invoices and exports", async () => {
		const dashboard = await getComplianceDashboard(clientB, USER_B);
		expect(dashboard).not.toBeNull();
		expect(JSON.stringify(dashboard)).not.toContain("INV-2026-A");
		expect(dashboard?.exports.recent.map((entry) => entry.id)).toEqual([
			"export-b",
		]);
	});
});

describe("integrations", () => {
	it("exposes only B's connection", async () => {
		const connections = await listConnections(clientB, USER_B);
		const xero = connections.find((entry) => entry.provider === "xero");
		expect(xero?._id).toBe("conn-b");
		expect(connections.some((entry) => entry._id === "conn-a")).toBe(false);
	});

	it("does not read A's secrets and does not rotate A's tokens", async () => {
		const secret = await getConnectionSecret(clientB, USER_B, "xero");
		expect(secret?.accessToken).toBe("token-b");

		await updateConnectionTokens(clientB, USER_B, {
			provider: "xero",
			accessToken: "rotated-b",
		});
		// The new token is written only to B's row (encrypted at rest when
		// INTEGRATION_ENCRYPTION_KEY is configured); A's token stays as-is.
		expect(row("integration_connections", "conn-b")?.access_token).not.toBe(
			"token-b",
		);
		expect(row("integration_connections", "conn-a")?.access_token).toBe(
			"token-a",
		);
	});

	it("does not disconnect A's connection", async () => {
		await disconnect(clientB, USER_B, "xero");
		expect(row("integration_connections", "conn-a")?.access_token).toBe(
			"token-a",
		);
		expect(row("integration_connections", "conn-b")?.access_token).toBeNull();
	});

	it("stamps sync-job writes with B as owner", async () => {
		const { jobId } = await recordSyncJobResult(clientB, USER_B, {
			provider: "xero",
			entityType: "invoice",
			entityId: INV_B,
			status: "success",
		});
		expect(row("integration_sync_jobs", jobId)?.owner_id).toBe(USER_B);
	});

	it("does not update A's invoice sync state by invoice id", async () => {
		await expect(
			updateInvoiceSyncState(clientB, USER_B, {
				invoiceId: INV_A,
				provider: "xero",
				status: "success",
			}),
		).rejects.toThrow("Invoice not found.");
		expect(row("invoices", INV_A)?.sync).toBeNull();
	});

	it("upserts B's connection in place and never rewrites A's row", async () => {
		const id = await upsertConnection(clientB, USER_B, {
			provider: "xero",
			authType: "oauth",
			accessToken: "rotated-b-upsert",
		});
		expect(id).toBe("conn-b");
		expect(row("integration_connections", "conn-a")?.access_token).toBe(
			"token-a",
		);
	});
});

describe("reports", () => {
	it("aggregates only B's invoices, products and payments", async () => {
		const report = await getRevenueCashFlow(clientB, USER_B);
		expect(report).not.toBeNull();
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain("INV-2026-A");
		expect(serialized).not.toContain("ref-a-1");
		expect(serialized).not.toContain("Widget A");
	});
});
