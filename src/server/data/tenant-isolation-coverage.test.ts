import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WP3 — coverage guard for tenant isolation.
 *
 * Every named export of every `src/server/data/*.ts` module, plus the two
 * server repository modules that issue queries themselves
 * (`src/server/invoice-repository.ts`, `src/server/public-invoice-repository.ts`),
 * must be classified here with the mechanism that prevents cross-tenant
 * access:
 *
 * - `app-scoped`: the query carries a workspace/owner filter resolved from
 *   the verified session. Proven by `tenant-isolation.test.ts` against the
 *   no-RLS fake.
 * - `rls-only`: the query has no app-layer tenant filter by design and is
 *   protected by Postgres RLS alone. Proven by
 *   `tenant-isolation.live.test.ts` (A10_LIVE=1) and by the RLS policy
 *   migrations.
 * - `public-token`: keyed by a public share/payment token (or by an invoice
 *   the server resolved from one), intentionally unauthenticated but
 *   token-scoped. Proven by the functional suite's token probes plus the
 *   route tests under `src/routes/api`.
 * - `pure`: pure computation or formatting with no database access.
 * - `server-admin`: server-only admin/webhook machinery (audit transport,
 *   Paystack webhook confirmation, token encryption helpers). Never
 *   reachable from a tenant-supplied workspace id; identity comes from the
 *   webhook signature or the verified server context.
 * - `session`: identity/session plumbing whose tenancy behavior is covered
 *   by the auth layer tests, not the data-layer probes.
 * - `test-only`: reachable only when the dev fixtures flag is enabled; never
 *   mounted in production builds.
 *
 * A new export without a classification fails this suite, forcing the
 * author to state (and test) its isolation story. The scan is
 * form-independent: declaration exports (`export function/const/class`,
 * including indented ones), named list exports (`export { a, b as c }`,
 * single-line or multiline, with or without a `from` clause), and namespace
 * re-exports (`export * as ns from`) all resolve to a name that must be
 * classified. Any export shape the scanner cannot resolve to a name — bare
 * `export * from`, `export default`, destructuring exports, or anything
 * else unrecognized — fails outright, so a new export form cannot evade the
 * guard. `export type` / `export interface` declarations are the deliberate
 * exception: they are erased at runtime, carry no query surface, and are
 * caught by `pnpm typecheck`.
 */

type Classification =
	| "app-scoped"
	| "rls-only"
	| "public-token"
	| "pure"
	| "server-admin"
	| "session"
	| "test-only";

const CLASSIFICATIONS: Record<string, Classification> = {
	// audit-client.ts
	recordInvoiceAudit: "server-admin",
	// audit.ts
	INVOICE_AUDIT_ACTIONS: "pure",
	sanitizeAuditPayload: "pure",
	buildInvoiceAuditRow: "pure",
	// audit.ts recordInvoiceAudit dedupes with audit-client above
	// client-intelligence.ts
	buildClientIntelligence: "pure",
	// clients.ts
	listClients: "app-scoped",
	getClientById: "app-scoped",
	getClientIntelligence: "app-scoped",
	createClient: "app-scoped",
	updateClient: "app-scoped",
	archiveClient: "app-scoped",
	removeClient: "app-scoped",
	toggleClientFavorite: "app-scoped",
	importClientsCsv: "app-scoped",
	CLIENT_BUYER_REJECTION_PREFIX: "pure",
	buildClientBuyerColumns: "pure",
	// compliance-dashboard.ts
	buildComplianceDashboardReport: "pure",
	// compliance-export.ts
	buildInvoiceExportContent: "pure",
	// einvoice-validation.ts — caller session selects active workspace, then
	// invoice and customer reads both carry that workspace filter.
	validateWorkspaceInvoice: "app-scoped",
	loadWorkspaceInvoiceSubmissionSnapshot: "app-scoped",
	// einvoice-provider-credentials.ts — derives active workspace with the
	// verified user client, then scopes service-role ciphertext access by it.
	saveEInvoiceProviderCredentials: "server-admin",
	createWorkspaceProviderAdapter: "server-admin",
	// einvoice-submissions.ts — active-workspace membership is verified with the user client, every admin mutation is workspace-filtered.
	submissionBackoffMs: "pure",
	queueInvoiceSubmission: "server-admin",
	dispatchDueInvoiceSubmissions: "server-admin",
	// compliance.ts
	getWorkspaceSettings: "app-scoped",
	SUPPLIER_PROFILE_REJECTION_PREFIX: "pure",
	buildSupplierProfileUpdate: "pure",
	upsertWorkspaceSettings: "app-scoped",
	listTaxProfiles: "app-scoped",
	saveTaxProfile: "app-scoped",
	listExportHistory: "app-scoped",
	getComplianceDashboard: "app-scoped",
	createInvoiceExport: "app-scoped",
	retryInvoiceExport: "app-scoped",
	// integrations.ts
	listConnections: "app-scoped",
	getConnectionSecret: "app-scoped",
	updateConnectionTokens: "app-scoped",
	upsertConnection: "app-scoped",
	disconnect: "app-scoped",
	listSyncJobs: "rls-only",
	listLogs: "rls-only",
	recordSyncJobResult: "app-scoped",
	retrySyncJob: "rls-only",
	updateInvoiceSyncState: "app-scoped",
	// invoice-numbering.ts (WP8/C1 — the ONE number authority)
	isInvoiceIssued: "pure",
	sequenceFromInvoiceNumber: "pure",
	invoiceNumberForSequence: "pure",
	resolveInvoiceNumberPrefix: "pure",
	candidateInvoiceNumber: "pure",
	// reads workspaces/invoices by a workspace id every caller first resolved
	// through resolveActiveWorkspaceId; the collision check is eq-filtered
	planInvoiceNumber: "app-scoped",
	assertInvoiceNumberAvailable: "app-scoped",
	// scope is enforced inside allocate_invoice_number / has_issued_invoice
	// from the caller's own JWT (app.is_workspace_member), never a passed flag
	reserveInvoiceNumber: "app-scoped",
	commitInvoiceNumber: "app-scoped",
	workspaceNumberingLocked: "app-scoped",
	assertSequenceCounterChangeAllowed: "app-scoped",
	// invoices.ts
	INVOICE_LIST_PAGE_SIZE: "pure",
	getDerivedInvoiceStatus: "pure",
	assertInvoiceInput: "pure",
	rowToInvoiceDoc: "pure",
	mapInvoice: "pure",
	mapPublicInvoice: "pure",
	isPublicInvoiceAvailable: "pure",
	parseFutureSchedule: "pure",
	paginateInvoiceRows: "pure",
	buildInvoicePaymentScore: "pure",
	buildInvoiceListSummary: "pure",
	list: "app-scoped",
	listPage: "app-scoped",
	listSummary: "app-scoped",
	listWithSummary: "app-scoped",
	getById: "app-scoped",
	// workspace-filtered (resolveActiveWorkspaceId) despite the token handle
	getByToken: "app-scoped",
	getPublicByToken: "public-token",
	getTemplateDefaults: "app-scoped",
	getInvoiceLifecycle: "app-scoped",
	createDraft: "app-scoped",
	autosaveDraft: "app-scoped",
	save: "app-scoped",
	saveDraftSettings: "app-scoped",
	saveTemplateDefaults: "app-scoped",
	updateStatus: "app-scoped",
	// B2 leave-Draft gates: workspace id resolved from the verified session,
	// customer lookup scoped to that workspace (resolveActiveWorkspaceId)
	assertCustomerForIssueTransition: "app-scoped",
	assertSendCustomerGate: "app-scoped",
	cancelSchedule: "app-scoped",
	reschedule: "app-scoped",
	remove: "app-scoped",
	previewBulkCleanup: "app-scoped",
	bulkDeleteOrArchive: "app-scoped",
	renumberInvoices: "app-scoped",
	deleteEmptyDrafts: "app-scoped",
	duplicate: "app-scoped",
	convertProformaToInvoice: "app-scoped",
	importCsv: "app-scoped",
	markInvoiceSent: "app-scoped",
	recordDeliveryEvent: "app-scoped",
	// nigeria.ts
	NIGERIA_AUTHORITY_LABEL: "pure",
	NIGERIA_TAX_RULE_SET_VERSION: "pure",
	NIGERIA_FOREIGN_CURRENCY_WARNING: "pure",
	RESEND_FREE_TIER_DAILY_LIMIT: "pure",
	NIGERIA_TAX_RULE_SETS: "pure",
	getNigeriaRuleSet: "pure",
	resolveNigeriaRuleSetId: "pure",
	resolveNigeriaRuleSet: "pure",
	isKnownNigeriaRuleSetVersion: "pure",
	classifyNigeriaRuleSetVersion: "pure",
	normalizeRuleSetVersionForWrite: "pure",
	NIGERIA_VAT_RATE: "pure",
	defaultTaxTreatmentForSellerTaxStatus: "pure",
	defaultWithholdingSelection: "pure",
	resolveWithholdingRate: "pure",
	withholdingLabelForCategory: "pure",
	legacyWithholdingSelectionFromPreset: "pure",
	legacyPresetFromWithholding: "pure",
	assertValidTin: "pure",
	assertValidRcNumber: "pure",
	normalizeNigeriaPhone: "pure",
	formatInvoiceNumber: "pure",
	// payments.ts
	getPaymentCapabilities: "pure",
	roundMoney: "pure",
	invoiceAmount: "pure",
	derivedPaymentStatus: "pure",
	// pure computation over an invoice state object; no query at all
	getInvoicePaymentSnapshot: "pure",
	payableInvoiceIssue: "pure",
	applyPaymentToSnapshot: "pure",
	canReuseCollectionSession: "pure",
	collectionAmountForInvoice: "pure",
	publicCharge: "pure",
	toPaymentCharge: "pure",
	recordPayment: "app-scoped",
	listInvoicePayments: "app-scoped",
	invoiceByToken: "public-token",
	getPublicPaymentContext: "public-token",
	// only caller is public-invoice-repository, which resolves the invoice
	// from a bearer token through the service-role RPC first
	getPublicPaymentContextForInvoice: "public-token",
	listPublicInvoicePayments: "public-token",
	listPublicInvoicePaymentsForInvoice: "public-token",
	rawRowToInvoiceState: "pure",
	// paystack-server.ts
	ensurePaystackTransferCharge: "server-admin",
	confirmPaystackWebhookPayment: "server-admin",
	// product-intelligence.ts
	buildProductIntelligence: "pure",
	buildProductSuggestions: "pure",
	// products.ts
	listProducts: "app-scoped",
	getProductById: "app-scoped",
	searchProducts: "app-scoped",
	getProductAnalytics: "app-scoped",
	createProduct: "app-scoped",
	updateProduct: "app-scoped",
	archiveProduct: "app-scoped",
	duplicateProduct: "app-scoped",
	// recurring.ts
	listSchedules: "app-scoped",
	createSchedule: "app-scoped",
	updateSchedule: "app-scoped",
	deleteSchedule: "app-scoped",
	setScheduleStatus: "app-scoped",
	// reminders.ts
	defaultRule: "pure",
	// currentRule() reads reminder_rules with no WHERE clause: the ONLY gate
	// is RLS on the caller's own JWT client (owner-scoped table). Not safe
	// against a no-RLS client, which is why they are deliberately not
	// exercised by the no-RLS fake in tenant-isolation.test.ts.
	getReminderSettings: "rls-only",
	saveReminderSettings: "rls-only",
	getCollectionOverview: "app-scoped",
	getInvoiceTimeline: "app-scoped",
	pauseInvoiceReminders: "app-scoped",
	resumeInvoiceReminders: "app-scoped",
	markManualException: "app-scoped",
	queueReminderEvent: "app-scoped",
	markReminderEventStatus: "rls-only",
	// resolves the caller's active workspace, then filters invoices by it
	runReminderBatch: "app-scoped",
	// resolves the caller's active workspace and filters events by owner_id
	sendQueuedEmails: "app-scoped",
	// reports.ts
	getRevenueCashFlow: "app-scoped",
	// revenue-reporting.ts
	buildRevenueCashFlowReport: "pure",
	// token-encryption.ts
	encryptToken: "server-admin",
	decryptToken: "server-admin",
	isEncryptedToken: "pure",
	encryptSensitiveFields: "server-admin",
	decryptSensitiveFields: "server-admin",
	// workspaces.ts
	normalizeWorkspaceName: "pure",
	getInvoiceWorkspaceSettings: "app-scoped",
	resolveActiveWorkspaceId: "session",
	listWorkspaces: "app-scoped",
	setActiveWorkspace: "session",
	// invoice-repository.ts (src/server — third query surface)
	// identity client is minted from the verified request session
	getInvoiceUserContext: "session",
	// thin wrapper over data/invoices.getById(sessionClient, sessionUser, id)
	getAuthenticatedInvoiceById: "app-scoped",
	// thin wrapper over data/invoices.recordDeliveryEvent(sessionClient,
	// sessionUser, …); the scoping inside the wrapper target is probed by
	// tenant-isolation.test.ts, the route consumes this seam
	// (src/routes/api/-tenant-isolation.test.ts)
	recordInvoiceDeliveryEvent: "app-scoped",
	// public-invoice-repository.ts (src/server — third query surface)
	// Admin client, but every read resolves the invoice through the
	// token-scoped `public_invoice_by_token` RPC first: no tenant id is ever
	// supplied by the caller. `public-invoice-repository.test.ts` proves the
	// RPC-only lookup never touches a table directly and drops private
	// fields; the payment sub-reads are the classified `public-token`
	// functions in data/payments.ts above; route behavior for
	// GET /api/invoice/public/$token and /invoice/download/$id is probed by
	// the route suite.
	getPublicInvoicePage: "public-token",
	getInvoiceByToken: "public-token",
	// Admin client UPDATE on invoices: the target id comes from the RPC result
	// for the caller's own share token, never from input, so the write stays
	// on that one invoice.
	recordPublicInvoiceView: "public-token",
};

const DATA_DIR = join(import.meta.dirname);

/**
 * Third query surface: these two `src/server/*.ts` repositories issue their
 * own queries (session-minted client and Supabase admin client) outside
 * `src/server/data/`, so they are enumerated alongside the data layer.
 */
const SERVER_REPOSITORIES = [
	"invoice-repository.ts",
	"public-invoice-repository.ts",
];

type GuardedModule = { label: string; path: string };

function guardedModules(): GuardedModule[] {
	const dataModules = readdirSync(DATA_DIR)
		.filter(
			(file) =>
				file.endsWith(".ts") &&
				!file.includes(".test.") &&
				!file.startsWith("testing"),
		)
		.sort()
		.map((file) => ({
			label: `src/server/data/${file}`,
			path: join(DATA_DIR, file),
		}));
	const serverModules = SERVER_REPOSITORIES.map((file) => ({
		label: `src/server/${file}`,
		path: join(DATA_DIR, "..", file),
	}));
	return [...dataModules, ...serverModules];
}

type ExportScan = {
	/** Exports resolved to a concrete runtime name; each must be classified. */
	names: string[];
	/** Export forms the scanner cannot resolve to a name; each fails. */
	opaque: string[];
};

/**
 * Form-independent export scanner. Resolves every runtime export shape to a
 * name — indented declarations, named list exports (single or multiline,
 * with or without `from`), and `export * as ns` — and reports any export
 * shape it cannot resolve (`export * from`, `export default`, destructuring,
 * unknown syntax) as `opaque` so a new export form fails the guard instead
 * of slipping past it. `export type` / `export interface` are skipped: they
 * are erased at runtime and carry no query surface.
 */
function scanExports(source: string): ExportScan {
	const names = new Set<string>();
	const opaque: string[] = [];
	const lines = source.split(/\r?\n/);

	const addNamedList = (chunk: string) => {
		const open = chunk.indexOf("{");
		const close = chunk.lastIndexOf("}");
		if (open === -1 || close <= open) {
			opaque.push(chunk.trim());
			return;
		}
		for (const part of chunk.slice(open + 1, close).split(",")) {
			const item = part.trim();
			if (!item || item.startsWith("type ")) continue; // inline type export
			const renamed = /^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/.exec(item);
			names.add(renamed ? renamed[2] : item);
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!/^[ \t]*export\b/.test(line)) continue;
		const rest = line.replace(/^[ \t]*export/, "");
		// compile-time only — no runtime binding, no query surface
		if (/^\s*(?:declare\s+)?(?:type|interface)\b/.test(rest)) continue;
		// named list export, possibly spread over several lines
		if (/^\s*\{/.test(rest)) {
			let chunk = rest;
			while (!/}/.test(chunk) && i + 1 < lines.length) {
				i += 1;
				chunk += ` ${lines[i]}`;
			}
			addNamedList(chunk);
			continue;
		}
		// `export * as ns from …` names its namespace; bare `export * from`
		// re-exports an unenumerable set and must be expanded by the author.
		if (/^\s*\*/.test(rest)) {
			const namespaced = /^\s*\*\s+as\s+([A-Za-z0-9_$]+)/.exec(rest);
			if (namespaced) names.add(namespaced[1]);
			else opaque.push(line.trim());
			continue;
		}
		const declaration =
			/^\s*(?:default\s+|abstract\s+)?(?:async\s+)?(?:function\s*\*?\s*|class\s+|const\s+|let\s+|var\s+)([A-Za-z0-9_$]+)/.exec(
				rest,
			);
		if (declaration && !/^\s*default\b/.test(rest)) {
			names.add(declaration[1]);
			continue;
		}
		// `export default …`, `export const { a } = …`, or anything else the
		// scanner does not recognise: fail loudly rather than ignore it.
		opaque.push(line.trim());
	}

	return { names: [...names], opaque };
}

describe("tenant isolation coverage guard", () => {
	it("classifies every data-layer and server-repository export", () => {
		const unclassified: string[] = [];
		const opaque: string[] = [];
		const stale = new Set(Object.keys(CLASSIFICATIONS));
		for (const mod of guardedModules()) {
			const source = readFileSync(mod.path, "utf8");
			const scan = scanExports(source);
			for (const name of scan.names) {
				stale.delete(name);
				if (!(name in CLASSIFICATIONS))
					unclassified.push(`${mod.label}:${name}`);
			}
			opaque.push(...scan.opaque.map((entry) => `${mod.label}: ${entry}`));
		}
		expect(
			unclassified,
			`Unclassified data-layer exports — add each to CLASSIFICATIONS ` +
				`with its isolation mechanism (app-scoped / rls-only / public-token / ` +
				`pure / server-admin / session):\n${unclassified.join("\n")}`,
		).toEqual([]);
		expect(
			opaque,
			`Export forms the coverage guard cannot resolve to a name — expand ` +
				`them (or classify the resolved names) so no export can evade the ` +
				`classification guard:\n${opaque.join("\n")}`,
		).toEqual([]);
		expect(
			[...stale],
			"CLASSIFICATIONS lists exports that no longer exist — remove them.",
		).toEqual([]);
	});
});

const API_DIR = join(import.meta.dirname, "..", "..", "routes", "api");

/**
 * The same guarantee for HTTP surfaces: every handler under
 * `src/routes/api/**` must state where its identity comes from (verified
 * session, public token, server secret) so a new route cannot ship without
 * one. Cross-tenant behavioral probes for the id/token-bearing routes live
 * in `src/routes/api/-tenant-isolation.test.ts`.
 */
const ROUTE_CLASSIFICATIONS: Record<string, Classification> = {
	"auth/$.ts": "session",
	"auth/$first/$second.ts": "session",
	"auth/supabase-session.ts": "session",
	"email/resend/webhook.ts": "server-admin",
	"integrations/quickbooks/callback.ts": "session",
	"integrations/quickbooks/connect.ts": "session",
	"integrations/xero/callback.ts": "session",
	"integrations/xero/connect.ts": "session",
	// identity + active workspace derived from the session; body is untrusted
	"invoice/audit.ts": "session",
	// `$id` is the public share token, not a row id
	"invoice/download/$id.ts": "public-token",
	"invoice/public/$token.ts": "public-token",
	"invoice/scheduled.ts": "server-admin",
	// invoice read goes through getById(session client, session user, id)
	"invoice/send/$id.ts": "session",
	// Private submission endpoint; identity comes from the verified request session.
	"invoice/submission/$id.ts": "session",
	"invoice/submissions/scheduled.ts": "server-admin",
	"payments/paystack/initialize.ts": "public-token",
	"payments/paystack/webhook.ts": "server-admin",
	"reminders/send-queue.ts": "session",
	"security/link-stepup/request.ts": "session",
	"security/link-stepup/status.ts": "session",
	"security/link-stepup/verify.ts": "session",
	"test/fixtures.ts": "test-only",
};

function routeFiles(dir: string, prefix = ""): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			found.push(...routeFiles(join(dir, entry.name), relative));
		} else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
			found.push(relative);
		}
	}
	return found.sort();
}

describe("tenant isolation coverage guard — API routes", () => {
	it("classifies every API route handler", () => {
		const files = routeFiles(API_DIR);
		const unclassified = files.filter(
			(file) => !(file in ROUTE_CLASSIFICATIONS),
		);
		const stale = Object.keys(ROUTE_CLASSIFICATIONS).filter(
			(file) => !files.includes(file),
		);
		expect(
			unclassified,
			`Unclassified API routes — add each to ROUTE_CLASSIFICATIONS with ` +
				`its identity source (session / public-token / server-admin / ` +
				`test-only):\n${unclassified.join("\n")}`,
		).toEqual([]);
		expect(
			stale,
			"ROUTE_CLASSIFICATIONS lists route files that no longer exist.",
		).toEqual([]);
	});
});
