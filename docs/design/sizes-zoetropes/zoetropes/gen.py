"""Generate mandala zoetrope discs (strobe model).

Each element k of a ring with count = m*N (N = frames per revolution) gets
frame f = (-(k // m) + c_r) mod N, so when the disc steps one slot (360/N)
per strobe tick, the element now at any fixed position shows the next
frame: every ring animates in place. Static decoration only ever uses
counts that are multiples of N, so stepping never shows on it.

usage: python3 -I gen.py <out_dir>
"""
import math, os, sys

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

# Radial remap: designs are drawn for the 12" label (art from r=36 to 98).
# A 7" label covers about half the record, so its art is squeezed into
# the band outside it (RIN = 53) rather than hidden under the label.
RIN = 36.0

def RM(r):
    return RIN + (r - 36.0) * (98.0 - RIN) / 62.0 if r >= 36 else r

def P(r, deg):
    r = RM(r)
    a = math.radians(deg)
    return r * math.sin(a), -r * math.cos(a)

def f2(x):
    return f"{x:.2f}".rstrip('0').rstrip('.')

def smooth(p):            # 0 -> 1 -> 0 over one cycle
    return 0.5 - 0.5 * math.cos(2 * math.pi * p)

def frames(count, m, N, k, cr=0.0):
    q, r = divmod(k, m)
    return ((-q) % N) / N + cr * r

def petal(rb, rt, w, ang, fill, op=1.0):
    rb, rt = RM(rb), RM(rt)
    L = rt - rb
    pts = [(0, -rb), (w, -rb - L * 0.35), (w * 0.7, -rt + L * 0.2), (0, -rt),
           (-w * 0.7, -rt + L * 0.2), (-w, -rb - L * 0.35)]
    d = (f"M0,{f2(-rb)} C{f2(w)},{f2(-rb - L*0.3)} {f2(w*0.8)},{f2(-rt + L*0.25)} 0,{f2(-rt)} "
         f"C{f2(-w*0.8)},{f2(-rt + L*0.25)} {f2(-w)},{f2(-rb - L*0.3)} 0,{f2(-rb)}Z")
    return f'<path d="{d}" fill="{fill}" fill-opacity="{f2(op)}" transform="rotate({f2(ang)})"/>'

def dot(r, ang, size, fill, op=1.0):
    x, y = P(r, ang)
    if RIN != 36.0:
        size *= 0.8
    return f'<circle cx="{f2(x)}" cy="{f2(y)}" r="{f2(size)}" fill="{fill}" fill-opacity="{f2(op)}"/>'

def ring(r, stroke, w, op):
    r = RM(r)
    return f'<circle r="{f2(r)}" fill="none" stroke="{stroke}" stroke-width="{f2(w)}" stroke-opacity="{f2(op)}"/>'

def static_dots(r, count, size, fill, op):
    return ''.join(dot(r, 360 * i / count, size, fill, op) for i in range(count))

def poly(points, fill, op=1.0, stroke=None, sw=0):
    pts = ' '.join(f"{f2(x)},{f2(y)}" for x, y in points)
    s = f' stroke="{stroke}" stroke-width="{f2(sw)}" stroke-linejoin="round"' if stroke else ''
    return f'<polygon points="{pts}" fill="{fill}" fill-opacity="{f2(op)}"{s}/>'

def polyline(points, stroke, sw, op=1.0):
    pts = ' '.join(f"{f2(x)},{f2(y)}" for x, y in points)
    return (f'<polyline points="{pts}" fill="none" stroke="{stroke}" stroke-width="{f2(sw)}" '
            f'stroke-opacity="{f2(op)}" stroke-linecap="round" stroke-linejoin="round"/>')

# ---------------------------------------------------------------- designs

def lotus(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [static_dots(36, 4 * N, .7, ink, .8), ring(56, ink, .6, .45), ring(88.5, acc, .6, .5)]
    for k in range(N):
        p = frames(N, 1, N, k); s = smooth(p); a = (k + .5) * slot
        out.append(petal(58, 74 + 7 * s, 7 + 3 * s, a, acc, .95))
        out.append(petal(60, 68 + 5 * s, 3 + 1.4 * s, a, ink, .95))
    for k in range(N):
        p = frames(N, 1, N, k) + 1 / 3; s = smooth(p); a = k * slot
        out.append(petal(38, 52 + 6 * s, 6 + 2.5 * s, a, ink, .95))
        out.append(petal(40, 47 + 3 * s, 2.4 + 1 * s, a, body, .95))
        out.append(dot(62, a, .9 + 1.3 * s, ink, .9))
    for k in range(2 * N):
        p = frames(2 * N, 2, N, k, .5) + 2 / 3; s = smooth(p); a = k * slot / 2
        out.append(petal(77, 86 + 4 * s, 3.2, a + slot / 4, ink, .9))
    out.append(static_dots(92.5, 4 * N, 1.15, ink, .9))
    out.append(static_dots(96.5, 8 * N, .55, acc, .8))
    return out

def sunwheel(N, c):
    # Wagon-wheel effect: evenly spaced, identical elements whose count is
    # one more (or less) than N. Each strobe step lands every element just
    # short of (or past) its neighbour's place, so the wheel appears to
    # turn slowly, one spacing per revolution, with no seam.
    body, ink, acc = c
    out = [ring(70, ink, .7, .35), ring(91, ink, .7, .35)]
    n = N + 1
    for k in range(n):
        a = k * 360 / n
        b1, b2 = P(37, a - 4.2), P(37, a + 4.2); tip = P(67, a)
        out.append(poly([b1, tip, b2], ink, .95))
        out.append(dot(44, a, 1.6, body))
    n = N - 1
    for k in range(n):
        a = (k + .5) * 360 / n
        d = [P(48, a), P(53, a + 3), P(58, a), P(53, a - 3)]
        out.append(poly(d, acc, .95))
    n = 2 * N - 1
    for k in range(n):
        a = k * 360 / n
        h = 360 / n * .42
        out.append(polyline([P(75, a - h), P(82, a + h * .2), P(89, a - h)], ink, 1.6, .9))
    out.append(static_dots(95.5, 4 * N, 1.1, acc, .9))
    return out

def tidepool(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [static_dots(36.5, 4 * N, .8, acc, .7), static_dots(96.5, 8 * N, .55, acc, .6)]
    bands = [(40, ink, 2.0, 0, 0), (50, acc, 1.1, .2, .5), (60, ink, 2.0, .4, 0),
             (70, acc, 1.1, .6, .5), (80, ink, 2.0, .8, 0), (89, acc, 1.1, 0, .5)]
    for (R, col, sw, ph, off) in bands:
        for k in range(N):
            p = frames(N, 1, N, k) + ph; s = smooth(p)
            pts = []
            for i in range(11):
                fr = -0.5 + i / 10
                ang = (k + off) * slot + fr * slot
                r = R + (2.5 + 4.5 * s) * math.sin(math.pi * (fr + .5))
                pts.append(P(r, ang))
            out.append(polyline(pts, col, sw, .95))
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p)
        out.append(dot(44 + 2 * s, k * slot, .8 + 1.2 * s, acc, .9))
        out.append(dot(64 + 2 * s, k * slot, .8 + 1.2 * s, acc, .9))
        out.append(dot(84 + 2 * s, k * slot, .8 + 1.2 * s, acc, .9))
    return out

def lantern(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [static_dots(36, 4 * N, .8, ink, .8), ring(97, ink, .7, .35)]
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = k * slot
        out.append(petal(39, 45 + 3 * s, 2.6 + 1 * s, a, ink, .95))
    for k in range(2 * N):
        q, rr = divmod(k, 2)
        p = frames(2 * N, 2, N, k, .5)
        col = ink if rr == 0 else acc
        base = q * slot + rr * slot / 2
        for j in range(7):
            t = j + (p % 1)
            r = 46 + t * 7.2
            if r > 95: continue
            ang = base + (r - 46) * 1.1
            op = math.sin(math.pi * t / 7)
            out.append(dot(r, ang, .7 + .32 * t, col, max(0, op)))
    return out

def starseed(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [ring(40, ink, .6, .45)]
    for k in range(N):
        p = frames(N, 1, N, k); s = smooth(p); a = k * slot
        out.append(poly([P(40, a - slot / 2), P(64 + 14 * s, a), P(40, a + slot / 2)], ink, .92))
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = (k + .5) * slot
        out.append(poly([P(44, a - slot / 3), P(52 + 9 * s, a), P(44, a + slot / 3)], acc, .95))
    for k in range(2 * N):
        q, rr = divmod(k, 2)
        p = frames(2 * N, 2, N, k, .5); s = smooth(p); a = k * slot / 2
        out.append(dot(84 if rr == 0 else 92, a, .5 + 2.1 * s, ink, .95))
    out.append(static_dots(97, 4 * N, .6, acc, .7))
    return out

def kaleido(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [ring(37, ink, 1.2, .9), ring(71, ink, .7, .5), ring(77, ink, .7, .5)]
    # static zigzag band, period one quarter-slot, so stepping never shows
    zz = []
    for i in range(8 * N + 1):
        zz.append(P(91 if i % 2 == 0 else 96, i * slot / 8))
    out.append(polyline(zz, ink, 1.1, .85))
    for k in range(N):
        p = frames(N, 1, N, k); a = k * slot
        cx, cy = P(55, a)
        tw = a + 120 * p
        tri = [(cx + 13 * math.sin(math.radians(tw + i * 120)), cy - 13 * math.cos(math.radians(tw + i * 120))) for i in range(3)]
        out.append(poly(tri, acc, .22, ink, 1.8))
        tw2 = a + 60 - 240 * p
        tri2 = [(cx + 6 * math.sin(math.radians(tw2 + i * 120)), cy - 6 * math.cos(math.radians(tw2 + i * 120))) for i in range(3)]
        out.append(poly(tri2, ink, .95))
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = (k + .5) * slot
        out.append(dot(44, a, 1 + 1.4 * s, acc, .95))
        cx, cy = P(84, a)
        tw = a - 90 * frames(N, 1, N, k)
        dia = [(cx + 6.5 * math.sin(math.radians(tw + i * 90)), cy - 6.5 * math.cos(math.radians(tw + i * 90))) for i in range(4)]
        out.append(poly(dia, acc, .95))
    for k in range(N):
        out.append(dot(84, k * slot, 1.3, ink, .9))
    out.append(static_dots(74, 4 * N, .9, ink, .9))
    return out

def unfurl(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [static_dots(36.5, 4 * N, .8, ink, .7), ring(91, ink, .6, .45),
           static_dots(94.5, 8 * N, .7, ink, .6)]
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = (k + .5) * slot
        out.append(petal(40, 58 + 6 * s, 5.5 + 2 * s, a, acc, .55))
        out.append(petal(42, 52 + 4 * s, 2.2, a, acc, .95))
    for k in range(N):
        p = frames(N, 1, N, k); s = smooth(p); a = k * slot
        bend = -12 + 24 * s
        b = P(38, a); m1 = P(60, a + bend); tip = P(87, a + bend * .4)
        w = 9
        l1 = P(60, a + bend + w * .9); l2 = P(60, a + bend - w * .9)
        d = (f"M{f2(b[0])},{f2(b[1])} Q{f2(l1[0])},{f2(l1[1])} {f2(tip[0])},{f2(tip[1])} "
             f"Q{f2(l2[0])},{f2(l2[1])} {f2(b[0])},{f2(b[1])}Z")
        out.append(f'<path d="{d}" fill="{ink}" fill-opacity=".9"/>')
        out.append(f'<path d="M{f2(b[0])},{f2(b[1])} Q{f2(m1[0])},{f2(m1[1])} {f2(tip[0])},{f2(tip[1])}" fill="none" stroke="{body}" stroke-width=".8" stroke-opacity=".7"/>')
        out.append(dot(89, a + bend * .4, 1.3 + 1.6 * s, acc, .95))
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = (k + .5) * slot
        out.append(dot(72, a, 1 + 1.8 * s, acc, .9))
        out.append(dot(81, a, .7 + 1 * s, ink, .8))
    return out

def ember(N, c):
    body, ink, acc = c
    slot = 360 / N
    out = [ring(37, ink, 1, .7), ring(74, ink, .6, .45), static_dots(97, 8 * N, .6, ink, .6)]
    for k in range(2 * N):
        p = frames(2 * N, 2, N, k, .5); s = smooth(p); a = k * slot / 2
        out.append(petal(38, 54 + 13 * s, 3.8, a, ink, .95))
        out.append(petal(40, 47 + 7 * s, 1.7, a, acc, .95))
    for k in range(N):
        p = frames(N, 1, N, k) + .25; s = smooth(p); a = (k + .5) * slot
        out.append(petal(76, 86 + 6 * s, 4.5 + 1.5 * s, a, acc, .9))
        out.append(petal(78, 83 + 3 * s, 1.8, a, body, .9))
    for k in range(N):
        p = frames(N, 1, N, k)
        for off in (0, .5):
            t = (p + off) % 1
            out.append(dot(78 + 17 * t, k * slot, 1.7 - .9 * t, ink, 1 - t))
    return out

def moon_path(R, p):
    # Lit shape of a moon at phase p (0 new, .5 full), waxing lit on the +x
    # (clockwise) side, in the moon's own local coordinates.
    k = math.cos(2 * math.pi * p)
    rx = max(.01, R * abs(k))
    if p < .5:
        limb = f"M0,{f2(-R)} A{f2(R)},{f2(R)} 0 0 1 0,{f2(R)}"
        sw = 0 if k > 0 else 1
    else:
        limb = f"M0,{f2(-R)} A{f2(R)},{f2(R)} 0 0 0 0,{f2(R)}"
        sw = 1 if k > 0 else 0
    return limb + f" A{f2(rx)},{f2(R)} 0 0 {sw} 0,{f2(-R)}Z"

def moonwheel(N, c):
    body, ink, acc = c
    slot = 360 / N
    small = RIN != 36.0
    R = 8.6 * (0.74 if small else 1)
    out = [static_dots(36, 4 * N, .7, ink, .7), ring(55, ink, .6, .4), ring(77.5, ink, .6, .4),
           static_dots(96.5, 8 * N, .55, ink, .55)]
    # inner petals swell toward full moon
    for k in range(N):
        p = frames(N, 1, N, k); s = smooth(p); a = k * slot
        out.append(petal(38, 46 + 6 * s, 3 + 2 * s, a, ink, .55 + .4 * s))
    # the lunation: one moon per slot, each a frame of the cycle
    rm = RM(66)
    for k in range(N):
        p = frames(N, 1, N, k); a = k * slot
        cid = f"mw{N}{'s' if small else ''}_{k}"
        lit = moon_path(R, p)
        out.append(
            f'<g transform="rotate({f2(a)}) translate(0,{f2(-rm)})">'
            f'<defs><clipPath id="{cid}"><path d="{lit}"/></clipPath></defs>'
            f'<circle r="{f2(R)}" fill="#2E3370"/>'
            f'<path d="{lit}" fill="{ink}"/>'
            f'<g clip-path="url(#{cid})" fill="#B9B2A2" fill-opacity=".55">'
            f'<circle cx="{f2(-R*.25)}" cy="{f2(-R*.3)}" r="{f2(R*.28)}"/>'
            f'<circle cx="{f2(R*.3)}" cy="{f2(R*.05)}" r="{f2(R*.2)}"/>'
            f'<circle cx="{f2(-R*.05)}" cy="{f2(R*.42)}" r="{f2(R*.16)}"/></g>'
            f'<circle r="{f2(R)}" fill="none" stroke="{ink}" stroke-opacity=".35" stroke-width=".5"/></g>')
    # four-point stars between the moons, twinkling out of step
    for k in range(N):
        p = frames(N, 1, N, k) + .5; s = smooth(p); a = (k + .5) * slot
        cx, cy = P(66, a); h = (1.2 + 2.6 * s) * (.8 if small else 1)
        out.append(poly([(cx, cy - h), (cx + h * .28, cy), (cx, cy + h), (cx - h * .28, cy)], acc, .95))
        out.append(poly([(cx - h, cy), (cx, cy - h * .28), (cx + h, cy), (cx, cy + h * .28)], acc, .95))
    # the tide: scalloped ring that rises toward full moon
    for k in range(N):
        p = frames(N, 1, N, k); s = smooth(p)
        pts = []
        for i in range(11):
            fr = -0.5 + i / 10
            ang = k * slot + fr * slot
            pts.append(P(84 + (1.5 + 5 * s) * math.sin(math.pi * (fr + .5)), ang))
        out.append(polyline(pts, ink, 1.4, .85))
        out.append(dot(91, k * slot, .8 + 1.2 * s, acc, .9))
    return out

DESIGNS = [
    ('moonwheel', 'Moonwheel', moonwheel, ('#3B4080', '#DED7C7', '#E6E2DA')),
    ('lotus',    'Lotus',    lotus,    ('#E8DCC4', '#C2566F', '#3F8C7E')),
    ('sunwheel', 'Sunwheel', sunwheel, ('#6E2925', '#E6DCC8', '#D9A441')),
    ('tidepool', 'Tidepool', tidepool, ('#1F4A55', '#8FD3CC', '#EFE9DF')),
    ('lantern',  'Lantern',  lantern,  ('#2B2A2E', '#D19A5B', '#B9D9EB')),
    ('starseed', 'Starseed', starseed, ('#262B5C', '#EFE9DF', '#D2493A')),
    ('kaleido',  'Kaleido',  kaleido,  ('#E6DCC8', '#2B5586', '#C4302B')),
    ('unfurl',   'Unfurl',   unfurl,   ('#23463F', '#CFE3B5', '#E07A5F')),
    ('ember',    'Ember',    ember,    ('#1C1A1E', '#E0563F', '#E3B04B')),
]

for slug, name, fn, cols in DESIGNS:
    # LP art: 12" label (r 33). 45 art: the 10" label (r 40) also covers
    # a 12" at 45. 7" art: the 7" label (r 51.5).
    for N, tag, rin in ((12, 'lp', 36.0), (16, '45', 42.0), (16, '7in_45', 53.0)):
        RIN = rin
        body = cols[0]
        parts = [f'<circle r="100" fill="{body}"/>'] + fn(N, cols)
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -100 200 200" width="400" height="400">'
               + ''.join(parts) + '</svg>')
        with open(os.path.join(OUT, f'{slug}_{tag}.svg'), 'w') as fh:
            fh.write(svg)
print('ok')
