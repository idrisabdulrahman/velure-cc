/**
 * Redirect helpers shared by the auth and email-verification screens.
 *
 * `authRedirectPath` is the only place a post-auth destination is chosen, so
 * the sign-in, sign-up and verification pages cannot drift apart on what
 * counts as a safe open-redirect target.
 */

/**
 * Turns a `?redirect=` value into a same-origin path.
 *
 * Anything that is not a single-slash absolute path is rejected (protocol
 * relative `//evil.example`, full URLs, bare words), and the auth screens
 * themselves are bounced to the dashboard so a return trip cannot loop.
 */
export function authRedirectPath(rawRedirect: string | null) {
	const redirect = rawRedirect?.trim();
	if (!redirect) return "/invoices";
	if (!redirect.startsWith("/") || redirect.startsWith("//"))
		return "/invoices";
	if (redirect.startsWith("/auth") || redirect.startsWith("/api/auth")) {
		return "/invoices";
	}
	return redirect;
}

/** Absolute URL for a Better Auth `callbackURL`, resolved against the origin. */
export function appCallbackURL(path: string) {
	if (typeof window === "undefined") return path;
	return new URL(path, window.location.origin).toString();
}

/**
 * The `callbackURL` a verification link should return to. Better Auth appends
 * `&error=...` to it on failure, so the page can render both outcomes.
 */
export function verificationCallbackURL(nextPath: string) {
	const search = new URLSearchParams({ next: authRedirectPath(nextPath) });
	return appCallbackURL(`/verify-email?${search.toString()}`);
}
