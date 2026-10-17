import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NRS_INFORMATIONAL_DISCLAIMER } from "./nigeria";

/* E-invoicing SPEC fixes A1–A3: the product has no NRS clearance
 * integration, so no UI copy may imply one and no "FIRS" reference may
 * survive the NRS rename. These are source-level contract checks in the
 * style of marketing-surface.contract.test.ts — they pin the copy itself,
 * which rendering tests would only mirror. */

const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = `${dir}${entry.name}`;
		if (entry.isDirectory()) return sourceFiles(`${path}/`);
		if (!/\.(ts|tsx)$/.test(entry.name)) return [];
		// Test files may spell out banned words to assert against them, and
		// routeTree.gen.ts is generated from the route files themselves.
		if (/\.test\.tsx?$/.test(entry.name) || entry.name.endsWith(".gen.ts"))
			return [];
		return [path];
	});
}

function readRoute(name: string) {
	return readFileSync(new URL(`../../routes/${name}`, import.meta.url), "utf8");
}

describe("NRS honesty claims (e-invoicing SPEC A1-A3)", () => {
	it("keeps the disclaimer wording stable", () => {
		expect(NRS_INFORMATIONAL_DISCLAIMER).toBe(
			"Informational summary. Not a tax filing and not NRS-cleared.",
		);
	});

	it("renames FIRS to NRS everywhere in src UI and copy", () => {
		const offenders = sourceFiles(SRC_DIR).filter((path) =>
			/\bFIRS\b/.test(readFileSync(path, "utf8")),
		);
		expect(offenders).toEqual([]);
	});

	it("banners the Compliance page with the not-NRS-cleared disclaimer", () => {
		// A2: visible banner on the Compliance page, sourced from the shared
		// constant so the UI and export artifacts cannot drift.
		expect(readRoute("settings.compliance.tsx")).toContain(
			"NRS_INFORMATIONAL_DISCLAIMER",
		);
	});

	it("keeps the landing page from implying tax lines or NRS clearance", () => {
		// A1: "tax lines" claim removed from hero copy and meta description…
		const landing = readRoute("index.lazy.tsx");
		expect(landing).not.toMatch(/tax lines/i);
		expect(readRoute("index.tsx")).not.toMatch(/tax lines/i);
		// …and the compliance section states the missing clearance explicitly.
		expect(landing).toContain("not an NRS-certified e-invoicing provider");
		expect(landing).toMatch(/cannot get invoices\s+cleared through the MBS/);
	});
});
