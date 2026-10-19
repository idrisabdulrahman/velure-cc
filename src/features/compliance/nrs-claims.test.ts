import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	NRS_INFORMATIONAL_DISCLAIMER,
	NRS_OFFICIAL_SOURCES,
	NRS_OFFICIAL_SOURCES_INTRO,
} from "./nigeria";

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

/* The rendered "Official sources" section itself, sliced out of the route
 * source between its aria-label and closing tag. Slicing lets assertions bind
 * to the actual markup of the source list instead of passing on independent
 * file-wide substrings that could survive the anchors losing their attributes. */
function officialSourcesSection(route: string): string {
	const start = route.indexOf('aria-label="Official sources"');
	const end = start === -1 ? -1 : route.indexOf("</section>", start);
	if (start === -1 || end === -1) {
		throw new Error("Official sources section missing from route source");
	}
	return route.slice(start, end);
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

/* Official-sources grounding for the same copy. The URLs were fetched live
 * and verified genuine; these tests pin them, their scheme, the
 * non-affiliation wording, and the absence of claim words so the
 * "further reading" block can never drift into a compliance claim. */

const NRS_OFFICIAL_SOURCE_URLS = [
	"https://community.nrsmbs.com/kb/what-is-mbs-e-invoicing",
	"https://community.nrsmbs.com/kb/clearance-reporting",
	"https://einvoice.nrs.gov.ng/",
	"https://nrs.gov.ng/",
];

const NON_AFFILIATION_PHRASE = "not connected to or endorsed by the NRS";

/* Banned in the official-sources copy — both the shared constants and the
 * route slice that renders the section. Scoped to claim words that would
 * turn a reference list into a compliance/clearance/certification claim;
 * "endorsed" is only ever allowed inside the non-affiliation phrase, which
 * is pinned separately. */
const BANNED_SOURCE_CLAIM_PATTERNS: RegExp[] = [
	/\bcompliant\b/i,
	/\bcertified\b/i,
	/\bcertification\b/i,
	/\baccredited\b/i,
	/\bcleared by\b/i,
	/\bcleared with\b/i,
	/\bapproved by\b/i,
	/\bofficial partner\b/i,
	/\bpartner(ed|ship) with\b/i,
	/\bauthori[sz]ed (agent|reseller|integrator)\b/i,
	/\bworks? (closely )?with the nrs\b/i,
];

function officialSourcesCopy(): string {
	return [
		NRS_OFFICIAL_SOURCES_INTRO,
		...NRS_OFFICIAL_SOURCES.flatMap((source) => [
			source.title,
			source.description,
		]),
	].join("\n");
}

describe("NRS official sources grounding", () => {
	it("pins the four verified official source URLs, all https", () => {
		expect(NRS_OFFICIAL_SOURCES.map((source) => source.url)).toEqual(
			NRS_OFFICIAL_SOURCE_URLS,
		);
		for (const url of NRS_OFFICIAL_SOURCE_URLS) {
			expect(url.startsWith("https://")).toBe(true);
		}
	});

	it("lists every source on the Compliance surface with new-tab-safe links", () => {
		// The URLs live in the shared constant, so pin the constant plus the
		// route's render wiring: the surface must import and map over it, and
		// the safe attributes must sit on the source anchors themselves —
		// inside the "Official sources" section, in the same tag as the href —
		// so they cannot migrate to an unrelated anchor elsewhere in the file.
		const route = readRoute("settings.compliance.tsx");
		expect(route).toContain("NRS_OFFICIAL_SOURCES");
		expect(route).toContain("NRS_OFFICIAL_SOURCES_INTRO");
		const section = officialSourcesSection(route);
		expect(section).toContain("NRS_OFFICIAL_SOURCES.map");
		expect(section).toContain("NRS_OFFICIAL_SOURCES_INTRO");
		const anchorTags = section.match(/<a\b[\s\S]*?>/g) ?? [];
		expect(anchorTags.length).toBeGreaterThan(0);
		for (const tag of anchorTags) {
			expect(tag).toMatch(/href=\{[^}]*\}/);
			expect(tag).toContain('target="_blank"');
			expect(tag).toContain('rel="noopener noreferrer"');
		}
		// The banner stays above it, untouched.
		expect(route).toContain("NRS_INFORMATIONAL_DISCLAIMER");
	});

	it("states that Velure is not connected to or endorsed by the NRS", () => {
		expect(NRS_OFFICIAL_SOURCES_INTRO).toContain(NON_AFFILIATION_PHRASE);
	});

	it("keeps claim words out of the official-sources copy", () => {
		// Scan both the shared constants and the route slice that renders the
		// section, so route-level literals (the heading, future sibling copy)
		// obey the same ban as the constant-sourced copy.
		const route = readRoute("settings.compliance.tsx");
		const section = officialSourcesSection(route);
		const copy = officialSourcesCopy();
		for (const pattern of BANNED_SOURCE_CLAIM_PATTERNS) {
			expect(copy, pattern.source).not.toMatch(pattern);
			expect(section, pattern.source).not.toMatch(pattern);
		}
		// "endorsed" survives only inside the negated phrase.
		for (const scanned of [copy, section]) {
			expect(
				scanned.replace(new RegExp(NON_AFFILIATION_PHRASE, "gi"), ""),
			).not.toMatch(/\bendorsed\b/i);
		}
	});
});
