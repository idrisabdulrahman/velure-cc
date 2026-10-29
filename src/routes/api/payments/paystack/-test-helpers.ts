import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

/**
 * Shared helpers for the Paystack webhook tests.
 *
 * The DB-backed suite runs only when `PAYSTACK_DB_LIVE=1` (loaded from the
 * gitignored `.env.test`) AND the configured Supabase/Postgres URL is a local
 * host. It refuses to run against anything that is not a disposable local
 * stack. `PAYSTACK_TEST_SECRET_KEY` must be a test-mode key (`sk_test_`).
 */

export type PaystackTestConfig = {
	paystackSecret: string;
	supabaseUrl: string;
	serviceRoleKey: string;
	databaseUrl: string;
};

export function signPaystackBody(rawBody: string, secret: string): string {
	return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export function buildChargeSuccessEvent(opts: {
	reference: string;
	amountKobo: number;
	currency?: string;
	id?: number;
	status?: string;
	email?: string;
	event?: string;
	metadata?: Record<string, unknown>;
}) {
	return {
		event: opts.event ?? "charge.success",
		data: {
			id: opts.id ?? Math.floor(Math.random() * 1e9),
			status: opts.status ?? "success",
			reference: opts.reference,
			amount: opts.amountKobo,
			currency: opts.currency ?? "NGN",
			paid_at: new Date().toISOString(),
			customer: { email: opts.email ?? "test@example.com" },
			metadata: opts.metadata ?? {},
		},
	};
}

function loadEnvFile() {
	try {
		process.loadEnvFile(new URL("../../../../../.env.test", import.meta.url));
	} catch {
		// No .env.test on disk: the DB suite stays disabled.
	}
}

/**
 * Returns the local test configuration, or `null` when the DB suite is not
 * enabled. Throws when the suite IS enabled but the environment is unsafe.
 */
export function paystackTestConfig(): PaystackTestConfig | null {
	loadEnvFile();
	if (process.env.PAYSTACK_DB_LIVE !== "1") return null;

	const paystackSecret = process.env.PAYSTACK_TEST_SECRET_KEY;
	if (!paystackSecret || !paystackSecret.startsWith("sk_test_")) {
		throw new Error(
			"Refusing to run: PAYSTACK_TEST_SECRET_KEY missing or not a test key",
		);
	}

	const supabaseUrl = process.env.PAYSTACK_TEST_SUPABASE_URL;
	const serviceRoleKey = process.env.PAYSTACK_TEST_SERVICE_ROLE_KEY;
	const databaseUrl = process.env.PAYSTACK_TEST_DATABASE_URL;
	if (!supabaseUrl || !serviceRoleKey || !databaseUrl) {
		throw new Error(
			"Refusing to run: PAYSTACK_TEST_SUPABASE_URL / PAYSTACK_TEST_SERVICE_ROLE_KEY / PAYSTACK_TEST_DATABASE_URL missing",
		);
	}

	for (const [label, value] of [
		["supabase", supabaseUrl],
		["database", databaseUrl],
	] as const) {
		const host = new URL(value).hostname;
		if (host !== "127.0.0.1" && host !== "localhost") {
			throw new Error(
				`Refusing to run ${label} tests against a non-local host: ${host}`,
			);
		}
	}

	// The webhook route reads PAYSTACK_SECRET_KEY; the admin client reads
	// VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Point all of them at the
	// local test stack before the first call.
	process.env.PAYSTACK_SECRET_KEY = paystackSecret;
	process.env.VITE_SUPABASE_URL = supabaseUrl;
	process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

	return { paystackSecret, supabaseUrl, serviceRoleKey, databaseUrl };
}

export type TestPool = {
	query: (
		text: string,
		values?: unknown[],
	) => Promise<{ rows: Record<string, unknown>[] }>;
	end: () => Promise<void>;
};

export function createTestPool(connectionString: string): TestPool {
	const require = createRequire(import.meta.url);
	const { Pool } = require("pg") as {
		Pool: new (cfg: { connectionString: string; max?: number }) => TestPool;
	};
	return new Pool({ connectionString, max: 5 });
}

export type InvoiceFixture = {
	workspaceId: string;
	invoiceId: string;
	token: string;
	reference: string;
	amountNaira: number;
};

const rand = () => Math.random().toString(36).slice(2, 10);

export async function createInvoiceFixture(
	pool: TestPool,
	opts: {
		amountNaira: number;
		currency?: string;
		chargeAmountNaira?: number;
		status?: string;
		canceled?: boolean;
		paymentAmountNaira?: number;
		chargeStatus?: string;
		withCustomer?: boolean;
		customerEmail?: string;
		skipCharge?: boolean;
	} = { amountNaira: 1500 },
): Promise<InvoiceFixture> {
	const suffix = `test_${Date.now()}_${rand()}`;
	const token = `tok_${suffix}`;
	const reference = `ref_${suffix}`;
	const currency = opts.currency ?? "NGN";
	const chargeAmount = opts.chargeAmountNaira ?? opts.amountNaira;
	const status = opts.status ?? "unpaid";

	const ws = await pool.query(
		`insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled)
     values ($1, $2, 'NG', 'NGN', false) returning id`,
		[`owner_${suffix}`, `Test ${suffix}`],
	);
	const workspaceId = ws.rows[0]?.id as string;

	let customerId: string | null = null;
	if (opts.withCustomer) {
		const client = await pool.query(
			`insert into public.clients
         (workspace_id, name, email, currency, payment_terms, contact, favorite, status)
       values ($1,$2,$3,$4,'net_30','{}'::jsonb,false,'active') returning id`,
			[
				workspaceId,
				`Client ${suffix}`,
				opts.customerEmail ?? `payer_${suffix}@example.com`,
				currency,
			],
		);
		customerId = client.rows[0]?.id as string;
	}

	const inv = await pool.query(
		`insert into public.invoices
       (workspace_id, customer_id, token, invoice_number, customer_name, currency, issue_date, due_date,
        status, line_items, payment_amount, canceled_at)
     values ($1,$2,$3,$4,'Test Customer',$5,current_date,current_date,$6::public.invoice_status,
        $7::jsonb,$8,$9)
     returning id`,
		[
			workspaceId,
			customerId,
			token,
			`INV-${suffix}`,
			currency,
			status,
			JSON.stringify([{ quantity: 1, price: opts.amountNaira }]),
			opts.paymentAmountNaira ?? 0,
			opts.canceled ? new Date().toISOString() : null,
		],
	);
	const invoiceId = inv.rows[0]?.id as string;

	if (!opts.skipCharge) {
		await pool.query(
			`insert into public.payment_charges
       (workspace_id, invoice_id, provider, reference, status, amount, currency, expires_at)
     values ($1,$2,'paystack',$3,$4::public.payment_charge_status,$5,$6, now() + interval '8 hours')`,
			[
				workspaceId,
				invoiceId,
				reference,
				opts.chargeStatus ?? "pending",
				chargeAmount,
				currency,
			],
		);
	}

	return {
		workspaceId,
		invoiceId,
		token,
		reference,
		amountNaira: opts.amountNaira,
	};
}

export async function readInvoice(pool: TestPool, invoiceId: string) {
	const { rows } = await pool.query(
		`select payment_amount, status, payment_reference, paid_at, lifecycle
     from public.invoices where id = $1`,
		[invoiceId],
	);
	return rows[0];
}

export async function listPaymentTransactions(
	pool: TestPool,
	invoiceId: string,
) {
	const { rows } = await pool.query(
		`select reference, amount, currency, provider, event_type, provider_status
     from public.payment_transactions where invoice_id = $1 order by created_at`,
		[invoiceId],
	);
	return rows;
}

export async function readCharge(pool: TestPool, reference: string) {
	const { rows } = await pool.query(
		`select status, provider_message, amount, currency
     from public.payment_charges where reference = $1`,
		[reference],
	);
	return rows[0];
}

export async function listPaymentCharges(pool: TestPool, invoiceId: string) {
	const { rows } = await pool.query(
		`select reference, status, amount, currency from public.payment_charges
     where invoice_id = $1 order by created_at`,
		[invoiceId],
	);
	return rows;
}

/** Backdate a pending charge so reconciliation treats it as a missed webhook. */
export async function expirePendingCharge(
	pool: TestPool,
	invoiceId: string,
	ageInterval = "1 hour",
) {
	await pool.query(
		`update public.payment_charges
       set expires_at = now() - $2::interval
     where invoice_id = $1 and status = 'pending'`,
		[invoiceId, ageInterval],
	);
}

export async function cleanupWorkspaces(pool: TestPool, ids: string[]) {
	if (ids.length === 0) return;
	// `clients.workspace_id` is ON DELETE SET NULL, and the C2 invoice guard
	// blocks nulling `customer_id` on an issued invoice, so capture the client
	// ids first, delete the workspace (cascading its invoices and charges),
	// then remove the now orphaned clients by id.
	const clients = await pool.query(
		`select id from public.clients where workspace_id = any($1::uuid[])`,
		[ids],
	);
	const clientIds = clients.rows.map((row) => row.id as string);
	await pool.query(`delete from public.workspaces where id = any($1::uuid[])`, [
		ids,
	]);
	if (clientIds.length > 0) {
		await pool.query(`delete from public.clients where id = any($1::uuid[])`, [
			clientIds,
		]);
	}
}
