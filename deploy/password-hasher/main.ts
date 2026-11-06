import { DurableObject } from "cloudflare:workers";
import {
	hashPassword,
	verifyPassword,
} from "../../src/server/password-hash";

/**
 * The password hasher Durable Object.
 *
 * This script exists for one reason: scrypt needs roughly 160-235 ms of CPU,
 * which does not fit the Workers free plan's 10 ms per-invocation budget, while a
 * Durable Object is allowed 30 s. The main Worker holds a namespace binding
 * (`durable_objects.bindings` in the repository `wrangler.jsonc`, pointing here
 * with `script_name`) and calls this object for `hash` and `verify` only.
 *
 * It is a separate script because Nitro owns the main Worker's entry module and
 * cannot export an extra class from it. There is deliberately **no fetch
 * handler** and no route, so nothing is publicly reachable here: only the main
 * Worker, through the binding, can talk to this object.
 *
 * It stores nothing. The SQLite backend is used because new namespaces are
 * required to be SQLite-backed on the free plan, not because there is state to
 * keep, so no storage API is touched and inactive objects cost no duration.
 *
 * The submitted password is never logged, never placed in a URL, and never
 * returned in an error message.
 */

type RequestBody = {
	operation?: unknown;
	password?: unknown;
	hash?: unknown;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

export class PasswordHasher extends DurableObject {
	async fetch(request: Request): Promise<Response> {
		if (request.method !== "POST") {
			return jsonResponse({ error: "Method not allowed" }, 405);
		}

		let body: RequestBody;
		try {
			body = (await request.json()) as RequestBody;
		} catch {
			return jsonResponse({ error: "Invalid JSON body" }, 400);
		}

		const password = body.password;

		if (typeof password !== "string") {
			return jsonResponse({ error: "A password is required" }, 400);
		}

		if (body.operation === "hash") {
			try {
				return jsonResponse({ hash: await hashPassword(password) });
			} catch {
				// Never echo the input back in the response.
				return jsonResponse({ error: "Hashing failed" }, 500);
			}
		}

		if (body.operation === "verify") {
			if (typeof body.hash !== "string") {
				return jsonResponse({ error: "A stored hash is required" }, 400);
			}

			try {
				return jsonResponse({
					valid: await verifyPassword({ hash: body.hash, password }),
				});
			} catch {
				// A malformed stored hash throws in Better Auth too. Report it as a
				// failure the caller can distinguish, without leaking the value.
				return jsonResponse({ error: "Stored hash is malformed" }, 400);
			}
		}

		return jsonResponse({ error: "Unknown operation" }, 400);
	}
}
