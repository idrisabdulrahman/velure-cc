import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
	new URL("../../styles.css", import.meta.url),
	"utf8",
);

describe("marketing surface contract", () => {
	it("paints the light marketing surface when the document theme is dark", () => {
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
});
