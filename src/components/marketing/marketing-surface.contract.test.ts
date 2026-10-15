import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
	new URL("../../styles.css", import.meta.url),
	"utf8",
);

describe("marketing surface contract", () => {
	it("paints the marketing surface from the .hm token scope when the document theme is dark", () => {
		const marketingScope = styles.slice(
			styles.indexOf(".hm {"),
			styles.indexOf("/* ── Editorial utility classes"),
		);

		expect(marketingScope).toContain("background-color: var(--hm-paper);");
		expect(marketingScope).toContain("color: var(--hm-ink);");
		expect(marketingScope).toMatch(
			/\.hm #smooth-content\s*{[^}]*background-color: var\(--hm-paper\);/s,
		);
	});

	it("declares the marketing palette in the .hm scope rather than inheriting it", () => {
		const marketingScope = styles.slice(
			styles.indexOf(".hm {"),
			styles.indexOf("/* ── Editorial utility classes"),
		);

		// The .hm scope owns every surface/line/text/accent value, so neither
		// `:root` light mode nor `.dark` on <html> can re-point it.
		for (const token of [
			"--hm-paper:",
			"--hm-paper-2:",
			"--hm-paper-3:",
			"--hm-paper-4:",
			"--hm-rule:",
			"--hm-rule-soft:",
			"--hm-ink:",
			"--hm-accent:",
			"--hm-font-num:",
			"--hm-r-card:",
		]) {
			expect(marketingScope).toContain(token);
		}
	});
});
