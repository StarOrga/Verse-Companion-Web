"""Verse location catalog projection (StarMapObject + system socpaks -> locations/<id>.json).

One row per *visible* starmap place, shaped like the ``codex_locations`` table
(supabase/migrations/20261008123750_codex_locations.sql).

Sources
-------
* DataCore ``StarMapObject`` records: ``name`` (@-loc key), ``parent`` (ref),
  ``hideInStarmap``, ``size`` (a radius for stars/planets/moons only — for
  stations and outposts it is no radius), ``type`` (ref -> StarMapObjectType).
  VERIFIED on LIVE 4.10 (scratch comparison 2026-11-09, 2132 records).
* ``Data/ObjectContainers/PU/system/<system>/*.socpak`` — a ZIP of ``.entxml``
  CryXML entities. The entity carries ``Name``, ``Pos`` (``x,y,z`` metres) and,
  in a child element (``EntityComponentObjectMetadata``), ``starmapRecord`` =
  the GUID of its StarMapObject. VERIFIED (same comparison, 30,038 entities,
  955 of 957 GUIDs resolved). The socpak decides the frame: entities of
  ``<system>system.socpak`` are in the system frame, entities of any other
  socpak (``stanton1.socpak`` ...) are in that body's frame.

ASSUMPTIONS the fixture tests pin (read from the scratch script soc8.py, not
yet seen on a full real run — the real-data check is issue #1195):
* the entity root element carries ``Name`` / ``Pos`` / ``EntityClass``
  (soc8.py: ``r.get('Pos')``), every ``starmapRecord`` is an attribute of some
  element below it (``r.iter()``), and a body entity of the system socpak has
  an ``EntityComponentObjectContainer`` whose ``objectContainer`` attribute
  names the body's own socpak (soc8.py reads it as ``oc``). That link is how a
  body socpak learns *which* body it is the frame of; a stem match against the
  record name (``stanton1`` -> ``Stanton1``) is the fallback.
* the CryEngine GUID in ``starmapRecord`` maps to the DataForge record id with
  ``ship_rooms.cry_guid_to_record_id`` (same byte permutation as soc8/cmp7 ``conv``).

Host rule (maintainer decision 2026-11-09): a place without an entity of its
own takes the position of the nearest ancestor that has one; only a place with
no such host gets ``frame = null`` and null positions. Stars and the system
node itself sit at the system-frame origin by definition.
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
_LAGRANGE_RE = re.compile(r"(?:^|_)L[1-5]$", re.IGNORECASE)

Entity = Dict[str, Any]  # {name, pos, records: [guid], container}
Pos = Tuple[float, float, float]


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

def _pos(text: Optional[str]) -> Optional[Pos]:
    try:
        v = tuple(float(p) for p in (text or "").split(","))
    except ValueError:
        return None
    if len(v) != 3 or not all(math.isfinite(c) for c in v):
        return None
    return v  # type: ignore[return-value]


def read_entity(root: Any) -> Entity:
    """Name, position, starmap GUIDs and own container of one ``.entxml`` root."""
    oc = next(root.iter("EntityComponentObjectContainer"), None)
    return {
        "name": root.get("Name"),
        "pos": _pos(root.get("Pos")) or (0.0, 0.0, 0.0),
        "records": [m.get("starmapRecord") for m in root.iter() if m.get("starmapRecord")],
        "container": oc.get("objectContainer") if oc is not None else None,
    }


def is_system_pak(pak: str) -> bool:
    return pak.lower().endswith("system.socpak")


def _pak_stem(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1].lower().removesuffix(".socpak")


def read_socpaks(p4k: Any, decode: Optional[Callable[[bytes], Any]] = None,
                 on_log: Callable[[str, str], None] = lambda lvl, m: None) -> Dict[str, List[Entity]]:
    """``{socpak file name: entities}`` for every system socpak of the P4K.

    ``p4k``: an open P4KFile (``infolist`` / ``getinfo`` / ``open``). ``decode``
    turns CryXmlB bytes into an element (scdatatools in production). Inner
    entries use backslash local headers, hence ``read_zip_entry`` and not
    ``zipfile.read``. One broken entity is skipped; a socpak that is no ZIP
    raises.
    """
    from .ship_rooms import decode_cryxml, read_zip_entry

    decode = decode or decode_cryxml
    out: Dict[str, List[Entity]] = {}
    for info in p4k.infolist():
        fn = info.filename.replace("\\", "/")
        if not _SYSTEM_SOCPAK_RE.search(fn):
            continue
        buf = p4k.open(p4k.getinfo(info.filename)).read()
        ents: List[Entity] = []
        for e in zipfile.ZipFile(io.BytesIO(buf)).infolist():
            if not e.filename.lower().endswith(".entxml"):
                continue
            try:
                ents.append(read_entity(decode(read_zip_entry(buf, e))))
            except Exception as exc:  # noqa: BLE001 — one odd entity, not the file
                on_log("warn", f"locations: {fn}:{e.filename}: {exc}")
        out[fn.rsplit("/", 1)[1]] = ents
    return out


def positions_by_record(paks: Dict[str, List[Entity]],
                        names: Dict[str, str]) -> Dict[str, Tuple[str, Pos, Optional[str]]]:
    """``record id -> (frame, position, body record id of the frame)``.

    ``names``: record id -> class name, only for the stem fallback of the body
    link. A record with entities in several socpaks takes the system-frame one;
    a body's own entity inside its own socpak is no position of that body.
    """
    # body socpak stem -> the body's record id (via the system entity's objectContainer)
    body_of: Dict[str, str] = {}
    for pak, ents in paks.items():
        if not is_system_pak(pak):
            continue
        for e in ents:
            if e["container"] and e["records"]:
                rid = cry_guid_to_record_id(e["records"][0])
                if rid:
                    body_of.setdefault(_pak_stem(e["container"]), rid)
    by_stem = {re.sub(r"[^a-z0-9]", "", n.lower()): rid for rid, n in names.items()}
    found: Dict[str, Tuple[str, Pos, Optional[str]]] = {}
    for pak in sorted(paks, key=lambda p: (not is_system_pak(p), p)):  # system socpaks first
        system = is_system_pak(pak)
        stem = _pak_stem(pak)
        body = None if system else (body_of.get(stem) or by_stem.get(stem))
        if not system and body is None:
            continue  # a body frame we cannot name is no usable frame
        for e in sorted(paks[pak], key=lambda x: x["name"] or ""):
            for g in e["records"]:
                rid = cry_guid_to_record_id(g)
                if not rid or rid == body or rid in found:
                    continue
                found[rid] = ("system" if system else "body", e["pos"], body)
    return found


# ── rows ─────────────────────────────────────────────────────────────────────

def _flag(v: Any) -> bool:
    return v is True


def build_rows(records: Iterable[Dict[str, Any]],
               positions: Dict[str, Tuple[str, Pos, Optional[str]]]) -> List[Dict[str, Any]]:
    """Location rows of the visible places.

    ``records``: one dict per StarMapObject — ``id`` (record guid), ``className``
    (record name without the type prefix, the row key), ``name`` (display text
    or None), ``type`` (StarMapObjectType class name), ``parent`` (record guid
    or None), ``hidden``, ``size``, ``filename``. ``positions``: see
    ``positions_by_record``.
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
            m = _SYSTEM_FILE_RE.search((x.get("filename") or "").replace("\\", "/"))
            if m:
                return m.group(1).upper()
        top = (*ancestors(r),)[-1] if r.get("parent") in recs else r
        return top["className"].upper()

    def visible(r: Dict[str, Any]) -> bool:
        return bool(r.get("name")) and not r.get("hidden")

    rows: List[Dict[str, Any]] = []
    for r in recs.values():
        if not visible(r):
            continue
        ctype = classify(r.get("type"), r["className"], r["name"])
        own = positions.get(r["id"])
        if own:
            frame, pos, body = own
            via = None
        else:
            frame = pos = body = None
            via = None
            for a in ancestors(r):
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
        attrs: Dict[str, Any] = {"hidden": bool(r.get("hidden"))}
        size = r.get("size")
        if isinstance(size, (int, float)) and size > 0:
            attrs["radiusM" if ctype in ("star", "planet", "moon") else "size"] = size
        if via:
            attrs["positionFrom"] = via
        if r.get("parent") in recs and near is not None and recs[r["parent"]] is not near:
            attrs["starmapParent"] = recs[r["parent"]]["className"]
        rows.append({
            "id": r["className"],
            "name": r["name"],
            "type": ctype,
            "system_code": system_of(r),
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


def collect_records(df: Any, localized: Callable[[Optional[str]], Optional[Dict[str, str]]],
                    on_log: Callable[[str, str], None] = lambda lvl, m: None) -> List[Dict[str, Any]]:
    """The StarMapObject records of a DataForge as plain dicts for ``build_rows``."""
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
            "type": _strip_type_prefix(typ["_RecordName_"]) if typ else None,
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
    if not paks:
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
