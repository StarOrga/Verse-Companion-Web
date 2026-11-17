"""Interior of a ship for the beta holotable (concept 20261117-1810).

Pure logic, no archive access: the extractor (`CodexExtractor._build_interior`)
reads the socpak entities and the default loadout and hands plain dicts to the
functions here. Payload contract: `ShipInterior` in `src/app/codex/codex.types.ts`.

VERIFIED LIVE 4.10.2 (Idris-P, Starlancer MAX, Reclaimer, probes of 2026-11-17):
  * interior entities sit in the socpak object containers (CryXmlB `<Entities>`);
  * `door_navlink` and `Door_Ship_Sensor_Proximity*` are AI / trigger helpers, no doors;
    the Idris-P then has exactly 94 doors (71 room, 13 inner, 3 lift, 3 hangar, 2 bow, 2 airlock);
  * a cargo grid is `*_CargoGrid*` in the default loadout, SCU = floor(x/1.25)·floor(y/1.25)·floor(z/1.25);
  * the relay -> single component edge is empty in the item records (not modelled).
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from .ship_rooms import bounds_of, is_connector

FALLBACK_DECK_KEY = "unassigned"  # same as dataforge_extract.FALLBACK_DECK_KEY (no import: cycle)
POS_ROUND = 1                  # metres in the payload: 0.1 m
SCU_CELL_M = 1.25              # edge of one SCU cell
PANEL_MAX_M = 3.0              # a door control panel this close belongs to the door
# Brig cell doors. The cell panels are no per-door panels: on the Idris-P all six
# (`…_Physical_Cell1`…`Cell6`) sit within 0.15 m of each other on the console of the security
# room. The cells are the inner doors of the cell-block room, in a row 4 m apart. So a ship with
# N cell panels gets its N cell-block doors nearest to that console as kind `cell`.
CELL_PANEL_RX = re.compile(r"cell", re.I)
CELL_BLOCK_ROOM_RX = re.compile(r"brig|cell|prison|jail", re.I)
CELL_BLOCK_NOT_RX = re.compile(r"control|security", re.I)
CELL_DOOR_MAX_M = 30.0         # a cell door this close to the cell console (Idris-P: 5.6–24.1 m)
LIFT_CLUSTER_M = 5.0           # stops of one shaft sit this close in x/y (TransitDestination is offset from its door)
LIFT_STOP_MIN_GAP_M = 1.0      # two stops of one shaft differ in height by more than this
DECK_TOLERANCE_M = 0.8         # a point stands on the highest deck floor up to this much above it
DECK_MIN_AREA_M2 = 350.0       # a derived level with this much real room floor is a deck of its own
DECK_STACK_GAP_M = 3.2         # a level this close under a deck is its landing / mezzanine

# entity class (socpak) -> category
ENT_CATS: List[Tuple[str, str]] = [
    ("lift", r"^Transit(Destination|Gateway)$"),
    ("ladder", r"^Ladder$|^Ladder_"),
    ("door", r"^Door_(?!.*toilet)|^ElevatorDoor"),
    ("weaponRack", r"Weapon_Rack"),
    ("locker", r"PersonalStorage|Locker"),
    ("fireExt", r"fire_extinguisher"),
    ("medBed", r"Medical|MedicalBed"),
    ("respawn", r"Medbay_Respawn"),
    ("bed", r"^Bed_"),
    ("maintenance", r"Maintenance|^Workzone"),
    ("head", r"toilet|^Sink"),
    ("escapePod", r"escape.?pod"),
    ("doorPanel", r"DoorControl"),
    ("console", r"^Console_"),
]
# default-loadout item class -> category
LO_CATS: List[Tuple[str, str]] = [
    ("powerPlant", r"^POWR_"), ("cooler", r"^COOL_"), ("shield", r"^SHLD_"),
    ("quantumDrive", r"^QDRV_"), ("jumpDrive", r"^JDRV_"), ("lifeSupport", r"^LFSP_"),
    ("radar", r"^RADR_"), ("relay", r"^RELAY_"), ("fuelTank", r"^[HQ]TNK_"),
    ("door", r"^Door_"), ("dockingTube", r"DockingTube|Docking"), ("turret", r"^Turret|TurretBase"),
    ("battery", r"^BATT_|Battery"), ("computer", r"^Controller_|COMP_"), ("tractor", r"Tractor"),
    ("escapePod", r"EscapePod|Escape_Pod"), ("medBed", r"Medical"),
]
# categories the payload carries (`ShipInteriorCat`); the rest (panels, consoles, batteries, tractors) is dropped
PAYLOAD_CATS = {
    "lift", "stairs", "ladder", "ramp", "airlock", "dockingTube", "escapePod", "medBed", "respawn",
    "weaponRack", "locker", "fireExt", "relay", "powerPlant", "cooler", "shield", "quantumDrive",
    "jumpDrive", "lifeSupport", "radar", "fuelTank", "maintenance", "turret", "computer", "bed", "head", "door",
}
NOT_A_DOOR = re.compile(r"door_navlink|Door_Ship_Sensor_Proximity|^Door_Ship_Switch", re.I)


def cat_of(rules: Sequence[Tuple[str, str]], cls: Optional[str]) -> Optional[str]:
    for name, rx in rules:
        if re.search(rx, cls or "", re.I):
            return name
    return None


def r1(v: Iterable[float]) -> List[float]:
    return [round(float(x), POS_ROUND) + 0.0 for x in v]


# ── doors ────────────────────────────────────────────────────────────────────
def is_real_door(cls: str) -> bool:
    return not NOT_A_DOOR.search(cls or "")


def classify_door(cls: str, name: str = "", from_loadout: bool = False) -> Dict[str, Any]:
    """`{kind, breachable}` of one door entity / loadout door.

    Rules from the Idris-P / Starlancer / Reclaimer door classes: lift doors say
    Elevator / Lift, airlocks say Airlock / Docking, a loadout door of the hull is a
    hangar gate (`RoomConnector`) or a bow door (`NoRoomConnector` at the front);
    inside, `RoomConnector` joins two rooms, every other door is an inner door / hatch."""
    text = f"{cls} {name}"
    breachable = bool(re.search(r"breachable", cls, re.I))
    if re.search(r"elevator|(?<![a-z])lift(?![a-z])", text, re.I):
        kind = "lift"
    elif re.search(r"airlock|docking", text, re.I):
        kind = "airlock"
    elif re.search(r"ramp", text, re.I):
        kind = "ramp"
    elif from_loadout:
        if re.search(r"NoRoomConnector", cls, re.I):
            kind = "bow" if re.search(r"front|bow|nose", text, re.I) else "inner"
        else:
            kind = "hangar"
    elif re.search(r"exterior", cls, re.I):
        kind = "hangar"
    elif re.search(r"(?<!No)RoomConnector", cls):
        kind = "room"
    else:
        kind = "inner"
    return {"kind": kind, "breachable": breachable}


def attach_panels(doors: List[Dict[str, Any]], panels: List[Dict[str, Any]],
                  max_dist: float = PANEL_MAX_M,
                  room_of: Optional[Callable[[Dict[str, Any]], Optional[str]]] = None) -> None:
    """Sets `door.panel` (nearest control panel within `max_dist`, else None) and marks the
    brig cell doors (see `CELL_PANEL_RX`): with N cell panels, the N inner doors (a cell is no
    room of its own, so its door is no `RoomConnector`) of a cell-block room (`room_of(door)` matches `CELL_BLOCK_ROOM_RX`, not `CELL_BLOCK_NOT_RX`)
    nearest to the cell console become kind `cell`, their panel the console. Without
    `room_of` no door is guessed to be a cell."""
    for d in doors:
        best, best_d = None, max_dist
        for p in panels:
            dist = math.dist(d["pos"], p["pos"])
            if dist <= best_d:
                best, best_d = p, dist
        d["door"]["panel"] = r1(best["pos"]) if best else None
    cells = [p for p in panels if CELL_PANEL_RX.search(f"{p.get('cls', '')} {p.get('name', '')}")]
    if not cells or room_of is None:
        return
    console = [sum(p["pos"][i] for p in cells) / len(cells) for i in range(3)]

    def in_cell_block(d: Dict[str, Any]) -> bool:
        key = room_of(d) or ""
        return bool(CELL_BLOCK_ROOM_RX.search(key)) and not CELL_BLOCK_NOT_RX.search(key)

    near = sorted((math.dist(d["pos"], console), i) for i, d in enumerate(doors)
                  if d["door"]["kind"] == "inner" and in_cell_block(d))
    for dist, i in near[:len(cells)]:
        if dist <= CELL_DOOR_MAX_M:
            doors[i]["door"]["kind"] = "cell"
            doors[i]["door"]["panel"] = r1(console)


# ── cargo ────────────────────────────────────────────────────────────────────
def scu_of(dims: Sequence[float]) -> int:
    """floor(x/1.25)·floor(y/1.25)·floor(z/1.25) — the cells that fit the interior box."""
    n = 1
    for v in dims[:3]:
        n *= int(math.floor(float(v) / SCU_CELL_M + 1e-6))
    return n


def flatten_loadout(entries: Optional[Sequence[Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for e in entries or []:
        if isinstance(e, dict):
            out.append(e)
            out += flatten_loadout(e.get("entries"))
    return out


def locate_grids(loadout: Sequence[Dict[str, Any]], port_names: Iterable[str],
                 transforms: Dict[str, Any], dims_of: Callable[[str], Optional[Sequence[float]]]
                 ) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """`(grids, gaps)`. A grid port is placed when its loadout item has a class with
    interior dimensions and the hull model gives the port a position. Every other grid
    port — also ports the loadout leaves empty — is a gap with its reason."""
    seen: Dict[str, Dict[str, Any]] = {}
    for e in loadout:
        port = e.get("itemPortName") or e.get("portName") or ""
        if "cargogrid" in port.lower() or "cargogrid" in (e.get("entityClassName") or "").lower():
            if port and (port not in seen or e.get("entityClassName")):
                seen[port] = e
    for port in port_names:
        if port and "cargogrid" in port.lower() and port not in seen:
            seen[port] = {}
    grids: List[Dict[str, Any]] = []
    gaps: List[Dict[str, str]] = []
    for port, e in seen.items():
        cls = e.get("entityClassName") or ""
        if not cls:
            gaps.append({"port": port, "reason": "noClass"})
            continue
        dims = dims_of(cls)
        if not dims or not all(dims[:3]):
            gaps.append({"port": port, "reason": "noDims"})
            continue
        t = transforms.get(port)
        if not t or not t.get("position"):
            gaps.append({"port": port, "reason": "noPos"})
            continue
        d = [round(float(x), 2) for x in dims[:3]]
        grids.append({"port": port, "cls": cls, "dims": d, "pos": r1(t["position"]), "scu": scu_of(d)})
    return grids, gaps


# ── lifts ────────────────────────────────────────────────────────────────────
def cluster_lifts(stops: Iterable[Sequence[float]], tol: float = LIFT_CLUSTER_M) -> List[Dict[str, Any]]:
    """Clusters lift stops `(x, y, z[, rank])` into shafts: x/y within `tol` metres of the shaft.
    Stops of one shaft within `LIFT_STOP_MIN_GAP_M` in height are one stop (the game places a
    TransitDestination and a TransitGateway per stop): the lower `rank` wins (destination 0,
    gateway 1). Returns `[{at: [x, y], stops: [z…] ascending}]`, shafts ordered by x then y."""
    shafts: List[Dict[str, Any]] = []
    for st in sorted(stops, key=lambda t: (t[0], t[1], t[2])):
        x, y, z = st[0], st[1], st[2]
        rank = st[3] if len(st) > 3 else 0
        for s in shafts:
            if math.dist(s["at"], (x, y)) <= tol:
                same = next((e for e in s["stops"] if abs(e[0] - z) <= LIFT_STOP_MIN_GAP_M), None)
                if same is None:
                    s["stops"].append([z, rank])
                elif rank < same[1]:
                    same[0], same[1] = z, rank
                s["_xy"].append((x, y, rank))
                break
        else:
            shafts.append({"at": [x, y], "stops": [[z, rank]], "_xy": [(x, y, rank)]})
    out = []
    for s in shafts:
        best = min(r for *_, r in s["_xy"])
        pts = [(px, py) for px, py, r in s["_xy"] if r == best]
        out.append({"at": r1([sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)])[:2],
                    "stops": sorted(round(e[0], 2) for e in s["stops"])})
    return sorted(out, key=lambda s: (s["at"][0], s["at"][1]))


# ── decks ────────────────────────────────────────────────────────────────────
def _area(poly: Sequence[Sequence[float]]) -> float:
    return abs(sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))) / 2


def room_area(room: Dict[str, Any]) -> float:
    return sum(_area(p) for p in list(room.get("shapes") or []) + list(room.get("tris") or []) if len(p) >= 3)


def _is_conn_room(room: Dict[str, Any]) -> bool:
    return bool(room.get("connects")) or is_connector(room.get("key"))


def _deck_token(room: Dict[str, Any]) -> str:
    return re.split(r"[_~]", room.get("key") or "")[0].lower()


# (keyword in the room key, English, German) — the area word a deck is named after.
# A deck whose real rooms match none keeps "Level N / Ebene N".
DECK_KEYWORDS = [
    ("argo", "Argo Bay", "Argo-Bucht"), ("hangar", "Hangar", "Hangar"), ("bridge", "Bridge", "Brücke"),
    ("turret", "Turrets", "Geschütze"), ("middeck", "Main Deck", "Hauptdeck"),
]


def _keyword_of(key: str) -> Optional[int]:
    best, best_at = None, 10 ** 9
    for i, (kw, _en, _de) in enumerate(DECK_KEYWORDS):
        at = (key or "").lower().find(kw)
        if 0 <= at < best_at:
            best, best_at = i, at
    return best


def _dominant(rooms: Sequence[Dict[str, Any]], by: Callable[[Dict[str, Any]], Any]) -> Any:
    weight: Dict[Any, float] = defaultdict(float)
    for r in rooms:
        k = by(r)
        if k is not None:
            weight[k] += room_area(r) or 1.0
    return max(weight, key=lambda k: weight[k]) if weight else None


def level_of(z: float, floors: Sequence[Tuple[float, str]], tol: float = DECK_TOLERANCE_M) -> Optional[str]:
    """Key of the highest deck floor up to `tol` above `z` (else the lowest deck)."""
    best = None
    for fz, key in sorted(floors):
        if fz <= z + tol:
            best = key
    return best or (sorted(floors)[0][1] if floors else None)


def merge_derived_decks(decks: List[Dict[str, Any]], stops: Sequence[float]) -> Dict[str, str]:
    """Merges derived floor-height levels into real decks, in place. A level is a deck when a
    lift stops at it or it holds real rooms (≥ `DECK_MIN_AREA_M2` of floor, not counting
    stairs / ladders / lifts); a level that only holds landings or passages belongs to the
    deck above ("Zwischenebenen gehören zum Deck darüber") — unless it sits within
    `DECK_STACK_GAP_M` of the deck below and shares its area name while the deck above does
    not (Argo bay access passages). Returns old key -> new key; `{}` when nothing merges."""
    levels = sorted((d for d in decks if d.get("derived") and d.get("floorZ") is not None),
                    key=lambda d: d["floorZ"])
    if len(levels) < 2:
        return {}
    floors = [(d["floorZ"], d["key"]) for d in levels]
    lift_levels = {level_of(z, floors) for z in stops}
    real = [[r for r in d.get("rooms", []) if not _is_conn_room(r)] for d in levels]
    seed = [False] * len(levels)
    for i in range(len(levels) - 1, -1, -1):
        gap_up = levels[i + 1]["floorZ"] - levels[i]["floorZ"] if i + 1 < len(levels) else math.inf
        big = sum(room_area(r) for r in real[i]) >= DECK_MIN_AREA_M2
        above_seed = seed[i + 1] if i + 1 < len(levels) else False
        seed[i] = levels[i]["key"] in lift_levels or (big and not (above_seed and gap_up <= DECK_STACK_GAP_M))
    if sum(seed) < 2:
        return {}
    target: Dict[str, str] = {}
    for i, lv in enumerate(levels):
        if seed[i]:
            target[lv["key"]] = lv["key"]
            continue
        above = next((j for j in range(i + 1, len(levels)) if seed[j]), None)
        below = next((j for j in range(i - 1, -1, -1) if seed[j]), None)
        pick = above if above is not None else below
        if above is not None and below is not None and lv["floorZ"] - levels[below]["floorZ"] <= DECK_STACK_GAP_M:
            tok = _dominant(real[i], _deck_token)
            if tok is not None and tok == _dominant(real[below], _deck_token) \
                    and tok != _dominant(real[above], _deck_token):
                pick = below
        target[lv["key"]] = levels[pick]["key"]
    by_key = {d["key"]: d for d in decks}
    merged: Dict[str, Dict[str, Any]] = {}
    for lv in levels:
        dest = merged.setdefault(target[lv["key"]], {"rooms": {}, "src": []})
        dest["src"].append(lv)
        for r in lv.get("rooms", []):
            row = dict(r)
            if row.get("connects"):
                ks = sorted({target.get(k, k) for k in row["connects"]},
                            key=lambda k: by_key[k]["floorZ"] if k in by_key else 0)
                if len(ks) > 1:
                    row["connects"] = ks
                else:
                    row.pop("connects")
            prev = dest["rooms"].get(row["key"])
            if prev is None or (not prev.get("connects") and row.get("connects")):
                dest["rooms"][row["key"]] = row
    keep: List[Dict[str, Any]] = []
    for lv, is_seed in zip(levels, seed):
        if not is_seed:
            continue
        k = lv["key"]
        deck = by_key[k]
        deck["rooms"] = sorted(merged[k]["rooms"].values(), key=lambda r: r["key"].lower())
        keep.append(deck)
    name_decks(keep, [merged[d["key"]]["src"] for d in keep])
    ids = {d["key"] for d in keep}
    decks[:] = [d for d in decks if d["key"] in ids or not d.get("derived")]
    for i, d in enumerate(sorted((x for x in decks if x["key"] in ids), key=lambda x: x["floorZ"])):
        d["order"] = i
    for d in decks:
        if d.get("fallback"):
            d["order"] = len(keep)
    for d in keep:
        d["bounds"] = bounds_of(d["rooms"]) if d["rooms"] else None
    return target


def name_decks(decks: List[Dict[str, Any]], sources: Sequence[Sequence[Dict[str, Any]]]) -> None:
    """Names merged derived decks (bottom first) after the dominant area of their real rooms;
    a second deck with the same name is the "Upper" one. No keyword -> `Level N`."""
    used: Dict[int, int] = {}
    for n, (deck, src) in enumerate(zip(decks, sources), start=1):
        rooms = [r for lv in src for r in lv.get("rooms", []) if not _is_conn_room(r)]
        kw = _dominant(rooms, lambda r: _keyword_of(r.get("key")))
        if kw is None:
            deck["name"] = {"en": f"Level {n}", "de": f"Ebene {n}"}
            continue
        _, en, de = DECK_KEYWORDS[kw]
        if used.get(kw):
            en, de = f"Upper {en}", "Oberer " + de if de == "Hangar" else f"{de} oben"
        used[kw] = used.get(kw, 0) + 1
        deck["name"] = {"en": en, "de": de}


def deck_floors(decks: Sequence[Dict[str, Any]]) -> List[Tuple[float, str]]:
    """`(floor height, deck key)` references: the floor of a derived deck, the median
    room floor of an authored one. The catch-all fallback deck is no reference."""
    out: List[Tuple[float, str]] = []
    for d in decks:
        if d.get("fallback"):
            continue
        if d.get("derived") and d.get("floorZ") is not None:
            out.append((d["floorZ"], d["key"]))
            continue
        zs = sorted(r["floorZ"] for r in d.get("rooms", []) if r.get("floorZ") is not None and not _is_conn_room(r))
        if zs:
            out.append((zs[len(zs) // 2], d["key"]))
    return out


def level_floors(levels: Sequence[Dict[str, Any]], mapping: Dict[str, str]) -> List[Tuple[float, str]]:
    """Reference floors of every ORIGINAL derived level, pointing at the deck it merged into."""
    return [(lv["floorZ"], mapping.get(lv["key"], lv["key"])) for lv in levels if lv.get("floorZ") is not None]


def reassign_fallback(decks: List[Dict[str, Any]]) -> None:
    """Rooms of the catch-all deck of a hull with authored decks go to the authored deck whose
    floor they stand on (Starlancer MAX: rooms whose origin sits 0.7 m above the floor of the
    lower deck). A room without a matching floor stays; an emptied fallback deck is removed."""
    fb = next((d for d in decks if d.get("fallback")), None)
    refs = deck_floors(decks)
    if fb is None or len(refs) < 2:
        return
    by_key = {d["key"]: d for d in decks}
    stay = []
    for r in fb.get("rooms", []):
        z = r["floorZ"] if r.get("floorZ") is not None else r["pos"][2]
        key = level_of(z, refs)
        if key:
            by_key[key].setdefault("rooms", []).append(r)
        else:
            stay.append(r)
    for d in decks:
        if d.get("rooms") and not d.get("fallback"):
            d["rooms"].sort(key=lambda r: r["key"].lower())
            d["bounds"] = bounds_of(d["rooms"])
    if stay:
        fb["rooms"] = stay
        fb["bounds"] = bounds_of(stay)
    else:
        decks.remove(fb)


# ── assembly ─────────────────────────────────────────────────────────────────
def _pip(pt: Sequence[float], poly: Sequence[Sequence[float]]) -> bool:
    x, y = pt[0], pt[1]
    inside = False
    for i in range(len(poly)):
        x0, y0 = poly[i - 1][:2]
        x1, y1 = poly[i][:2]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0:
            inside = not inside
    return inside


def room_at(decks: Sequence[Dict[str, Any]], deck_key: str, pos: Sequence[float]) -> Optional[str]:
    """Key of the room of `deck_key` whose floor contains `pos` (the one with the nearest floor)."""
    deck = next((d for d in decks if d["key"] == deck_key), None)
    best, best_dz = None, math.inf
    for r in (deck or {}).get("rooms", []):
        if _is_conn_room(r):
            continue
        if any(len(p) >= 3 and _pip(pos, p) for p in list(r.get("shapes") or []) + list(r.get("tris") or [])):
            dz = abs((r.get("floorZ") if r.get("floorZ") is not None else r["pos"][2]) - pos[2])
            if dz < best_dz:
                best, best_dz = r["key"], dz
    return best


LADDER_RISE_M = 3.0   # `Ladder_Navlink_<n>m` names its rise; a plain ladder is taken as one 3 m flight
STAIRS_ROOM_DX_M = 8.0


def ladder_span(e: Dict[str, Any], floors: Sequence[Tuple[float, str]], deck: str) -> List[str]:
    """Deck keys a ladder joins: the deck it starts on and the one its rise reaches."""
    m = re.search(r"(\d+(?:\.\d+)?)m$", e.get("cls") or "", re.I)
    rise = float(m.group(1)) if m else LADDER_RISE_M
    top = level_of(e["pos"][2] + rise, floors) or deck
    return [deck] if top == deck else [deck, top]


def stairs_span(pos: Sequence[float], decks: Sequence[Dict[str, Any]], deck: str) -> List[str]:
    """Deck keys a stair container joins: the `connects` of the stair rooms beside it (same
    side of the hull, within `STAIRS_ROOM_DX_M` in x), else the deck it stands on."""
    keys: set = set()
    for d in decks:
        for r in d.get("rooms", []):
            if (r.get("connects") and re.search(r"stair", r["key"], re.I) and not re.search(r"guard", r["key"], re.I)
                    and abs(r["pos"][0] - pos[0]) <= STAIRS_ROOM_DX_M):
                keys.update(r["connects"])
    order = {d["key"]: i for i, d in enumerate(decks)}
    return sorted(keys, key=lambda k: order.get(k, 0)) if keys else [deck]


def assemble(*, decks: List[Dict[str, Any]], floors: List[Tuple[float, str]],
             entities: List[Dict[str, Any]], loadout_pois: List[Dict[str, Any]],
             grids: List[Dict[str, Any]], gaps: List[Dict[str, str]]) -> Dict[str, Any]:
    """The `ShipInterior` payload. `entities` / `loadout_pois`: `{cat, cls, name, pos, door?}` in
    the hull frame (door panels as cat `doorPanel`), `floors`: deck references of `level_of`."""
    fallback = next((d["key"] for d in decks if d.get("fallback")), None) or \
        (decks[0]["key"] if decks else FALLBACK_DECK_KEY)

    def deck_of(pos: Sequence[float]) -> str:
        return level_of(pos[2], floors) or fallback

    doors = []
    panels = []
    for e in entities + loadout_pois:
        if e["cat"] == "doorPanel":
            panels.append(e)
        elif e["cat"] == "door":
            doors.append(e)
    def door_room(d: Dict[str, Any]) -> Optional[str]:
        return room_at(decks, deck_of(d["pos"]), d["pos"])

    attach_panels(doors, panels, room_of=door_room)
    shafts = cluster_lifts([(*e["pos"][:3], 1 if re.search(r"gateway", e.get("cls") or "", re.I) else 0)
                            for e in entities if e["cat"] == "lift"])
    seen_climb: List[Tuple[str, Sequence[float]]] = []
    pois: List[Dict[str, Any]] = []
    for e in entities + loadout_pois:
        cat = e["cat"]
        if cat not in PAYLOAD_CATS or cat == "lift":
            continue  # lifts: one element per shaft stop below
        if cat == "ladder":
            # A ladder is a `Ladder` + `Ladder_Navlink_*` pair on one spot.
            if any(c == cat and math.dist(q, e["pos"]) < 0.5 for c, q in seen_climb):
                continue
            seen_climb.append((cat, e["pos"]))
        deck = deck_of(e["pos"])
        poi: Dict[str, Any] = {"cat": cat, "pos": r1(e["pos"]), "deck": deck}
        room = room_at(decks, deck, e["pos"])
        if room:
            poi["room"] = room
        if e.get("cls"):
            poi["cls"] = e["cls"]
        if e.get("port"):
            poi["port"] = e["port"]
        if cat == "door":
            poi["door"] = e["door"]
            pois.append(poi)
            if e["door"]["kind"] in ("airlock", "ramp"):
                pois.append({k: v for k, v in dict(poi, cat=e["door"]["kind"]).items() if k != "door"})
            continue
        if cat == "ladder":
            poi["connects"] = ladder_span(e, floors, deck)
        elif cat == "stairs":
            poi["connects"] = stairs_span(e["pos"], decks, deck)
        pois.append(poi)
    lifts = []
    for s in shafts:
        ks = []
        for z in s["stops"]:
            k = level_of(z, floors) or fallback
            if k not in ks:
                ks.append(k)
        lifts.append({"at": s["at"], "stops": s["stops"], "decks": ks})
        for z in s["stops"]:
            k = level_of(z, floors) or fallback
            pos = [s["at"][0], s["at"][1], z]
            lp: Dict[str, Any] = {"cat": "lift", "pos": r1(pos), "deck": k}
            room = room_at(decks, k, pos)
            if room:
                lp["room"] = room
            pois.append(lp)
    out_grids = []
    for g in grids:
        deck = deck_of(g["pos"])
        row = dict(g, deck=deck)
        room = room_at(decks, deck, g["pos"])
        if room:
            row["room"] = room
        out_grids.append(row)
    return {"pois": pois, "cargoGrids": out_grids, "lifts": lifts,
            "cargoScuLocated": sum(g["scu"] for g in out_grids), "cargoGaps": gaps}
