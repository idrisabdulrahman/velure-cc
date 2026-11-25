import { hashPassword, verifyPassword } from "#/server/password-hash";

/**
 * Routes password hashing to the Durable Object when one is bound.
 *
 * scrypt at Better Auth's parameters is roughly 160-235 ms of CPU. The Workers
 * free plan allows 10 ms per invocation, so password login cannot run it in the
 * main Worker at all; that is the measured reason Invoicly moved to a Node host in
 * `docs/DECISIONS.md` (2026-11-01). A Durable Object gets 30 s of CPU per
 * request, so the work moves there and the main Worker only serialises a request.
 *
 * The binding is read from `globalThis.__env__`, which is where Nitro's
 * Cloudflare preset puts the Worker environment on every fetch
 * (`node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs:10`).
 * Reading it lazily (rather than at module scope) is required because bindings
 * are per request, and it keeps this module importable in plain Node, where
 * `__env__` simply does not exist.
 *
 * Fallback rules:
 *
 *   - **No binding** (Node dev, the VPS build, unit tests): hash in process,
 *     exactly as today. A mis-set binding must not break those hosts.
 *   - **Binding present but the call fails**: throw. Do not fall back. On
 *     Workers the in-process path cannot fit the CPU budget, so a fallback would
 *     turn a clear error into a 1102 timeout storm and hide the real fault.
 */

/** The minimal shape of the namespace binding this module uses. */
export type PasswordHasherBinding = {
	idFromName: (name: string) => unknown;
	get: (id: unknown) => {
		fetch: (input: string | Request, init?: RequestInit) => Promise<Response>;
	};
};

const BINDING_NAME = "PASSWORD_HASHER";

/**
 * Hashing holds no state, so a single object would serialise concurrent logins
 * for no benefit. Spread requests across a small fixed set of instances instead.
 * (`idFromName` maps these eight names to eight objects, and inactive objects
 * accrue no duration charge.)
 */
const SHARD_COUNT = 8;

export function resolvePasswordHasherBinding(
	env: Record<string, unknown> | undefined = (
		globalThis as { __env__?: Record<string, unknown> }
	).__env__,
): PasswordHasherBinding | null {
	const binding = env?.[BINDING_NAME];

	return (binding as PasswordHasherBinding | undefined) ?? null;
}

function pickShard(): number {
	const value = new Uint8Array(1);
	crypto.getRandomValues(value);

	return value[0] % SHARD_COUNT;
}

async function callBinding(
	binding: PasswordHasherBinding,
	body: Record<string, string>,
): Promise<Record<string, unknown>> {
	const stub = binding.get(
		binding.idFromName(`password-hasher-${pickShard()}`),
	);

	const response = await stub.fetch("https://password-hasher.internal/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});

	const payload = (await response.json().catch(() => null)) as Record<
		string,
		unknown
	> | null;

	if (!response.ok || !payload) {
		// The Durable Object never returns the submitted password in an error,
		// and neither does this message.
		throw new Error(
			`Password hasher request failed with status ${response.status}`,
		);
	}

	return payload;
}

export async function hashPasswordWithBinding(
	password: string,
	binding: PasswordHasherBinding | null = resolvePasswordHasherBinding(),
): Promise<string> {
	if (!binding) return hashPassword(password);

	const payload = await callBinding(binding, {
		operation: "hash",
		password,
	});
	const hash = payload.hash;

	if (typeof hash !== "string") {
		throw new Error("Password hasher returned a malformed response");
	}

	return hash;
}

export async function verifyPasswordWithBinding(
	{ hash, password }: { hash: string; password: string },
	binding: PasswordHasherBinding | null = resolvePasswordHasherBinding(),
): Promise<boolean> {
	if (!binding) return verifyPassword({ hash, password });

	const payload = await callBinding(binding, {
		operation: "verify",
		hash,
		password,
	});

	if (typeof payload.valid !== "boolean") {
		throw new Error("Password hasher returned a malformed response");
	}

	return payload.valid;
}
