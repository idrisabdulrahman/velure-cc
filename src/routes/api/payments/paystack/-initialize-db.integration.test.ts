import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { ensurePaystackTransferCharge } from "#/server/data/paystack-server";
import {
	cleanupWorkspaces,
	createInvoiceFixture,
	createTestPool,
	listPaymentCharges,
	paystackTestConfig,
	readCharge,
	type TestPool,
} from "./-test-helpers";

/**
 * Paystack transfer-charge initialization against a REAL Postgres +
 * PostgREST. Runs only with `PAYSTACK_DB_LIVE=1` and a LOCAL test stack (guard
 * in `-test-helpers`). Only `api.paystack.co` is mocked; Supabase/PostgREST
 * traffic passes through untouched.
 */
const config = paystackTestConfig();
const hasDb = config !== null;
const realFetch = globalThis.fetch;

let pool: TestPool;
const createdWorkspaces: string[] = [];
let chargeRequests: Array<Record<string, unknown>>;
let fetchMock: ReturnType<typeof vi.fn>;
let chargeResponder: (reference: string) => Response;

function paystackChargeResponse(reference: string) {
	return new Response(
		JSON.stringify({
			status: true,
			message: "Charge attempted",
			data: {
				status: "pending",
				reference,
				account_name: "VELURE/PAYER",
				account_number: "0123456789",
				bank: { name: "Test Bank", slug: "test-bank" },
				amount: 150000,
				currency: "NGN",
			},
		}),
		{ status: 201, headers: { "content-type": "application/json" } },
	);
}

beforeAll(() => {
	if (hasDb && config) pool = createTestPool(config.databaseUrl);
});

beforeEach(() => {
	chargeRequests = [];
	chargeResponder = paystackChargeResponse;
	fetchMock = vi.fn(
		async (
			input: Parameters<typeof fetch>[0],
			init?: Parameters<typeof fetch>[1],
		) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url;
			if (!url.startsWith("https://api.paystack.co/")) {
				return realFetch(input, init);
			}
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			chargeRequests.push(body);
			return chargeResponder(String(body.reference ?? ""));
		},
	);
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
	vi.unstubAllGlobals();
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
	"Paystack transfer-charge initialization against a real test database",
	() => {
		it("F12: persists the final provider reference before the provider call", async () => {
			const f = await fixture({
				amountNaira: 1500,
				withCustomer: true,
				skipCharge: true,
			});
			const charge = await ensurePaystackTransferCharge(f.token);

			expect(charge?.reference).toMatch(/^velure-/);
			expect(chargeRequests).toHaveLength(1);
			expect(chargeRequests[0]?.reference).toBe(charge?.reference);
			expect(chargeRequests[0]?.amount).toBe(150_000);
			expect(chargeRequests[0]?.currency).toBe("NGN");

			// The reference is durable in the DB *before* any webhook could
			// arrive, and it equals the provider request (no `claim-` row).
			const stored = await readCharge(pool, charge?.reference ?? "");
			expect(stored?.status).toBe("pending");
			expect(Number(stored?.amount)).toBe(1500);
			const charges = await listPaymentCharges(pool, f.invoiceId);
			expect(charges.map((row) => row.reference)).toEqual([charge?.reference]);
		});

		it("F12: a failed provider call still leaves the final reference durable", async () => {
			chargeResponder = () =>
				new Response(JSON.stringify({ status: false, message: "boom" }), {
					status: 500,
					headers: { "content-type": "application/json" },
				});
			const f = await fixture({
				amountNaira: 1500,
				withCustomer: true,
				skipCharge: true,
			});

			await expect(ensurePaystackTransferCharge(f.token)).rejects.toThrow();

			// Before F12 the row kept the `claim-...` placeholder until the
			// provider replied, so a failure here left the reference unmatched.
			// Now the final reference is durable from the start.
			const charges = await listPaymentCharges(pool, f.invoiceId);
			expect(charges).toHaveLength(1);
			expect(charges[0]?.reference).toMatch(/^velure-/);
			expect(charges[0]?.status).toBe("failed");
			expect(chargeRequests[0]?.reference).toBe(charges[0]?.reference);
		});

		it("F8: reuses a matching pending charge without another provider call", async () => {
			const f = await fixture({ amountNaira: 1500, withCustomer: true });

			const first = await ensurePaystackTransferCharge(f.token);
			expect(first?.reference).toBe(f.reference);
			expect(chargeRequests).toHaveLength(0);

			const second = await ensurePaystackTransferCharge(f.token);
			expect(second?.reference).toBe(f.reference);
			expect(chargeRequests).toHaveLength(0);
			expect(await listPaymentCharges(pool, f.invoiceId)).toHaveLength(1);
		});

		it("F8: expires a stale pending charge and issues a fresh correct one", async () => {
			const f = await fixture({
				amountNaira: 1500,
				chargeAmountNaira: 400,
				withCustomer: true,
			});

			const charge = await ensurePaystackTransferCharge(f.token);

			expect(charge?.reference).not.toBe(f.reference);
			expect(charge?.reference).toMatch(/^velure-/);
			expect(charge?.amount).toBe(1500);
			expect(chargeRequests[0]?.amount).toBe(150_000);

			const stale = await readCharge(pool, f.reference);
			expect(stale?.status).toBe("expired");
			const fresh = await readCharge(pool, charge?.reference ?? "");
			expect(fresh?.status).toBe("pending");
			expect(Number(fresh?.amount)).toBe(1500);
		});

		it("F9: refuses a non-NGN invoice without touching Paystack", async () => {
			const f = await fixture({
				amountNaira: 1500,
				currency: "USD",
				withCustomer: true,
				skipCharge: true,
			});

			await expect(ensurePaystackTransferCharge(f.token)).rejects.toThrow(
				/Only NGN invoices/,
			);
			expect(chargeRequests).toHaveLength(0);
			expect(await listPaymentCharges(pool, f.invoiceId)).toHaveLength(0);
		});
	},
);
