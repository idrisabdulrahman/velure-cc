type ServerEnvName =
	| "PAYSTACK_PUBLIC_KEY"
	| "PAYSTACK_SECRET_KEY"
	| "RESEND_API_KEY"
	| "RESEND_FROM"
	| "RESEND_FROM_EMAIL"
	| "SITE_URL";

function getViteEnv(name: ServerEnvName) {
	switch (name) {
		case "PAYSTACK_PUBLIC_KEY":
			return import.meta.env.PAYSTACK_PUBLIC_KEY;
		case "PAYSTACK_SECRET_KEY":
			return import.meta.env.PAYSTACK_SECRET_KEY;
		case "RESEND_API_KEY":
			return import.meta.env.RESEND_API_KEY;
		case "RESEND_FROM":
			return import.meta.env.RESEND_FROM ?? import.meta.env.RESEND_FROM_EMAIL;
		case "RESEND_FROM_EMAIL":
			return import.meta.env.RESEND_FROM_EMAIL ?? import.meta.env.RESEND_FROM;
		case "SITE_URL":
			return import.meta.env.SITE_URL;
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
