# Design — Velure

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

Implemented as a token block in [`src/styles.css`](src/styles.css) (search for the
`Hallmark ·` stamp). Tokens live on `:root`; two scope classes consume them —
`.hm` for marketing and `.hm-app` for the dashboard. Both scopes re-point
tokens: `.hm` declares the dark marketing palette unconditionally, and
`.hm-app` is the only scope that follows `<html class="dark">`.

## Genre

**editorial · instrument** — dark editorial paper as the workbench canvas,
warm-red accent as the single functional colour, italic display emphasis with
mono caps labels, departure-board tables and ticket-stamp status chips. The
reference register is the Wayfare travel site: not the literal copy or layout,
but the visual DNA — warm cream paper in the marketing scope, deep editorial
paper in the app scope, a warm red `#EA373E` as the single accent that carries
every CTA, link, focus ring, and 'live' indicator.

The **instrument** half governs data-visualisation surfaces only: charts read
as instrumentation, not illustration. Hairline grids on the ledger grid pitch,
tabular condensed numerals, crosshair readouts that track the pointer, axis
labels as tracked micro-caps. Reference register for this half is the Bklit
chart system — its structure and interaction model, never its palette. The
editorial half still governs every non-chart surface.

Genre bans that stay in force: saturated consumer pinks/purples as *fills*,
emoji-as-ornament, bouncy/overshoot easings on UI state, gradient text,
italic *display* type (italic is reserved for the emphasis slot inside an
otherwise-upright heading), rotated ticket stamps, N5 floating pill nav, N6
newspaper masthead, Ft6 letter close.

**Glassmorphism — overlays only.** Translucent fill plus backdrop blur is
permitted on transient layers that float above the canvas: tooltip, dropdown
menu, popover, sheet, dialog. It is still banned on panels, cards, stat tiles,
tables, and anything holding working data. A chart tooltip may be glass; the
panel the chart sits in may not. The blur stays ≤ 12 px so the scrim reads as
dimming rather than a milky wash (see `--hm-scrim` in
[`src/styles.css`](src/styles.css)).

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
Vibe: *editorial ledger* — warm near-black paper in marketing, deep editorial
paper in the workbench, a single warm-red functional accent (`#E5483B` on the
marketing scope, `#EA373E` on the workbench — see "Marketing scope" below),
status triples in a muted gold / rose / cyan / paper palette. Inspired by the
Wayfare travel-site reference register, not a copy of it.

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

The marketing surface is **always dark, in both theme directions.** The `.hm`
block in [`src/styles.css`](src/styles.css) declares the mock's
[`design/landing.html`](design/landing.html) palette unconditionally, so it no
longer reverts `:root` and `<html class="dark">` cannot re-point it either way.
The user's persisted toggle therefore only re-paints the authenticated
`.hm-app`; toggling the workbench leaves marketing untouched.

*This amends the earlier "marketing always light" rule. The decision and its
confirmation are recorded in
[`prompts/landing-and-auth-redesign.md`](prompts/landing-and-auth-redesign.md).*

| Role | Value |
| --- | --- |
| `--hm-paper` | `#0a0706` (page) |
| `--hm-paper-2` | `#110d0c` (tile / `--surface`) |
| `--hm-paper-3` | `#171211` (tile hover / `--surface-2`) |
| `--hm-paper-4` | `#1e1817` (raised pill, toast, toggle) |
| `--hm-rule` | `#2a2220` |
| `--hm-rule-soft` | `#201918` (row divider) |
| `--hm-ink` | `#f5eee9` |
| `--hm-ink-2` | `#9b8d85` |
| `--hm-ink-3` | `#6a5e57` (de-emphasis floor) |
| `--hm-accent` / `--hm-accent-hi` | `#e5483b` / `#f0584b` |
| `--hm-accent-soft` / `--hm-accent-line` | accent @ 11% / 38% |
| `--hm-accent-on-soft` | `#ff9186` (accent text/icon on the soft tint) |
| `--hm-ok` / `warn` / `info` | `#52c48f` / `#e9ab43` / `#5db3d6` |
| `--hm-r-card` / `btn` / `input` | `14px` / `10px` / `8px` |

`--hm-paper-4` and `--hm-rule-soft` are additive: the mock has four surface
levels where the editorial family had three, so they were declared for `:root`
and `.dark .hm-app` too, keeping one set of token names across all scopes. No
pre-existing value changed.

**Cards follow the mock's two levels.** A `.hm-card` outer tile sits on
`--hm-paper-2` (`--surface`), a `.hm-card--soft` inset sits on `--hm-paper`
(`--bg`) *inside* it, and `.hm-card--lift:hover` steps to `--hm-paper-3`
(`--surface-2`) — the same "soft is the inset direction" reading light mode
takes. `.hm-band` sits on `--hm-paper`, because every mock section shares
`--bg` and only tiles step up.

**The two scopes carry two warm reds, deliberately.** `.hm` uses the mock's
`#e5483b`; `.dark .hm-app` keeps `#EA373E`. Each is the single functional
accent *within its own scope* — never two accents inside one scope, and never a
`dark:` variant for colour.

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

- `.hm-ts-board` — departure-board table treatment. Sticky micro-caps head,
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

A single neutral grotesque carries display, title, body, and label. The
editorial voice now comes from weight, rule-work, and the numeral face rather
than from three competing families — which is also what lets a chart axis and a
table header read as the same system.

- Display: **Inter 700**, roman, `line-height: 1.02`, `letter-spacing: -0.032em`
- Title: Inter 600, `1.16` / `-0.02em`
- Body: Inter 400 — same family, regular weight
- Label: **Inter 500**, `0.8125rem`, sentence case by default —
  `letter-spacing: 0.005em`
- Numerals: **IBM Plex Sans Condensed** (unchanged), with
  `font-variant-numeric: tabular-nums` and `"cv05" 1`. This is the one face
  that stays, and it is load-bearing: every money column, chart axis, and stat
  value depends on condensed tabular figures.
- Type scale anchor: display = `clamp(2.75rem, 7.5vw, 4.75rem)` on the landing
  hero, `clamp(2.5rem, 7vw, 4.25rem)` on secondary heroes

**Marketing scope (`.hm`).** Signed-off redesign scope; this list describes the
workbench (`.hm-app`), which is unchanged. Following `design/landing.html`, the
marketing surface runs on its own two families — `@fontsource/geist-sans`
(registered as `Geist Sans`) for display, title, body and label, and
`@fontsource/geist-mono` (`Geist Mono`) for the numeral role. The workbench
keeps Inter plus IBM Plex Sans Condensed, so both families still load once
across the app. Two consequences for `.hm` only:

- **Weight 500, not 700/600.** The reference sets every heading at 500
  (`.hero h1`, `h2.h`, `.final h2`, `.cta-card h3`), and varies tracking and
  leading per heading: `-0.05em`/`0.98` hero, `-0.035em`/`1.04` section,
  `-0.045em`/`1` closing, `-0.03em`/`1.1` card. `.hm-display` and `.hm-title`
  are therefore declared in `@layer base` and stay *defaults* — weight,
  tracking, leading and colour travel as `font-*`, `tracking-*`, `leading-*`
  and `text-*` utilities on each element. Unlayered CSS outranks every layer,
  so keeping them unlayered would have silently swallowed all of that; consumers
  with no utility (the `/features` and `/pricing` headings) still get the role
  fallbacks. Title roles follow the reference at 500/`1.55` on the landing.
- **The base line-height is 1.55**, from the reference's `body{font:16px/1.55}`.
  It is set on `.hm`, and because line-height only *inherits*, any element
  carrying its own `leading-*` or role rule still overrides it directly.
- **The numeral role is still tabular, but its face is Geist Mono**, and the
  reference's one display figure — the `7.5%` in the compliance diptych — is
  deliberately *not* numeral-role: `design/landing.html` sets `.big` in display
  sans at 500, `-0.07em`, `0.85`. Money stays mono-tabular everywhere.

Plus Jakarta Sans and Space Grotesk are retired. Their `@fontsource` imports
come out of [`src/styles.css`](src/styles.css) with the token change — a
retired family left loading is dead weight on every route. Geist is added the
same way, for the marketing scope only.

**Micro-caps label — instrument surfaces only.** `0.625rem`–`0.6875rem`,
weight 600, `text-transform: uppercase`, `letter-spacing: 0.18em`–`0.24em`. Its
scope is exactly: chart axis ticks, chart legend labels, stat-tile captions, and
the sidebar/header section eyebrows. It is a *structural* label, not an
emphasis device — it never appears in body copy, never as a heading.
Everywhere else the sentence-case label role above still holds. This legalises
the treatment already shipping at `DashboardLayout.tsx:256` and resolves the
contradiction flagged in the `styles.css` comment at the legacy-label block.

The `never on a marketing surface` clause is retired with the redesign: the
signed-off `design/landing.html` does use caps on marketing, in two lighter
shapes than the workbench's micro-caps. They are role classes, not utilities —
`.hm-kicker` (12 px / `0.1em`, accent — the reference's `.kicker`) and
`.hm-caps` (10.5 px / `0.08em`, faint, plus `.hm-caps--side` at 11 px / 500 —
the reference's `.m-tr.h`, `.wr.h`, `.m-side b`). The
`[class*="uppercase"]` guard below deliberately stays on both scopes, so ad-hoc
`uppercase`/`tracking-*` utilities are still re-voiced as the sentence-case
label role; caps that the reference does ask for are expressed through those two
classes. A caps role class must not contain the literal string `uppercase` or
the guard catches it.

Headings are always roman. Emphasis is carried by weight or accent colour —
never italic, never a gradient.

## Spacing

4-point named scale, `--hm-space-2xs` (0.5rem) → `--hm-space-3xl` (7rem).
Section rhythm: `py-16` mobile, `py-20`–`py-24` at `lg`. Gutters `px-5` mobile,
`px-8` at `lg`. Content max width `max-w-7xl`.

Radius: cards **12 px** (`--hm-r-card`), buttons **8 px** (`--hm-r-btn`), inputs
**6 px** (`--hm-r-input`), pills **999 px** (`--hm-r-pill`). 12 px is the genre
ceiling — do not exceed it. Cards moved 8 px → 12 px with the instrument
amendment; inputs deliberately did *not*, so a control still reads tighter than
the panel containing it. Buttons sit between the two: they used to borrow the
input radius, which made a primary action read like a text field. The pill
radius is reserved for the marketing CTA (`.hm-btn`) — an in-app button is never
a pill, and `.hm-ts-stamp` keeps its tight 4 px stamp corners on purpose. The
original `--radius: 0` brutalist system has been deleted along with the
generated remap layer; nothing in the codebase depends on zero radius.

**Marketing scope (`.hm`).** Signed-off redesign scope; the values above are the
workbench's and are unchanged. `design/landing.html` sets `--r-lg:14px`,
`--r-md:10px`, `--r-sm:8px`, so `.hm` overrides the three steps to **cards
14 px, buttons 10 px, inputs 8 px** — one step softer than the workbench at
every tier, which is why the marketing 12 px genre ceiling above is lifted to
14 px for `.hm` only. `--hm-r-pill` is shared. The relative rule is what
matters and still holds in both scopes: an input reads tighter than the button,
which reads tighter than the panel containing it.

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

**Chart internals — spring permitted.** Inside a chart's own drawing surface,
spring and staggered physics are allowed: path draw-on, clip reveals, animated
y-domain transitions, series stagger, marker settle, crosshair tracking. This is
the one exception to the no-spring rule, and it is scoped to marks *within* the
plot area.

It does not extend to the chart's container, its card, its legend, its tooltip
box, or any control that changes app state — those keep `--hm-ease` and the
no-overshoot rule. A tooltip's *position* may track the pointer with spring
damping; the tooltip *appearing* is a UI state change and fades on `--hm-ease`.

Reduced motion still wins outright: charts render at their final frame with no
draw-on, no stagger, no domain animation. A chart must be readable on first
paint — animation is never load-bearing for comprehension.

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

This applies to **vendored third-party components too**. Registry components
(shadcn, kokonutui, Bklit) are written for a `dark:`-variant world and arrive
full of them, often with a whole duplicate element set gated on `dark:block`.
Porting one means converting those to tokens, not preserving them — otherwise
every registry add re-introduces a second, divergent theme system that the
toggle only half-controls. A vendored file is not exempt because someone else
wrote it.

Structure:

- **Canvas** `--hm-paper-2`. **Panels** `--hm-paper` with a `--hm-rule` hairline
  and 12 px radius. One elevation step only — panels do not stack on panels.
- **Sidebar** `.hm-side`, 260 px, paper with a right hairline. Active item is
  `--hm-accent-soft` fill + `--hm-accent-line` border + `--hm-accent-hi` label.
  No inset accent bar — that was the brutalist tell. The header above the
  sidebar uses `.hm-ts-ticker` for the active workspace chrome.
- **Tables** `.hm-ts-board`: `--hm-paper-2` sticky head with micro-caps
  labels, `--hm-rule` row hairlines, `--hm-paper-2` row hover.
  The status column is left-bordered in the row's status line colour (see
  `.hm-ts-board .is-paid` etc. in [`src/styles.css`](src/styles.css)). Money
  and dates are `.hm-num-cell` — IBM Plex Sans Condensed, tabular, right-aligned.
- **Status** `.hm-ts-stamp` + one modifier. The mapping is fixed so a status
  reads the same on every route: Paid → `.is-ok`, Open/Sent → `.is-info`,
  Overdue → `.is-danger`, Pending/Draft → `.is-paper`, Partially paid →
  `.is-warn`. Never bare text colour on a status — always a stamp chip.
- **Stat tiles** `.hm-stat`, a left 3 px accent edge and a `.hm-stat-value`
  numeral. Status modifiers only where the number *is* a warning.
- **Charts** — see "Charts" below. Panels hold charts; charts never restyle the
  panel around them.
- **Empty states** `.hm-empty` — a dashed hairline block with a label and one
  action. Per the honest-copy rule: an em-dash, never an invented figure.

The accent budget still applies. On a dense table page the primary action, the
active sidebar item, and focus rings are the whole budget — status pills are
semantic colour and do not count, but they are the only other chroma allowed.

## Charts

Charts are the instrument surface. Structure and interaction follow the
shadcn chart system on Recharts (`src/components/ui/chart.tsx` wrapper plus
`src/components/ui/chart-format.ts` date formatters); **colour follows this
document and nothing else.**

**Series mapping is fixed**, so a quantity reads the same colour on every route:

| Series | Token |
| --- | --- |
| Paid / collected revenue | `--hm-ok` |
| Open / unpaid / outstanding | `--hm-warn` |
| Overdue | `--hm-danger` |
| Billed (total invoiced) | `--hm-accent` |
| Secondary / comparison series | `--hm-info` |
| Crosshair, active point | `--hm-accent` |
| Grid, axis rules | `--hm-rule` |
| Axis + legend labels | `--hm-ink-3` |

**No hex in chart code, ever.** Every stroke, fill, gradient stop, and dot
border resolves from a `--hm-*` token through the semantic `--chart-*` bridge in
[`src/styles.css`](src/styles.css). This is not stylistic — hardcoded hex is
what silently broke light mode in the Recharts implementation this system
replaces, and a hex value cannot follow the theme toggle.

**A vendored chart's own palette is not authoritative.** Registry components
ship their own `--chart-*` values (Bklit's are a grayscale ramp). Those are
overridden at the bridge; never let a registry write colour vars into
`styles.css`.

Structure rules:

- Grid: hairline `--hm-rule`, horizontal rules only unless the chart is a
  scatter. Pitch aligns to the 48 px ledger grid where the plot height allows.
- Axes: micro-caps label role. No axis line where a grid rule already reads as
  one — one rule per edge, not two.
- Numerals: `--hm-font-num`, tabular, on every tick, tooltip value, and legend
  figure. A chart is a numeric surface; proportional figures make columns dance.
- Tooltip: glass is permitted here (overlay). `--hm-paper` at ≥ 90 % opacity,
  `--hm-rule` hairline, blur ≤ 12 px, card radius.
- Legend: sentence-case or micro-caps label, swatch colour **identical** to the
  series stroke it names. A swatch that disagrees with its line is a bug.
- Empty and loading states are required, not optional. Empty follows the
  honest-copy rule — an em-dash and a labelled block, never a zeroed axis
  implying real data.
- Accent budget: the crosshair and one primary series are the chart's whole
  allowance. Status colours are semantic and exempt, as elsewhere.

## What pages MUST share

- The `Wordmark` component from
  [`src/components/marketing/MarketingLayout.tsx`](src/components/marketing/MarketingLayout.tsx).
- `MarketingNav` (N1b SaaS three-section) and `MarketingFooter` (Ft5 Statement).
  The landing page imports both — it does not roll its own header.
- The accent colour and its ≤ 5 % placement rule.
- Inter display + body + labels, IBM Plex Sans Condensed numerals.
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

  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-outlier: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-num:     "IBM Plex Sans Condensed", ui-sans-serif, system-ui, sans-serif;

  --space-3xs: 0.25rem;  --space-2xs: 0.5rem;  --space-xs: 0.75rem;
  --space-sm:  1rem;     --space-md:  1.5rem;  --space-lg: 2rem;
  --space-xl:  3rem;     --space-2xl: 4.5rem;  --space-3xl: 7rem;

  --text-xs: 0.75rem;  --text-sm: 0.875rem; --text-md: 1.125rem;
  --text-lg: 1.375rem; --text-xl: 1.75rem;  --text-2xl: 2.25rem;

  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 150ms;
  --dur-base:  260ms;

  --radius-card: 12px; --radius-input: 6px; --radius-pill: 999px;

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

  --font-display: "Inter", sans-serif;
  --font-body:    "Inter", sans-serif;
  --font-label:   "Inter", sans-serif;

  --spacing-sm:  1rem;
  --spacing-md:  1.5rem;
  --spacing-lg:  2rem;
  --spacing-xl:  3rem;
  --spacing-2xl: 4.5rem;
  --spacing-3xl: 7rem;

  --text-md: 1.125rem;
  --radius-card: 12px;
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
    "display": { "$value": "Inter", "$type": "fontFamily" },
    "body":    { "$value": "Inter", "$type": "fontFamily" },
    "label":   { "$value": "Inter", "$type": "fontFamily" }
  },
  "space": {
    "sm": { "$value": "1rem",   "$type": "dimension" },
    "md": { "$value": "1.5rem", "$type": "dimension" },
    "lg": { "$value": "2rem",   "$type": "dimension" },
    "xl": { "$value": "3rem",   "$type": "dimension" }
  },
  "radius": {
    "card":  { "$value": "12px",  "$type": "dimension" },
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
  --radius:              12px;
}
```
