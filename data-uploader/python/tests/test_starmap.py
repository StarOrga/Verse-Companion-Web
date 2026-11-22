"""Verse location projection (sc_extract/starmap.py) — fixture DataCore + synthetic socpaks.

The DataCore side is a stub with the DataForge surface the projection uses
(like test_missions); the socpak side is a real ZIP of plain-XML ``.entxml``
entries read through ``ship_rooms.read_zip_entry`` with a stub decoder (the
production decoder is scdatatools' CryXmlB reader).

The fixture has the shape LIVE 4.10 has (#1195): StarMapObjectType records are
named by a GUID with the readable type in their ``name`` field, the system node
is hidden in the starmap and lives beside the system folders, the star has no
parent, and the Lagrange rest stops sit in a container the L-point entity opens.
"""
import io
import json
import math
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pytest

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.ship_rooms import cry_guid_to_record_id
from sc_extract.starmap import (LICENSE, SOURCE, build_rows, classify, collect_records,
                                extract_locations, positions_by_record, read_socpaks, rotate)


def _cry(record_id: str) -> str:
    """The CryEngine spelling of a DataForge record id (inverse of cry_guid_to_record_id)."""
    h = record_id.replace("-", "")
    g2, g3, a, b, rev_a, rev_b = h[0:4], h[4:8], h[8:12], h[12:16], h[16:20], h[20:32]
    rev = rev_a + rev_b
    tail = "".join(rev[i:i + 2] for i in range(14, -2, -2))
    g1 = b + a
    cry = f"{g1}{g2}{g3}{tail}"
    out = f"{cry[:8]}-{cry[8:12]}-{cry[12:16]}-{cry[16:20]}-{cry[20:]}"
    assert cry_guid_to_record_id(out) == record_id
    return out


def _id(n: int) -> str:
    return f"{n:08x}-0000-4000-8000-{n:012x}"


class _Rec:
    def __init__(self, name, guid, filename, value):
        self.name, self.guid, self.filename, self._value = name, guid, filename, value


TYPES = ("SolarSystem", "Star", "Planet", "Moon", "LandingZone", "Asteroid", "Outpost", "Manmade",
         "Manmade_VisibleOnInteraction")
TYPE_ID = {t: _id(100 + i) for i, t in enumerate(TYPES)}


def _type_records():
    # LIVE 4.10 names a type record by a GUID (StarMapObjectType.73efbf7b-…); its value says "Planet"
    return [_Rec("StarMapObjectType." + _cry(TYPE_ID[t]), TYPE_ID[t], "starmapobjecttypes.xml", {"name": t})
            for t in TYPES]


class _DF:
    def __init__(self, recs, types=None):
        self._recs = recs
        self._types = _type_records() if types is None else types

    def records_by_type_name(self, t):
        return self._recs if t == "StarMapObject" else self._types if t == "StarMapObjectType" else []

    def record_to_dict(self, rec, max_depth=1):
        if rec.name.endswith("Broken"):
            raise ValueError("unreadable")
        return {"_RecordValue_": rec._value}


def _ref(name, gid):
    return {"_RecordId_": gid, "_RecordName_": name}


NAMES = {"@sys": "Stanton System", "@star": "Stanton", "@hur": "Hurston", "@lor": "Lorville",
         "@l1": "HUR-L1", "@rr": "HUR-L1 Green Glade Station", "@shared": "Inside A Template",
         "@clinic": "Lorville Clinic", "@arc": "Comm Array ST1-12", "@orphan": "Lost Place", "@hid": "Hidden Thing",
         "@claim": "Mining Claim #M77-B9R", "@tmpl": "<= UNINITIALIZED =>"}

(SYS, STAR, HUR, LOR, L1, CLINIC, ARC, ORPHAN, HID, CLAIM, TMPL, BROKEN, RR,
 SHARED) = (_id(i) for i in range(1, 15))
PATH = "libs/foundry/records/starmap/pu/system/stanton/"


def _rec(name, gid, key, typ, parent=None, hidden=False, size=None, path=PATH):
    v = {"name": key, "type": _ref("StarMapObjectType." + _cry(TYPE_ID[typ]), TYPE_ID[typ]),
         "hideInStarmap": hidden}
    if parent:
        v["parent"] = _ref("StarMapObject.x", parent)
    if size is not None:
        v["size"] = size
    return _Rec("StarMapObject." + name, gid, path + name + ".xml", v)


def _fixture_df():
    return _DF([
        # LIVE: the system node is hidden in the starmap and sits beside the system folders
        _rec("StantonSolarSystem", SYS, "@sys", "SolarSystem", hidden=True,
             path="libs/foundry/records/starmap/pu/"),
        _rec("StantonStar", STAR, "@star", "Star", None, size=696000000.0),   # LIVE: the star has no parent
        _rec("Stanton1", HUR, "@hur", "Planet", STAR, size=1000000.0),
        _rec("Stanton1_Lorville", LOR, "@lor", "LandingZone", HUR),
        _rec("Stanton1_L1", L1, "@l1", "Asteroid", STAR),
        _rec("Stanton1_Lorville_Clinic", CLINIC, "@clinic", "Outpost", LOR),
        _rec("Stanton1_CommArray", ARC, "@arc", "Manmade", STAR),
        _rec("Lost", ORPHAN, "@orphan", "Outpost", None, path="libs/foundry/records/starmap/pu/system/pyro/"),
        _rec("HiddenThing", HID, "@hid", "Outpost", HUR, hidden=True),
        _rec("MiningClaim1", CLAIM, "@claim", "Asteroid", HUR, size=400),
        _rec("Template", TMPL, "@tmpl", "Outpost", HUR),
        _rec("Broken", BROKEN, "@hur", "Outpost", HUR),
        _rec("RR_HUR_L1", RR, "@rr", "Manmade_VisibleOnInteraction", STAR),   # LIVE: hangs under the star
        _rec("SharedInner", SHARED, "@shared", "Outpost", STAR),
    ])


def _loc(key):
    t = NAMES.get(key, key)
    return {"en": t, "de": "", "key": key}


# ── socpak fixtures ──────────────────────────────────────────────────────────

def _ent(name, pos, record=None, container=None, rot=None):
    meta = f'<EntityComponentObjectMetadata starmapRecord="{_cry(record)}"/>' if record else ""
    oc = f'<EntityComponentObjectContainer objectContainer="{container}"/>' if container else ""
    r = f' Rotate="{rot}"' if rot else ""
    return name, f'<Entity Name="{name}" Pos="{pos}"{r} EntityClass="OrbitingObjectContainer">{meta}{oc}</Entity>'


def _socpak(entities):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, xml in entities:
            z.writestr(f"entities/{name}.entxml", xml)
    return buf.getvalue()


def _decode(blob: bytes):
    return ET.fromstring(blob.decode("utf-8"))


class _P4K:
    """Just the P4KFile surface read_socpaks uses."""

    class _Info:
        def __init__(self, filename):
            self.filename = filename

    def __init__(self, files):
        self._files = files

    def infolist(self):
        return [self._Info(n) for n in self._files]

    def getinfo(self, name):
        return self._Info(name)

    def open(self, info):
        return io.BytesIO(self._files[info.filename])


ROOT = "Data/ObjectContainers/PU/system/stanton/"
L1_PAK = "Data/ObjectContainers/PU/system/stanton/lagrangepoints/stanton1_l1.socpak"
COMM_PAK = "objectcontainers/pu/station/comm/commarray.socpak"
QUARTER_TURN_Z = "0.70710678,0,0,0.70710678"   # w,x,y,z: +90° about z, (1,0,0) -> (0,1,0)


def _p4k():
    system = _socpak([
        _ent("OOC_Stanton_1_Hurston", "1000,2000,3000", HUR, container="ObjectContainers/PU/system/stanton/stanton1.socpak"),
        _ent("OOC_Stanton1_L1", "-5,6,7", L1, container=L1_PAK, rot=QUARTER_TURN_Z),
        _ent("Comm", "9,9,9", ARC, container=COMM_PAK),
        _ent("Comm2", "50,50,50", container=COMM_PAK),   # a second opener: commarray.socpak is a template
        _ent("NoRecord", "1,1,1"),
    ])
    body = _socpak([
        _ent("Hurston_self", "0,0,0", HUR),               # the body inside its own frame: no position of its own
        _ent("Lorville_zone", "10.5,-20,30", LOR),
        _ent("Claim", "nan,0,0", CLAIM),                  # unreadable position: stays at the origin default
    ])
    lagrange = _socpak([_ent("LOC_RR_S1_L1", "10,0,0", RR, container="oc/mod/stanton/station/ser/rs_ext_hur-l1.socpak")])
    comm = _socpak([_ent("inner", "1,2,3", SHARED)])
    return _P4K({
        ROOT + "stantonsystem.socpak": system,
        ROOT + "stanton1.socpak": body,
        L1_PAK: lagrange,
        "Data/ObjectContainers/PU/station/comm/commarray.socpak": comm,
        "Data/ObjectContainers/PU/loc/other.socpak": b"never read",
    })


def _rows(positions):
    return {r["id"]: r for r in build_rows(collect_records(_fixture_df(), _loc), positions)}


class TestClassify:
    def test_names_decide_what_datacore_types_do_not(self):
        assert classify("Asteroid", "Stanton1_L3", "HUR-L3") == "lagrange"
        assert classify("Asteroid", "Cluster7", "Cluster SZA-178") == "asteroid"
        assert classify("Asteroid_ValidQT", "M1", "Mining Claim #M77-B9R") == "mining-claim"
        assert classify("Manmade", "ArcCA", "Comm Array ST1-12") == "comm-array"
        assert classify("Manmade_VisibleOnInteraction", "Gate", "Seraphim Station") == "station"
        assert classify("Outpost", "Lor_Clinic", "Lorville Clinic") == "clinic"
        assert classify("Outpost_InvalidQT", "Shubin", "Shubin Mining") == "outpost"
        assert classify("Anomaly", "JP", "Pyro - Terra Jump Point") == "jumppoint"
        assert classify("SolarSystem", "Stanton", "Stanton") == "system"
        assert classify("LandingZone", "Lor", "Lorville") == "landing-zone"

    def test_a_guid_named_type_record_resolves_to_its_readable_name(self):
        recs = {r["className"]: r for r in collect_records(_fixture_df(), _loc)}
        assert recs["Stanton1"]["type"] == "Planet" and recs["StantonSolarSystem"]["type"] == "SolarSystem"
        # without type records the ref's own name is the fallback (older builds, other stubs)
        bare = {r["className"]: r for r in collect_records(_DF(_fixture_df()._recs, types=[]), _loc)}
        assert bare["Stanton1"]["type"] == _cry(TYPE_ID["Planet"])

    def test_a_landing_zone_on_a_planet_is_a_city(self):
        assert _rows({})["Stanton1_Lorville"]["type"] == "city"


class TestSocpaks:
    def test_system_socpaks_and_the_containers_they_open_are_read(self):
        paks = read_socpaks(_p4k(), _decode)
        assert sorted(paks) == [COMM_PAK, L1_PAK[5:].lower(), "stanton1.socpak", "stantonsystem.socpak"]
        hur = next(e for e in paks["stantonsystem.socpak"] if e["name"] == "OOC_Stanton_1_Hurston")
        assert hur["pos"] == (1000.0, 2000.0, 3000.0) and hur["rotate"] is None
        assert [cry_guid_to_record_id(g) for g in hur["records"]] == [HUR]
        assert hur["container"].endswith("stanton1.socpak")

    def test_a_broken_entity_is_skipped_not_fatal(self):
        files = {ROOT + "stantonsystem.socpak": _socpak([("a", "<Entity Name='a' Pos='1,1,1'/>"), ("b", "<<<not xml")])}
        paks = read_socpaks(_P4K(files), _decode)
        assert [e["name"] for e in paks["stantonsystem.socpak"]] == ["a"]

    def test_a_broken_nested_container_is_skipped_with_a_warning(self):
        logs = []
        files = {ROOT + "stantonsystem.socpak": _socpak([_ent("L", "0,0,0", L1, container=L1_PAK)]),
                 L1_PAK: b"no zip"}
        paks = read_socpaks(_P4K(files), _decode, lambda lvl, m: logs.append(lvl))
        assert list(paks) == ["stantonsystem.socpak"] and logs == ["warn"]

    def test_the_socpak_decides_the_frame_and_the_body_comes_from_the_container_link(self):
        pos = positions_by_record(read_socpaks(_p4k(), _decode), {})
        assert pos[HUR] == ("system", (1000.0, 2000.0, 3000.0), None)   # not its own (0,0,0) body-frame entity
        assert pos[L1] == ("system", (-5.0, 6.0, 7.0), None)
        assert pos[LOR] == ("body", (10.5, -20.0, 30.0), HUR)
        assert pos[CLAIM] == ("body", (0.0, 0.0, 0.0), HUR)

    def test_a_container_opened_by_one_system_entity_is_in_that_entitys_frame(self):
        pos = positions_by_record(read_socpaks(_p4k(), _decode), {})
        frame, p, body = pos[RR]
        assert (frame, body) == ("system", None)
        assert p == pytest.approx((-5.0, 16.0, 7.0), abs=1e-6)   # L1 (-5,6,7) + the quarter turn of (10,0,0)
        assert SHARED not in pos                       # inside a container two entities open: a template

    def test_rotate_reads_w_first(self):
        assert rotate((0.70710678, 0.0, 0.0, 0.70710678), (1.0, 0.0, 0.0)) == pytest.approx((0.0, 1.0, 0.0), abs=1e-6)
        assert rotate(None, (1.0, 2.0, 3.0)) == (1.0, 2.0, 3.0)

    def test_the_stem_of_the_socpak_names_the_body_when_there_is_no_container_link(self):
        paks = {"stantonsystem.socpak": [], "stanton1.socpak": [{"name": "x", "pos": (1.0, 2.0, 3.0),
                                                                 "records": [_cry(LOR)], "container": None}]}
        pos = positions_by_record(paks, {HUR: "Stanton1"})
        assert pos[LOR] == ("body", (1.0, 2.0, 3.0), HUR)
        assert positions_by_record(paks, {}) == {}   # unnamed body frame: no usable position


class TestRows:
    @pytest.fixture()
    def rows(self):
        return _rows(positions_by_record(read_socpaks(_p4k(), _decode), {}))

    def test_one_row_per_visible_named_place_keyed_on_the_record_name(self, rows):
        assert set(rows) == {"StantonSolarSystem", "StantonStar", "Stanton1", "Stanton1_Lorville", "Stanton1_L1",
                             "Stanton1_Lorville_Clinic", "Stanton1_CommArray", "Lost", "MiningClaim1",
                             "RR_HUR_L1", "SharedInner"}
        assert all(r["source"] == SOURCE == "data-uploader" and r["license"] == LICENSE for r in rows.values())

    def test_own_position_and_frame_come_from_the_socpak(self, rows):
        hur = rows["Stanton1"]
        assert (hur["frame"], hur["pos_x"], hur["pos_y"], hur["pos_z"]) == ("system", 1000.0, 2000.0, 3000.0)
        assert hur["type"] == "planet" and hur["system_code"] == "STANTON"
        assert hur["attributes"] == {"hidden": False, "radiusM": 1000000.0}
        lor = rows["Stanton1_Lorville"]
        assert (lor["frame"], lor["parent_id"], lor["pos_x"]) == ("body", "Stanton1", 10.5)

    def test_a_place_without_a_position_takes_its_hosts(self, rows):
        clinic = rows["Stanton1_Lorville_Clinic"]
        assert clinic["type"] == "clinic"
        assert (clinic["frame"], clinic["pos_x"], clinic["pos_y"], clinic["pos_z"]) == ("body", 10.5, -20.0, 30.0)
        assert clinic["parent_id"] == "Stanton1"       # a body-frame position is in the body's frame
        assert clinic["attributes"]["positionFrom"] == "Stanton1_Lorville"
        assert clinic["attributes"]["starmapParent"] == "Stanton1_Lorville"

    def test_a_hostless_place_has_no_frame_and_no_position(self, rows):
        lost = rows["Lost"]
        assert (lost["frame"], lost["pos_x"], lost["pos_y"], lost["pos_z"], lost["parent_id"]) == (None, None, None, None, None)
        assert lost["system_code"] == "PYRO"

    def test_a_star_is_no_host(self, rows):
        # under the star, no entity of its own: no position, not the star's origin (#1195)
        inner = rows["SharedInner"]
        assert (inner["frame"], inner["pos_x"], inner["parent_id"]) == (None, None, "StantonStar")
        assert "positionFrom" not in inner["attributes"]
        rr = rows["RR_HUR_L1"]
        assert (rr["frame"], rr["type"], rr["parent_id"]) == ("system", "station", "StantonStar")
        assert rr["pos_y"] == pytest.approx(16.0, abs=1e-6)

    def test_star_and_system_sit_at_the_origin_of_the_system_frame(self, rows):
        for k in ("StantonSolarSystem", "StantonStar"):
            assert (rows[k]["frame"], rows[k]["pos_x"], rows[k]["pos_y"], rows[k]["pos_z"]) == ("system", 0.0, 0.0, 0.0)
        assert rows["StantonStar"]["attributes"]["radiusM"] == 696000000.0

    def test_the_hidden_system_node_is_the_root_and_the_parentless_star_hangs_under_it(self, rows):
        node = rows["StantonSolarSystem"]
        assert (node["type"], node["system_code"], node["parent_id"], node["attributes"]["hidden"]) == \
            ("system", "STANTON", None, True)
        assert rows["StantonStar"]["parent_id"] == "StantonSolarSystem"
        assert "starmapParent" not in rows["StantonStar"]["attributes"]
        assert rows["Stanton1"]["parent_id"] == "StantonStar"

    def test_hidden_templates_and_unreadable_records_are_no_rows_but_hosts_still_count(self):
        pos = positions_by_record(read_socpaks(_p4k(), _decode), {})
        rows = _rows({**pos, HID: ("system", (1.0, 1.0, 1.0), None)})
        assert "HiddenThing" not in rows and "Template" not in rows and "Broken" not in rows
        # a hidden parent's position still serves its children, but the row points at a visible ancestor
        rows = _rows({HID: ("system", (7.0, 7.0, 7.0), None)})
        assert rows["Stanton1_Lorville"]["frame"] is None

    def test_parent_is_the_nearest_visible_ancestor(self):
        rows = _rows({})
        assert rows["MiningClaim1"]["parent_id"] == "Stanton1" and rows["MiningClaim1"]["attributes"]["size"] == 400
        assert "starmapParent" not in rows["MiningClaim1"]["attributes"]
        assert rows["Stanton1_L1"]["type"] == "lagrange" and rows["Stanton1_CommArray"]["type"] == "comm-array"

    def test_a_body_frame_names_the_parent_and_keeps_the_starmap_parent(self):
        # LIVE: the MT SecurityCenters are Calliope children in DataCore but sit in microTech's socpak
        planet, moon, place = _id(80), _id(81), _id(82)
        recs = [{"id": planet, "className": "Stanton4", "name": "microTech", "type": "Planet", "parent": None,
                 "hidden": False, "filename": PATH},
                {"id": moon, "className": "Stanton4a", "name": "Calliope", "type": "Moon", "parent": planet,
                 "hidden": False, "filename": PATH},
                {"id": place, "className": "Stanton4_MTSecurityCenterX", "name": "MT SecurityCenter X",
                 "type": "Outpost", "parent": moon, "hidden": False, "filename": PATH}]
        row = {r["id"]: r for r in build_rows(recs, {place: ("body", (1.0, 2.0, 3.0), planet)})}
        sc = row["Stanton4_MTSecurityCenterX"]
        assert (sc["parent_id"], sc["frame"], sc["attributes"]["starmapParent"]) == ("Stanton4", "body", "Stanton4a")

    def test_the_host_never_loops_on_a_parent_cycle(self):
        a, b = _id(90), _id(91)
        recs = [{"id": a, "className": "A", "name": "A", "type": "Outpost", "parent": b, "hidden": False, "filename": ""},
                {"id": b, "className": "B", "name": "B", "type": "Outpost", "parent": a, "hidden": False, "filename": ""}]
        assert [r["frame"] for r in build_rows(recs, {})] == [None, None]


class TestMicroTechMoons:
    """#1195 regression: the microTech moons and comm arrays, LIVE 4.10 values.

    The desktop catalog (scunpacked) has Calliope, Clio, Euterpe and Comm Array
    ST4-22 point-mirrored through microTech (off by 4.8e6 to 2.2e8 m). The
    socpak positions are right: each moon's offset from microTech matches its
    own ``EntityComponentOrbit`` (radius + angle), and all three match the
    in-game measurements in Valalol/Star-Citizen-Navigation Database.json (MIT,
    (c) Valalol) to the metre.
    """
    # record, socpak Pos (system frame), OrbitalRadius, OrbitalAngle (deg, around microTech)
    MT = ("Stanton4", (22462085252.484795, 37185744964.830101, 0.0))
    MOONS = {
        "Stanton4a": ((22398369308.0, 37168840679.0, 0.0), 65823063.0, 194.77366638),     # Calliope
        "Stanton4b": ((22476728221.0, 37091020074.0, 0.0), 95742637.0, 278.83914185),     # Clio
        "Stanton4c": ((22488109736.0, 37081123565.0, 0.0), 107710475.52, 284.01968384),   # Euterpe
    }
    ARRAYS = {  # comm arrays: socpak Pos, the moon (or planet) they orbit
        "Stanton4_comm001": ((22463480440.0, 37187712709.0, 24000.0), "Stanton4"),    # ST4-22
        "Stanton4_comm002": ((22398627814.0, 37169314872.0, 24000.0), "Stanton4a"),   # ST4-31
        "Stanton4_comm003": ((22476478957.0, 37091530237.0, 24000.0), "Stanton4b"),   # ST4-59
        "Stanton4_comm004": ((22488541520.0, 37081331599.0, 24000.0), "Stanton4c"),   # ST4-64
    }
    VALALOL = {"Stanton4a": (22398369308.0, 37168840679.0), "Stanton4b": (22476728221.0, 37091020074.0),
               "Stanton4c": (22488109736.0, 37081123565.0)}
    CATALOG = {"Stanton4a": (22525801196.7, 37202649250.6), "Stanton4b": (22447442284.5, 37280469855.3),
               "Stanton4c": (22436060769.3, 37290366365.0)}

    def _run(self):
        ids = {n: _id(200 + i) for i, n in enumerate([self.MT[0], *self.MOONS, *self.ARRAYS])}
        ents = [{"name": "OOC_" + self.MT[0], "pos": self.MT[1], "rotate": None, "records": [_cry(ids[self.MT[0]])],
                 "container": "objectcontainers/pu/system/stanton/stanton4.socpak"}]
        ents += [{"name": "OOC_" + n, "pos": v[0], "rotate": None, "records": [_cry(ids[n])], "container": None}
                 for n, v in {**self.MOONS, **self.ARRAYS}.items()]
        recs = [{"id": ids[self.MT[0]], "className": self.MT[0], "name": "microTech", "type": "Planet",
                 "parent": None, "hidden": False, "filename": PATH}]
        recs += [{"id": ids[n], "className": n, "name": n, "type": "Moon", "parent": ids[self.MT[0]],
                  "hidden": False, "filename": PATH} for n in self.MOONS]
        recs += [{"id": ids[n], "className": n, "name": "Comm Array " + n, "type": "Manmade",
                  "parent": ids[host], "hidden": False, "filename": PATH} for n, (_, host) in self.ARRAYS.items()]
        pos = positions_by_record({"stantonsystem.socpak": ents}, {})
        return {r["id"]: r for r in build_rows(recs, pos)}

    def test_the_moons_keep_their_socpak_positions_which_agree_with_their_orbit(self):
        rows = self._run()
        mx, my, _ = self.MT[1]
        for n, (p, radius, angle) in self.MOONS.items():
            r = rows[n]
            assert (r["frame"], r["parent_id"], r["type"]) == ("system", "Stanton4", "moon")
            assert (r["pos_x"], r["pos_y"], r["pos_z"]) == p
            dx, dy = p[0] - mx, p[1] - my
            assert math.hypot(dx, dy) == pytest.approx(radius, rel=2e-3)
            assert math.degrees(math.atan2(dy, dx)) % 360 == pytest.approx(angle, abs=0.2)

    def test_the_moons_match_the_in_game_measurement_not_the_mirrored_catalog(self):
        rows = self._run()
        mx, my, _ = self.MT[1]
        for n, ref in self.VALALOL.items():
            here = (rows[n]["pos_x"], rows[n]["pos_y"])
            assert math.dist(here, ref) < 1.0
            mirrored = (2 * mx - here[0], 2 * my - here[1])
            assert math.dist(mirrored, self.CATALOG[n]) < 2.0   # the catalog value is our point mirrored

    def test_the_comm_arrays_hang_under_their_moon_in_the_system_frame(self):
        rows = self._run()
        for n, (p, host) in self.ARRAYS.items():
            r = rows[n]
            assert (r["frame"], r["parent_id"], r["type"]) == ("system", host, "comm-array")
            assert (r["pos_x"], r["pos_y"], r["pos_z"]) == p


class TestExtract:
    def test_writes_one_json_per_row_and_is_stable_across_runs(self, tmp_path: Path):
        n = extract_locations(_fixture_df(), _loc, _p4k(), tmp_path, decode=_decode)
        assert n == 11
        files = sorted((tmp_path / "locations").glob("*.json"))
        assert len(files) == 11
        again = extract_locations(_fixture_df(), _loc, _p4k(), tmp_path, decode=_decode)
        assert again == 11 and len(list((tmp_path / "locations").glob("*.json"))) == 11
        clinic = json.loads((tmp_path / "locations" / "Stanton1_Lorville_Clinic.json").read_text(encoding="utf-8"))
        assert clinic["id"] == "Stanton1_Lorville_Clinic" and clinic["frame"] == "body"

    def test_a_p4k_without_system_socpaks_raises_so_the_run_can_skip_only_locations(self, tmp_path: Path):
        with pytest.raises(RuntimeError):
            extract_locations(_fixture_df(), _loc, _P4K({}), tmp_path, decode=_decode)


def test_the_run_step_logs_a_warning_and_never_aborts(tmp_path: Path):
    logs = []

    class _Boom:
        p4k = _P4K({})
        df = _fixture_df()
        out = tmp_path
        on_log = lambda self, lvl, msg: logs.append((lvl, msg))  # noqa: E731
        _localized = staticmethod(_loc)

        def _bump(self, key, n):
            raise AssertionError("must not count a failed step")

    CodexExtractor.extract_locations(_Boom())
    assert logs[-1][0] == "warn" and "locations skipped" in logs[-1][1]
