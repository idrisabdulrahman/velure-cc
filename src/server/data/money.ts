/**
 * Integer minor-unit money helpers for provider payments.
 *
 * Paystack amounts are integers in the lowest currency unit (kobo for NGN:
 * ₦1.00 = 100 kobo). Money must never be converted through binary floating
 * point, so these helpers parse the decimal *string* form of a naira amount
 * and do the arithmetic in integers. `nairaToKobo` recovers the exact kobo
 * integer for any naira amount with at most two decimal places; `koboToNaira`
 * returns the exact decimal string the provider amount maps to, which is what
 * gets compared against the `numeric` invoice/charge amount in Postgres.
 */

const MINOR_UNITS_PER_MAJOR = 100n;
const NAIRA_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

export function nairaToKobo(amount: number): number {
	if (typeof amount !== "number" || !Number.isFinite(amount)) {
		throw new Error("Money amount must be a finite number.");
	}
	if (amount < 0) {
		throw new Error("Money amount cannot be negative.");
	}
	const match = NAIRA_PATTERN.exec(String(amount));
	if (!match) {
		throw new Error(
			"Money amount must have at most two decimal places in the lowest currency unit.",
		);
	}
	const whole = BigInt(match[1]);
	const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
	const kobo = whole * MINOR_UNITS_PER_MAJOR + fraction;
	if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error("Money amount is too large to be represented exactly.");
	}
	return Number(kobo);
}

export function koboToNaira(kobo: number): string {
	if (!Number.isSafeInteger(kobo)) {
		throw new Error("Provider minor units must be a safe integer.");
	}
	if (kobo < 0) {
		throw new Error("Provider minor units cannot be negative.");
	}
	const whole = Math.trunc(kobo / 100);
	const fraction = kobo % 100;
	return `${whole}.${String(fraction).padStart(2, "0")}`;
}
