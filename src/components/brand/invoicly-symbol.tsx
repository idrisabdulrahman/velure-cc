/**
 * Invoicly "The Figure" symbol, drawn inline so it can follow the active theme.
 *
 * The kit masters (`design/brand/invoicly/invoicly-mark-*.svg`) are two fixed
 * treatments — ink for light surfaces, paper for dark ones — and an `<img>`
 * cannot switch when `.dark` flips. So the app renders the same paths inline:
 *
 *   stem    `var(--hm-ink)`  near-black on a light surface, paper on a dark one
 *                            (`:root`, `.dark` and the marketing `.hm` scope all
 *                            define it, so every scope resolves correctly),
 *   figure  `#EA373E`        the locked warm red, identical everywhere
 *                            (design.md `--hm-accent`; the logo is never
 *                            re-tinted to a scope's accent variant).
 *
 * The mark is placed bare — no tile, chip or coloured background behind it
 * (guidelines §10 pairs the colour mark with paper/ink surfaces; a container is
 * only for photography, and the favicon is the deliberate exception).
 *
 * The mark is a lowercase `i`: a 56 x 56 accent square (the tittle) over a
 * 48 x 112 ink stem, 16 units apart on a 4-unit grid. Path data is copied
 * verbatim from the masters — never retype or restyle it, and never recreate
 * the wordmark by typing "Invoicly".
 */

/** The figure (tittle) — a 56 x 56 square, the single warm-red accent. */
const FIGURE = "M0 0H56V56H0Z";

/** The stem — 48 x 112, bottom-aligned with the mark box. */
const STEM = "M4 72H52V184H4Z";

export interface InvoiclySymbolProps {
	/** Size and placement — the SVG scales to whatever box it is given. */
	className?: string;
	/** Only when the mark stands alone; omit it next to a text label. */
	label?: string;
}

export function InvoiclySymbol({ className, label }: InvoiclySymbolProps) {
	return (
		<svg
			viewBox="0 0 56 184"
			width={56}
			height={184}
			className={className}
			focusable="false"
			aria-hidden={label ? undefined : true}
			role={label ? "img" : undefined}
			style={{ fill: "var(--hm-ink)" }}
		>
			{label ? <title>{label}</title> : null}
			<path d={FIGURE} fill="#EA373E" />
			<path d={STEM} />
		</svg>
	);
}
