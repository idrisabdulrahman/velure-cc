/**
 * Legacy-hex -> design.md token remap generator.
 *
 * The app tree carries ~1800 inline Tailwind arbitrary-value colour utilities
 * from the previous brutalist dark system. Rather than rewrite every call site,
 * this censuses the actual class tokens in source and emits a remap layer that
 * points each one at a `--hm-*` token from design.md.
 *
 * Token-precise on purpose: it matches whole class tokens with `[class~=]` (not
 * substrings), so `hover:bg-[#x]` only paints on `:hover`, and it preserves
 * `/opacity` modifiers via color-mix.
 *
 *   node scripts/hm-census.mjs          # review table
 *   node scripts/hm-census.mjs --css    # the remap block for src/styles.css
 *
 * Paste `--css` output into the marked block in src/styles.css. Delete rules as
 * their routes get converted to `.hm-*` primitives; new code must be token-only.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/routes", "src/components"];
const SKIP = new Set(["node_modules", "dist", ".output"]);

/** Tailwind variant prefix -> selector suffix. */
const VARIANT = {
	"": "",
	"hover:": ":hover",
	"focus:": ":focus",
	"focus-visible:": ":focus-visible",
	"disabled:": ":disabled",
	"placeholder:": "::placeholder",
	"data-[state=checked]:": '[data-state="checked"]',
	"data-[state=unchecked]:": '[data-state="unchecked"]',
	"data-[state=open]:": '[data-state="open"]',
	"data-[state=indeterminate]:": '[data-state="indeterminate"]',
	"[&>div]:": " > div",
};

/** role -> [css property, extra selector suffix] */
const ROLE = {
	bg: ["background-color", ""],
	text: ["color", ""],
	border: ["border-color", ""],
	"border-l": ["border-left-color", ""],
	"border-r": ["border-right-color", ""],
	"border-t": ["border-top-color", ""],
	"border-b": ["border-bottom-color", ""],
	"border-x": ["border-inline-color", ""],
	"border-y": ["border-block-color", ""],
	"border-s": ["border-inline-start-color", ""],
	"border-e": ["border-inline-end-color", ""],
	divide: ["border-color", " > * + *"],
	fill: ["fill", ""],
	stroke: ["stroke", ""],
	outline: ["outline-color", ""],
	ring: ["--tw-ring-color", ""],
	shadow: ["box-shadow", ""],
};

/**
 * Structural values (gradients, inset shadows) whose whole declaration is
 * rewritten rather than reduced to a single colour. Keyed by raw arbitrary value.
 */
const STRUCTURAL = {
	"linear-gradient(180deg,#181a1d_0%,#141715_100%)":
		"linear-gradient(180deg, var(--hm-paper-2) 0%, var(--hm-paper) 100%)",
	"inset_3px_0_0_#c8ff62": "inset 3px 0 0 var(--hm-accent)",
};

function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (SKIP.has(entry)) continue;
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (path.endsWith(".tsx")) out.push(path);
	}
	return out;
}

/* ── colour geometry ─────────────────────────────────────────────────────── */

function expand(hex) {
	const h = hex.slice(1).toLowerCase();
	if (h.length === 3 || h.length === 4)
		return h
			.split("")
			.map((c) => c + c)
			.join("");
	return h;
}

function channels(hex) {
	const h = expand(hex);
	return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
}

/** alpha baked into an 8-digit hex, or null */
function alphaOf(hex) {
	const h = expand(hex);
	return h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : null;
}

/** relative luminance, 0..1 */
function lum(hex) {
	const [r, g, b] = channels(hex).map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** [hue in degrees, saturation 0..1, absolute channel spread 0..1] */
function hueSat(hex) {
	const [r, g, b] = channels(hex);
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d === 0) return [0, 0, 0];
	let hue;
	if (max === r) hue = ((g - b) / d) % 6;
	else if (max === g) hue = (b - r) / d + 2;
	else hue = (r - g) / d + 4;
	return [(hue * 60 + 360) % 360, d / max, d];
}

/**
 * Semantic family. The legacy system is olive/lime on near-black: anything with
 * real chroma is a status colour, everything neutral is paper/ink/rule.
 *
 * Both tests matter. HSV saturation alone calls #1a2117 (the standard row
 * hover) a status green, because near black a 10/255 channel spread is a large
 * *ratio*. Absolute spread alone would let a washed pastel through. A colour is
 * only a status colour if it is both proportionally and visibly chromatic.
 */
function family(hex) {
	const [hue, sat, spread] = hueSat(hex);
	if (sat < 0.18 || spread < 0.1) return "neutral";
	if (hue >= 340 || hue < 20) return "danger";
	// 20-70deg is amber/gold, not red — saturation does not make it danger
	if (hue < 70) return "warn";
	if (hue < 100) return "accent"; // legacy lime #c8ff62
	if (hue < 175) return "ok";
	if (hue < 260) return "info";
	return "danger";
}

/**
 * Legacy hex -> design.md token, per role. Dark-system luminance reads inverted:
 * the darkest legacy surface is the lightest paper.
 */
function tokenFor(hex, role) {
	const L = lum(hex);
	const fam = family(hex);
	const paint = role === "text" || role === "fill" || role === "stroke";
	const line = role.startsWith("border") || role === "divide";

	if (role === "ring" || role === "outline") return "--hm-focus";

	if (paint) {
		if (fam === "accent") return "--hm-accent";
		if (fam === "danger") return "--hm-danger";
		if (fam === "warn") return "--hm-warn";
		if (fam === "ok") return "--hm-ok";
		if (fam === "info") return "--hm-info";
		if (L < 0.06) return "--hm-accent-ink"; // dark label sitting on a lime fill
		if (L > 0.75) return "--hm-ink";
		if (L > 0.55) return "--hm-ink-2";
		return "--hm-ink-3";
	}

	if (line) {
		// A dark olive hairline is a rule, not a functional accent. Promoting it
		// would blow design.md's "accent footprint <= 5% per viewport".
		if (fam === "accent") return L > 0.4 ? "--hm-accent" : "--hm-rule";
		if (fam === "danger") return "--hm-danger-line";
		if (fam === "warn") return "--hm-warn-line";
		if (fam === "ok") return "--hm-ok-line";
		if (fam === "info") return "--hm-info-line";
		return "--hm-rule";
	}

	// Surfaces. In the legacy dark system a mid-dark saturated fill IS the strong
	// state — #7f1d1d is a destructive button, not a tint — so chroma decides
	// strength, not luminance.
	const strong = L > 0.4 || hueSat(hex)[2] > 0.25;
	if (fam === "accent") return L > 0.6 ? "--hm-accent" : "--hm-accent-soft";
	if (fam === "danger") return strong ? "--hm-danger" : "--hm-danger-soft";
	if (fam === "warn") return strong ? "--hm-warn" : "--hm-warn-soft";
	if (fam === "ok") return strong ? "--hm-ok" : "--hm-ok-soft";
	if (fam === "info") return strong ? "--hm-info" : "--hm-info-soft";
	if (L > 0.75) return "--hm-ink"; // a light fill in a dark system is an ink block
	if (L < 0.012) return "--hm-paper";
	if (L < 0.02) return "--hm-paper-2";
	return "--hm-paper-3";
}

/* ── census ──────────────────────────────────────────────────────────────── */

const CLASS_TOKEN =
	/[a-zA-Z0-9_:&>[\]=.-]*-\[[^\]"' ]*#[0-9a-fA-F]{3,8}[^\]"' ]*\](?:\/[0-9.]+)?/g;

const files = ROOTS.flatMap((root) => walk(root));
const tokens = new Map(); // raw class token -> Set<file>

for (const file of files) {
	const source = readFileSync(file, "utf8");
	for (const [raw] of source.matchAll(CLASS_TOKEN)) {
		if (!tokens.has(raw)) tokens.set(raw, new Set());
		tokens.get(raw).add(file);
	}
}

const parsed = [];
const skipped = [];

for (const [raw, where] of tokens) {
	// `dark:` utilities belong to the dark theme, which keeps its own values
	if (raw.includes("dark:")) {
		skipped.push([raw, "dark: variant"]);
		continue;
	}

	const cut = raw.lastIndexOf(":");
	const variant = cut === -1 ? "" : raw.slice(0, cut + 1);
	const rest = raw.slice(cut + 1);

	if (!(variant in VARIANT)) {
		skipped.push([raw, `unmapped variant "${variant}"`]);
		continue;
	}

	const shape = rest.match(/^([a-z-]+)-\[(.*)\](?:\/([0-9.]+))?$/);
	if (!shape) {
		skipped.push([raw, "unparsed shape"]);
		continue;
	}
	const [, role, value, opacity] = shape;

	if (!(role in ROLE)) {
		skipped.push([raw, `unmapped role "${role}"`]);
		continue;
	}

	const hexes = [...value.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0]);
	const structural = STRUCTURAL[value];

	if (!structural && hexes.length !== 1) {
		skipped.push([raw, `${hexes.length} hexes and no structural mapping`]);
		continue;
	}

	const token = structural ? null : tokenFor(hexes[0], role);
	// A `/40` modifier and an 8-digit hex both mean transparency, and one token
	// can carry both. Dropping the baked alpha erases disabled affordances.
	const baked = structural ? null : alphaOf(hexes[0]);
	const alpha = (opacity ? Number(opacity) / 100 : 1) * (baked ?? 1);
	let declaration;
	if (structural) {
		declaration = structural;
	} else if (alpha < 1) {
		declaration = `color-mix(in oklab, var(${token}) ${Math.round(
			alpha * 100,
		)}%, transparent)`;
	} else {
		declaration = `var(${token})`;
	}

	parsed.push({
		raw,
		variant,
		role,
		value,
		opacity: alpha < 1 ? String(Math.round(alpha * 100)) : null,
		hex: hexes[0] ?? "—",
		token: structural ? "(structural)" : token,
		declaration,
		files: where.size,
	});
}

/* ── output ──────────────────────────────────────────────────────────────── */

parsed.sort(
	(a, b) =>
		a.role.localeCompare(b.role) ||
		a.token.localeCompare(b.token) ||
		a.raw.localeCompare(b.raw),
);

if (process.argv.includes("--css")) {
	// group identical (property, declaration, suffix) so selectors collapse
	const groups = new Map();
	for (const row of parsed) {
		const [property, roleSuffix] = ROLE[row.role];
		const suffix = VARIANT[row.variant] + roleSuffix;
		const key = `${property}|${row.declaration}|${suffix}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(row.raw);
	}

	const blocks = [];
	for (const [key, raws] of [...groups].sort()) {
		const [property, declaration, suffix] = key.split("|");
		const selectors = raws
			.sort()
			.map((raw) => `[class~="${raw}"]${suffix}`)
			.join(",\n");
		blocks.push(`${selectors} {\n  ${property}: ${declaration} !important;\n}`);
	}

	console.log(
		"/* generated by scripts/hm-census.mjs — do not hand-edit, regenerate */",
	);
	console.log(blocks.join("\n\n"));
	if (skipped.length) {
		console.log(`\n/* not remapped (${skipped.length}):`);
		for (const [raw, why] of skipped.sort())
			console.log(` *   ${raw} — ${why}`);
		console.log(" */");
	}
} else {
	console.log(`files scanned:   ${files.length}`);
	console.log(`class tokens:    ${tokens.size}`);
	console.log(`remapped:        ${parsed.length}`);
	console.log(`skipped:         ${skipped.length}\n`);
	const head = ["role", "variant", "hex", "op", "token", "class token"];
	const width = [11, 24, 10, 5, 20, 0];
	console.log(head.map((h, i) => h.padEnd(width[i])).join(""));
	for (const row of parsed)
		console.log(
			row.role.padEnd(width[0]) +
				(row.variant || "—").padEnd(width[1]) +
				row.hex.padEnd(width[2]) +
				(row.opacity ?? "—").padEnd(width[3]) +
				row.token.padEnd(width[4]) +
				row.raw,
		);
	if (skipped.length) {
		console.log("\nskipped:");
		for (const [raw, why] of skipped.sort()) console.log(`  ${raw} — ${why}`);
	}
}
