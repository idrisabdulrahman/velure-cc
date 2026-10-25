import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * G1 browser boundary — proof that audit writes happen only on the server.
 *
 * `src/server/data/audit.ts` holds the service-role INSERT and
 * `src/server/data/paystack-server.ts` holds the remaining service-role
 * Paystack machinery; both must stay out of every browser-reachable module
 * (AGENTS.md §8: the service-role key never reaches a client bundle).
 *
 * This test walks the real import graph starting from the browser entry
 * modules (every route module under `src/routes/` — minus `src/routes/api/**`,
 * whose `server.handlers` TanStack Start extracts into server-only chunks —
 * plus `src/router.tsx`) and asserts:
 *
 *   1. no reachable module references `getSupabaseAdminClient` or imports
 *      `#/server/supabase`, and none of them is the server-only audit or
 *      Paystack module;
 *   2. the browser-safe transport (`./audit-client`) and the lifecycle
 *      modules ARE reachable — otherwise the walk would prove nothing.
 *
 * Type-only imports are erased at compile time and are not followed, so the
 * `import type { InvoiceAuditEntry }` edge from `./audit-client` into
 * `./audit` correctly does not count.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

function listFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) listFiles(path, out);
		else out.push(path);
	}
	return out;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
	let base: string;
	if (specifier.startsWith("#/")) base = join(SRC, specifier.slice(2));
	else if (specifier.startsWith("./") || specifier.startsWith("../"))
		base = resolve(dirname(fromFile), specifier);
	else return null; // bare package specifier: external, not our code.
	for (const candidate of [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
		join(base, "index.tsx"),
	]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

/** Remove comments so doc comments mentioning a symbol do not count as code. */
function stripComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Runtime import specifiers; `import type` / all-type import lists are erased. */
function runtimeSpecifiers(code: string): string[] {
	const specs: string[] = [];
	const importRe =
		/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:\{([^}]*)\}|[\w$]+)?\s*(?:,\s*\{[^}]*\})?\s*from\s*["']([^"']+)["']/g;
	for (const match of code.matchAll(importRe)) {
		if (match[1]) continue;
		const braces = match[2];
		if (braces !== undefined && braces.trim().length > 0) {
			const parts = braces
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			if (parts.length > 0 && parts.every((part) => /^type\s/.test(part)))
				continue;
		}
		specs.push(match[3]);
	}
	for (const match of code.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
		specs.push(match[1]);
	}
	return specs;
}

function browserSeeds(): string[] {
	const routeDir = join(SRC, "routes");
	return [
		...listFiles(routeDir).filter(
			(path) =>
				/\.(ts|tsx)$/.test(path) &&
				!`${path}`.startsWith(`${join(routeDir, "api")}/`),
		),
		join(SRC, "router.tsx"),
	];
}

function walkFromBrowserEntries(): Set<string> {
	const seen = new Set<string>();
	const queue = browserSeeds();
	expect(queue.length).toBeGreaterThan(20);
	while (queue.length > 0) {
		const file = queue.pop() as string;
		if (seen.has(file)) continue;
		seen.add(file);
		const code = stripComments(readFileSync(file, "utf8"));
		for (const specifier of runtimeSpecifiers(code)) {
			const target = resolveSpecifier(file, specifier);
			if (!target) continue;
			// The generated route registry references every route module,
			// API routes included; TanStack Start strips `server.handlers`
			// from the client build, so it is not a browser code edge.
			if (target.endsWith("routeTree.gen.ts")) continue;
			if (!seen.has(target)) queue.push(target);
		}
	}
	return seen;
}

function referencesServiceRole(file: string): boolean {
	const code = stripComments(readFileSync(file, "utf8"));
	return (
		/from\s*["'][^"']*server\/supabase["']/.test(code) ||
		/from\s*["']\.\.?\/supabase["']/.test(code) ||
		/\bgetSupabaseAdminClient\s*\(/.test(code)
	);
}

function relative(file: string): string {
	return file.slice(SRC.length);
}

describe("browser boundary (no service-role code client-side)", () => {
	const reachable = walkFromBrowserEntries();

	it("walks the real lifecycle modules, so the proof is not vacuous", () => {
		for (const probe of [
			"server/data/audit-client.ts",
			"server/data/invoices.ts",
			"server/data/payments.ts",
			"server/data/compliance.ts",
		]) {
			expect(reachable.has(join(SRC, probe)), probe).toBe(true);
		}
		expect(reachable.size).toBeGreaterThan(50);
	});

	it("never reaches getSupabaseAdminClient from browser-imported code", () => {
		const offenders = [...reachable].filter(referencesServiceRole);
		expect(offenders.map(relative)).toEqual([]);
	});

	it("keeps the server-only audit, Paystack and session modules out of the browser graph", () => {
		for (const forbidden of [
			"server/data/audit.ts",
			"server/data/paystack-server.ts",
			"server/supabase.ts",
			"server/invoice-repository.ts",
			"routes/api/invoice/audit.ts",
		]) {
			expect(reachable.has(join(SRC, forbidden)), forbidden).toBe(false);
		}
	});

	it("routes the browser audit write through ./audit-client only", () => {
		const client = readFileSync(
			join(SRC, "server/data/audit-client.ts"),
			"utf8",
		);
		expect(client).toContain("/api/invoice/audit");
		expect(
			referencesServiceRole(join(SRC, "server/data/audit-client.ts")),
		).toBe(false);
		// Every lifecycle module takes its audit write from the transport,
		// never from the server-only service.
		for (const module of ["invoices.ts", "payments.ts", "compliance.ts"]) {
			const source = readFileSync(join(SRC, "server/data", module), "utf8");
			expect(source).toContain('from "./audit-client"');
			expect(source).not.toMatch(/from "\.\/audit"/);
		}
	});
});
