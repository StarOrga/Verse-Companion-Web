"""Orthographic 3D view of a ship interior inside a ghost hull (SVG)."""
import math
import re

import render as R

def sil_points(sil):
    nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", sil["path"].split("Z")[0])]
    pts = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
    sc = sil["scale"]
    return [((x - 500) * sc, sil["ymax"] - y * sc) for x, y in pts]

class Cam:
    def __init__(self, yaw, pitch):
        self.cy, self.sy = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        self.ce, self.se = math.cos(math.radians(pitch)), math.sin(math.radians(pitch))

    def p(self, x, y, z):
        x1 = x * self.cy - y * self.sy
        y1 = x * self.sy + y * self.cy
        return x1, -(z * self.ce + y1 * self.se)

    def depth(self, x, y, z):
        y1 = x * self.sy + y * self.cy
        return y1 * self.ce - z * self.se

def path(cam, pts, z, close=True):
    q = [cam.p(x, y, z) for x, y in pts]
    return "M" + " L".join(f"{a:.1f},{b:.1f}" for a, b in q) + ("Z" if close else "")

def view(ship, sil, sel, yaw=35, pitch=32, filt=None, all_decks=False, deck_z=None, label=None):
    """sel: deck key in focus (None = all decks equal). deck_z: deck key -> floor z."""
    cam = Cam(yaw, pitch)
    hull = sil_points(sil)
    zs = [z for z in deck_z.values()]
    zlo, zhi = min(zs) - 3.0, max(zs) + 5.0
    zmid = (zlo + zhi) / 2
    out, pts_all = [], []
    for z in (zlo, zmid, zhi):
        for x, y in hull:
            pts_all.append(cam.p(x, y, z))
    # hull ghost: three rings + verticals at every 6th point
    g = [f'<path class="h3-ring" d="{path(cam, hull, zlo)}"/>', f'<path class="h3-ring mid" d="{path(cam, hull, zmid)}"/>', f'<path class="h3-ring" d="{path(cam, hull, zhi)}"/>']
    for i in range(0, len(hull), 5):
        x, y = hull[i]
        a, b = cam.p(x, y, zlo), cam.p(x, y, zhi)
        g.append(f'<line class="h3-rib" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
    out.append('<g class="h3-hull">' + "".join(g) + "</g>")
    # decks
    order = sorted(ship["decks"], key=lambda d: deck_z[d["key"]])
    for d in order:
        z = deck_z[d["key"]]
        focus = all_decks or d["key"] == sel
        cls = "h3-deck on" if focus and not all_decks else ("h3-deck all" if all_decks else "h3-deck ghost")
        floors, tops = [], []
        for rm in d["rooms"]:
            fz = rm["floorZ"] if rm.get("floorZ") is not None else z
            h = rm.get("height") or 2.6
            for poly in rm["shapes"] + rm["tris"]:
                if len(poly) < 3:
                    continue
                floors.append(path(cam, poly, fz))
                if focus and not all_decks and rm["shapes"]:
                    tops.append(path(cam, poly, fz + h))
        out.append(f'<g class="{cls}"><path class="h3-floor" d="{"".join(floors)}"/>' + (f'<path class="h3-top" d="{"".join(tops)}"/>' if tops else "") + "</g>")
        if focus:
            # cargo grids as boxes
            for gr in ship["cargoGrids"]:
                if gr["deck"] != d["key"] or not gr.get("dims"):
                    continue
                (cx, cy, cz), (w, l, hh) = gr["pos"], gr["dims"]
                x0, x1, y0, y1 = cx - w / 2, cx + w / 2, cy - l / 2, cy + l / 2
                z0 = cz if cz is not None else z
                z1 = z0 + hh
                faces = [
                    ([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, "b"),
                    ([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z1, "t"),
                ]
                fb = [f'<path class="h3-gb" d="{path(cam, faces[0][0], z0)}"/>']
                sides = []
                for (ax, ay), (bx, by) in (((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))):
                    q = [cam.p(ax, ay, z0), cam.p(bx, by, z0), cam.p(bx, by, z1), cam.p(ax, ay, z1)]
                    dep = cam.depth((ax + bx) / 2, (ay + by) / 2, z0)
                    sides.append((dep, "M" + " L".join(f"{a:.1f},{b:.1f}" for a, b in q) + "Z"))
                sides.sort(reverse=True)
                out.append('<g class="h3-grid">' + "".join(fb) + "".join(f'<path class="h3-gs" d="{s}"/>' for _, s in sides)
                           + f'<path class="h3-gt" d="{path(cam, faces[1][0], z1)}"/></g>')
    # lifts and ladders
    links = []
    for lf in ship["lifts"]:
        if len(lf["stops"]) < 2:
            continue
        a, b = cam.p(lf["at"][0], lf["at"][1], min(lf["stops"])), cam.p(lf["at"][0], lf["at"][1], max(lf["stops"]))
        links.append(f'<line class="h3-lift" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
        for s in lf["stops"]:
            c = cam.p(lf["at"][0], lf["at"][1], s)
            links.append(f'<circle class="h3-stop" cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="1.3"/>')
    for p in ship["pois"]:
        if p["cat"] == "ladder":
            a, b = cam.p(p["pos"][0], p["pos"][1], p["pos"][2]), cam.p(p["pos"][0], p["pos"][1], p["pos"][2] + 3.2)
            links.append(f'<line class="h3-ladder" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
    out.append('<g class="h3-links">' + "".join(links) + "</g>")
    # POIs of the focused deck
    xs = [p[0] for p in pts_all]; ys = [p[1] for p in pts_all]
    span = max(max(xs) - min(xs), max(ys) - min(ys))
    r = span / 120
    icons = []
    for p in ship["pois"]:
        if (all_decks or p["deck"] == sel) and filt is not None and p["cat"] in filt and p["cat"] in R.CAT:
            c = R.CAT[p["cat"]]
            if p["cat"] == "door":
                a = cam.p(*p["pos"])
                icons.append(f'<circle class="h3-door" cx="{a[0]:.1f}" cy="{a[1]:.1f}" r="{r*0.35:.2f}"/>')
                continue
            a = cam.p(*p["pos"])
            icons.append(f'<use href="#ipi-{c[2]}" x="{a[0]-r:.1f}" y="{a[1]-r:.1f}" width="{2*r:.1f}" height="{2*r:.1f}" style="color:{c[1]}"/>')
    out.append('<g class="h3-pois">' + "".join(icons) + "</g>")
    if label and sel:
        z = deck_z[sel]
        nose = max(hull, key=lambda q: q[1])
        a = cam.p(nose[0], nose[1] + 4, z)
        out.append(f'<text class="h3-lbl" x="{a[0]:.1f}" y="{a[1]:.1f}" font-size="{span/45:.1f}">{R.esc(label)}</text>')
    pad = span * 0.04
    vb = f"{min(xs)-pad:.1f} {min(ys)-pad:.1f} {max(xs)-min(xs)+2*pad:.1f} {max(ys)-min(ys)+2*pad:.1f}"
    return f'<svg class="h3" viewBox="{vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + "".join(out) + "</svg>"
