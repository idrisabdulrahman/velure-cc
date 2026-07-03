type ServerEnvName =
	| "CONVEX_URL"
	| "NUXT_CONVEX_URL"
	| "PAYSTACK_PUBLIC_KEY"
	| "PAYSTACK_SECRET_KEY"
	| "RESEND_API_KEY"
	| "RESEND_FROM"
	| "SITE_URL"
	| "VITE_CONVEX_URL";

function getViteEnv(name: ServerEnvName) {
	switch (name) {
		case "CONVEX_URL":
			return import.meta.env.CONVEX_URL;
		case "NUXT_CONVEX_URL":
			return import.meta.env.NUXT_CONVEX_URL;
		case "PAYSTACK_PUBLIC_KEY":
			return import.meta.env.PAYSTACK_PUBLIC_KEY;
		case "PAYSTACK_SECRET_KEY":
			return import.meta.env.PAYSTACK_SECRET_KEY;
		case "RESEND_API_KEY":
			return import.meta.env.RESEND_API_KEY;
		case "RESEND_FROM":
			return import.meta.env.RESEND_FROM;
		case "SITE_URL":
			return import.meta.env.SITE_URL;
		case "VITE_CONVEX_URL":
			return import.meta.env.VITE_CONVEX_URL;
	}
}

export function getServerEnv(name: ServerEnvName) {
	return process.env[name] ?? getViteEnv(name);
}

export function firstServerEnv(...names: ServerEnvName[]) {
	for (const name of names) {
		const value = getServerEnv(name);
		if (value) return value;
	}
	return "";
}
