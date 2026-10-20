/**
 * Velure "Level V" symbol, drawn inline so it can follow the active theme.
 *
 * The kit masters (`design/brand/kit/velure-symbol*.svg`) are two fixed
 * treatments — ink for light surfaces, paper for dark ones — and an `<img>`
 * cannot switch when `.dark` flips. So the app renders the same paths inline:
 *
 *   arms  `var(--hm-ink)`  near-black on a light surface, paper on a dark one
 *                          (`:root`, `.dark` and the marketing `.hm` scope all
 *                          define it, so every scope resolves correctly),
 *   level `#EA373E`        the locked warm red, identical everywhere
 *                          (design.md `--hm-accent`; the logo is never
 *                          re-tinted to a scope's accent variant).
 *
 * The mark is placed bare — no tile, chip or coloured background behind it
 * (guidelines §4 pairs the colour mark with paper/white and the reversed mark
 * with dark surfaces; a container is only for photography).
 *
 * Path data is copied verbatim from the masters — never retype or restyle it,
 * and never recreate the wordmark by typing "Velure".
 */

/** Full outline of the symbol's V (kit `velure-symbol.svg`). */
const V_OUTLINE =
	"M32 45.72 L78.19 45.72 L128 132 L177.81 45.72 L224 45.72 L128 212 Z";

/** The level fill — the single warm-red accent. */
const V_LEVEL =
	"M69.11 110 L128 212 L186.89 110 L140.70 110 L128 132 L115.30 110 Z";

export interface VelureSymbolProps {
	/** Size and placement — the SVG scales to whatever box it is given. */
	className?: string;
	/** Only when the mark stands alone; omit it next to a text label. */
	label?: string;
}

export function VelureSymbol({ className, label }: VelureSymbolProps) {
	return (
		<svg
			viewBox="0 0 256 256"
			className={className}
			focusable="false"
			aria-hidden={label ? undefined : true}
			role={label ? "img" : undefined}
			style={{ fill: "var(--hm-ink)" }}
		>
			{label ? <title>{label}</title> : null}
			<path d={V_OUTLINE} />
			<path d={V_LEVEL} fill="#EA373E" />
		</svg>
	);
}
