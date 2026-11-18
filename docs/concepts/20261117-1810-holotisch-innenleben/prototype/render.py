"""Render interior.json -> SVG snippets for the concept page (top view per deck + exploded 3D)."""
import json
import math
import re
import sys
from collections import Counter

CAT = {  # category -> (label de, colour token, glyph)
    "door": ("Tür", "#7fa8c4", "door"),
    "lift": ("Aufzug", "#52c1e6", "lift"),
    "stairs": ("Treppe", "#52c1e6", "stairs"),
    "ladder": ("Leiter", "#52c1e6", "ladder"),
    "weaponRack": ("Waffenständer", "#e88a6a", "gun"),
    "locker": ("Spind", "#b7a3e8", "locker"),
    "fireExt": ("Feuerlöscher", "#ff6b5b", "fire"),
    "medBed": ("Medbett", "#5fd39a", "med"),
    "respawn": ("Respawn", "#5fd39a", "med"),
    "bed": ("Bett", "#9fb3c8", "bed"),
    "maintenance": ("Wartung", "#f2c46b", "wrench"),
    "head": ("WC/Bad", "#9fb3c8", "drop"),
    "relay": ("Relais", "#f2c46b", "bolt"),
    "powerPlant": ("Kraftwerk", "#f2c46b", "comp"),
    "cooler": ("Kühler", "#f2c46b", "comp"),
    "shield": ("Schildgenerator", "#f2c46b", "comp"),
    "quantumDrive": ("Quantenantrieb", "#f2c46b", "comp"),
    "jumpDrive": ("Sprungmodul", "#f2c46b", "comp"),
    "lifeSupport": ("Lebenserhaltung", "#f2c46b", "comp"),
    "radar": ("Radar", "#f2c46b", "comp"),
    "fuelTank": ("Tank", "#f2c46b", "comp"),
}
SHOW = set(CAT)

def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

def room_label(rm):
    n = rm.get("name") or {}
    lab = n.get("de") or n.get("en")
    if not lab:
        k = re.sub(r"_?Room_RN.*$|_RN$|~\d+$", "", rm["key"])
        lab = re.sub(r"(?<!^)(?=[A-Z])", " ", k).replace("_", " ").strip()
    return lab

def poly_area(p):
    a = 0
    for i in range(len(p)):
        x0, y0 = p[i - 1]
        x1, y1 = p[i]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2

def centroid(p):
    xs = [q[0] for q in p]; ys = [q[1] for q in p]
    return sum(xs) / len(xs), sum(ys) / len(ys)

def scu(d):
    return int(d[0] / 1.25) * int(d[1] / 1.25) * int(d[2] / 1.25) if d else None

def plan_svg(ship, deck_keys, cls="ip", sel_room=None, filt=None, bounds=None, label_min=18, ids=True):
    """Top view, nose up: svg x = X (starboard right), svg y = -Y."""
    decks = [d for d in ship["decks"] if d["key"] in deck_keys]
    rooms = [rm for d in decks for rm in d["rooms"]]
    pts = [pt for rm in rooms for poly in rm["shapes"] + rm["tris"] for pt in poly]
    grids = [g for g in ship["cargoGrids"] if g["deck"] in deck_keys and g.get("dims")]
    pois = [p for p in ship["pois"] if p["deck"] in deck_keys and p["cat"] in SHOW and ((filt is None and p["cat"] != "door") or (filt is not None and p["cat"] in filt))]
    for g in grids:
        pts += [[g["pos"][0] - g["dims"][0] / 2, g["pos"][1] - g["dims"][1] / 2], [g["pos"][0] + g["dims"][0] / 2, g["pos"][1] + g["dims"][1] / 2]]
    if bounds is None:
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        bounds = (min(xs), min(ys), max(xs), max(ys))
    x0, y0, x1, y1 = bounds
    pad = 2
    vb = f"{x0-pad:.1f} {-y1-pad:.1f} {x1-x0+2*pad:.1f} {y1-y0+2*pad:.1f}"
    span = max(x1 - x0, y1 - y0)
    fs = max(1.0, span / 70)
    out = [f'<svg class="{cls}" viewBox="{vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">']
    out.append('<g class="ip-rooms">')
    labels = []
    for rm in rooms:
        on = sel_room and rm["key"] == sel_room
        k = " on" if on else ""
        lk = " link" if rm.get("connects") else ""
        best = None
        for poly in rm["shapes"]:
            if len(poly) < 3:
                continue
            d = "M" + " L".join(f"{p[0]:.1f},{-p[1]:.1f}" for p in poly) + "Z"
            out.append(f'<path class="ip-room{k}{lk}" d="{d}"/>')
            a = poly_area(poly)
            if best is None or a > best[0]:
                best = (a, centroid(poly))
        if rm["tris"]:
            d = "".join("M" + " L".join(f"{p[0]:.1f},{-p[1]:.1f}" for p in t) + "Z" for t in rm["tris"])
            out.append(f'<path class="ip-mesh{k}" d="{d}"/>')
            a = sum(poly_area(t) for t in rm["tris"])
            if best is None or a > best[0]:
                allp = [p for t in rm["tris"] for p in t]
                best = (a, centroid(allp))
        if best and (best[0] >= label_min or on):
            labels.append((best[1], room_label(rm), on))
    out.append("</g><g class=\"ip-grids\">")
    for g in grids:
        w, h = g["dims"][0], g["dims"][1]
        x, y = g["pos"][0] - w / 2, -g["pos"][1] - h / 2
        out.append(f'<rect class="ip-grid" x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}"/>')
        if min(w, h) > fs * 2.2:
            out.append(f'<text class="ip-gt" x="{g["pos"][0]:.1f}" y="{-g["pos"][1]:.1f}" font-size="{fs*0.95:.1f}">{scu(g["dims"])}</text>')
    out.append("</g><g class=\"ip-labels\">")
    for (cx, cy), lab, on in labels:
        out.append(f'<text class="ip-lbl{" on" if on else ""}" x="{cx:.1f}" y="{-cy:.1f}" font-size="{fs*(1.05 if on else 0.85):.1f}">{esc(lab)}</text>')
    out.append("</g><g class=\"ip-pois\">")
    r = fs * 0.75
    for p in pois:
        c = CAT[p["cat"]]
        if p["cat"] == "door":
            out.append(f'<circle class="ip-door" cx="{p["pos"][0]:.1f}" cy="{-p["pos"][1]:.1f}" r="{r*0.33:.2f}"/>')
            continue
        out.append(f'<use href="#ipi-{c[2]}" class="ip-poi c-{p["cat"]}" x="{p["pos"][0]-r:.1f}" y="{-p["pos"][1]-r:.1f}" width="{2*r:.1f}" height="{2*r:.1f}" style="color:{c[1]}"/>')
    out.append("</g></svg>")
    return "".join(out)

def iso_svg(ship, deck_order, gap=9.0, cls="ip3d", focus=None, names=None):
    """Exploded side-above view: nose to the right, decks stacked with a gap."""
    def pj(x, y, level):
        return y, x * 0.3 - level * gap
    out = []
    allpts = []
    layers = []
    for li, dk in enumerate(deck_order):
        d = next(dd for dd in ship["decks"] if dd["key"] == dk)
        paths = []
        for rm in d["rooms"]:
            for poly in rm["shapes"] + rm["tris"]:
                if len(poly) < 3:
                    continue
                q = [pj(p[0], p[1], li) for p in poly]
                allpts += q
                paths.append("M" + " L".join(f"{a:.1f},{b:.1f}" for a, b in q) + "Z")
        grids = []
        for g in ship["cargoGrids"]:
            if g["deck"] == dk and g.get("dims"):
                x, y = g["pos"][0], g["pos"][1]; w, h = g["dims"][0] / 2, g["dims"][1] / 2
                q = [pj(x - w, y - h, li), pj(x + w, y - h, li), pj(x + w, y + h, li), pj(x - w, y + h, li)]
                allpts += q
                grids.append("M" + " L".join(f"{a:.1f},{b:.1f}" for a, b in q) + "Z")
        layers.append((li, dk, paths, grids))
    xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]
    pad = 6
    out.append(f'<svg class="{cls}" viewBox="{min(xs)-pad-40:.1f} {min(ys)-pad:.1f} {max(xs)-min(xs)+2*pad+40:.1f} {max(ys)-min(ys)+2*pad:.1f}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">')
    for li, dk, paths, grids in reversed(layers):
        on = focus is None or focus == dk
        out.append(f'<g class="ip3-layer{" on" if focus == dk else ""}{" dim" if not on else ""}">')
        out.append(f'<path class="ip3-room" d="{"".join(paths)}"/>')
        if grids:
            out.append(f'<path class="ip3-grid" d="{"".join(grids)}"/>')
        lab = (names or {}).get(dk, dk)
        lx = min(xs) - 38
        ly = sum(p[1] for p in allpts) / len(allpts) if False else (0.0 - li * gap)
        out.append(f'<text class="ip3-lbl" x="{lx:.1f}" y="{ly:.1f}">{esc(lab)}</text></g>')
    # connectors: lifts
    lvl = {dk: i for i, dk in enumerate(deck_order)}
    out.append('<g class="ip3-links">')
    for lf in ship["lifts"]:
        ds = [lvl[d] for d in lf["decks"] if d in lvl]
        if len(ds) < 2:
            continue
        a = pj(lf["at"][0], lf["at"][1], min(ds)); b = pj(lf["at"][0], lf["at"][1], max(ds))
        out.append(f'<line class="ip3-lift" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
        for dd in ds:
            c = pj(lf["at"][0], lf["at"][1], dd)
            out.append(f'<circle class="ip3-stop" cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="1.6"/>')
    for p in ship["pois"]:
        if p["cat"] in ("stairs", "ladder") and p["deck"] in lvl:
            li = lvl[p["deck"]]
            a = pj(p["pos"][0], p["pos"][1], li); b = pj(p["pos"][0], p["pos"][1], min(li + 1, len(deck_order) - 1))
            out.append(f'<line class="ip3-{p["cat"]}" x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}"/>')
    out.append("</g></svg>")
    return "".join(out)

if __name__ == "__main__":
    s = json.load(open(sys.argv[1], encoding="utf-8"))
    print(json.dumps({"floors": s["floors"], "lifts": s["lifts"], "counts": s["counts"], "perDeck": s["perDeck"],
                      "grids": [(g["port"], g["deck"], scu(g.get("dims"))) for g in s["cargoGrids"]],
                      "decks": [(d["key"], (d.get("name") or {}).get("de"), d.get("floorZ"), len(d["rooms"]), [room_label(r) for r in d["rooms"]][:30]) for d in s["decks"]]}, ensure_ascii=False, indent=0))
