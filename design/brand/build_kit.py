#!/usr/bin/env python3
"""Velure logo kit — dependency-free generator (Phase 7).

Checkpoint decision: concept A (Level V) is the symbol, concept C (Velure
Wordmark) is the wordmark, concept B is dropped. This turns those two finals
into the delivery set:

  symbol    colour / one-colour (slot + plain) / reversed / icon tile
  wordmark  colour / one-colour / reversed
  lockup    horizontal (A + C) and stacked, in the same three treatments

Colour rules (design.md, locked):
  ink      #180F0A   --hm-ink
  accent   #EA373E   --hm-accent  (the level fill)
  paper    #FCF8F5   --hm-paper

One-colour note: the level is a *colour* boundary, so a single-ink master
cannot show it as a fill. It is cut as a horizontal slot instead (4.8 % of V
height, centred on the level, same proportion in symbol and wordmark). The
slot is transparent, so the cut works on any background.

Run:  python3 design/brand/build_kit.py [out_dir]
"""
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_concepts import (  # noqa: E402
    A_FILL,
    A_V,
    ACCENT,
    ELURE,
    INK,
    V_GAP,
    V_H,
    V_INK,
    V_RED,
    V_W,
    custom_width,
    lockup_a,
)

HERE = os.path.dirname(os.path.abspath(__file__))
PAPER = "#FCF8F5"          # --hm-paper (marketing surface, light)

# Both the symbol's V and the wordmark's V have the same topology:
# outer-left top, inner-left top, inner apex, inner-right top, outer-right
# top, bottom apex — which is what makes one split routine valid for both.
#   symbol A_V : level 110, inner apex 132, top 45.72, bottom 212
#   wordmark   : level  27, inner apex 41.71, top    0, bottom 69.84
SLOT_RATIO = 8.0 / 166.28      # slot height / V height, taken from the symbol

A_PTS = [(32, 45.72), (78.19, 45.72), (128, 132),
         (177.81, 45.72), (224, 45.72), (128, 212)]
LEVEL = 110

W_PTS = [(0, 0), (16.24, 0), (40.32, 41.71),
         (64.40, 0), (80.64, 0), (40.32, 69.84)]
W_LEVEL = 27.0


def _edge_x(p0, p1, y):
    """x of the straight edge p0->p1 at height y."""
    if p1[1] == p0[1]:
        raise ValueError("horizontal edge")
    return p0[0] + (p1[0] - p0[0]) * (y - p0[1]) / (p1[1] - p0[1])


def v_split(pts, y_top, y_bot):
    """Cut a V polygon into (two arms above y_top, one piece below y_bot).

    Requires top < y_top < y_bot < inner apex < bottom, which holds for every
    variant here. The three subpaths never overlap, so they can share one path
    element without needing fill-rule tricks.
    """
    p0, p1, p2, p3, p4, p5 = pts
    if not (p0[1] < y_top < y_bot < p2[1] < p5[1]):
        raise ValueError("cuts must run top < slot < inner apex < bottom")

    lo_t, li_t = _edge_x(p5, p0, y_top), _edge_x(p1, p2, y_top)
    ri_t, ro_t = _edge_x(p2, p3, y_top), _edge_x(p4, p5, y_top)
    above = [
        [(p0[0], p0[1]), (p1[0], p1[1]), (li_t, y_top), (lo_t, y_top)],
        [(ri_t, y_top), (p3[0], p3[1]), (p4[0], p4[1]), (ro_t, y_top)],
    ]

    lo_b, li_b = _edge_x(p5, p0, y_bot), _edge_x(p1, p2, y_bot)
    ri_b, ro_b = _edge_x(p2, p3, y_bot), _edge_x(p4, p5, y_bot)
    below = [[
        (lo_b, y_bot), (li_b, y_bot), (p2[0], p2[1]),
        (ri_b, y_bot), (ro_b, y_bot), (p5[0], p5[1]),
    ]]
    return above, below


def cut_d(pts, level):
    """Path data for the V with the level cut out as a transparent slot."""
    slot = SLOT_RATIO * (pts[5][1] - pts[0][1])
    above, below = v_split(pts, level - slot / 2, level + slot / 2)
    return " ".join(_d(p) for p in above + below)


def _d(poly):
    return "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in poly) + " Z"


def _path_points(d):
    """Absolute points of one path (M/L/H/V/Q/C/Z, incl. implicit repeats).

    Curve control points are included, so the result is a safe superset of the
    true ink — a crop from it can never clip the artwork.
    """
    toks = re.findall(r"[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?", d)
    pts, i, x, y, cmd = [], 0, 0.0, 0.0, None

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    while i < len(toks):
        if re.match(r"[A-Za-z]", toks[i]):
            cmd = toks[i]
            i += 1
            if cmd in "Zz":
                continue
        if cmd in "Mm":
            x, y = num(), num()
            pts.append((x, y))
            cmd = "L" if cmd == "M" else "l"
        elif cmd in "Ll":
            nx, ny = num(), num()
            x, y = (x + nx, y + ny) if cmd.islower() else (nx, ny)
            pts.append((x, y))
        elif cmd in "Hh":
            nx = num()
            x = x + nx if cmd.islower() else nx
            pts.append((x, y))
        elif cmd in "Vv":
            ny = num()
            y = y + ny if cmd.islower() else ny
            pts.append((x, y))
        elif cmd in "Qq":
            c, e = (num(), num()), (num(), num())
            if cmd.islower():
                c, e = (x + c[0], y + c[1]), (x + e[0], y + e[1])
            pts += [c, e]
            x, y = e
        elif cmd in "Cc":
            c1, c2, e = (num(), num()), (num(), num()), (num(), num())
            if cmd.islower():
                c1, c2 = (x + c1[0], y + c1[1]), (x + c2[0], y + c2[1])
                e = (x + e[0], y + e[1])
            pts += [c1, c2, e]
            x, y = e
        else:
            raise ValueError(f"unsupported path command {cmd!r}")
    return pts


def _apply(t, x, y):
    """Apply one transform attribute. Lists read outermost-first, but an SVG
    list composes left-to-right, so the rightmost entry acts on the point first."""
    for kind, args in reversed(re.findall(r"(translate|scale)\(([^)]*)\)", t)):
        n = [float(v) for v in re.split(r"[,\s]+", args.strip()) if v]
        if kind == "translate":
            x += n[0]
            y += n[1] if len(n) > 1 else 0.0
        else:
            x *= n[0]
            y *= n[1] if len(n) > 1 else n[0]
    return x, y


def ink_bbox(markup):
    """Content box (x, y, w, h) of a generated mark, following its transforms."""
    stack, xs, ys = [], [], []
    for m in re.finditer(r'<g\s+transform="([^"]+)"|</g>|<path[^>]*>', markup):
        tok = m.group(0)
        if tok.startswith("<g"):
            stack.append(m.group(1))
        elif tok == "</g>":
            stack.pop()
        else:
            dm = re.search(r'\sd="([^"]+)"', tok)
            if not dm:
                continue
            tm = re.search(r'transform="([^"]+)"', tok)
            chain = stack + ([tm.group(1)] if tm else [])
            for px, py in _path_points(dm.group(1)):
                x, y = px, py
                for t in reversed(chain):
                    x, y = _apply(t, x, y)
                xs.append(x)
                ys.append(y)
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return round(x0, 2), round(y0, 2), round(x1 - x0, 2), round(y1 - y0, 2)


def svg(body, w=256, h=256, title="Velure", box=None):
    """box=(x, y, w, h) overrides the default 0 0 w h viewBox — used to crop a
    lockup to its ink so it can be sized directly as an <img>."""
    b = box or (0, 0, w, h)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="{b[0]} {b[1]} {b[2]} {b[3]}" '
        f'width="{b[2]}" height="{b[3]}" role="img" aria-labelledby="t">\n'
        f'  <title id="t">{title}</title>\n{body}\n</svg>\n'
    )


# --------------------------------------------------------------- symbol
def symbol_colour():
    body = (f'  <path fill="{INK}" fill-rule="evenodd" d="{A_V}"/>\n'
            f'  <path fill="{ACCENT}" fill-rule="evenodd" d="{A_FILL}"/>')
    return svg(body, title="Velure symbol")


def symbol_reversed():
    body = (f'  <path fill="{PAPER}" fill-rule="evenodd" d="{A_V}"/>\n'
            f'  <path fill="{ACCENT}" fill-rule="evenodd" d="{A_FILL}"/>')
    return svg(body, title="Velure symbol, reversed")


def symbol_mono():
    """One colour, level kept as a transparent slot."""
    return svg(f'  <path fill="{INK}" d="{cut_d(A_PTS, LEVEL)}"/>',
               title="Velure symbol, one colour")


def _tile(size, radius, fit, lift=0):
    """Rounded tile with the V optically centred inside it.

    The V outline starts at (32, 45.72), so the translate must cancel that
    offset or the mark lands off-centre and overflows the canvas.
    """
    s = fit / (A_PTS[5][1] - A_PTS[0][1])
    w = (A_PTS[4][0] - A_PTS[0][0]) * s
    x = (size - w) / 2 - A_PTS[0][0] * s
    y = (size - fit) / 2 - lift - A_PTS[0][1] * s   # lift: mass sits high
    body = (f'  <rect width="{size}" height="{size}" rx="{radius}" '
            f'fill="{INK}"/>\n'
            f'  <g transform="translate({x:.2f},{y:.2f}) scale({s:.4f})">\n'
            f'    <path fill="{PAPER}" d="{A_V}"/>\n'
            f'    <path fill="{ACCENT}" d="{A_FILL}"/>\n'
            f'  </g>')
    return body


def symbol_tile():
    """App icon / favicon master: ink tile, paper V, accent level fill."""
    return svg(_tile(256, 56, 150.0), 256, 256, "Velure app icon")


def symbol_tile_small():
    """Small-size cut: bigger V, shallower corners, so 16 px still reads."""
    return svg(_tile(256, 44, 172.0), title="Velure app icon, small size")


# --------------------------------------------------------------- wordmark
WM_PAD = 24
WM_SCALE = 2.0


def _wm_layout(s):
    """Integer canvas with the wordmark centred inside WM_PAD of clear space."""
    cw, ch = custom_width(s), 69.84 * s
    w = math.ceil(cw + 2 * WM_PAD)
    h = math.ceil(ch + 2 * WM_PAD)
    return w, h, round((w - cw) / 2, 2), round((h - ch) / 2 + ch, 2)


def wordmark_at(x, baseline, s, fill, *, mono=False, accent=None):
    """The wordmark at any position/scale/treatment.

    mono   -> level cut as a slot instead of a fill
    accent -> colour level fill drawn inside the V (else the V stays one tone)
    """
    if mono:
        v_d = cut_d(W_PTS, W_LEVEL)
        paths = [f'    <path fill="{fill}" d="{v_d}"/>']
    else:
        paths = [f'    <path fill="{fill}" d="{V_INK}"/>']
        if accent:
            paths.append(f'    <path fill="{accent}" d="{V_RED}"/>')
    g = (f'  <g transform="translate({x},{baseline - V_H * s:.2f}) '
         f'scale({s})">\n' + "\n".join(paths) + "\n  </g>")
    x_el = x + (V_W + V_GAP) * s
    rest = (f'  <path fill="{fill}" '
            f'transform="translate({x_el:.2f},{baseline}) scale({s})" '
            f'd="{ELURE}"/>')
    return g + "\n" + rest


def wordmark_colour():
    w, h, x, b = _wm_layout(WM_SCALE)
    return svg(wordmark_at(x, b, WM_SCALE, INK, accent=ACCENT),
               w, h, "Velure wordmark")


def wordmark_reversed():
    w, h, x, b = _wm_layout(WM_SCALE)
    return svg(wordmark_at(x, b, WM_SCALE, PAPER, accent=ACCENT),
               w, h, "Velure wordmark, reversed")


def wordmark_mono():
    w, h, x, b = _wm_layout(WM_SCALE)
    return svg(wordmark_at(x, b, WM_SCALE, INK, mono=True),
               w, h, "Velure wordmark, one colour")


# --------------------------------------------------------------- lockups
def _body(markup):
    """Inner content of a generated <svg>, minus its own tags and <title>."""
    return markup.split("</title>\n", 1)[1].rsplit("\n</svg>", 1)[0]


def _cropped(body, box, title):
    """Crop the canvas to the ink so the asset sizes directly as an <img>."""
    return svg(body, box[2], box[3], title, box=box)


def _horizontal_body(mono=False):
    if not mono:
        return _body(lockup_a())
    s = 110 / 166.28
    tx, ty = 16 - 32 * s, 79 - 45.72 * s
    body = (f'  <g transform="translate({tx:.2f},{ty:.2f}) scale({s:.4f})">\n'
            f'    <path fill="{INK}" d="{cut_d(A_PTS, LEVEL)}"/>\n  </g>\n')
    wx = 16 + 192 * s + 34
    body += wordmark_at(round(wx, 2), 168, 1.0, INK, mono=True)
    return body


def _horizontal_box():
    """One content box shared by all three horizontal treatments, so colour,
    mono and reversed align pixel for pixel when placed side by side."""
    return ink_bbox(_horizontal_body())


def horizontal_colour():
    return _cropped(_horizontal_body(), _horizontal_box(),
                     "Velure logo, horizontal")


def horizontal_reversed():
    return _cropped(_horizontal_body().replace(INK, PAPER), _horizontal_box(),
                     "Velure logo, horizontal, reversed")


def horizontal_mono():
    """Symbol with the slot cut + wordmark with the slot cut, one ink."""
    return _cropped(_horizontal_body(mono=True), _horizontal_box(),
                     "Velure logo, horizontal, one colour")


def _stacked_body(sym_h, gap, pad, *, mono, reversed_):
    fill = PAPER if reversed_ else INK
    s = sym_h / 166.28
    sym_w = 192 * s
    wm_w = custom_width(1.0)
    w = math.ceil(max(sym_w, wm_w) + 2 * pad)

    sym_x = (w - sym_w) / 2 - 32 * s
    sym_y = pad - 45.72 * s
    if mono:
        sym_path = f'    <path fill="{fill}" d="{cut_d(A_PTS, LEVEL)}"/>\n'
    else:
        sym_path = (f'    <path fill="{fill}" fill-rule="evenodd" '
                    f'd="{A_V}"/>\n'
                    f'    <path fill="{ACCENT}" fill-rule="evenodd" '
                    f'd="{A_FILL}"/>\n')
    body = (f'  <g transform="translate({sym_x:.2f},{sym_y:.2f}) '
            f'scale({s:.4f})">\n{sym_path}  </g>\n')

    baseline = pad + sym_h + gap + 69.84
    body += wordmark_at(round((w - wm_w) / 2, 2), baseline, 1.0, fill,
                        mono=mono)
    return body


def stacked(sym_h=110, gap=40, pad=32, *, mono=False, reversed_=False,
            title="Velure logo, stacked"):
    """Symbol centred above the wordmark; lockups never double the accent."""
    body = _stacked_body(sym_h, gap, pad, mono=mono, reversed_=reversed_)
    box = ink_bbox(_stacked_body(sym_h, gap, pad, mono=False, reversed_=False))
    return _cropped(body, box, title)


# --------------------------------------------------------------- write
FILES = {
    "velure-symbol.svg": symbol_colour,
    "velure-symbol-reversed.svg": symbol_reversed,
    "velure-symbol-mono.svg": symbol_mono,
    "velure-symbol-tile.svg": symbol_tile,
    "velure-symbol-tile-small.svg": symbol_tile_small,
    "velure-wordmark.svg": wordmark_colour,
    "velure-wordmark-reversed.svg": wordmark_reversed,
    "velure-wordmark-mono.svg": wordmark_mono,
    "velure-lockup-horizontal.svg": horizontal_colour,
    "velure-lockup-horizontal-reversed.svg": horizontal_reversed,
    "velure-lockup-horizontal-mono.svg": horizontal_mono,
    "velure-lockup-stacked.svg": stacked,
    "velure-lockup-stacked-reversed.svg": lambda: stacked(
        reversed_=True, title="Velure logo, stacked, reversed"),
    "velure-lockup-stacked-mono.svg": lambda: stacked(
        mono=True, title="Velure logo, stacked, one colour"),
}


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "kit")
    os.makedirs(out, exist_ok=True)
    for name, fn in FILES.items():
        path = os.path.join(out, name)
        with open(path, "w") as f:
            f.write(fn())
        print("wrote", path)


if __name__ == "__main__":
    main()
