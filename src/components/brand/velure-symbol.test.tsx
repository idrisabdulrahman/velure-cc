import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VelureSymbol } from "./velure-symbol";

const styles = readFileSync(
	new URL("../../styles.css", import.meta.url),
	"utf8",
);
const source = readFileSync(
	new URL("./velure-symbol.tsx", import.meta.url),
	"utf8",
);

const read = (path: string) =>
	readFileSync(new URL(path, import.meta.url), "utf8");
const kit = (file: string) =>
	readFileSync(
		new URL(`../../../design/brand/kit/${file}`, import.meta.url),
		"utf8",
	);

/** Path data of a `const NAME = "…" [+ "…"]` declaration, whitespace-normalised. */
function constant(name: string): string {
	const block = new RegExp(`const ${name} =([\\s\\S]*?);`).exec(source)?.[1];
	if (!block) throw new Error(`missing constant ${name}`);
	return (block.match(/"([^"]*)"/g) ?? [])
		.map((part) => part.slice(1, -1))
		.join("")
		.replace(/\s+/g, " ")
		.trim();
}

/** Every path `d` in a kit master, whitespace-normalised. */
function kitPaths(file: string): string[] {
	return [...kit(file).matchAll(/ d="([^"]+)"/g)].map((match) =>
		match[1].replace(/\s+/g, " ").trim(),
	);
}

/** The element each occurrence of the mark sits in, one string per usage. */
function wrappers(file: string): string[] {
	return [...file.matchAll(/<\w+[^>]*?>\s*<VelureSymbol/gs)].map(
		(match) => match[0],
	);
}

describe("velure symbol", () => {
	it("takes its arms from the theme ink token, so the mark flips with `.dark`", () => {
		const markup = renderToStaticMarkup(<VelureSymbol />);

		expect(markup).toContain('style="fill:var(--hm-ink)"');
		expect(markup).toContain('fill="#EA373E"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).not.toContain("<title");

		// `:root` (light), `.dark` (dark) and `.hm` (always-dark marketing)
		// each declare the token, so no scope can render an invisible mark.
		// The `.hm` pattern tolerates one nested brace level: its header
		// comment quotes `body{font:16px/1.55}`.
		expect(styles).toMatch(/:root \{[^}]*--hm-ink:/s);
		expect(styles).toMatch(
			/\.dark,\s*\.dark \.hm-app,\s*\.hm-app\.dark \{[^}]*--hm-ink:/s,
		);
		expect(styles).toMatch(/\.hm \{(?:[^{}]|\{[^{}]*\})*--hm-ink:/s);
	});

	it("never pins the arms to a fixed ink or re-tints the level", () => {
		expect(source).not.toContain("#180F0A");
		expect(source).not.toContain("var(--hm-accent)");
	});

	it("keeps an accessible name only when the mark stands alone", () => {
		const labelled = renderToStaticMarkup(<VelureSymbol label="Velure" />);

		expect(labelled).toContain("<title>Velure</title>");
		expect(labelled).not.toContain('aria-hidden="true"');
		expect(labelled).toContain('role="img"');
	});

	it("matches the kit masters path for path", () => {
		const [outline, level] = kitPaths("velure-symbol.svg");

		expect(constant("V_OUTLINE")).toBe(outline);
		expect(constant("V_LEVEL")).toBe(level);
	});

	it("is what the app surfaces render — bare, with no typed letter left behind", () => {
		const dashboard = read("../dashboard/DashboardLayout.tsx");
		const auth = read("../../routes/auth.lazy.tsx");

		expect(dashboard.match(/<VelureSymbol/g)).toHaveLength(2);
		expect(auth.match(/<VelureSymbol/g)).toHaveLength(1);

		// No tile, chip or coloured background behind the mark: the artwork
		// carries the surface, so one component works on every page and mode.
		for (const [name, file] of [
			["dashboard", dashboard],
			["auth", auth],
		] as const) {
			const wraps = wrappers(file);
			expect(wraps.length, name).toBeGreaterThan(0);
			for (const wrap of wraps) {
				expect(wrap, `${name}: ${wrap}`).not.toMatch(/\bbg-|background:/);
			}
			expect(file, name).not.toMatch(/^\s*V\s*$/m);
		}
	});
});
