"""Compose round 01 of the holotisch-innenleben concept from the prototype interior extracts."""
import json
import math
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, ".")
import render as R  # noqa: E402

S = sys.argv[1]          # scratchpad
OUT = sys.argv[2]        # rounds/01.html

def load(c):
    return json.load(open(f"{S}/probe-out3/{c}.interior.json", encoding="utf-8"))

NOISY = re.compile(r"hallway|stairwell|stairs|guard|dummy|passage|corridor|^room\b|room-\d|access ladder|accesspassage|lobby|^\s*$", re.I)
DE = {"Mess Hall": "Messe", "Escape Pods": "Rettungskapseln", "Battle Bridge": "Gefechtsbrücke", "Armory": "Waffenkammer",
      "Engineering": "Maschinenraum", "Habitation": "Wohnbereich", "Brig": "Arrestzellen", "Turret Access": "Turmzugang",
      "Drone Depot": "Drohnendepot", "Sub Cargo Bay": "Unterer Frachtraum", "Mining Station": "Bergbau-Station",
      "Hangar  Pilot Ready Room  Room": "Bereitschaftsraum", "Hangar  Right Control Room  Room": "Hangar-Leitstand",
      "Argo Bay  Hangar  Room": "Argo-Bucht", "Argo Bay  Gravity Generator  Room": "Gravitationsgenerator",
      "Mid Deck  Front  Hangar Observation Hallway  Room": "", "Cockpit": "Cockpit"}
_orig = R.room_label

def label(rm):
    n = rm.get("name") or {}
    if not (n.get("de") or n.get("en")):
        return ""
    lab = _orig(rm)
    lab = DE.get(lab, lab)
    return "" if NOISY.search(lab) else lab
R.room_label = label

def merge(ship, mapping, names, order):
    """mapping: old deck key -> new key; names: new key -> label; order: bottom→top new keys."""
    decks = {}
    for d in ship["decks"]:
        nk = mapping.get(d["key"])
        if nk is None:
            continue
        nd = decks.setdefault(nk, {"key": nk, "name": {"de": names[nk]}, "rooms": []})
        nd["rooms"] += d["rooms"]
    ship = dict(ship)
    ship["decks"] = [decks[k] for k in order]
    ship["pois"] = [dict(p, deck=mapping.get(p["deck"], p["deck"])) for p in ship["pois"]]
    ship["cargoGrids"] = [dict(g, deck=mapping.get(g["deck"], g["deck"])) for g in ship["cargoGrids"]]
    # cluster lifts by position (< 6 m), union of stops/decks
    cl = []
    for lf in ship["lifts"]:
        for c in cl:
            if math.dist(c["at"], lf["at"]) < 6:
                c["decks"] = sorted(set(c["decks"]) | {mapping.get(d, d) for d in lf["decks"]})
                c["stops"] = sorted(set(c["stops"]) | set(lf["stops"]))
                break
        else:
            cl.append({"at": lf["at"], "stops": list(lf["stops"]), "decks": sorted({mapping.get(d, d) for d in lf["decks"]})})
    ship["lifts"] = cl
    return ship

def counts(ship, deck):
    return Counter(p["cat"] for p in ship["pois"] if p["deck"] == deck)

def grid_scu(ship, deck):
    return sum(R.scu(g["dims"]) or 0 for g in ship["cargoGrids"] if g["deck"] == deck)

def pip(pt, poly):
    x, y = pt; ins = False
    for i in range(len(poly)):
        x0, y0 = poly[i - 1]; x1, y1 = poly[i]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0:
            ins = not ins
    return ins

def in_room(rm, pt):
    return any(len(p) >= 3 and pip(pt, p) for p in rm["shapes"] + rm["tris"])

# ── ships ────────────────────────────────────────────────────────────────────
idris_raw = load("AEGS_Idris_P")
I_MAP = {"level_1": "argo", "level_2": "argo", "level_3": "hangar", "level_4": "ohangar", "level_5": "haupt", "level_6": "haupt", "level_7": "turm", "level_8": "bruecke"}
I_NAMES = {"argo": "Argo-Deck", "hangar": "Hangar", "ohangar": "Oberer Hangar", "haupt": "Hauptdeck", "turm": "Geschütz-Deck", "bruecke": "Brücke"}
I_ORDER = ["argo", "hangar", "ohangar", "haupt", "turm", "bruecke"]
idris = merge(idris_raw, I_MAP, I_NAMES, I_ORDER)

sl_raw = load("MISC_Starlancer_Max")
# lower/upper by floor height: rooms of the catch-all go where their floor (or pivot) sits
sl = dict(sl_raw)
lower, upper = [], []
for d in sl_raw["decks"]:
    for rm in d["rooms"]:
        z = rm["floorZ"] if rm.get("floorZ") is not None else rm["pos"][2]
        (lower if z < -2.0 else upper).append(rm)
sl["decks"] = [{"key": "unten", "name": {"de": "Unteres Deck"}, "rooms": lower}, {"key": "oben", "name": {"de": "Oberes Deck"}, "rooms": upper}]
sl["pois"] = [dict(p, deck="unten" if p["pos"][2] < -2.0 else "oben") for p in sl_raw["pois"]]
sl["cargoGrids"] = [dict(g, deck="unten" if g["pos"][2] < -2.0 else "oben") for g in sl_raw["cargoGrids"]]
cl = []
for lf in sl_raw["lifts"]:
    dk = "unten" if lf["stops"][0] < -2 else "oben"
    for c in cl:
        if abs(c["at"][0] - lf["at"][0]) < 4.5 and abs(c["at"][1] - lf["at"][1]) < 3:
            c["decks"] = sorted(set(c["decks"]) | {dk}); c["stops"] += lf["stops"]; break
    else:
        cl.append({"at": lf["at"], "stops": list(lf["stops"]), "decks": [dk]})
sl["lifts"] = cl

def bounds_all(ship):
    pts = [pt for d in ship["decks"] for rm in d["rooms"] for poly in rm["shapes"] + rm["tris"] for pt in poly]
    for g in ship["cargoGrids"]:
        if g.get("dims"):
            pts += [[g["pos"][0] - g["dims"][0] / 2, g["pos"][1] - g["dims"][1] / 2], [g["pos"][0] + g["dims"][0] / 2, g["pos"][1] + g["dims"][1] / 2]]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))

IB = bounds_all(idris)
SB = bounds_all(sl)

# selected room on the Idris main deck: the big cargo room
haupt = next(d for d in idris["decks"] if d["key"] == "haupt")
cargo_room = max((rm for rm in haupt["rooms"] if R.room_label(rm) == "Frachtraum"),
                 key=lambda rm: sum(R.poly_area(p) for p in rm["shapes"] + rm["tris"] if len(p) >= 3))
inside = [p for p in idris["pois"] if p["deck"] == "haupt" and in_room(cargo_room, p["pos"][:2])]
inside_grids = [g for g in idris["cargoGrids"] if g["deck"] == "haupt" and in_room(cargo_room, g["pos"][:2])]
near_lifts = [lf for lf in idris["lifts"] if "haupt" in lf["decks"] and len(lf["decks"]) > 1]

stats = {
    "idris": {d: dict(counts(idris, d)) for d in I_ORDER},
    "idris_scu": {d: grid_scu(idris, d) for d in I_ORDER},
    "sl": {d: dict(counts(sl, d)) for d in ("unten", "oben")},
    "sl_scu": {d: grid_scu(sl, d) for d in ("unten", "oben")},
    "cargo_room": {"key": cargo_room["key"], "inside": dict(Counter(p["cat"] for p in inside)), "grids": [(g["port"], R.scu(g["dims"])) for g in inside_grids]},
    "idris_lifts": idris["lifts"], "sl_lifts": sl["lifts"],
    "sl_rooms": {d["key"]: [R.room_label(r) or r["key"] for r in d["rooms"]] for d in sl["decks"]},
}
json.dump(stats, open(f"{S}/probe-out3/compose-stats.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ── SVG snippets ─────────────────────────────────────────────────────────────
WEGE_MED = {"lift", "stairs", "ladder", "medBed", "respawn"}
TECH = {"lift", "stairs", "ladder", "relay", "powerPlant", "cooler", "shield", "quantumDrive", "jumpDrive", "lifeSupport", "radar", "fuelTank"}
svgs = {
    "i_haupt": R.plan_svg(idris, {"haupt"}, label_min=30, filt=WEGE_MED),
    "i_haupt_sel": R.plan_svg(idris, {"haupt"}, sel_room=cargo_room["key"], label_min=30, filt=WEGE_MED),
    "i_haupt_all": R.plan_svg(idris, {"haupt"}, label_min=30),
    "i_relay": R.plan_svg(idris, {"haupt"}, label_min=30, filt={"relay"}),
    "i_hangar": R.plan_svg(idris, {"hangar"}, label_min=30, filt=TECH),
    "i_3d": R.iso_svg(idris, I_ORDER, gap=30, names=I_NAMES),
    "i_3d_haupt": R.iso_svg(idris, I_ORDER, gap=30, names=I_NAMES, focus="haupt"),
    "s_unten": R.plan_svg(sl, {"unten"}, bounds=SB, label_min=6),
    "s_oben": R.plan_svg(sl, {"oben"}, bounds=SB, label_min=6),
    "s_3d": R.iso_svg(sl, ["unten", "oben"], gap=14, names={"unten": "Unteres Deck", "oben": "Oberes Deck"}),
}
json.dump(svgs, open(f"{S}/probe-out3/svgs.json", "w", encoding="utf-8"))
for k, v in svgs.items():
    print(k, len(v))
print(json.dumps({k: stats[k] for k in ("idris", "idris_scu", "sl", "sl_scu", "cargo_room")}, ensure_ascii=False))
print("lifts", stats["idris_lifts"], stats["sl_lifts"])
print("sl rooms", stats["sl_rooms"])
