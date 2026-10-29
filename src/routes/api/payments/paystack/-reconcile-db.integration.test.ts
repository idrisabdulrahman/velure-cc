import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { reconcilePendingPaystackCharges } from "#/server/data/paystack-server";
import {
	cleanupWorkspaces,
	createInvoiceFixture,
	createTestPool,
	expirePendingCharge,
	listPaymentTransactions,
	paystackTestConfig,
	readCharge,
	readInvoice,
	type TestPool,
} from "./-test-helpers";

/**
 * F7 — missed-webhook recovery against a REAL Postgres + PostgREST.
 *
 * Runs only with `PAYSTACK_DB_LIVE=1` on a LOCAL test stack. The provider
 * verify call is injected so this suite makes no network call; the credit goes
 * through the same real `confirm_paystack_payment` RPC the webhook uses.
 *
 * Concurrency note: other DB suites create charges that expire in the FUTURE,
 * so they are never reconciliation candidates (which require an expiry in the
 * past); the global scan therefore only sees this suite's backdated charges.
 */
const config = paystackTestConfig();
const hasDb = config !== null;

let pool: TestPool;
const createdWorkspaces: string[] = [];

const successPayload = (reference: string) => ({
	status: true,
	data: {
		status: "success",
		reference,
		amount: 150_000,
		currency: "NGN",
		id: 424242,
		customer: { email: "payer@example.com" },
	},
});

beforeAll(() => {
	if (hasDb && config) pool = createTestPool(config.databaseUrl);
});

afterEach(async () => {
	vi.restoreAllMocks();
	if (!hasDb) return;
	await cleanupWorkspaces(pool, createdWorkspaces.splice(0));
});

afterAll(async () => {
	if (hasDb) await pool.end();
});

async function fixture(opts: Parameters<typeof createInvoiceFixture>[1]) {
	const f = await createInvoiceFixture(pool, opts);
	createdWorkspaces.push(f.workspaceId);
	return f;
}

describe.skipIf(!hasDb)(
	"Paystack reconciliation against a real test database",
	() => {
		it("credits a missed success discovered by verification, exactly once", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });
			await expirePendingCharge(pool, f.invoiceId, "1 hour");

			const summary = await reconcilePendingPaystackCharges({
				verifyTransaction: async (reference) => successPayload(reference),
			});

			expect(summary).toMatchObject({
				checked: 1,
				credited: 1,
				duplicates: 0,
				unchanged: 0,
				errors: 0,
			});
			expect((await readInvoice(pool, f.invoiceId))?.status).toBe("paid");
			expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
			expect((await readCharge(pool, f.reference))?.status).toBe("succeeded");

			// A second run finds nothing left to reconcile and adds no credit.
			const again = await reconcilePendingPaystackCharges({
				verifyTransaction: async (reference) => successPayload(reference),
			});
			expect(again.checked).toBe(0);
			expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(1);
		});

		it("never releases the pending slot on a non-success verification", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });
			await expirePendingCharge(pool, f.invoiceId, "1 hour");
			vi.spyOn(console, "warn").mockImplementation(() => {});

			const summary = await reconcilePendingPaystackCharges({
				verifyTransaction: async (reference) => ({
					status: true,
					data: { status: "abandoned", reference },
				}),
			});

			expect(summary).toMatchObject({
				checked: 1,
				credited: 0,
				unchanged: 1,
				errors: 0,
			});
			// State is untouched: the charge is still `pending` and no money
			// moved.
			expect((await readCharge(pool, f.reference))?.status).toBe("pending");
			expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
			expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
		});

		it("emits one structured payment-anomaly event per checked charge (F11)", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });
			await expirePendingCharge(pool, f.invoiceId, "1 hour");

			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			await reconcilePendingPaystackCharges({
				verifyTransaction: async () => null,
			});

			const anomalyCalls = warn.mock.calls.filter(
				(call) => call[0] === "payment_anomaly",
			);
			expect(anomalyCalls).toHaveLength(1);
			expect(JSON.parse(String(anomalyCalls[0]?.[1]))).toMatchObject({
				event: "payment_anomaly",
				type: "verification_non_success",
				reference: f.reference,
			});
		});

		it("flags a canceled invoice for review without crediting it", async () => {
			const f = await fixture({
				amountNaira: 1500,
				withCustomer: true,
				canceled: true,
			});
			await expirePendingCharge(pool, f.invoiceId, "1 hour");

			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const summary = await reconcilePendingPaystackCharges({
				verifyTransaction: async (reference) => successPayload(reference),
			});
			expect(summary).toMatchObject({ checked: 1, credited: 0, unchanged: 1 });
			expect(warn).toHaveBeenCalled();

			expect(await listPaymentTransactions(pool, f.invoiceId)).toHaveLength(0);
			// The RPC's canceled guard flags the charge for review, never credits.
			const charge = await readCharge(pool, f.reference);
			expect(charge?.status).toBe("manual_review");
			expect(charge?.provider_message).toBe("invoice_canceled");
			expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
		});

		it("ignores charges older than the recovery window", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });
			await expirePendingCharge(pool, f.invoiceId, "8 days");

			const summary = await reconcilePendingPaystackCharges({
				verifyTransaction: async (reference) => successPayload(reference),
			});
			expect(summary.checked).toBe(0);
			expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
		});

		it("fails closed without a secret key", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });
			await expirePendingCharge(pool, f.invoiceId, "1 hour");

			const summary = await reconcilePendingPaystackCharges({
				secretKey: "",
				verifyTransaction: async () => {
					throw new Error("verification must not run without a key");
				},
			});
			expect(summary.checked).toBe(0);
			expect((await readInvoice(pool, f.invoiceId))?.status).not.toBe("paid");
		});
	},
);
