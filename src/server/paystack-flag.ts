/**
 * Master switch for Paystack collection that the app itself initiates: the
 * public-page "transfer account" charge and the pre-warm done on invoice send.
 *
 * Default OFF. Today every charge is created with the single environment
 * `PAYSTACK_SECRET_KEY`, so settlement lands in that one Paystack account, not
 * in the seller's. Do not enable this in production until payments settle to
 * each seller (seller-owned keys or an approved split/subaccount setup) and the
 * funds flow has been confirmed in writing with Paystack and payments counsel.
 *
 * Only the string "true" (any case, surrounding whitespace ignored) enables it.
 * Anything else (unset, empty, "false", "1", "yes") leaves it off.
 *
 * Deliberately NOT consulted by the webhook or reconcile routes: a charge that
 * was already issued must still be credited when its transfer arrives.
 */
export function isPaystackCollectionEnabled(
	env: Record<string, string | undefined> = typeof process !== "undefined"
		? process.env
		: {},
): boolean {
	return env.PAYSTACK_COLLECTION_ENABLED?.trim().toLowerCase() === "true";
}
