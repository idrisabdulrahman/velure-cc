# Invoicly — logo brief & mark guidelines

**Status: draft v1, for review.** Concept 1 (“The Figure”) is the recommended direction and the
only one built out into a kit. Nothing in `src/` was touched and nothing is wired into the app.
The owner should approve the direction and the light/dark pairing before it ships.

Master files live in this folder. Concepts came first; the kit is built from concept 1.

---

## 1. The idea

**One sentence:** the name starts with a lowercase `i`, so the mark draws that letter as an ink
stem carrying a warm-red square — the tittle — and the company's initial becomes the brand's
figure.

Three things follow from that:

- **It is a letter, not a picture.** No document, receipt, checkmark, arrow or coin. It reads as
  `i` at first glance and needs no caption.
- **The red square is the one ownable detail.** It is the only accent, it is a perfect square,
  and it can recur as a system device (it is already the wordmark's tittle).
- **There is nothing to lose at small sizes.** The mark is two rectangles and one gap. No
  curves, hairlines, counters or micro-detail.

### The three directions

| # | Concept | One-line idea | Verdict |
| --- | --- | --- | --- |
| 1 | **The Figure** | The initial `i`: ink stem, warm-red square figure. | **Recommended.** Letterform, favicon-friendly, and the square seeds a system. |
| 2 | **The Seal** | The same figure held inside a bold ink ring. | Strong and “instrument-like”, but a circle is the most crowded shape in the category. |
| 3 | **The Record** | The figure set into a stepped square. | Reads clearly, but the highest cliché risk — it drifts toward a chip/folder. |

### Why The Figure

- **It is the name.** A lowercase `i` is the first letter of Invoicly; the mark and the wordmark
  share one logic instead of two unrelated ideas.
- **It is a genuine gap in the category.** Of the 37 payment/fintech marks in the bundled
  reference library, 29.7 % are blue and 35.1 % are built on a circle. A warm-red, non-circular
  letterform is the unoccupied position — and it avoids the local fintech tropes (stacked bars,
  upward arrows, shields, document-with-tick).
- **The device scales.** The same square is the mark's figure, the wordmark's tittle, and a
  usable graphic element. That is a system, not a one-off drawing.
- **Honest risks.** Its proportions are very tall (56 × 184, 0.30 : 1), which is awkward in
  square slots — the favicon cut solves that. In one colour the figure and stem are the same ink,
  so the mark reduces to an `i` silhouette and the red-square idea disappears; that is expected.

---

## 2. Files

| File | What it is | Use |
| --- | --- | --- |
| `concept-1.svg` | Review concept, 256 canvas, light on white. | Comparison only. |
| `concept-2.svg` | Review concept, 256 canvas, light on white. | Comparison only. |
| `concept-3.svg` | Review concept, 256 canvas, light on white. | Comparison only. |
| `invoicly-mark-light.svg` | Mark: ink stem + accent figure, cropped to ink (56 × 184). | Light surfaces. |
| `invoicly-mark-dark.svg` | Mark: paper stem + accent figure. | Dark surfaces. |
| `invoicly-monochrome.svg` | Mark in one ink. | One-colour print, engraving, fax, vinyl. |
| `invoicly-lockup-light.svg` | Mark + wordmark, 582 × 152. | Nav, documents, decks — light surfaces. |
| `invoicly-lockup-dark.svg` | The same lockup, paper wordmark. | Dark surfaces. |
| `invoicly-favicon.svg` | 256 square small-size cut, accent only. | Favicon / app icon. |
| `invoicly-test-sheet.png` | Rendered test sheet (16/32/64, one colour, reversed, lockup). | Review and handover. |

**Naming note.** Here `-light` means *for light surfaces* and `-dark` means *for dark surfaces*.
The older Velure kit in [`../kit/`](../kit/) uses `-light` for the light-coloured artwork that sits
on dark surfaces — the opposite. Read the pair, not the word.

All masters are outlined paths: no `<text>`, no rasters, no filters, no masks, no strokes, no
gradients. The mark files are cropped to the ink so a placed asset is exactly the logo.

---

## 3. Construction geometry

The design grid is **256 × 256 with a 4-unit module**; every landmark is a multiple of 4. The mark
itself is squared off — 0° and 90° only, square corners, no radii.

```
y  36   ┌──────────────┐      figure   56 × 56   accent   x 100…156
        │              │
y  92   └──────────────┘
              ↑ 16 gap (4 modules)
y 108   ┌──────────────┐      stem     48 × 112  ink      x 104…152
        │              │
y 220   └──────────────┘

ink box 56 × 184, centred on x = 128; 36 margins above and below on the 256 canvas.
```

| Relationship | Value |
| --- | --- |
| Figure : stem height | 1 : 2 (56 : 112) |
| Figure : stem width | 7 : 6 — the figure is one module proud on each side |
| Gap | 16 = 8.7 % of the mark height |
| Stem width | 48 = 26.1 % of the mark height — the clear-space unit |
| Angles | 0° and 90° only; all corners square |

The figure is deliberately 8 units wider than the stem (4 per side) so the tittle has presence at
large sizes while still reading as one letter. The stem is exactly twice the figure's height, which
keeps the mark a letter rather than a bar.

---

## 4. Wordmark

- **Type:** Geist Sans **SemiBold (600)**, © 2023 Vercel, SIL Open Font License 1.1.
- **Construction:** shaped with HarfBuzz (kerning and ligatures on), then baked to absolute
  outlines with fontTools and normalised to **cap height 100, baseline y = 0, y growing down**.
  There is no live text anywhere in the delivered files.
- **Metrics:** cap 100 · x-height 76.34 · `l` ascender 100 · `y` descender +21.13 · total advance
  523.24 · ink span x 11.27…520.28.
- **The one modification:** the `i`'s round dot is replaced by an **18 × 18 square**, centred on
  the stem (x 302.12), its top on the cap line (y −100), its bottom at −82, and 7.35 above the
  stem. It is filled with the accent. 18 ≈ the stem width (18.31), so the tittle keeps the letter's
  weight — only the shape changes, from round to square.
- **Case:** title case, `Invoicly`. A lowercase `invoicly` was tested: it puts a second accent
  square immediately after the mark's own square and the lockup starts to read “i-invoicly”. Title
  case gives the word exactly one accent square, on the medial `i`. (If lowercase is ever wanted,
  re-bake `invoicly` and give only the leading `i` the square — expect the doubling risk to return.)
- **Licensing:** Geist is OFL; the name is outlined, not embedded, so there is no font dependency
  in the files. Never retype the wordmark — the paths are the artwork.

---

## 5. Lockup

The horizontal lockup is the primary form.

- **Mark height** = 1.3 × the wordmark ascender: 130 units against a cap height of 100.
- **Scale** = 130 / 184 = 0.7065, so the mark's 48-unit stem becomes 33.91 in lockup units.
- **Gap** between the mark's ink and the wordmark's ink = **33.91 — the mark's own stem width**.
  Spacing therefore follows the mark's rhythm instead of an arbitrary number.
- **Alignment:** the mark's stem bottom sits on the wordmark baseline; the mark's figure top lands
  30 units above the cap line.
- **Crop:** viewBox `-64 -130 582 152` — 582 × 152, aspect 3.83 : 1, cropped to the ink.

---

## 6. Clear space

Keep a margin of **1 × the mark's stem width** on all four sides.

| Artwork | Clear-space unit | As % of height |
| --- | --- | --- |
| Mark | 48 units | 26 % |
| Horizontal lockup | 33.91 units | 22 % |

The zone scales with the logo — never a fixed distance. Inside that zone keep type, rules, other
logos and the container edge out. On photography, place the mark on a calm area or put it in a
container rather than shrinking the clear space.

---

## 7. Minimum size

| Version | Screen | Print |
| --- | --- | --- |
| Mark, full colour | 16 px high | 6 mm high |
| Mark, one colour | 16 px high | 6 mm high |
| Horizontal lockup | 140 px wide (≈ 37 px high) | 40 mm wide |
| Favicon cut | 16 px | — |

Below 16 px the figure/stem gap starts to close, so use `invoicly-favicon.svg` rather than shrinking
the full mark further.

---

## 8. Colour

Values are locked in [`design.md`](../../../design.md) and `src/styles.css` (`--hm-ink`,
`--hm-accent`, `--hm-paper`).

| Token | HEX | RGB | CMYK (uncoated approx.) |
| --- | --- | --- | --- |
| Ink | `#180F0A` | 24, 15, 10 | 0, 37, 58, 91 |
| Accent | `#EA373E` | 234, 55, 62 | 0, 76, 74, 8 |
| Paper | `#FCF8F5` | 252, 248, 245 | 0, 2, 3, 1 |

**Light/dark mapping** — the ink and paper swap; the accent does not change.

| Surface | Mark | Wordmark | Tittle |
| --- | --- | --- | --- |
| Light / paper | ink stem + accent figure | ink | accent |
| Dark / ink | paper stem + accent figure | paper | accent |
| One colour | all ink (or all paper on dark) | ink / paper | ink / paper |

**Contrast** (sRGB, WCAG 2.x): ink on paper **17.89 : 1** · accent on paper **3.89 : 1** ·
accent on ink **4.60 : 1** · accent on white **4.11 : 1**. The accent clears the 3 : 1 bar for
logos and large graphics but **fails 4.5 : 1 for small text**, so it is never used for type or
body copy. It is the single functional brand accent and never a status colour.

CMYK figures are conversions to confirm against a physical swatch book before a print run; **no
Pantone match has been made** — do not order spot colour from these numbers.

---

## 9. Favicon

`invoicly-favicon.svg` — 256 square `viewBox`, transparent, **no tile**.

- **Bolder small cut:** figure 72 × 72, stem 60 × 144, gap 26 (the design grid uses 56 / 48 / 16).
  That is roughly 29 % more relative stroke weight and a 63 % wider relative gap, so the separation
  survives rasterisation at 16 px.
- **Accent only.** A two-tone favicon cannot work on both light and dark tab bars without either a
  tile or `prefers-color-scheme` — and Safari ignores media queries inside SVG favicons. Drawing
  the cut in the single brand accent means it reads on light, dark and coloured tabs with no second
  file and no fallback. The two-tone identity stays in the mark and lockup files; at 16 px the
  colour distinction was barely visible anyway.
- **Verified as a real 16 px raster** (8× nearest-neighbour inspection): figure and stem stay
  separate and the `i` reads. See §11.

---

## 10. Misuse

Don't:

- stretch, squash, rotate or skew any file;
- recolour outside the three tokens, or swap the accent for another colour;
- add shadows, glows, gradients, outlines, strokes or bevels;
- move the figure off the stem's axis, change the 16-unit gap, or alter the 7 : 6 figure/stem ratio;
- resize the mark and the wordmark independently inside a lockup;
- retype the wordmark in a font — use the outlined artwork;
- place the colour mark on a busy photo without a calm area or a container;
- use the accent for small text or as a semantic/status colour;
- wrap the mark in a tile or chip when a bare mark is expected (the favicon is the deliberate
  exception, and even it stays tile-free).

---

## 11. What has been tested

- **`svg_audit.py`** (logo-design skill): concepts 1–3 **100/100**, lockups **100/100**, mark files
  **99/100** (only the informational “tall proportions” note, which is inherent to an `i`), favicon
  **99/100** (only the informational “small-in-canvas” note). No FAIL and no WARN on any file. No
  live text, rasters, filters, masks, strokes or gradients.
- **Rendered and inspected** at 16, 32, 64, 128 and 512 px; the 16 px raster was checked at 8×
  nearest-neighbour to confirm the figure/stem gap survives.
- **One colour** (ink) and **reversed on ink** (paper + accent) rendered and inspected; the mono
  mark still reads as an `i` at 16 and 32 px.
- **Category research:** 37 payment/fintech marks from the bundled library, by colour and geometry
  (blue 29.7 %, circle-based 35.1 %).
- **Not run, and needed before launch:** shelf test against live competitors in context, trademark
  and reverse-image search, print proofing (CMYK/Pantone), and a real-device favicon check.

---

## 12. Open items

1. Owner to approve the direction, the wordmark case, and the light/dark pairing.
2. Wire-up is **not** part of this task: `favicon.ico` + PNG icon set, an in-app mark component, and
   `<link rel="icon">`.
3. Confirm CMYK and any Pantone equivalents against a swatch book.
4. Commission a trademark and reverse-image search. Nothing here is legal clearance.