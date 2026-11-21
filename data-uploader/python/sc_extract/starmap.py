"""Verse location catalog projection (StarMapObject + system socpaks -> locations/<id>.json).

One row per *visible* starmap place, shaped like the ``codex_locations`` table
(supabase/migrations/20261008123750_codex_locations.sql).

Sources
-------
* DataCore ``StarMapObject`` records: ``name`` (@-loc key), ``parent`` (ref),
  ``hideInStarmap``, ``size`` (a radius for stars/planets/moons only — for
  stations and outposts it is no radius), ``type`` (ref -> StarMapObjectType).
  VERIFIED on LIVE 4.10 (scratch comparison 2026-11-09, 2132 records).
* ``StarMapObjectType`` records: on real data they are *named by a GUID*
  (``StarMapObjectType.73efbf7b-…``); the readable type (``Planet``, ``Moon``,
  ``Outpost`` …) is their ``name`` field. VERIFIED LIVE 4.10 (#1195, 21 types).
* ``Data/ObjectContainers/PU/system/<system>/*.socpak`` — a ZIP of ``.entxml``
  CryXML entities. The entity root carries ``Name``, ``Pos`` (``x,y,z``
  metres), optional ``Rotate`` (``w,x,y,z``); a child element
  (``EntityComponentObjectMetadata``) carries ``starmapRecord`` = the GUID of
  its StarMapObject, ``EntityComponentObjectContainer.objectContainer`` names
  the socpak the entity opens. The socpak decides the frame: entities of
  ``<system>system.socpak`` are in the system frame, entities of a body's
  socpak (``stanton1.socpak`` ...) are in that body's frame. VERIFIED LIVE 4.10
  (#1195): 30,038 entities; positions agree with the entities' own
  ``EntityComponentOrbit`` radius/angle and, for all 18 moons, with in-game
  measurements (Valalol Star-Citizen-Navigation, MIT).
* Containers opened by a system-frame entity that are *not* body socpaks
  (``…/lagrangepoints/stanton1_l1.socpak``, jump-point and asteroid-ring
  segments) hold the Lagrange rest stops, gateways and Nyx stations. Their
  entities sit in the opening entity's frame: system position = opener ``Pos``
  + opener ``Rotate`` applied to the inner ``Pos``. VERIFIED LIVE 4.10 (#1195):
  the nine Pyro rest stops land within 7 cm of the catalog. A container opened
  by more than one entity (``commarray.socpak``, derelict sets) is a template,
  not a place, and is skipped.

Host rule (maintainer decision 2026-11-09, sharpened in #1195): a place without
an entity of its own takes the position of the nearest ancestor that has one;
only a place with no such host gets ``frame = null`` and null positions. A
star or the system node is no host — the star's origin says nothing about
where a station that merely hangs under it in the starmap is. Stars and the
system node itself sit at the system-frame origin by definition.

The catalog the desktop app bundles (scunpacked) has Calliope, Clio, Euterpe
and Comm Array ST4-22 point-mirrored through microTech; the socpak values here
are the right ones (#1195, see the regression test).
"""
from __future__ import annotations

import io
import json
import math
import re
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .missions import _ref, _strip_type_prefix, readable_text
from .ship_rooms import cry_guid_to_record_id

SOURCE = "data-uploader"
LICENSE = ("Star Citizen game data (c) Cloud Imperium Games, read from the game files "
           "by the Data Uploader")

_SYSTEM_SOCPAK_RE = re.compile(
    r"(?:^|/)objectcontainers/pu/system/([^/]+)/([^/]+)\.socpak$", re.IGNORECASE)
_SYSTEM_FILE_RE = re.compile(r"starmap/pu/system/([^/]+)/", re.IGNORECASE)
# The system node records live beside the system folders: starmap/pu/stantonsolarsystem.xml
_SOLARSYSTEM_FILE_RE = re.compile(r"starmap/pu/([^/]+?)solarsystem\.xml$", re.IGNORECASE)
_LAGRANGE_RE = re.compile(r"(?:^|_)L[1-5]$", re.IGNORECASE)

Entity = Dict[str, Any]  # {name, pos, rotate, records: [guid], container}
Pos = Tuple[float, float, float]
Quat = Tuple[float, float, float, float]  # w, x, y, z

_NO_HOST_TYPES = ("star", "solarsystem")


# ── type mapping ─────────────────────────────────────────────────────────────

def classify(type_name: Optional[str], record_name: str, display: str) -> str:
    """Catalog type of a place, from the DataCore type plus name patterns.

    DataCore has no station / clinic / comm-array / Lagrange types (they are
    Manmade, Outpost and Asteroid records), so those come from the record and
    display names — the same patterns the scratch comparison matched on.
    """
    t = (type_name or "").lower()
    rec = record_name.lower()
    disp = display.lower()
    if t == "solarsystem":
        return "system"
    if t in ("star", "planet", "moon"):
        return t
    if t == "jumppoint" or "jump point" in disp:
        return "jumppoint"
    if t.startswith("asteroid") and _LAGRANGE_RE.search(record_name):
        return "lagrange"
    if "mining claim" in disp:
        return "mining-claim"
    if "comm array" in disp or "commarray" in rec or "comm_array" in rec:
        return "comm-array"
    if t.startswith("outpost"):
        if any(k in rec or k in disp for k in ("clinic", "hospice", "hospital", "medical")):
            return "clinic"
        return "outpost"
    if t.startswith("manmade"):
        return "station"
    if t == "landingzone":
        return "landing-zone"
    if t.startswith("asteroid"):
        return "asteroid"
    if t == "pointofinterest":
        return "poi"
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "unknown"


# ── socpak entities ──────────────────────────────────────────────────────────

def _floats(text: Optional[str], n: int) -> Optional[Tuple[float, ...]]:
    try:
        v = tuple(float(p) for p in (text or "").split(","))
    except ValueError:
        return None
    if len(v) != n or not all(math.isfinite(c) for c in v):
        return None
    return v


def _pos(text: Optional[str]) -> Optional[Pos]:
    return _floats(text, 3)  # type: ignore[return-value]


def _quat(text: Optional[str]) -> Optional[Quat]:
    """CryEngine ``Rotate`` = ``w,x,y,z`` (VERIFIED #1195: the w-first reading puts
    Levski 5 km from the catalog, the x-first one 37 km)."""
    return _floats(text, 4)  # type: ignore[return-value]


def rotate(q: Optional[Quat], v: Pos) -> Pos:
    """``v`` turned by the unit quaternion ``q`` (``None`` = no rotation)."""
    if not q:
        return v
    w, x, y, z = q
    vx, vy, vz = v
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


def read_entity(root: Any) -> Entity:
    """Name, position, rotation, starmap GUIDs and own container of one ``.entxml`` root."""
    oc = next(root.iter("EntityComponentObjectContainer"), None)
    return {
        "name": root.get("Name"),
        "pos": _pos(root.get("Pos")) or (0.0, 0.0, 0.0),
        "rotate": _quat(root.get("Rotate")),
        "records": [m.get("starmapRecord") for m in root.iter() if m.get("starmapRecord")],
        "container": oc.get("objectContainer") if oc is not None else None,
    }


def is_system_pak(pak: str) -> bool:
    return pak.lower().endswith("system.socpak")


def is_nested_pak(pak: str) -> bool:
    """A container read through a system-frame entity (keyed by its path, so it has a ``/``)."""
    return "/" in pak


def _norm(path: str) -> str:
    p = path.replace("\\", "/").lower().lstrip("/")
    return p[5:] if p.startswith("data/") else p


def _pak_stem(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1].lower().removesuffix(".socpak")


def _read_pak(buf: bytes, label: str, decode: Callable[[bytes], Any],
              on_log: Callable[[str, str], None]) -> List[Entity]:
    from .ship_rooms import read_zip_entry

    ents: List[Entity] = []
    for e in zipfile.ZipFile(io.BytesIO(buf)).infolist():
        if not e.filename.lower().endswith(".entxml"):
            continue
        try:
            ents.append(read_entity(decode(read_zip_entry(buf, e))))
        except Exception as exc:  # noqa: BLE001 — one odd entity, not the file
            on_log("warn", f"locations: {label}:{e.filename}: {exc}")
    return ents


def read_socpaks(p4k: Any, decode: Optional[Callable[[bytes], Any]] = None,
                 on_log: Callable[[str, str], None] = lambda lvl, m: None) -> Dict[str, List[Entity]]:
    """Entities of every system socpak of the P4K, plus the containers they open.

    Keys: the socpak file name for ``ObjectContainers/PU/system/<system>/*.socpak``
    (``stantonsystem.socpak``, ``stanton1.socpak`` …); the normalised path
    (``objectcontainers/pu/system/stanton/lagrangepoints/stanton1_l1.socpak``)
    for a container opened by an entity of a ``*system.socpak`` that is not one
    of those (see ``is_nested_pak``).

    ``p4k``: an open P4KFile (``infolist`` / ``getinfo`` / ``open``). ``decode``
    turns CryXmlB bytes into an element (scdatatools in production). Inner
    entries use backslash local headers, hence ``read_zip_entry`` and not
    ``zipfile.read``. One broken entity is skipped; a system socpak that is no
    ZIP raises, a broken nested container is skipped with a warning.
    """
    from .ship_rooms import decode_cryxml

    decode = decode or decode_cryxml
    out: Dict[str, List[Entity]] = {}
    index: Dict[str, str] = {}
    for info in p4k.infolist():
        fn = info.filename.replace("\\", "/")
        if fn.lower().endswith(".socpak"):
            index.setdefault(_norm(fn), info.filename)
        if not _SYSTEM_SOCPAK_RE.search(fn):
            continue
        buf = p4k.open(p4k.getinfo(info.filename)).read()
        out[fn.rsplit("/", 1)[1]] = _read_pak(buf, fn, decode, on_log)
    opened = sorted({_norm(e["container"]) for pak, ents in out.items() if is_system_pak(pak)
                     for e in ents if e["container"]})
    for path in opened:
        if _SYSTEM_SOCPAK_RE.search(path) or path not in index:
            continue  # a body socpak (already read) or a container the archive does not have
        try:
            out[path] = _read_pak(p4k.open(p4k.getinfo(index[path])).read(), path, decode, on_log)
        except Exception as exc:  # noqa: BLE001 — one odd container, not the catalog
            on_log("warn", f"locations: {path}: {exc}")
    return out


def positions_by_record(paks: Dict[str, List[Entity]],
                        names: Dict[str, str]) -> Dict[str, Tuple[str, Pos, Optional[str]]]:
    """``record id -> (frame, position, body record id of the frame)``.

    ``names``: record id -> class name, only for the stem fallback of the body
    link. Precedence when a record has entities in several places: the system
    socpak, then a nested container (moved into the system frame), then a body
    socpak. A body's own entity inside its own socpak is no position of that body.
    """
    # body socpak stem -> the body's record id (via the system entity's objectContainer)
    body_of: Dict[str, str] = {}
    openers: Dict[str, List[Entity]] = {}
    for pak, ents in paks.items():
        if not is_system_pak(pak) or is_nested_pak(pak):
            continue
        for e in ents:
            if not e["container"]:
                continue
            openers.setdefault(_norm(e["container"]), []).append(e)
            if e["records"]:
                rid = cry_guid_to_record_id(e["records"][0])
                if rid:
                    body_of.setdefault(_pak_stem(e["container"]), rid)
    by_stem = {re.sub(r"[^a-z0-9]", "", n.lower()): rid for rid, n in names.items()}
    found: Dict[str, Tuple[str, Pos, Optional[str]]] = {}

    def take(ents: List[Entity], frame: str, body: Optional[str],
             place: Callable[[Pos], Pos] = lambda p: p) -> None:
        for e in sorted(ents, key=lambda x: x["name"] or ""):
            for g in e["records"]:
                rid = cry_guid_to_record_id(g)
                if not rid or rid == body or rid in found:
                    continue
                found[rid] = (frame, place(e["pos"]), body)

    def rank(p: str) -> Tuple[int, str]:
        return (0 if is_system_pak(p) and not is_nested_pak(p) else 1 if is_nested_pak(p) else 2, p)

    for pak in sorted(paks, key=rank):
        if is_nested_pak(pak):
            who = openers.get(pak, [])
            if len(who) != 1:
                continue  # opened by several entities: a template, its inner entities are no place
            o = who[0]
            take(paks[pak], "system", None,
                 lambda p, o=o: tuple(a + b for a, b in zip(o["pos"], rotate(o.get("rotate"), p))))
        elif is_system_pak(pak):
            take(paks[pak], "system", None)
        else:
            stem = _pak_stem(pak)
            body = body_of.get(stem) or by_stem.get(stem)
            if body is not None:  # a body frame we cannot name is no usable frame
                take(paks[pak], "body", body)
    return found


# ── rows ─────────────────────────────────────────────────────────────────────

def _flag(v: Any) -> bool:
    return v is True


def _lower(v: Optional[str]) -> str:
    return (v or "").lower()


def build_rows(records: Iterable[Dict[str, Any]],
               positions: Dict[str, Tuple[str, Pos, Optional[str]]]) -> List[Dict[str, Any]]:
    """Location rows of the visible places.

    ``records``: one dict per StarMapObject — ``id`` (record guid), ``className``
    (record name without the type prefix, the row key), ``name`` (display text
    or None), ``type`` (StarMapObjectType name), ``parent`` (record guid or
    None), ``hidden``, ``size``, ``filename``. ``positions``: see
    ``positions_by_record``.

    A system node (``SolarSystem``) is a row even though DataCore hides it in
    the starmap (it does on LIVE 4.10): it is the root the catalog hangs a
    system on. A star without a DataCore parent hangs under its system's node.
    """
    recs = {r["id"]: r for r in records}

    def ancestors(r: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
        seen = {r["id"]}
        p = recs.get(r.get("parent") or "")
        while p is not None and p["id"] not in seen:
            seen.add(p["id"])
            yield p
            p = recs.get(p.get("parent") or "")

    def system_of(r: Dict[str, Any]) -> str:
        for x in (r, *ancestors(r)):
            fn = (x.get("filename") or "").replace("\\", "/")
            m = _SYSTEM_FILE_RE.search(fn) or _SOLARSYSTEM_FILE_RE.search(fn)
            if m:
                return m.group(1).upper()
        top = (*ancestors(r),)[-1] if r.get("parent") in recs else r
        return re.sub(r"solarsystem$", "", top["className"], flags=re.IGNORECASE).upper()

    def visible(r: Dict[str, Any]) -> bool:
        return bool(r.get("name")) and (not r.get("hidden") or _lower(r.get("type")) == "solarsystem")

    system_node = {system_of(r): r["className"] for r in recs.values()
                   if visible(r) and _lower(r.get("type")) == "solarsystem"}

    rows: List[Dict[str, Any]] = []
    for r in recs.values():
        if not visible(r):
            continue
        dc_parent = recs.get(r.get("parent") or "")
        ctype = classify(r.get("type"), r["className"], r["name"])
        if ctype == "landing-zone" and dc_parent is not None and _lower(dc_parent.get("type")) == "planet":
            ctype = "city"  # Lorville, Area18, Orison, New Babbage — the catalog's cities
        own = positions.get(r["id"])
        via = None
        if own:
            frame, pos, body = own
        else:
            frame = pos = body = None
            for a in ancestors(r):
                if _lower(a.get("type")) in _NO_HOST_TYPES:
                    continue
                hit = positions.get(a["id"])
                if hit:
                    frame, pos, body = hit
                    via = a["className"]
                    break
            if frame is None and ctype in ("system", "star"):
                frame, pos, body = "system", (0.0, 0.0, 0.0), None
        near = next((a for a in ancestors(r) if visible(a)), None)
        parent_id = near["className"] if near else None
        if frame == "body" and body in recs:
            parent_id = recs[body]["className"]  # the frame's body IS the parent
        sys_code = system_of(r)
        if ctype == "star" and parent_id is None:
            parent_id = system_node.get(sys_code)
        attrs: Dict[str, Any] = {"hidden": bool(r.get("hidden"))}
        size = r.get("size")
        if isinstance(size, (int, float)) and size > 0:
            attrs["radiusM" if ctype in ("star", "planet", "moon") else "size"] = size
        if via:
            attrs["positionFrom"] = via
        if dc_parent is not None and dc_parent["className"] != parent_id:
            attrs["starmapParent"] = dc_parent["className"]
        rows.append({
            "id": r["className"],
            "name": r["name"],
            "type": ctype,
            "system_code": sys_code,
            "parent_id": parent_id,
            "frame": frame,
            "pos_x": pos[0] if pos else None,
            "pos_y": pos[1] if pos else None,
            "pos_z": pos[2] if pos else None,
            "aliases": [],
            "attributes": attrs,
            "source": SOURCE,
            "license": LICENSE,
        })
    rows.sort(key=lambda x: x["id"])
    return rows


def type_names(df: Any, on_log: Callable[[str, str], None] = lambda lvl, m: None) -> Dict[str, str]:
    """StarMapObjectType record id -> its readable ``name`` (``Planet``, ``Outpost`` …)."""
    out: Dict[str, str] = {}
    for t in df.records_by_type_name("StarMapObjectType"):
        try:
            name = (df.record_to_dict(t, max_depth=1).get("_RecordValue_", {}).get("name") or "").strip()
        except Exception as exc:  # noqa: BLE001
            on_log("warn", f"locations: {t.name}: {exc}")
            continue
        if name:
            out[t.guid] = name
    return out


def collect_records(df: Any, localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                    on_log: Callable[[str, str], None] = lambda lvl, m: None) -> List[Dict[str, Any]]:
    """The StarMapObject records of a DataForge as plain dicts for ``build_rows``."""
    types = type_names(df, on_log)
    out: List[Dict[str, Any]] = []
    for r in df.records_by_type_name("StarMapObject"):
        try:
            rv = df.record_to_dict(r, max_depth=1).get("_RecordValue_", {})
        except Exception as exc:  # noqa: BLE001
            on_log("warn", f"locations: {r.name}: {exc}")
            continue
        name = readable_text(localized, rv.get("name"))
        parent, typ = _ref(rv.get("parent")), _ref(rv.get("type"))
        out.append({
            "id": r.guid,
            "className": _strip_type_prefix(r.name),
            "name": ((name or {}).get("en") or (name or {}).get("de") or "").strip() or None,
            "type": (types.get(typ["_RecordId_"]) or _strip_type_prefix(typ["_RecordName_"])) if typ else None,
            "parent": parent["_RecordId_"] if parent else None,
            "hidden": _flag(rv.get("hideInStarmap")),
            "size": rv.get("size"),
            "filename": r.filename or "",
        })
    return out


def extract_locations(df: Any, localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                      p4k: Any, out_dir: Path,
                      on_log: Callable[[str, str], None] = lambda lvl, m: None,
                      decode: Optional[Callable[[bytes], Any]] = None) -> int:
    """Write ``locations/<id>.json`` per visible place; returns the count."""
    records = collect_records(df, localized, on_log)
    paks = read_socpaks(p4k, decode, on_log)
    if not any(not is_nested_pak(p) for p in paks):
        raise RuntimeError("no system socpak found in the P4K")
    names = {r["id"]: r["className"] for r in records}
    positions = positions_by_record(paks, names)
    rows = build_rows(records, positions)
    d = out_dir / "locations"
    d.mkdir(parents=True, exist_ok=True)
    used: set = set()
    for row in rows:
        safe = re.sub(r"[^A-Za-z0-9_.-]", "_", row["id"])
        if safe.lower() in used:  # two ids that only differ in case or odd characters
            safe = f"{safe}-{len(used)}"
        used.add(safe.lower())
        (d / f"{safe}.json").write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
    placed = sum(1 for r in rows if r["frame"])
    on_log("info", f"locations: {len(rows)} visible places ({placed} with a position, "
                   f"{len(positions)} socpak entities linked)")
    return len(rows)
