#!/usr/bin/env python3
"""Velure logo concepts — dependency-free generator.

Writes the concept SVGs into design/brand/concepts/. Geometry is expressed as
plain numbers so every iteration can be reproduced and compared:

  concept-a-v1..v3   letterform V  (ink / level fill / level fill + datum rule)
  concept-b-v1..v7   B exploration (tally, ledger cell, focus frame,
                     readout, the total, focus frame + settled rule)
  concept-c-v1..v4   wordmark      (stock outline / + rule / custom level V)
  concept-*-lockup   symbol + wordmark lockups for the three finalists

Type outline data (Inter Bold, size 96, tracking -0.032em, outlined with
fontTools) lives in build-data/*.path — the masters never ship <text>.
Re-outline with: fontTools TTFont + SVGPathPen if the wordmark changes.

Run:  python3 design/brand/build_concepts.py [out_dir]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "build-data")

INK = "#180F0A"     # --hm-ink (oklch(18% 0.018 50)) re-encoded
ACCENT = "#EA373E"  # --hm-accent, locked in design.md

# ---------------------------------------------------------------- concept A
# Letterform V. Exact 60 degree arms (interior angle 60), constant 40-unit
# stroke, flat horizontal tops, apex at (128,212).
#   outer left  (32,45.72) -> apex, direction (0.5, 0.8660254)
#   inner line  offset w*(0.8660254,-0.5) = (34.64,-20)
#   inner apex  y = 25.72 + 0.8660254 * (128-66.64)/0.5 = 132
A_V = "M32 45.72 L78.19 45.72 L128 132 L177.81 45.72 L224 45.72 L128 212 Z"
# Level line at y=110: everything below it is accent (arms from y=110 down
# plus the merged wedge), traced as one simple polygon.
#   outer at y=110: x = 32 + 0.5*(110-45.72)/0.8660254 = 69.11 (mirror 186.89)
#   inner at y=110: x = 66.64 + 0.5*(110-25.72)/0.8660254 = 115.30 (mirror 140.70)
A_FILL = "M69.11 110 L128 212 L186.89 110 L140.70 110 L128 132 L115.30 110 Z"

# ---------------------------------------------------------------- concept B
BARS = [56, 112, 168]
B_DIAG = "M61.31 217.31 L217.31 61.31 L194.69 38.69 L38.69 194.69 Z"
# accent "total" rule; right end cut at the 60 degree brand angle
# (16 units tall -> dx = 16 / tan60 = 9.24)
B_RULE = "M64 118 H192 L182.76 138 H64 Z"
B_CORNERS = (
    "M32 32 H88 V56 H56 V88 H32 Z",
    "M224 32 H168 V56 H200 V88 H224 Z",
    "M32 224 H88 V200 H56 V168 H32 Z",
    "M224 224 H168 V200 H200 V168 H224 Z",
)

# ---------------------------------------------------------------- concept C
# Inter Bold measured from the installed TTF: stem 300/2048 em = 14.06 px at
# size 96, cap height 1490/2048 = 69.84. The V is redrawn on the brand's
# 60 degree angle at that same stem weight so the name carries the mark:
# ink above the level (y=27, i.e. 38.7 % down the cap, same as concept A).
V_W, V_H = 80.64, 69.84
V_INK = "M0 0 L16.24 0 L40.32 41.71 L64.40 0 L80.64 0 L40.32 69.84 Z"
V_RED = "M15.59 27 L40.32 69.84 L65.05 27 L48.81 27 L40.32 41.71 L31.83 27 Z"
# Inter's stock V->e ink gap is 3.02 px (V ink ends 69.38, e ink starts 72.40);
# "elure"'s own e ink starts 3.80 px into its outline, so the offset between the
# custom V's right ink edge and the elure path origin is 3.02 - 3.80 = -0.78.
V_GAP = -0.78


def _path(name: str) -> str:
    with open(os.path.join(DATA, name)) as f:
        return f.read().strip()


ELURE = _path("elure.path")            # "elure" outline, advance 226.96
ELURE_W = 226.96
FULL = _path("velure-full.path")       # stock "Velure" outline, advance 295.56
FULL_W = 295.56


def svg(body: str, w: int = 256, h: int = 256, title: str = "Velure mark") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}" role="img" aria-labelledby="t">\n'
        f'  <title id="t">{title}</title>\n{body}\n</svg>\n'
    )


# ---------------------------------------------------------------- concept A
def a(version: int) -> str:
    if version == 1:
        return svg(f'  <path fill="{INK}" fill-rule="evenodd" d="{A_V}"/>',
                   title="Velure concept A - letterform V (ink)")
    body = ""
    if version == 3:  # datum rule crossing behind the letter
        body += f'  <rect x="16" y="106" width="224" height="8" fill="{ACCENT}"/>\n'
    body += f'  <path fill="{INK}" fill-rule="evenodd" d="{A_V}"/>\n'
    body += f'  <path fill="{ACCENT}" fill-rule="evenodd" d="{A_FILL}"/>'
    return svg(body, title="Velure concept A - level V")


# ---------------------------------------------------------------- concept B
def b(version: int) -> str:
    if version == 3:  # ledger cell: cut-corner container, one settled row
        body = (
            f'  <path fill="{INK}" fill-rule="evenodd" d="'
            'M24 24 H200 L232 79.4 V232 H24 Z '
            'M64 96 H192 V128 H64 Z '
            'M64 152 H144 V184 H64 Z"/>'
            f'\n  <rect x="160" y="96" width="32" height="32" fill="{ACCENT}"/>'
        )
        return svg(body, title="Velure concept B - ledger cell")
    if version in (4, 7):  # focus frame, with and without the settled rule
        corners = "\n".join(f'  <path fill="{INK}" d="{d}"/>' for d in B_CORNERS)
        body = corners
        if version == 4:
            body += f'\n  <rect x="104" y="104" width="48" height="48" fill="{ACCENT}"/>'
            return svg(body, title="Velure concept B - focus frame")
        body += f'\n  <path fill="{ACCENT}" d="{B_RULE}"/>'
        return svg(body, title="Velure concept B - the line in focus")
    if version == 5:  # readout: broken crosshair, accent node at the centre
        body = "\n".join([
            f'  <rect x="112" y="24" width="32" height="64" fill="{INK}"/>',
            f'  <rect x="112" y="168" width="32" height="64" fill="{INK}"/>',
            f'  <rect x="24" y="112" width="64" height="32" fill="{INK}"/>',
            f'  <rect x="168" y="112" width="64" height="32" fill="{INK}"/>',
            f'  <rect x="108" y="108" width="40" height="40" fill="{ACCENT}"/>',
        ])
        return svg(body, title="Velure concept B - readout crosshair")
    if version == 6:  # the total: figures column, accent total rule
        body = "\n".join([
            f'  <rect x="40" y="64" width="176" height="24" fill="{INK}"/>',
            f'  <rect x="40" y="112" width="136" height="24" fill="{INK}"/>',
            f'  <path fill="{ACCENT}" d="{B_RULE.replace("64 118 H192 L182.76 138 H64", "40 176 H216 L206.76 192 H40")}"/>',
        ])
        return svg(body, title="Velure concept B - the total")
    colour = INK if version == 1 else ACCENT
    bars = "\n".join(
        f'  <rect x="{x}" y="64" width="32" height="128" fill="{INK}"/>'
        for x in BARS)
    return svg(bars + f'\n  <path fill="{colour}" d="{B_DIAG}"/>',
               title="Velure concept B - tally" + (" (ink)" if version == 1 else ""))


# ---------------------------------------------------------------- concept C
def wordmark_stock(ink: str, x: float, baseline: float, scale: float = 1.0) -> str:
    """Stock Inter outline (exploration only; the master is the custom V)."""
    t = f"translate({x},{baseline})"
    if scale != 1.0:
        t += f" scale({scale},{scale})"
    return f'  <path fill="{ink}" transform="{t}" d="{FULL}"/>'


def custom_wordmark(x: float, baseline: float, s: float,
                    accent_v: bool = True) -> str:
    """'Velure' with the mark's own V geometry doing the work.

    accent_v=False gives an all-ink wordmark for lockups where the symbol
    already carries the accent.
    """
    v_red = f'\n    <path fill="{ACCENT}" d="{V_RED}"/>' if accent_v else ""
    g_v = (f'  <g transform="translate({x},{baseline - V_H * s:.2f}) scale({s})">\n'
           f'    <path fill="{INK}" d="{V_INK}"/>{v_red}\n  </g>')
    x_el = x + (V_W + V_GAP) * s
    g_rest = (f'  <path fill="{INK}" '
              f'transform="translate({x_el:.2f},{baseline}) scale({s})" '
              f'd="{ELURE}"/>')
    return g_v + "\n" + g_rest


def custom_width(s: float) -> float:
    return (V_W + V_GAP + ELURE_W) * s


def c(version: int) -> str:
    if version == 3:  # custom level V carries the name
        s = 1.5
        w = int(round(40 + custom_width(s) + 40))
        return svg(custom_wordmark(40, 180.38, s), w, 256,
                   "Velure - wordmark with the level V")
    if version == 4:  # ... with the ledger rule and settle square
        s = 1.5
        body = custom_wordmark(40, 160, s)
        rule_w = round(custom_width(s), 2)
        body += f'\n  <rect x="40" y="188" width="{rule_w}" height="6" fill="{INK}"/>'
        body += (f'\n  <rect x="{40 + rule_w + 12:.2f}" y="175" width="22" '
                 f'height="22" fill="{ACCENT}"/>')
        return svg(body, int(round(40 + rule_w + 12 + 22 + 40)), 256,
                   "Velure - wordmark, rule and settle mark")
    body = wordmark_stock(INK, 48, 144)
    if version == 2:
        sq = f'\n  <rect x="348" y="165.5" width="18" height="18" fill="{ACCENT}"/>'
    else:
        sq = f'\n  <rect x="348" y="165.5" width="18" height="18" fill="{INK}"/>'
    body += f'\n  <rect x="48" y="172" width="288" height="5" fill="{INK}"/>' + sq
    return svg(body, 414, 256, "Velure concept C - wordmark" + (" (ink)" if version == 1 else ""))


# ---------------------------------------------------------------- lockups
def lockup_a() -> str:
    # symbol: h 110 -> scale 0.6615, bbox x 32..224 -> left edge 16, y -> 79
    s = 110 / 166.28
    tx, ty = 16 - 32 * s, 79 - 45.72 * s
    wx = 16 + 192 * s + 34
    body = f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})">\n'
    body += f'    <path fill="{INK}" fill-rule="evenodd" d="{A_V}"/>\n'
    body += f'    <path fill="{ACCENT}" fill-rule="evenodd" d="{A_FILL}"/>\n'
    body += '  </g>\n'
    body += custom_wordmark(round(wx, 2), 168, 1.0, accent_v=False)
    return svg(body, int(round(wx + custom_width(1.0) + 16)), 256,
               "Velure - concept A lockup")


def lockup_b() -> str:
    s = 110 / 192
    tx, ty = 16 - 32 * s, 79 - 32 * s
    wx = 16 + 192 * s + 34
    corners = "\n".join(f'    <path fill="{INK}" d="{d}"/>' for d in B_CORNERS)
    body = f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})">\n'
    body += corners + f'\n    <path fill="{ACCENT}" d="{B_RULE}"/>\n  </g>\n'
    body += custom_wordmark(round(wx, 2), 168, 1.0, accent_v=False)
    return svg(body, int(round(wx + custom_width(1.0) + 16)), 256,
               "Velure - concept B lockup")


def lockup_c() -> str:
    # the wordmark carries the mark: level V, ledger rule, settle square
    s = 1.6
    rule_w = round(custom_width(s), 2)
    body = custom_wordmark(32, 160, s)
    body += f'\n  <rect x="32" y="188" width="{rule_w}" height="6" fill="{INK}"/>'
    body += (f'\n  <rect x="{32 + rule_w + 12:.2f}" y="175" width="22" '
             f'height="22" fill="{ACCENT}"/>')
    return svg(body, int(round(32 + rule_w + 12 + 22 + 32)), 256,
               "Velure - concept C lockup")


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "concepts")
    os.makedirs(out, exist_ok=True)
    files = {
        "concept-a-v1.svg": a(1),
        "concept-a-v2.svg": a(2),
        "concept-a-v3.svg": a(3),
        "concept-b-v1.svg": b(1),
        "concept-b-v2.svg": b(2),
        "concept-b-v3.svg": b(3),
        "concept-b-v4.svg": b(4),
        "concept-b-v5.svg": b(5),
        "concept-b-v6.svg": b(6),
        "concept-b-v7.svg": b(7),
        "concept-c-v1.svg": c(1),
        "concept-c-v2.svg": c(2),
        "concept-c-v3.svg": c(3),
        "concept-c-v4.svg": c(4),
        "concept-a-lockup.svg": lockup_a(),
        "concept-b-lockup.svg": lockup_b(),
        "concept-c-lockup.svg": lockup_c(),
    }
    for name, content in files.items():
        with open(os.path.join(out, name), "w") as f:
            f.write(content)
        print("wrote", os.path.join(out, name))


if __name__ == "__main__":
    main()
