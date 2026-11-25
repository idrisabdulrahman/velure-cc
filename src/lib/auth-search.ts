/**
 * `/auth` search-param contract, shared by the route (`validateSearch`) and the
 * lazy component (initial tab). Kept in one module so the two cannot drift.
 */

export type AuthMode = "sign-in" | "sign-up" | "reset";

export type AuthSearch = {
	mode?: AuthMode;
	token?: string;
	redirect?: string;
	google?: string;
};

/**
 * Route-level validation for `/auth`.
 *
 * Any `mode` outside the three modes the page actually renders collapses to
 * `undefined`, so a hand-edited `?mode=admin` cannot put the page into a state
 * it has no form for. Every other param the page already understands
 * (`token`, `redirect`, `google`) is kept only when it is a string.
 */
export function validateAuthSearch(input: Record<string, unknown>): AuthSearch {
	const mode = input.mode;
	return {
		mode:
			mode === "sign-in" || mode === "sign-up" || mode === "reset"
				? mode
				: undefined,
		token: stringParam(input.token),
		redirect: stringParam(input.redirect),
		google: stringParam(input.google),
	};
}

function stringParam(value: unknown) {
	return typeof value === "string" ? value : undefined;
}

/**
 * The tab `/auth` opens on.
 *
 * `reset` only opens with its emailed token; without one a stale
 * `?mode=reset` link falls back to sign-in instead of showing a form that
 * cannot submit. `?mode=sign-up` deep-links the sign-up form; everything else
 * (including a bare `/auth`) keeps the sign-in default so existing links and
 * bookmarks are unchanged.
 */
export function resolveInitialAuthMode(
	mode: string | null | undefined,
	token: string | null | undefined,
): AuthMode {
	if (mode === "reset" && token) return "reset";
	if (mode === "sign-up") return "sign-up";
	return "sign-in";
}
