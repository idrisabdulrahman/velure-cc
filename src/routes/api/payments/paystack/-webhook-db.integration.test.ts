import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	buildChargeSuccessEvent,
	cleanupWorkspaces,
	createInvoiceFixture,
	createTestPool,
	listPaymentTransactions,
	paystackTestConfig,
	readCharge,
	readInvoice,
	signPaystackBody,
	type TestPool,
} from "./-test-helpers";
import { handle } from "./webhook";

/**
 * Paystack webhook money-safety suite against a REAL Postgres + PostgREST.
 *
 * Runs only with `PAYSTACK_DB_LIVE=1` and a LOCAL test stack (guard in
 * `-test-helpers`). Exercises the production handler -> confirm RPC -> DB
 * path, including concurrency and rollback. Not part of the default suite.
 */
const config = paystackTestConfig();
const hasDb = config !== null;

let pool: TestPool;
const createdWorkspaces: string[] = [];

async function deliver(body: unknown) {
	const raw = JSON.stringify(body);
	return handle({
		request: new Request("http://localhost/api/payments/paystack/webhook", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-paystack-signature": signPaystackBody(
					raw,
					config?.paystackSecret ?? "",
				),
			},
			body: raw,
		}),
	});
}

async function fixture(opts: Parameters<typeof createInvoiceFixture>[1]) {
	const f = await createInvoiceFixture(pool, opts);
	createdWorkspaces.push(f.workspaceId);
	return f;
}

beforeAll(() => {
	if (hasDb && config) pool = createTestPool(config.databaseUrl);
});

afterEach(async () => {
	if (!hasDb) return;
	await cleanupWorkspaces(pool, createdWorkspaces.splice(0));
});

afterAll(async () => {
	if (hasDb) await pool.end();
});

describe.skipIf(!hasDb)("Paystack webhook against a real test database", () => {
	it("credits a valid event when optional provider id and customer email are absent", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const response = await deliver({
			event: "charge.success",
			data: {
				status: "success",
				reference: f.reference,
				amount: 150000,
				currency: "NGN",
			},
		});
		expect(response.status).toBe(200);
		expect((await readInvoice(pool, f.invoiceId))?.status).toBe("paid");
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
	});
	it.each([
		["invalid signature", 401, "bad"],
		["missing signature", 401, null],
		["tampered body", 401, "tampered"],
		["malformed signed JSON", 400, "malformed"],
		["failed status", 200, "failed"],
		["unhandled event", 200, "ignored"],
	] as const)("preserves DB state for %s", async (_name, status, mode) => {
		const f = await fixture({ amountNaira: 1500 });
		const before = await readInvoice(pool, f.invoiceId);
		const chargeBefore = await readCharge(pool, f.reference);
		const raw =
			mode === "malformed"
				? "{"
				: JSON.stringify(
						buildChargeSuccessEvent({
							reference: f.reference,
							amountKobo: 150000,
							status: mode === "failed" ? "failed" : "success",
							event: mode === "ignored" ? "transfer.success" : "charge.success",
						}),
					);
		const headers: Record<string, string> = {};
		if (mode !== null)
			headers["x-paystack-signature"] =
				mode === "bad"
					? "bad"
					: signPaystackBody(
							mode === "tampered" ? raw + " " : raw,
							config?.paystackSecret ?? "",
						);
		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				headers,
				body: raw,
			}),
		});
		expect(response.status).toBe(status);
		expect(await readInvoice(pool, f.invoiceId)).toEqual(before);
		expect(await readCharge(pool, f.reference)).toEqual(chargeBefore);
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
	});

	it("case 1: credits a valid charge.success exactly once and marks the invoice paid", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 150_000 }),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			duplicate: false,
			paid: true,
			reference: f.reference,
		});

		const invoice = await readInvoice(pool, f.invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(Number(invoice?.payment_amount)).toBe(1500);
		expect(invoice?.payment_reference).toBe(f.reference);
		expect(invoice?.paid_at).not.toBeNull();

		const txns = await listPaymentTransactions(pool, f.invoiceId);
		expect(txns).toHaveLength(1);
		expect(Number(txns[0]?.amount)).toBe(1500);

		expect((await readCharge(pool, f.reference))?.status).toBe("succeeded");
	});

	it("case 2: a sequential replay credits once and reports duplicate", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const event = buildChargeSuccessEvent({
			reference: f.reference,
			amountKobo: 150_000,
		});

		const first = await (await deliver(event)).json();
		const second = await (await deliver(event)).json();

		expect(first).toMatchObject({ ok: true, duplicate: false });
		expect(second).toMatchObject({ ok: true, duplicate: true });
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
		expect(Number((await readInvoice(pool, f.invoiceId))?.payment_amount)).toBe(
			1500,
		);
	});

	it("case 3: 10 concurrent deliveries credit exactly once without a leaked 500", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const event = buildChargeSuccessEvent({
			reference: f.reference,
			amountKobo: 150_000,
		});

		const responses = await Promise.all(
			Array.from({ length: 10 }, () => deliver(event)),
		);
		for (const response of responses) {
			expect(response.status).toBe(200);
		}
		const bodies = await Promise.all(responses.map((r) => r.json()));
		const credited = bodies.filter((b) => b.ok && b.duplicate === false);
		expect(credited).toHaveLength(1);

		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
		expect(Number((await readInvoice(pool, f.invoiceId))?.payment_amount)).toBe(
			1500,
		);
	});

	it("case 7: an underpayment is recorded as partially-paid, never paid", async () => {
		const f = await fixture({ amountNaira: 1500, chargeAmountNaira: 400 });
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 40_000 }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ ok: true, paid: false });

		const invoice = await readInvoice(pool, f.invoiceId);
		expect(invoice?.status).toBe("partially-paid");
		expect(Number(invoice?.payment_amount)).toBe(400);
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
	});

	it("case 8: an overpayment is refused, flagged for review, and never marked paid", async () => {
		const f = await fixture({ amountNaira: 100, chargeAmountNaira: 500 });
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 50_000 }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			processed: false,
			reason: "exceeds_balance",
		});

		expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
		const charge = await readCharge(pool, f.reference);
		expect(charge?.status).toBe("manual_review");
		expect(charge?.provider_message).toBe("exceeds_balance");
	});

	it("case 9: a wrong currency is refused and never credited", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const response = await deliver(
			buildChargeSuccessEvent({
				reference: f.reference,
				amountKobo: 150_000,
				currency: "USD",
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			processed: false,
			reason: "amount_currency_mismatch",
		});
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
		expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
	});

	it("case 9b: a wrong amount for a known reference is refused", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 90_000 }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			processed: false,
			reason: "amount_currency_mismatch",
		});
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
	});

	it("case 10: an unknown reference is acknowledged with 200 and changes nothing", async () => {
		const response = await deliver(
			buildChargeSuccessEvent({
				reference: "ref_never_seen",
				amountKobo: 150_000,
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			processed: false,
			reason: "unknown_reference",
		});
	});

	it("case 11: an event for an already-paid invoice is not credited again", async () => {
		const f = await fixture({
			amountNaira: 1500,
			paymentAmountNaira: 1500,
			status: "paid",
		});
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 150_000 }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ processed: false });

		const invoice = await readInvoice(pool, f.invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(Number(invoice?.payment_amount)).toBe(1500);
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
	});

	it("case 15: a canceled invoice is never settled from a webhook", async () => {
		const f = await fixture({ amountNaira: 1500, canceled: true });
		const response = await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 150_000 }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			processed: false,
			reason: "invoice_canceled",
		});
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
		expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
	});

	it("keeps the first reference across a second (remainder) payment", async () => {
		const f = await fixture({ amountNaira: 1500, chargeAmountNaira: 500 });
		await deliver(
			buildChargeSuccessEvent({ reference: f.reference, amountKobo: 50_000 }),
		);
		expect(Number((await readInvoice(pool, f.invoiceId))?.payment_amount)).toBe(
			500,
		);

		// The first charge is now `succeeded`, so a fresh pending charge for the
		// remainder can be created (unique index allows one pending per invoice).
		const secondRef = `${f.reference}_b`;
		await pool.query(
			`insert into public.payment_charges
         (workspace_id, invoice_id, provider, reference, status, amount, currency, expires_at)
       values ($1,$2,'paystack',$3,'pending',$4,'NGN', now() + interval '8 hours')`,
			[f.workspaceId, f.invoiceId, secondRef, 1000],
		);

		const response = await deliver(
			buildChargeSuccessEvent({ reference: secondRef, amountKobo: 100_000 }),
		);
		expect(await response.json()).toMatchObject({ ok: true, paid: true });

		const invoice = await readInvoice(pool, f.invoiceId);
		expect(invoice?.status).toBe("paid");
		expect(Number(invoice?.payment_amount)).toBe(1500);
		// C2: the FIRST reference is retained; the second is recorded per row.
		expect(invoice?.payment_reference).toBe(f.reference);
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(2);
	});

	it("cases 16/17: a mid-transaction failure rolls back, then a retry succeeds once", async () => {
		const f = await fixture({ amountNaira: 1500 });
		const event = buildChargeSuccessEvent({
			reference: f.reference,
			amountKobo: 150_000,
		});

		await pool.query(
			`create or replace function public._test_block_paytx() returns trigger
         language plpgsql as $$ begin raise exception 'injected transaction failure'; end; $$;
       create trigger _test_block_paytx before insert on public.payment_transactions
         for each row execute function public._test_block_paytx();`,
		);

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			await expect(deliver(event)).rejects.toThrow();
			const invoice = await readInvoice(pool, f.invoiceId);
			expect(Number(invoice?.payment_amount ?? 0)).toBe(0);
			expect(invoice?.status).not.toBe("paid");
			expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
		} finally {
			errorSpy.mockRestore();
			await pool.query(
				`drop trigger if exists _test_block_paytx on public.payment_transactions;
         drop function if exists public._test_block_paytx();`,
			);
		}

		// Retry after the failure clears succeeds exactly once.
		const response = await deliver(event);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: true,
			duplicate: false,
			paid: true,
		});
		expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
	});
});
