import { convexBetterAuthReactStart } from "@convex-dev/better-auth/react-start";
import { env } from "#/env";

const convexUrl = env.VITE_CONVEX_URL ?? env.CONVEX_URL;
const convexSiteUrl = env.VITE_CONVEX_SITE_URL ?? env.CONVEX_SITE_URL;
if (!convexUrl || !convexSiteUrl) {
	throw new Error(
		"Missing Convex auth env. Set VITE_CONVEX_URL and VITE_CONVEX_SITE_URL.",
	);
}

export const auth = convexBetterAuthReactStart({
	convexUrl,
	convexSiteUrl,
});
