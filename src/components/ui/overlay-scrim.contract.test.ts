import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlayPrimitives = ["alert-dialog.tsx", "dialog.tsx", "sheet.tsx"];

const styles = readFileSync(
	new URL("../../styles.css", import.meta.url),
	"utf8",
);

function source(file: string) {
	return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

/** Lightness (0–100%) of every `--hm-scrim` declaration, in order. */
function scrimLightnesses(): number[] {
	return styles
		.split("--hm-scrim:")
		.slice(1)
		.map((decl) => {
			const match = /oklch\(([\d.]+)%/.exec(decl);
			return match ? Number(match[1]) : Number.NaN;
		});
}

describe("overlay scrim contract", () => {
	it("paints every overlay scrim from the theme-aware --hm-scrim token", () => {
		for (const file of overlayPrimitives) {
			expect(source(file), file).toContain("bg-[var(--hm-scrim)]");
		}
	});

	it("never derives an overlay scrim from ink — ink flips to near-white in dark mode", () => {
		// `bg-ink/60 dark:bg-ink/80` painted a white wash behind the invoice
		// cleanup dialog: --hm-ink is oklch(95%) under .dark, so the scrim
		// inverted instead of darkening. The token carries both themes.
		for (const file of overlayPrimitives) {
			expect(source(file), file).not.toMatch(/bg-ink\//);
		}
	});

	it("declares the dark-mode scrim as a genuinely dark wash", () => {
		const lightnesses = scrimLightnesses();
		expect(lightnesses.length).toBeGreaterThanOrEqual(2);
		for (const lightness of lightnesses) {
			expect(Number.isNaN(lightness)).toBe(false);
			// Below 50% keeps every declaration on the dark side of the ramp, so
			// a scrim can never read as a light sheet over dark content.
			expect(lightness).toBeLessThan(50);
		}
	});
});
