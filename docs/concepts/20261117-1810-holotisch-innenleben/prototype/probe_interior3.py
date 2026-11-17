"""Probe 3: prototype interior extract — rooms + POIs + cargo grids + components per deck.

Usage: python probe_interior3.py <Data.p4k> <out_dir> <ClassName> [...]
Writes <out_dir>/<cls>.interior.json (proposed payload shape).
"""
import io
import json
import math
import re
import sys
import time
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from sc_extract.p4k_compat import apply_p4k_compat
from sc_extract.extract import _find_dcb_entry, _load_localizer
from sc_extract.dataforge import DataForge
from sc_extract import dataforge_extract as dx
from sc_extract.ship_rooms import read_zip_entry, decode_cryxml, ang3_quat, move, _vec

apply_p4k_compat()
from scdatatools.p4k import P4KFile  # noqa: E402

p4k_path, out_dir, *classes = sys.argv[1:]
t0 = time.time()
p4k = P4KFile(p4k_path)
loc = _load_localizer(p4k)
with p4k.open(p4k.getinfo(_find_dcb_entry(p4k))) as f:
    raw = f.read()
df = DataForge(raw)
print(f"ready {time.time()-t0:.0f}s", flush=True)
ex = dx.CodexExtractor(df, loc, Path(out_dir), {"channel": "LIVE", "patch": "probe", "build": ""},
                       on_log=lambda l, m: None, dump_generic=False, p4k=p4k, extract_assets=False)
by_lower = {n.lower().replace("\\", "/"): n for n in p4k.namelist()}

# entity class -> category (socpak entities)
ENT_CATS = [
    ("lift", r"^TransitDestination$"),
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
    ("doorPanel", r"DoorControl"),
    ("console", r"^Console_"),
]
# loadout entity class prefix -> category
LO_CATS = [
    ("powerPlant", r"^POWR_"), ("cooler", r"^COOL_"), ("shield", r"^SHLD_"),
    ("quantumDrive", r"^QDRV_"), ("jumpDrive", r"^JDRV_"), ("lifeSupport", r"^LFSP_"),
    ("radar", r"^RADR_"), ("relay", r"^RELAY_"), ("fuelTank", r"^[HQ]TNK_"),
    ("door", r"^Door_"), ("dockingTube", r"DockingTube|Docking"), ("turret", r"^Turret|TurretBase"),
    ("battery", r"^BATT_|Battery"), ("computer", r"^Controller_|COMP_"), ("tractor", r"Tractor"),
    ("escapePod", r"EscapePod|Escape_Pod"), ("medBed", r"Medical"),
]

def cat_of(rules, cls):
    for name, rx in rules:
        if re.search(rx, cls or "", re.I):
            return name
    return None

def socpak_entities(file_name):
    real = by_lower.get(file_name.replace("\\", "/").lower()) or by_lower.get("data/" + file_name.replace("\\", "/").lower())
    if not real:
        return []
    with p4k.open(p4k.getinfo(real)) as f:
        blob = f.read()
    zf = zipfile.ZipFile(io.BytesIO(blob))
    out = []
    for info in zf.infolist():
        fn = info.filename.replace("\\", "/")
        if not fn.lower().endswith(".soc") or "/" in fn:
            continue
        soc = read_zip_entry(blob, info)
        for m in re.finditer(rb"CryXmlB", soc):
            try:
                root = decode_cryxml(soc[m.start():])
            except Exception:
                continue
            if root is not None and root.tag == "Entities":
                for e in root:
                    out.append((e.get("EntityClass") or "", e.get("Name") or "", _vec(e.get("Pos"))))
    return out

def r2(v):
    return [round(float(x), 2) for x in v]

ents = {r.name.split(".", 1)[-1].lower(): r for r in df.records_by_type_name("EntityClassDefinition")}
for cls in classes:
    r = ents.get(cls.lower())
    resolved = df.record_to_dict(r, max_depth=20)
    comps = dx._components_of(resolved)
    obj = ex._project_ship(r, resolved, comps, dx._attach_def(comps))
    decks = obj.get("decks") or []
    floors = sorted([(d.get("floorZ"), d["key"]) for d in decks if d.get("floorZ") is not None])
    # authored decks have no floorZ: fall back to median room floor
    if not floors:
        for d in decks:
            zs = sorted(rm.get("floorZ") for rm in (d.get("rooms") or []) if rm.get("floorZ") is not None)
            if zs:
                floors.append((zs[len(zs) // 2], d["key"]))
        floors.sort()

    def deck_of(z):
        best = None
        for fz, key in floors:
            if fz <= z + 0.8:
                best = key
        return best or (floors[0][1] if floors else None)

    vcp = dx._find_component(comps, "VehicleComponentParams") or {}
    pois = []
    lift_z = defaultdict(list)
    for oc in vcp.get("objectContainers") or []:
        off = oc.get("Offset") or {}
        p = off.get("Position") or {}
        pos = tuple(float(p.get(k) or 0) for k in "xyz")
        rot = ang3_quat(off.get("Rotation") or {})
        cname = oc["fileName"].replace("\\", "/").split("/")[-1].replace(".socpak", "")
        for ecls, name, epos in socpak_entities(oc["fileName"]):
            c = cat_of(ENT_CATS, ecls)
            if not c:
                continue
            sp = move(list(epos), rot, pos)
            if c == "lift":
                lift_z[(cname, round(sp[0]), round(sp[1]))].append(round(sp[2], 2))
            pois.append({"cat": c, "cls": ecls, "name": name, "pos": r2(sp), "container": cname, "deck": deck_of(sp[2])})
        if "stairs" in cname:
            pois.append({"cat": "stairs", "cls": "container", "name": cname, "pos": r2(pos), "container": cname, "deck": deck_of(pos[2])})
    tf = obj.get("hardpointTransforms") or {}
    flat = []

    def walk(entries):
        for e in entries or []:
            if isinstance(e, dict):
                flat.append(e)
                walk(e.get("entries"))
    walk(obj.get("defaultLoadout"))
    grids = []
    for e in flat:
        port = e.get("itemPortName") or e.get("portName") or ""
        ecls = e.get("entityClassName") or ""
        t = tf.get(port)
        if "cargogrid" in ecls.lower():
            dims = None
            for cc in ex._entity_class_comps(ecls):
                if isinstance(cc, dict):
                    for field in getattr(ex, "_CARGO_CONTAINER_FIELDS", ("containerParams",)):
                        d = ex._interior_dimensions(cc.get(field))
                        if d:
                            dims = [float(d.get(a) or 0) for a in "xyz"]
            if t:
                grids.append({"port": port, "cls": ecls, "dims": dims, "pos": r2(t["position"]), "deck": deck_of(t["position"][2])})
            continue
        c = cat_of(LO_CATS, ecls)
        if c and t:
            pois.append({"cat": c, "cls": ecls, "name": port, "pos": r2(t["position"]), "container": "loadout", "deck": deck_of(t["position"][2])})
    lifts = [{"at": list(k[1:]), "container": k[0], "stops": sorted(set(v)), "decks": sorted({deck_of(z) for z in v})} for k, v in lift_z.items()]
    out = {
        "className": cls, "cargoScu": obj.get("cargoScu"), "frame": obj.get("hardpointFrame"),
        "decks": [{"key": d["key"], "name": d.get("name"), "order": d.get("order"), "derived": d.get("derived"), "fallback": d.get("fallback"),
                   "floorZ": d.get("floorZ"), "bounds": d.get("bounds"),
                   "rooms": [{"key": rm["key"], "name": rm.get("name"), "pos": r2(rm["pos"]), "floorZ": rm.get("floorZ"), "height": rm.get("height"),
                              "shapes": [[r2(pt) for pt in poly] for poly in rm.get("shapes") or []],
                              "tris": [[r2(pt) for pt in poly] for poly in rm.get("tris") or []], "connects": rm.get("connects")}
                             for rm in d.get("rooms") or []]} for d in decks],
        "floors": floors, "lifts": lifts, "cargoGrids": grids, "pois": pois,
        "counts": {k: v for k, v in Counter(p["cat"] for p in pois).most_common()},
        "perDeck": {dk: dict(Counter(p["cat"] for p in pois if p["deck"] == dk)) for _, dk in floors},
    }
    with open(f"{out_dir}/{cls}.interior.json", "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, separators=(",", ":"), default=str)
    print(cls, "decks", len(decks), "pois", len(pois), "grids", len(grids), "lifts", len(lifts), out["counts"], f"{time.time()-t0:.0f}s", flush=True)
print("done")
