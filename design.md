# Design — Velure

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Implemented as a token block in [`src/styles.css`](src/styles.css) (search for the
`Hallmark ·` stamp). Tokens live on `:root`; two scope classes consume them —
`.hm` for marketing and `.hm-app` for the dashboard. `.hm-app` is the only scope
that re-points tokens for dark mode, so marketing stays pure-white paper in
either theme.

## Genre

**editorial** — dark editorial paper as the workbench canvas, warm-red accent
as the single functional colour, italic display emphasis with mono caps labels,
departure-board tables and ticket-stamp status chips. The reference register
is the Wayfare travel site: not the literal copy or layout, but the visual DNA
— warm cream paper in the marketing scope, deep editorial paper in the app
scope, a warm red `#EA373E` as the single accent that carries every CTA, link,
focus ring, and 'live' indicator.

Genre bans that stay in force: saturated consumer pinks/purples as *fills*,
emoji-as-ornament, bouncy/overshoot easings, glassmorphism, gradient text,
italic *display* type (italic is reserved for the emphasis slot inside an
otherwise-upright heading), rotated ticket stamps, N5 floating pill nav, N6
newspaper masthead, Ft6 letter close.

## Macrostructure family

- **Marketing pages: Split Studio.** Left copy / right product card hero, a
  hairline checkpoint strip, then alternating bands. Variation knobs: hero
  archetype (H2 split diptych is the default), which body archetypes appear
  (F1 bento · F4 step sequence · T4 stat strip), and their order.
- **App pages: Workbench.** Same tokens, same type, same radii, scoped under
  `.hm-app`. Not Split Studio — no hero, no wash, no marketing rhythm. The
  workbench is a sidebar + topbar + working canvas: page title, then panels,
  tables, and stat tiles on `--hm-paper` sitting on a `--hm-paper-2` canvas.
  Density over drama. See "App surface" below.
- **Content pages (privacy, terms): Split Studio, typography only.** Same nav,
  hero, and footer; body is a long document. No enrichment, no bento.

## Theme

Custom (tuned) · axes: **light / grotesque / warm-red**.
Vibe: *editorial ledger* — warm cream paper in marketing, deep editorial paper
in the workbench, warm red `#EA373E` as the single functional accent, status
triples in a muted gold / rose / cyan / paper palette. Inspired by the Wayfare
travel-site reference register, not a copy of it.

### Editorial palette (light mode, `:root`)

| Role | Value |
| --- | --- |
| `--hm-paper` | `oklch(98.2% 0.006 70)` |
| `--hm-paper-2` | `oklch(95.8% 0.008 70)` |
| `--hm-paper-3` | `oklch(92% 0.012 70)` |
| `--hm-ink` | `oklch(18% 0.018 50)` |
| `--hm-ink-2` | `oklch(38% 0.022 50)` |
| `--hm-ink-3` | `oklch(50% 0.018 50)` |
| `--hm-rule` | `oklch(86% 0.014 60)` |
| `--hm-accent` | `oklch(62% 0.21 27)` ← `#EA373E` re-encoded |
| `--hm-accent-hi` | `oklch(56% 0.22 27)` |
| `--hm-accent-ink` | `oklch(98.5% 0.005 70)` |
| `--hm-accent-soft` | `oklch(94% 0.04 27)` |
| `--hm-accent-line` | `oklch(78% 0.08 27)` |
| `--hm-focus` | `oklch(62% 0.21 27)` |
| `--hm-ok` | `oklch(50% 0.1 162)` (muted green — paid) |
| `--hm-warn` | `oklch(62% 0.12 75)` (muted gold — attention / partial) |
| `--hm-danger` | `oklch(55% 0.16 22)` (muted rose — overdue / destructive) |
| `--hm-info` | `oklch(55% 0.1 215)` (muted cyan — active / open) |

### Editorial palette (dark mode, `.dark .hm-app`)

| Role | Value |
| --- | --- |
| `--hm-paper` | `oklch(16% 0.012 50)` |
| `--hm-paper-2` | `oklch(12% 0.012 50)` |
| `--hm-paper-3` | `oklch(20% 0.014 50)` |
| `--hm-ink` | `oklch(95% 0.008 70)` |
| `--hm-ink-2` | `oklch(82% 0.014 70)` |
| `--hm-ink-3` | `oklch(66% 0.014 60)` |
| `--hm-rule` | `oklch(28% 0.014 50)` |
| `--hm-accent` | `oklch(65% 0.2 27)` |
| `--hm-accent-hi` | `oklch(72% 0.18 27)` |
| `--hm-accent-ink` | `oklch(16% 0.012 50)` |
| `--hm-accent-soft` | `oklch(26% 0.08 27)` |
| `--hm-accent-line` | `oklch(42% 0.13 27)` |
| `--hm-focus` | `oklch(72% 0.2 27)` |

Status triples follow the same shape but shifted for dark paper
(`oklch(74% 0.13 162)` for ok, `oklch(78% 0.12 75)` for warn,
`oklch(72% 0.14 22)` for danger, `oklch(74% 0.1 215)` for info).

### Marketing scope (`.hm`)

The marketing surface is always light. When `<html>` carries `.dark`, the
`.hm` block re-declares every light-mode token so the marketing surface never
goes dark — only the authenticated app scope does. The user's persisted toggle
wins on the app scope; the marketing scope is light in both directions.

### Status triples

Every status colour is a **triple**: `--hm-ok` (fill), `--hm-ok-soft` (tint),
`--hm-ok-line` (hairline), and the same for `warn` / `danger` / `info`. A pill is
soft fill + line border + base text; a solid button is base fill +
`--hm-accent-ink` text. Never mix the three across a component.

The status palette is **separate** from the accent. Warm red is the brand
accent (CTA, link, focus, live/open); status colours are semantic (paid,
overdue, attention, partial-paid) and never serve as a brand colour. A "live"
chip on the open state can sit on `--hm-info-line` or `--hm-info` but **not**
on `--hm-accent`.

Dark values for all of the above live in the `.dark .hm-app` block in
[`src/styles.css`](src/styles.css). `--hm-ink-3` is the de-emphasis floor in
both themes — 4.7:1 on paper, 4.6:1 on dark paper. Nothing goes fainter.

**One functional accent, strictly.** Warm red carries every CTA, link, focus
ring, brand mark, and 'live' indicator. The two wash stops (`--hm-wash-2` warm
gold `oklch(78% 0.12 75)` and `--hm-wash-3` muted cyan `oklch(72% 0.1 215)`)
exist **only** as radial-gradient stops inside `.hm-ts-wash`. They never touch
type, never fill a button, never border a card. Accent footprint ≤ 5 % per
viewport.

### Editorial utility classes (new)

- `.hm-ts-board` — departure-board table treatment. Sticky grotesque head,
  paper-rule row hairlines, status column left-bordered in the row's status
  line colour (`.is-draft` / `.is-sent` / `.is-partial` / `.is-paid` /
  `.is-overdue` / `.is-canceled` modifiers, or `data-status` attribute).
- `.hm-ts-stamp` — ticket-stamp chip. Hard 2 px border in the row's status
  line, soft fill, mono caps, no rotation. Modifiers: `.is-ok` / `.is-warn` /
  `.is-danger` / `.is-info` / `.is-paper`.
- `.hm-ts-ticker` — header ticker bar. Full-bleed paper-2 band, mono numerals
  in `.hm-ts-ticker__num`, paper-rule column dividers, horizontal scroll-snap
  on mobile.
- `.hm-ts-tape` — paper-tape divider. 1 px rule with a 3 px warm-red
  underscore. Used between major marketing sections.
- `.hm-ts-wash` — radial-gradient wash using `--hm-wash-2` and `--hm-wash-3`.
  Decoration only, never under type.

## Typography

- Display: **Plus Jakarta Sans 800**, roman, `line-height: 1.02`,
  `letter-spacing: -0.032em`
- Title: Plus Jakarta Sans 700, `1.16` / `-0.02em`
- Body: Plus Jakarta Sans 400 — same family, regular weight
- Label: **Space Grotesk 500**, `0.8125rem`, **sentence case** —
  `text-transform: none`, `letter-spacing: 0.005em`. Never uppercase, never
  tracked out.
- Numerals: **IBM Plex Sans Condensed** (already in the project), with
  `font-variant-numeric: tabular-nums` and `"cv05" 1`
- Type scale anchor: display = `clamp(2.75rem, 7.5vw, 4.75rem)` on the landing
  hero, `clamp(2.5rem, 7vw, 4.25rem)` on secondary heroes

Headings are always roman. Emphasis is carried by weight or accent colour —
never italic, never a gradient.

## Spacing

4-point named scale, `--hm-space-2xs` (0.5rem) → `--hm-space-3xl` (7rem).
Section rhythm: `py-16` mobile, `py-20`–`py-24` at `lg`. Gutters `px-5` mobile,
`px-8` at `lg`. Content max width `max-w-7xl`.

Radius: cards **8 px** (`--hm-r-card`), inputs **6 px** (`--hm-r-input`),
pills **999 px** (`--hm-r-pill`). 8 px is the genre ceiling — do not exceed it.
The previous `--radius: 0` brutalist system has been deleted along with the
generated remap layer; nothing in the codebase depends on zero radius.

## Motion

- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` as `--hm-ease`. Smooth only — no
  overshoot, no spring physics on UI state.
- Durations: `--hm-dur` 260 ms, `--hm-dur-fast` 150 ms.
- Reveal pattern: **fade + 8 px slide**, once per element on mount
  (`.hm-reveal`), staggered by `--hm-i × 70ms`. Below-fold marketing bands
  reveal scroll-triggered via `[data-fade-scroll]` (driven by
  `useMarketingMotion()` — GSAP `ScrollTrigger.batch`, `once: true`,
  starts ~`top 88%`, same fade + 8 px / ~0.5 s / `power3.out`, staggered
  in groups). Same reduced-motion respect.
- Hover: cards lift `translateY(-2px)` and the shadow expands
  (`--hm-shadow` → `--hm-shadow-lift`). Nothing else moves.
- Press: `translateY(1px)`, no scale.
- Reduced motion: reveal and lift are removed, `saturate()` on the wash is
  dropped. Opacity-only, ≤ 150 ms.

## Microinteractions stance

- Silent success. No celebratory toasts on a marketing surface.
- Focus is always visible: `2px solid var(--hm-focus)` with `outline-offset: 2px`.
  Never `box-shadow`-only, never removed.
- Mobile nav is a native `<details>`/`<summary>` disclosure — no JS, no portal,
  44 px minimum row height.
- No hover-only affordances. Everything reachable by keyboard.

## CTA voice

- **Primary** — `.hm-btn .hm-btn--primary`: accent fill, `--hm-accent-ink`
  label, pill radius, `min-height: 2.75rem`, display font at 700, trailing
  `ArrowRight` 16 px. Copy is a verb + object: *"Open workspace"*,
  *"Create workspace"*, *"Open app"*.
- **Secondary** — `.hm-btn .hm-btn--ghost`: hairline border on paper, ink label,
  same pill and height, no arrow. *"View pricing"*, *"See the system"*.
- Never three CTAs in a row. Never a CTA whose label is a full sentence.

## Per-page allowances

- Marketing pages MAY use enrichment: **Tier-A only** — the pure-CSS
  `.hm-wash` watercolour blobs (three overlapping radial gradients, blurred
  36 px, `opacity: 0.24`, positioned so the copy column stays on white paper).
  One per hero, one per footer. Nothing else.
- App pages MUST NOT use enrichment. No wash, no blobs, no decorative gradient
  behind working data.
- Content pages: typography only. No wash.
- No re-drawn browser chrome, phone frames, or fake IDE windows anywhere. The
  product card is a real invoice layout, not a mocked-up browser.

## App surface (Workbench)

Scoped under `.hm-app`, applied once on the `DashboardLayout` root. Everything
inside inherits the tokens; nothing needs a per-page scope class.

**Dark mode survives.** The app ships a working theme toggle
([`src/components/theme/theme-provider.tsx`](src/components/theme/theme-provider.tsx)),
so `.dark .hm-app` re-points every token to a dark ramp. Write one utility —
`bg-paper`, `text-ink-2`, `border-rule` — and it resolves correctly in both
themes. **Never write a `dark:` variant for colour.** If a colour needs a `dark:`
override, the token is wrong; fix the token.

Structure:

- **Canvas** `--hm-paper-2`. **Panels** `--hm-paper` with a `--hm-rule` hairline
  and 8 px radius. One elevation step only — panels do not stack on panels.
- **Sidebar** `.hm-side`, 260 px, paper with a right hairline. Active item is
  `--hm-accent-soft` fill + `--hm-accent-line` border + `--hm-accent-hi` label.
  No inset accent bar — that was the brutalist tell. The header above the
  sidebar uses `.hm-ts-ticker` for the active workspace chrome.
- **Tables** `.hm-ts-board`: `--hm-paper-2` sticky head with grotesque
  sentence-case labels, `--hm-rule` row hairlines, `--hm-paper-2` row hover.
  The status column is left-bordered in the row's status line colour (see
  `.hm-ts-board .is-paid` etc. in [`src/styles.css`](src/styles.css)). Money
  and dates are `.hm-num-cell` — IBM Plex Sans Condensed, tabular, right-aligned.
- **Status** `.hm-ts-stamp` + one modifier. The mapping is fixed so a status
  reads the same on every route: Paid → `.is-ok`, Open/Sent → `.is-info`,
  Overdue → `.is-danger`, Pending/Draft → `.is-paper`, Partially paid →
  `.is-warn`. Never bare text colour on a status — always a stamp chip.
- **Stat tiles** `.hm-stat`, a left 3 px accent edge and a `.hm-stat-value`
  numeral. Status modifiers only where the number *is* a warning.
- **Empty states** `.hm-empty` — a dashed hairline block with a label and one
  action. Per the honest-copy rule: an em-dash, never an invented figure.

The accent budget still applies. On a dense table page the primary action, the
active sidebar item, and focus rings are the whole budget — status pills are
semantic colour and do not count, but they are the only other chroma allowed.

## What pages MUST share

- The `Wordmark` component from
  [`src/components/marketing/MarketingLayout.tsx`](src/components/marketing/MarketingLayout.tsx).
- `MarketingNav` (N1b SaaS three-section) and `MarketingFooter` (Ft5 Statement).
  The landing page imports both — it does not roll its own header.
- The accent colour and its ≤ 5 % placement rule.
- Plus Jakarta Sans display + body, Space Grotesk labels, IBM Plex Sans
  Condensed numerals.
- The CTA voice above — shape, radius, height, padding rhythm, arrow discipline.
- Section heading rhythm: accent label (`.hm-label--accent`) → display heading
  → lede.

## What pages MAY differ on

- Which body archetypes appear and in what order, within Split Studio.
- Hero archetype: H2 split diptych (default) or a copy-only hero on legal pages.
- `SplitSection`'s `reverse` prop, to alternate the copy side down a long page.
- Enrichment presence — marketing yes, content no.

## Honest copy

Every number on these pages is real product behaviour or clearly-labelled demo
data: the 7.5 % VAT rate, the ₦ figures in the sample invoice and ledger rows,
the export formats. No invented conversion lifts, no "trusted by N teams", no
fabricated testimonials or logo walls. If a metric is wanted and not known, ship
an em-dash and a labelled grey block instead.

## Exports

Drop-in formats for re-using this design system in other projects.

### tokens.css

```css
:root {
  --color-paper:       oklch(98.2% 0.006 70);
  --color-paper-2:     oklch(95.8% 0.008 70);
  --color-paper-3:     oklch(92% 0.012 70);
  --color-ink:         oklch(18% 0.018 50);
  --color-ink-2:       oklch(38% 0.022 50);
  --color-ink-3:       oklch(50% 0.018 50);
  --color-rule:        oklch(86% 0.014 60);
  --color-accent:      oklch(62% 0.21 27);   /* warm red #EA373E */
  --color-accent-hi:   oklch(56% 0.22 27);
  --color-accent-ink:  oklch(98.5% 0.005 70);
  --color-accent-soft: oklch(94% 0.04 27);
  --color-accent-line: oklch(78% 0.08 27);
  --color-wash-2:      oklch(78% 0.12 75);   /* warm gold */
  --color-wash-3:      oklch(72% 0.1 215);   /* muted cyan */
  --color-focus:       oklch(62% 0.21 27);
  --color-ok:          oklch(50% 0.1 162);
  --color-ok-soft:     oklch(94% 0.03 162);
  --color-ok-line:     oklch(80% 0.06 162);
  --color-warn:        oklch(62% 0.12 75);
  --color-warn-soft:   oklch(95% 0.04 78);
  --color-warn-line:   oklch(82% 0.07 76);
  --color-danger:      oklch(55% 0.16 22);
  --color-danger-soft: oklch(94% 0.03 22);
  --color-danger-line: oklch(80% 0.07 22);
  --color-info:        oklch(55% 0.1 215);
  --color-info-soft:   oklch(94% 0.03 215);
  --color-info-line:   oklch(80% 0.06 215);

  --font-display: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "Space Grotesk", ui-sans-serif, system-ui, sans-serif;
  --font-num:     "IBM Plex Sans Condensed", ui-sans-serif, system-ui, sans-serif;

  --space-3xs: 0.25rem;  --space-2xs: 0.5rem;  --space-xs: 0.75rem;
  --space-sm:  1rem;     --space-md:  1.5rem;  --space-lg: 2rem;
  --space-xl:  3rem;     --space-2xl: 4.5rem;  --space-3xl: 7rem;

  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-md: 1.125rem;
  --text-lg: 1.375rem; --text-xl: 1.75rem;  --text-2xl: 2.25rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 150ms;
  --dur-base:  260ms;

  --radius-card: 8px; --radius-input: 6px; --radius-pill: 999px;

  --shadow-soft: 0 8px 24px -10px oklch(18% 0.018 50 / 0.18);
  --shadow-lift: 0 14px 34px -12px oklch(18% 0.018 50 / 0.26);
}
```

### Tailwind v4 `@theme`

```css
@theme {
  --color-paper:       oklch(98.2% 0.006 70);
  --color-paper-2:     oklch(95.8% 0.008 70);
  --color-ink:         oklch(18% 0.018 50);
  --color-ink-2:       oklch(38% 0.022 50);
  --color-rule:        oklch(86% 0.014 60);
  --color-accent:      oklch(62% 0.21 27);
  --color-accent-soft: oklch(94% 0.04 27);
  --color-focus:       oklch(62% 0.21 27);

  --font-display: "Plus Jakarta Sans", sans-serif;
  --font-body:    "Plus Jakarta Sans", sans-serif;
  --font-label:   "Space Grotesk", sans-serif;

  --spacing-sm:  1rem;
  --spacing-md:  1.5rem;
  --spacing-lg:  2rem;
  --spacing-xl:  3rem;
  --spacing-2xl: 4.5rem;
  --spacing-3xl: 7rem;

  --text-md: 1.125rem;
  --radius-card: 8px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

### DTCG `tokens.json`

```json
{
  "color": {
    "paper":       { "$value": "oklch(98.2% 0.006 70)", "$type": "color" },
    "paper-2":     { "$value": "oklch(95.8% 0.008 70)", "$type": "color" },
    "ink":         { "$value": "oklch(18% 0.018 50)",   "$type": "color" },
    "ink-2":       { "$value": "oklch(38% 0.022 50)",   "$type": "color" },
    "rule":        { "$value": "oklch(86% 0.014 60)",   "$type": "color" },
    "accent":      { "$value": "oklch(62% 0.21 27)",    "$type": "color" },
    "accent-ink":  { "$value": "oklch(98.5% 0.005 70)", "$type": "color" },
    "accent-soft": { "$value": "oklch(94% 0.04 27)",    "$type": "color" },
    "focus":       { "$value": "oklch(62% 0.21 27)",    "$type": "color" }
  },
  "font": {
    "display": { "$value": "Plus Jakarta Sans", "$type": "fontFamily" },
    "body":    { "$value": "Plus Jakarta Sans", "$type": "fontFamily" },
    "label":   { "$value": "Space Grotesk",     "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "1rem",   "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem",   "$type": "dimension" },
    "xl": { "$value": "3rem",   "$type": "dimension" }
  },
  "radius": {
    "card":  { "$value": "8px",   "$type": "dimension" },
    "input": { "$value": "6px",   "$type": "dimension" },
    "pill":  { "$value": "999px", "$type": "dimension" }
  }
}
```

### shadcn/ui CSS variables

OKLCH triples, for a shadcn theme that matches this system. The existing app
blocks in `src/styles.css` are now thin redirects to the editorial `--hm-*`
tokens, so Dialog / Select / Sheet / Tooltip primitives resolve correctly.

```css
:root {
  --background:          98.2% 0.006 70;   /* paper */
  --foreground:          18%   0.018 50;   /* ink */
  --card:                98.2% 0.006 70;
  --card-foreground:     18%   0.018 50;
  --primary:             62%   0.21  27;   /* accent (warm red) */
  --primary-foreground:  98.5% 0.005 70;   /* accent-ink */
  --secondary:           95.8% 0.008 70;   /* paper-2 */
  --muted:               86%   0.014 60;   /* rule */
  --muted-foreground:    38%   0.022 50;   /* ink-2 */
  --border:              86%   0.014 60;
  --input:               86%   0.014 60;
  --ring:                62%   0.21  27;   /* focus */
  --radius:              8px;
}
```
