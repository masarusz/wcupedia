#!/usr/bin/env python3
"""Generate the Wcupedia soccer-ball marks.

Pillow only (no cairo, no rsvg, no SVG libraries). Every output is drawn at
4x its final resolution and downsampled once with Image.LANCZOS. There is no
randomness and no embedded timestamp, so running this script twice produces
identical pixels.

Writes:
  public/assets/apple-touch-icon.png  180x180, opaque RGB, pitch-green bg
  public/assets/icon-512.png          512x512, opaque RGB, pitch-green bg
  public/assets/ball-mark.png         96x96,  RGBA, transparent bg
"""
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"

PITCH_GREEN = (31, 122, 77)   # #1f7a4d
DARK = (29, 36, 51)           # #1d2433
WHITE = (255, 255, 255)

SCALE = 4  # supersampling factor; each output is drawn this many times
           # larger than its final size, then downsampled once with LANCZOS.

# Classic flat soccer-ball layout, all sizes as fractions of the white interior
# radius (inner_r). One central pentagon, point up; five outer pentagons placed
# in the direction of the central pentagon's VERTICES, each with one vertex
# pointing back at the centre and large enough to be cut by the rim; straight
# seams join each central vertex to the facing outer vertex and join
# neighbouring outer pentagons, which draws the white hexagon panels.
# Measured at a 512px ball: 59.5px between the central and any outer pentagon,
# 88px between neighbouring outer pentagons (the test requires >= 20.5px).
# Earlier rounds placed the outer pentagons toward the central EDGES and drew
# seams as stubs, which read as a flower or cracked plate at 40-60px.
CENTRAL_FRAC = 0.25
OUTER_R_FRAC = 0.30
OUTER_DISTANCE_FRAC = 0.80

# Seam thickness as a fraction of the ball's outer diameter.
SEAM_FRAC_OF_DIAMETER = 0.020


def _pentagon(cx, cy, radius, rotation_deg):
    """Vertices of a regular pentagon, one vertex at angle `rotation_deg`."""
    points = []
    for i in range(5):
        angle = math.radians(rotation_deg + i * 72)
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def _pattern_polygons(cx, cy, r):
    """The central pentagon and the 5 outer pentagons, as plain vertex lists.

    Pure geometry (no drawing), so it can be reused by the renderer, by the
    CLI polygon dump used for testing, and by anything else that needs to
    reason about the pattern's shape."""
    central_rotation = -90  # a vertex points straight up
    central = _pentagon(cx, cy, r * CENTRAL_FRAC, central_rotation)

    outer_r = r * OUTER_R_FRAC
    outer_distance = r * OUTER_DISTANCE_FRAC
    outer_pentagons = []
    for i in range(5):
        # Toward central vertex i, so the white hexagons sit between them.
        vertex_angle = central_rotation + i * 72
        ox = cx + outer_distance * math.cos(math.radians(vertex_angle))
        oy = cy + outer_distance * math.sin(math.radians(vertex_angle))
        # Vertex 0 of each outer pentagon points back at the centre.
        outer_pentagons.append(_pentagon(ox, oy, outer_r, vertex_angle + 180))

    return central, outer_pentagons


def _pattern_seams(cx, cy, r, central, outer_pentagons):
    """Seam line segments: each central vertex to the inward-pointing vertex
    of the outer pentagon in that direction, and each pair of neighbouring
    outer pentagons joined at their nearest vertices. Together they outline
    the white hexagon panels of a classic ball."""
    seams = []
    for i, vertex in enumerate(central):
        seams.append((vertex, outer_pentagons[i][0]))
    for i in range(5):
        a, b = outer_pentagons[i], outer_pentagons[(i + 1) % 5]
        pair = min(((pa, pb) for pa in a for pb in b),
                   key=lambda t: (t[0][0] - t[1][0]) ** 2 + (t[0][1] - t[1][1]) ** 2)
        seams.append(pair)
    return seams


def _draw_pattern(draw, cx, cy, r, diameter):
    """Draw the outer ring of pentagons and the central pentagon as clean
    filled shapes first, then the seams on top. Seams are drawn LAST (on top
    of the already-filled polygons) so a seam's starting pixels always land
    on solid fill: there is no dependency on a line's rasterised edge lining
    up exactly with a polygon's rasterised edge, which is what previously
    left a stray outline sliver and a white wedge at the central pentagon's
    corners when the seams were drawn underneath it."""
    central, outer_pentagons = _pattern_polygons(cx, cy, r)

    for pentagon in outer_pentagons:
        draw.polygon(pentagon, fill=DARK)
    draw.polygon(central, fill=DARK)

    seam_width = max(1, round(diameter * SEAM_FRAC_OF_DIAMETER))
    for p1, p2 in _pattern_seams(cx, cy, r, central, outer_pentagons):
        draw.line([p1, p2], fill=DARK, width=seam_width)


def ball_layer(diameter):
    """A transparent RGBA square of side `diameter`: a white disc with a dark
    outline ring and the pentagon/seam pattern.

    The ring is built from two concentric filled circles - a dark one of
    radius R (the ball's true outer edge), then a smaller white one of
    radius R - outline_width on top - instead of ImageDraw's stroked
    ellipse, whose `width` parameter grows inward from a bbox that does not
    itself reach R. That mismatch is what previously let the pattern
    (positioned relative to the full radius) poke past the actual drawn ring
    into the background. Here nothing is ever drawn beyond R: the pattern is
    rendered on its own layer and pasted in through a mask no larger than
    the white interior (radius R - outline_width), so it can not reach, let
    alone cross, the ring.
    """
    size = diameter
    cx = cy = size / 2
    outline_width = max(2, round(size * 0.035))
    R = size / 2
    inner_r = R - outline_width

    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    draw.ellipse([cx - R, cy - R, cx + R, cy + R], fill=DARK + (255,))
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=WHITE + (255,))

    pattern = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    _draw_pattern(ImageDraw.Draw(pattern), cx, cy, inner_r, size)

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=255)
    clipped_pattern = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    clipped_pattern.paste(pattern, (0, 0), mask)

    disc.paste(clipped_pattern, (0, 0), clipped_pattern)
    return disc


def render_touch_icon(size, ball_frac=0.82):
    """Opaque RGB square: pitch-green background, the ball centred."""
    hi = size * SCALE
    canvas = Image.new("RGB", (hi, hi), PITCH_GREEN)
    ball_diameter = round(hi * ball_frac)
    ball = ball_layer(ball_diameter)
    offset = ((hi - ball_diameter) // 2, (hi - ball_diameter) // 2)
    canvas.paste(ball, offset, ball)
    return canvas.resize((size, size), Image.LANCZOS).convert("RGB")


def render_ball_mark(size, ball_frac=0.94):
    """Transparent RGBA square containing just the ball."""
    hi = size * SCALE
    ball_diameter = round(hi * ball_frac)
    layer = Image.new("RGBA", (hi, hi), (0, 0, 0, 0))
    ball = ball_layer(ball_diameter)
    offset = ((hi - ball_diameter) // 2, (hi - ball_diameter) // 2)
    layer.paste(ball, offset, ball)
    return layer.resize((size, size), Image.LANCZOS)


def pattern_geometry_for_diameter(diameter):
    """The exact pentagon/seam geometry ball_layer(diameter) draws, as plain
    JSON-serialisable data - the same maths ball_layer uses to get from a
    ball diameter to inner_r, so a test can check the real generator's
    geometry (e.g. for overlaps) instead of a hand-copied approximation."""
    size = diameter
    cx = cy = size / 2
    outline_width = max(2, round(size * 0.035))
    inner_r = size / 2 - outline_width
    central, outer_pentagons = _pattern_polygons(cx, cy, inner_r)
    seams = _pattern_seams(cx, cy, inner_r, central, outer_pentagons)
    return {
        "diameter": diameter,
        "inner_r": inner_r,
        "central": central,
        "outer": outer_pentagons,
        "seams": seams,
    }


def main():
    ASSETS.mkdir(parents=True, exist_ok=True)

    apple_icon = render_touch_icon(180)
    assert apple_icon.mode == "RGB"
    apple_icon.save(ASSETS / "apple-touch-icon.png", format="PNG")

    icon_512 = render_touch_icon(512)
    assert icon_512.mode == "RGB"
    icon_512.save(ASSETS / "icon-512.png", format="PNG")

    ball_mark = render_ball_mark(96)
    assert ball_mark.mode == "RGBA"
    ball_mark.save(ASSETS / "ball-mark.png", format="PNG")

    for name in ("apple-touch-icon.png", "icon-512.png", "ball-mark.png"):
        path = ASSETS / name
        with Image.open(path) as img:
            print(f"{name}: {img.size[0]}x{img.size[1]} {img.mode}")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--print-polygons":
        diameter = int(sys.argv[2]) if len(sys.argv) > 2 else 512
        print(json.dumps(pattern_geometry_for_diameter(diameter)))
    else:
        main()
