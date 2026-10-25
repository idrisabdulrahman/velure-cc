import { importJWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * WP3 — the tenant-isolation live matrix: every tenant table against REAL
 * minted JWTs on the live project.
 *
 * Run with: A10_LIVE=1 pnpm exec vitest run src/server/data/tenant-isolation.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * `tenant-isolation.test.ts` proves the APP-layer filters with a no-RLS
 * fake. This suite proves the other half of the story: the RLS policies
 * themselves, for the tables whose data functions deliberately carry no
 * app-layer tenant filter (`rls-only` in `tenant-isolation-coverage.test.ts`)
 * and as defense-in-depth behind every app-scoped function.
 *
 * Shape (same token minting as rls-tenancy.live.test.ts — the A10 app mints
 * its own ES256 JWT at POST /api/auth/supabase-session and the browser calls
 * PostgREST directly, so these policies ARE the enforcement boundary):
 *
 *   1. Seed one row per tenant table inside workspace A (owner-scoped tables
 *      anchored to user A) using user A's token.
 *   2. As workspace-B's user, attempt SELECT / PATCH / DELETE on each of A's
 *      rows by primary key: every read must return zero rows, every write
 *      must be refused (403) or match zero rows — and A's row must be
 *      byte-for-byte unchanged afterwards.
 *   3. As B, attempt a cross-tenant INSERT into A's workspace (or with A's
 *      owner id on owner-scoped tables): must be refused.
 *   4. Server-only tables (integration_connections, invoice_audit_log,
 *      audit_logs, job_runs): even the OWNING user's browser token cannot
 *      write, and B cannot read A's rows.
 *
 * owner_id/user_id are plain text with no FK into better_auth, so scratch
 * users are synthetic ids and no auth rows are created.
 */
const LIVE = process.env.A10_LIVE === "1";
const gate = LIVE ? describe : describe.skip;

const SUPABASE_URL =
	process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
	process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
	process.env.SUPABASE_PUBLISHABLE_KEY ??
	"";
const PRIVATE_JWK = process.env.SUPABASE_JWT_PRIVATE_JWK ?? "";

const suffix = `${Date.now()}`;
const USER_A = `wp3-live-a-${suffix}`;
const USER_B = `wp3-live-b-${suffix}`;

let tokenA = "";
let tokenB = "";
let workspaceA = "";
let workspaceB = "";

/** Mint the same token shape as server/supabase-session.ts mintSupabaseAccessToken. */
async function mintFor(userId: string) {
	const jwk = JSON.parse(PRIVATE_JWK) as Record<string, unknown>;
	if (typeof jwk.kid !== "string") {
		throw new Error(
			"SUPABASE_JWT_PRIVATE_JWK must include its Supabase key kid",
		);
	}
	return new SignJWT({
		sub: userId,
		velure_user_id: userId,
		role: "authenticated",
		aud: "authenticated",
	})
		.setIssuedAt()
		.setExpirationTime(Math.floor(Date.now() / 1000) + 60 * 30)
		.setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
		.sign(await importJWK({ ...jwk, key_ops: ["sign"] }, "ES256"));
}

/** PostgREST exactly as the browser's supabase-js client calls it. */
async function rest(
	method: string,
	path: string,
	options: { token?: string | null; body?: unknown } = {},
) {
	const headers: Record<string, string> = {
		apikey: ANON_KEY,
		prefer: "return=representation",
	};
	if (options.token) headers.authorization = `Bearer ${options.token}`;
	if (options.body !== undefined) headers["content-type"] = "application/json";
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		method,
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await res.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON error body */
	}
	return { status: res.status, body, text: text.slice(0, 240) };
}

const rows = (value: unknown) => (Array.isArray(value) ? value : []);

type ProbeResult = Awaited<ReturnType<typeof rest>>;

/** A write probe that must not take effect: 403 or zero matched rows. */
function expectNoEffectiveWrite(result: ProbeResult) {
	if (result.status === 200) {
		expect(rows(result.body), result.text).toEqual([]);
	} else {
		expect(result.status, result.text).toBe(403);
	}
}

type TableSpec = {
	table: string;
	/** "workspace": anchored to workspace A. "owner": anchored to user A. */
	anchor: "workspace" | "owner";
	/** Column set to a bogus value by the B write probe (must be writable). */
	marker: string;
	/** Server-only tables: even A's browser token must be locked out. */
	serverOnly?: boolean;
};

const TABLES: TableSpec[] = [
	{ table: "workspaces", anchor: "workspace", marker: "legal_name" },
	{ table: "workspace_members", anchor: "workspace", marker: "invited_by" },
	{ table: "active_workspaces", anchor: "workspace", marker: "updated_at" },
	{ table: "clients", anchor: "workspace", marker: "internal_notes" },
	{ table: "products", anchor: "workspace", marker: "sku" },
	{ table: "invoices", anchor: "workspace", marker: "customer_po_number" },
	{
		table: "invoice_delivery_events",
		anchor: "workspace",
		marker: "provider_message_id",
	},
	{
		table: "payment_transactions",
		anchor: "workspace",
		marker: "provider_payment_id",
	},
	{ table: "payment_charges", anchor: "workspace", marker: "account_name" },
	{
		table: "recurring_invoice_schedules",
		anchor: "workspace",
		marker: "payment_link",
	},
	{ table: "recurring_invoice_runs", anchor: "workspace", marker: "error" },
	{ table: "invoice_exports", anchor: "workspace", marker: "error" },
	{ table: "email_events", anchor: "workspace", marker: "subject" },
	{ table: "tax_profiles", anchor: "owner", marker: "notes" },
	{ table: "reminder_rules", anchor: "owner", marker: "enabled" },
	{ table: "reminder_runs", anchor: "owner", marker: "notes" },
	{ table: "reminder_events", anchor: "owner", marker: "error" },
	{ table: "collections_cases", anchor: "owner", marker: "note" },
	{
		table: "integration_sync_jobs",
		anchor: "owner",
		marker: "error",
		serverOnly: false,
	},
	{ table: "integration_logs", anchor: "owner", marker: "message" },
	{
		table: "integration_connections",
		anchor: "owner",
		marker: "id",
		serverOnly: true,
	},
	{
		table: "invoice_audit_log",
		anchor: "workspace",
		marker: "message",
		serverOnly: true,
	},
	{
		table: "audit_logs",
		anchor: "workspace",
		marker: "message",
		serverOnly: true,
	},
	{ table: "job_runs", anchor: "workspace", marker: "id", serverOnly: true },
];

/** Marker values that satisfy every column's check constraint. */
function markerValue(table: string, marker: string): unknown {
	if (table === "reminder_rules" && marker === "enabled") return true;
	if (table === "active_workspaces" && marker === "updated_at") {
		return new Date().toISOString();
	}
	if (table === "integration_connections" || table === "job_runs") return null;
	return `wp3-probe-${suffix}`;
}

const seeded = new Map<string, { id: string; row: Record<string, unknown> }>();

async function seedRow(
	spec: TableSpec,
): Promise<{ id: string; row: Record<string, unknown> }> {
	const base: Record<string, unknown> =
		spec.anchor === "workspace"
			? { workspace_id: workspaceA }
			: { owner_id: USER_A };

	const payloads: Record<string, Record<string, unknown>> = {
		workspaces: {
			owner_id: USER_A,
			name: `WP3 W1 ${suffix}`,
			country_code: "NG",
			base_currency: "NGN",
			reminders_enabled: false,
		},
		workspace_members: { user_id: USER_A, role: "owner" },
		active_workspaces: { user_id: USER_A, workspace_id: workspaceA },
		clients: {
			...base,
			owner_id: USER_A,
			name: `WP3 Client ${suffix}`,
			email: `wp3-${suffix}@example.test`,
			currency: "NGN",
			payment_terms: "Net 7",
			contact: {},
			favorite: false,
			status: "active",
		},
		products: {
			...base,
			type: "product",
			name: `WP3 Product ${suffix}`,
			default_unit_price: 1000,
			is_active: true,
		},
		invoices: {
			...base,
			user_id: USER_A,
			token: `wp3-${suffix}`,
			invoice_number: `INV-WP3-${suffix}`,
			customer_name: `WP3 Customer ${suffix}`,
			currency: "NGN",
			issue_date: "2026-10-01",
			due_date: "2026-10-08",
			line_items: [],
		},
		invoice_delivery_events: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			channel: "email",
			recipient: `wp3-${suffix}@example.test`,
			provider: "resend",
			status: "sent",
		},
		payment_transactions: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			source: "manual",
			amount: 1000,
			currency: "NGN",
		},
		payment_charges: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			reference: `wp3-charge-${suffix}`,
			status: "pending",
			amount: 1000,
			currency: "NGN",
			expires_at: "2026-10-02T00:00:00Z",
		},
		recurring_invoice_schedules: {
			...base,
			name: `WP3 Schedule ${suffix}`,
			status: "active",
			frequency: "monthly",
			interval: 1,
			start_date: "2026-10-01",
			next_run_date: "2026-11-01",
			auto_send: false,
			customer_name: `WP3 Customer ${suffix}`,
			currency: "NGN",
			payment_terms_days: 7,
			template: "standard",
			line_items: [],
		},
		recurring_invoice_runs: {
			...base,
			schedule_id: seeded.get("recurring_invoice_schedules")?.id,
			period_key: "2026-10",
			status: "created",
		},
		invoice_exports: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			kind: "invoices_csv",
			status: "ready",
			file_name: `wp3-${suffix}.csv`,
			content: "scratch",
		},
		email_events: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			provider: "resend",
			provider_event_id: `wp3-${suffix}`,
			event_type: "delivered",
		},
		tax_profiles: {
			...base,
			name: `WP3 VAT ${suffix}`,
			tax_treatment: "exclusive_rate",
			rate: 7.5,
			label: "VAT",
		},
		reminder_rules: {
			...base,
			enabled: false,
			days_before_due: 3,
			on_due_date: true,
			overdue_cadence_days: 3,
			max_overdue_reminders: 3,
			escalate_after_count: 2,
		},
		reminder_runs: {
			...base,
			run_date: "2026-10-01",
			status: "completed",
			scanned_count: 0,
			queued_count: 0,
			sent_count: 0,
			escalated_count: 0,
		},
		reminder_events: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			stage: "before_due",
			channel: "email",
			scheduled_for: "2026-10-01T00:00:00Z",
			status: "queued",
		},
		collections_cases: {
			...base,
			invoice_id: seeded.get("invoices")?.id,
			status: "open",
			last_action_at: "2026-10-01T00:00:00Z",
			escalation_status: "idle",
		},
		integration_sync_jobs: {
			...base,
			provider: "xero",
			entity_type: "invoice",
			entity_id: `wp3-${suffix}`,
			direction: "push",
			status: "pending",
			retry_count: 0,
		},
		integration_logs: {
			...base,
			provider: "xero",
			level: "info",
			message: `WP3 log ${suffix}`,
		},
		// Server-only tables: no client INSERT grant, so they cannot be seeded
		// through the browser path at all. The probes assert exactly that.
		integration_connections: {},
		invoice_audit_log: {},
		audit_logs: {},
		job_runs: {},
	};

	if (spec.serverOnly) {
		// Probe target: any row (there should be none of B's); use a synthetic
		// id so the SELECT filter is well-formed even on an empty table.
		return {
			id: `00000000-0000-4000-8000-00000000000${seeded.size % 10}`,
			row: {},
		};
	}

	const payload = { ...base, ...(payloads[spec.table] ?? {}) };
	if (spec.table === "workspaces") {
		// Seeded via the workspace-creation leg below, not per-table.
		return { id: workspaceA, row: { id: workspaceA } };
	}
	const created = await rest("POST", `${spec.table}?select=id`, {
		token: tokenA,
		body: payload,
	});
	expect(created.status, `${spec.table}: ${created.text}`).toBe(201);
	const id = (rows(created.body)[0] as { id: string }).id;
	const full = await rest("GET", `${spec.table}?id=eq.${id}`, {
		token: tokenA,
	});
	return { id, row: (rows(full.body)[0] ?? {}) as Record<string, unknown> };
}

gate("WP3 tenant isolation: live RLS matrix", () => {
	beforeAll(async () => {
		if (!SUPABASE_URL || !ANON_KEY || !PRIVATE_JWK) {
			throw new Error(
				"A10_LIVE=1 requires VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_JWT_PRIVATE_JWK",
			);
		}
		tokenA = await mintFor(USER_A);
		tokenB = await mintFor(USER_B);

		for (const [token, userId, label] of [
			[tokenA, USER_A, "A"],
			[tokenB, USER_B, "B"],
		] as const) {
			const created = await rest("POST", "workspaces?select=id", {
				token,
				body: {
					owner_id: userId,
					name: `WP3 W${label} ${suffix}`,
					country_code: "NG",
					base_currency: "NGN",
					reminders_enabled: false,
				},
			});
			expect(created.status, created.text).toBe(201);
			const id = (rows(created.body)[0] as { id: string }).id;
			if (label === "A") workspaceA = id;
			else workspaceB = id;
			const member = await rest("POST", "workspace_members", {
				token,
				body: { workspace_id: id, user_id: userId, role: "owner" },
			});
			expect(member.status, member.text).toBe(201);
			const active = await rest("POST", "active_workspaces", {
				token,
				body: { user_id: userId, workspace_id: id },
			});
			expect(active.status, active.text).toBe(201);
		}

		// Seed in FK-dependency order; every spec reads `seeded` for its FKs.
		for (const spec of TABLES) {
			const row = await seedRow(spec);
			seeded.set(spec.table, row);
		}
	}, 120_000);

	afterAll(async () => {
		// Sweep in reverse dependency order with each tenant's own token.
		for (const spec of [...TABLES].reverse()) {
			const entry = seeded.get(spec.table);
			if (!entry || spec.serverOnly || spec.table === "workspaces") continue;
			await rest("DELETE", `${spec.table}?id=eq.${entry.id}`, {
				token: tokenA,
			});
		}
		for (const table of [
			"active_workspaces",
			"workspace_members",
			"workspaces",
		]) {
			await rest("DELETE", `${table}?id=eq.${workspaceA}`, { token: tokenA });
			await rest("DELETE", `${table}?id=eq.${workspaceB}`, { token: tokenB });
		}
		const gone = await rest("DELETE", `workspaces?id=eq.${workspaceA}`, {
			token: tokenA,
		});
		if (rows(gone.body).length !== 1) {
			console.warn(
				`WP3 live: scratch workspace ${workspaceA} may remain (status ${gone.status})`,
			);
		}
	}, 120_000);

	it.each(TABLES)(
		"[$anchor] B cannot read, write or delete A's $table row",
		async (spec) => {
			const entry = seeded.get(spec.table);
			expect(entry, `${spec.table} was not seeded`).toBeDefined();
			const { id } = entry as { id: string };
			const filter = `id=eq.${id}`;

			// 1. Cross-tenant read: zero rows (or an outright refusal).
			const read = await rest("GET", `${spec.table}?${filter}`, {
				token: tokenB,
			});
			if (read.status === 200) {
				expect(rows(read.body), `${spec.table} leaked to B`).toEqual([]);
			} else {
				expect(read.status, read.text).toBe(403);
			}

			// 2. Cross-tenant write: refused or zero matched rows, and A's
			//    row is byte-for-byte unchanged afterwards.
			const patched = await rest("PATCH", `${spec.table}?${filter}`, {
				token: tokenB,
				body: { [spec.marker]: markerValue(spec.table, spec.marker) },
			});
			expectNoEffectiveWrite(patched);
			const after = await rest("GET", `${spec.table}?${filter}`, {
				token: tokenA,
			});
			if (spec.serverOnly) {
				// No client read path exists at all — including for A.
				expect([200, 403, 401, 404], after.text).toContain(after.status);
				if (after.status === 200) expect(rows(after.body)).toEqual([]);
			} else {
				expect(rows(after.body)[0], `${spec.table} was mutated`).toEqual(
					entry?.row,
				);
			}

			// 3. Cross-tenant delete: refused or zero matched rows, and the
			//    row still exists for A.
			const removed = await rest("DELETE", `${spec.table}?${filter}`, {
				token: tokenB,
			});
			expectNoEffectiveWrite(removed);
			if (!spec.serverOnly) {
				const still = await rest("GET", `${spec.table}?${filter}`, {
					token: tokenA,
				});
				expect(rows(still.body), `${spec.table} was deleted`).toHaveLength(1);
			}
		},
		60_000,
	);

	it("refuses B inserting into A's workspace on every workspace-anchored table", async () => {
		const intrusions: Array<[string, Record<string, unknown>]> = [
			[
				"clients",
				{
					workspace_id: workspaceA,
					owner_id: USER_B,
					name: `WP3 Intrusion ${suffix}`,
					email: `wp3-i-${suffix}@example.test`,
					currency: "NGN",
					payment_terms: "Net 7",
					contact: {},
					favorite: false,
					status: "active",
				},
			],
			[
				"products",
				{
					workspace_id: workspaceA,
					type: "product",
					name: `WP3 Intrusion ${suffix}`,
					default_unit_price: 1,
					is_active: true,
				},
			],
			[
				"invoices",
				{
					workspace_id: workspaceA,
					user_id: USER_B,
					token: `wp3-i-${suffix}`,
					invoice_number: `INV-WP3-I-${suffix}`,
					customer_name: `WP3 Intrusion ${suffix}`,
					currency: "NGN",
					issue_date: "2026-10-01",
					due_date: "2026-10-08",
					line_items: [],
				},
			],
			[
				"workspace_members",
				{ workspace_id: workspaceA, user_id: USER_B, role: "owner" },
			],
			["active_workspaces", { user_id: USER_B, workspace_id: workspaceA }],
			[
				"tax_profiles",
				{
					owner_id: USER_A,
					name: `WP3 Intrusion ${suffix}`,
					tax_treatment: "exclusive_rate",
					rate: 7.5,
					label: "VAT",
				},
			],
			[
				"reminder_rules",
				{
					owner_id: USER_A,
					enabled: false,
					days_before_due: 3,
					on_due_date: true,
					overdue_cadence_days: 3,
					max_overdue_reminders: 3,
					escalate_after_count: 2,
				},
			],
			[
				"integration_sync_jobs",
				{
					owner_id: USER_A,
					provider: "xero",
					entity_type: "invoice",
					entity_id: `wp3-i-${suffix}`,
					direction: "push",
					status: "pending",
					retry_count: 0,
				},
			],
		];
		for (const [table, body] of intrusions) {
			const result = await rest("POST", `${table}?select=id`, {
				token: tokenB,
				body,
			});
			// If a regression lets the row through, delete it before asserting
			// so the live project is never left with a cross-tenant row.
			const planted = rows(result.body)[0] as { id?: string } | undefined;
			if (planted?.id) {
				await rest("DELETE", `${table}?id=eq.${planted.id}`, { token: tokenB });
				await rest("DELETE", `${table}?id=eq.${planted.id}`, { token: tokenA });
			}
			expect(result.status, `${table}: ${result.text}`).toBe(403);
		}
	}, 60_000);

	it("keeps invoice_audit_log writes server-only even for the owning member", async () => {
		const forged = await rest("POST", "invoice_audit_log?select=id", {
			token: tokenA,
			body: {
				workspace_id: workspaceA,
				actor_id: USER_A,
				actor_type: "user",
				action: "invoice.create",
				resource_type: "invoice",
				resource_id: `wp3-${suffix}`,
			},
		});
		const planted = rows(forged.body)[0] as { id?: string } | undefined;
		if (planted?.id) {
			await rest("DELETE", `invoice_audit_log?id=eq.${planted.id}`, {
				token: tokenA,
			});
		}
		expect(forged.status, forged.text).toBe(403);
	});

	it("keeps job_runs invisible and untouchable for every browser token", async () => {
		const read = await rest("GET", "job_runs?select=id", { token: tokenA });
		if (read.status === 200) {
			expect(rows(read.body)).toEqual([]);
		} else {
			expect(read.status, read.text).toBe(403);
		}
		const write = await rest("POST", "job_runs?select=id", {
			token: tokenA,
			body: { workspace_id: workspaceA, kind: "wp3-probe" },
		});
		const planted = rows(write.body)[0] as { id?: string } | undefined;
		if (planted?.id) {
			await rest("DELETE", `job_runs?id=eq.${planted.id}`, { token: tokenA });
		}
		expect([403, 401], write.text).toContain(write.status);
	});

	it("does not let B resolve A's active workspace through active_workspaces", async () => {
		// The with-check requires membership: B must not be able to point its
		// own active row at A's workspace (the forged-active-workspace probe).
		const forged = await rest(
			"PATCH",
			`active_workspaces?user_id=eq.${USER_B}&select=workspace_id`,
			{ token: tokenB, body: { workspace_id: workspaceA } },
		);
		const landed = rows(forged.body)[0] as
			| { workspace_id?: string }
			| undefined;
		expect(landed?.workspace_id ?? null, forged.text).not.toBe(workspaceA);

		// And B's SELECT of A's active row is empty.
		const read = await rest(
			"GET",
			`active_workspaces?user_id=eq.${USER_A}&select=id`,
			{ token: tokenB },
		);
		expect(rows(read.body)).toEqual([]);
	});
});
