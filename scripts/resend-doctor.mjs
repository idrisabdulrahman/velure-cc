#!/usr/bin/env node
/**
 * Resend configuration doctor.
 *
 * Answers "why is mail not arriving?" in one command, without printing a
 * secret and without sending anything unless explicitly asked.
 *
 * Why this exists: Resend reports several unrelated faults under the same
 * `error.name` (`validation_error`), so a Worker log line reading
 * `validation_error` cannot say whether the API key is dead, the key is
 * sending-only, the sender is Resend's test address, or the sending domain is
 * unverified. The `statusCode` separates them and the `message` names the
 * cause; this script prints both.
 *
 * Usage:
 *   node scripts/resend-doctor.mjs
 *       Read-only. Validates the key and inspects the `from` address.
 *   node scripts/resend-doctor.mjs --send-to you@example.com
 *       Also performs ONE real send to exactly that address, so the whole
 *       path (key + sender + domain) is proven end to end. Nothing else is
 *       ever sent.
 *
 * Configuration is read from the environment, then from `.env.local`, then
 * `.env` (parsed line by line; the files are never sourced). The key value is
 * never printed.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const API = "https://api.resend.com";
const TEST_SENDER = "resend.dev";

function fingerprint(value) {
	if (!value) return "(missing)";
	return `len=${value.length} sha256:${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

/** Reads NAME=value from the first file that defines it. */
function fromEnvFiles(name, files) {
	for (const file of files) {
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			const t = line.trim();
			if (!t || t.startsWith("#")) continue;
			const eq = t.indexOf("=");
			if (eq < 0) continue;
			if (t.slice(0, eq).replace(/^export\s+/, "").trim() !== name) continue;
			const value = t
				.slice(eq + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			if (value) return value;
		}
	}
	return "";
}

/** Same rule the app logs with: never let an address reach the output. */
function redact(value) {
	return String(value ?? "").replace(
		/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
		"[redacted-address]",
	);
}

async function resendFetch(path, apiKey, init) {
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	let body = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return { response, body };
}

function sendToArg() {
	const index = process.argv.indexOf("--send-to");
	if (index < 0) return "";
	return process.argv[index + 1] ?? "";
}

async function main() {
	const files = [".env.local", ".env"];
	const apiKey =
		process.env.RESEND_API_KEY || fromEnvFiles("RESEND_API_KEY", files);
	const from =
		process.env.RESEND_FROM_EMAIL ||
		process.env.RESEND_FROM ||
		fromEnvFiles("RESEND_FROM_EMAIL", files) ||
		fromEnvFiles("RESEND_FROM", files);

	console.log("Resend configuration doctor");
	console.log(`  key : ${fingerprint(apiKey)}`);
	console.log(`  from: ${from || "(missing)"}`);

	const problems = [];

	if (!apiKey) {
		problems.push("RESEND_API_KEY is not set in the environment or .env files.");
	}
	if (!from) {
		problems.push("RESEND_FROM_EMAIL is not set in the environment or .env files.");
	}

	// 1. Key validity, read-only. Sends no email.
	if (apiKey) {
		const { response, body } = await resendFetch("/domains", apiKey, {
			method: "GET",
		});
		if (response.status === 200) {
			const names = Array.isArray(body?.data)
				? body.data.map((d) => `${d.name}[${d.status}]`).join(", ")
				: "";
			console.log(`  key check: OK (full access). Domains: ${names || "(none)"}`);
		} else if (body?.name === "restricted_api_key") {
			console.log(
				"  key check: OK, but sending-only (cannot list domains). Fine for sending.",
			);
		} else {
			console.log(
				`  key check: FAILED -> HTTP ${response.status} ${body?.name ?? "?"} ${redact(body?.message)}`,
			);
			problems.push("The API key was rejected. Create a new one at resend.com/api-keys.");
		}
	}

	// 2. Sender sanity, no network call.
	let domain = "";
	if (from) {
		const match = from.match(/<([^>]+)>/) ?? from.match(/(\S+)$/);
		const address = match?.[1] ?? from;
		domain = address.includes("@") ? address.split("@").pop() : "";
		console.log(`  sender domain: ${domain || "(unparsable)"}`);
		if (domain.endsWith(TEST_SENDER) || domain === TEST_SENDER) {
			console.log(
				"  WARNING: this is Resend's test sender. It only delivers to the address",
			);
			console.log(
				"           that owns the Resend account. Every other recipient gets",
			);
			console.log(
				"           403 validation_error 'You can only send testing emails to your",
			);
			console.log(
				"           own email address'. Verify a domain, then set RESEND_FROM_EMAIL",
			);
			console.log("           to an address on it.");
			problems.push(
				"RESEND_FROM_EMAIL uses the test sender; real recipients cannot receive.",
			);
		}
	}

	// 3. Optional single real send.
	const to = sendToArg();
	if (to) {
		if (!apiKey || !from) {
			console.log("  send test: skipped (key or from is missing)");
		} else {
			console.log(`  send test: sending ONE message to ${to} ...`);
			const { response, body } = await resendFetch("/emails", apiKey, {
				method: "POST",
				body: JSON.stringify({
					from,
					to,
					subject: "Velure mail configuration test",
					text: "If you are reading this, Velure can deliver mail with the configured key and sender.",
					tags: [{ name: "source", value: "resend-doctor" }],
				}),
			});
			if (response.ok) {
				console.log(`  send test: ACCEPTED (id ${body?.id ?? "?"})`);
				console.log(
					"             ACCEPTED means Resend queued it. Delivery is confirmed by the",
				);
				console.log(
					"             email.delivered webhook, not by this response.",
				);
			} else {
				console.log(
					`  send test: REJECTED -> HTTP ${response.status} ${body?.name ?? "?"} ${redact(body?.message)}`,
				);
				problems.push("Resend rejected the send; see the status and message above.");
			}
		}
	}

	if (problems.length === 0) {
		console.log("\nNo configuration problems detected.");
		process.exit(0);
	}
	console.log(`\n${problems.length} problem(s):`);
	for (const p of problems) console.log(`  - ${p}`);
	process.exit(1);
}

main().catch((error) => {
	console.error("resend-doctor failed:", redact(error?.message ?? error));
	process.exit(1);
});
