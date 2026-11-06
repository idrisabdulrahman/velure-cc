import type { AuthPool } from "./auth-database";

/**
 * The two writes email verification needs that Better Auth 1.4.9 does not
 * perform itself.
 *
 * Both run on the same connection as the auth request that triggered them
 * (`withAuthConnection` in `routes/api/auth/$`), so they add no new subrequest
 * or connection.
 */

/**
 * Removes a password that was set before its owner ever proved control of the
 * address.
 *
 * The attack this closes ("pre-hijacking"): someone registers a victim's email
 * with a password they choose. The account is inert because sign-in requires a
 * verified email, but the row and the password exist. Later the real owner
 * presses "Continue with Google" for that same address, Better Auth links
 * Google into the existing row and marks the email verified
 * (`better-auth/dist/oauth2/link-account.mjs:40`) - at which point the
 * attacker's password becomes usable.
 *
 * Deleting the credential account at link time leaves the legitimate owner with
 * the provider they just proved ownership with. They can set a fresh password
 * from Security while signed in, which is session-gated.
 *
 * Safe to re-run: the delete is idempotent and only touches rows whose user is
 * still unverified. A verified user keeps their password.
 */
export const REVOKE_UNVERIFIED_CREDENTIAL_SQL = `delete from better_auth."account" as a
using better_auth."user" as u
where a."userId" = u."id"
  and a."userId" = $1
  and a."providerId" = 'credential'
  and u."emailVerified" = false`;

/**
 * Marks an address verified after a password reset.
 *
 * A completed reset means the person holds a token that was only ever mailed to
 * that address, which is the same proof a verification link gives. Without this
 * write, a user who signed up but never opened the verification email would
 * reset their password successfully and still be refused sign-in by
 * `requireEmailVerification` - a dead end, because the reset path does not set
 * `emailVerified` in Better Auth 1.4.9
 * (`better-auth/dist/api/routes/reset-password.mjs`).
 */
export const MARK_EMAIL_VERIFIED_SQL = `update better_auth."user"
set "emailVerified" = true, "updatedAt" = now()
where "id" = $1`;

type Queryable = Pick<AuthPool, "query">;

/**
 * Revokes the unverified password attached to the user a social account just
 * linked into. Returns whether a row was removed.
 *
 * The credential account itself is skipped: Better Auth creates it in the same
 * request as the user during email+password sign-up, and deleting it there
 * would destroy a password the user is entitled to keep until it is proven
 * unusable.
 */
export async function revokeUnverifiedCredentialAccount(
	queryable: Queryable,
	account: { userId: string; providerId: string },
): Promise<boolean> {
	if (account.providerId === "credential") return false;

	const result = await queryable.query(REVOKE_UNVERIFIED_CREDENTIAL_SQL, [
		account.userId,
	]);

	return (result.rowCount ?? 0) > 0;
}

/** Marks the address verified after a proven password reset. */
export async function markEmailVerified(
	queryable: Queryable,
	userId: string,
): Promise<void> {
	await queryable.query(MARK_EMAIL_VERIFIED_SQL, [userId]);
}
