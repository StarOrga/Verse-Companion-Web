"""Verse location projection (sc_extract/starmap.py) — fixture DataCore + synthetic socpaks.

The DataCore side is a stub with the DataForge surface the projection uses
(like test_missions); the socpak side is a real ZIP of plain-XML ``.entxml``
entries read through ``ship_rooms.read_zip_entry`` with a stub decoder (the
production decoder is scdatatools' CryXmlB reader).
"""
import io
import json
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import pytest

from sc_extract.dataforge_extract import CodexExtractor
from sc_extract.ship_rooms import cry_guid_to_record_id
from sc_extract.starmap import (LICENSE, SOURCE, build_rows, classify, extract_locations,
                                positions_by_record, read_socpaks)


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


class _DF:
    def __init__(self, recs):
        self._recs = recs

    def records_by_type_name(self, t):
        return self._recs if t == "StarMapObject" else []

    def record_to_dict(self, rec, max_depth=1):
        if rec.name.endswith("Broken"):
            raise ValueError("unreadable")
        return {"_RecordValue_": rec._value}


def _ref(name, gid):
    return {"_RecordId_": gid, "_RecordName_": name}


NAMES = {"@sys": "Stanton", "@star": "Stanton", "@hur": "Hurston", "@lor": "Lorville", "@l1": "HUR-L1 Green Glade Station",
         "@clinic": "Lorville Clinic", "@arc": "Comm Array ST1-12", "@orphan": "Lost Place", "@hid": "Hidden Thing",
         "@claim": "Mining Claim #M77-B9R", "@tmpl": "<= UNINITIALIZED =>"}

SYS, STAR, HUR, LOR, L1, CLINIC, ARC, ORPHAN, HID, CLAIM, TMPL, BROKEN = (_id(i) for i in range(1, 13))
PATH = "libs/foundry/records/starmap/pu/system/stanton/"


def _rec(name, gid, key, typ, parent=None, hidden=False, size=None, path=PATH):
    v = {"name": key, "type": _ref("StarMapObjectType." + typ, "T" + typ), "hideInStarmap": hidden}
    if parent:
        v["parent"] = _ref("StarMapObject.x", parent)
    if size is not None:
        v["size"] = size
    return _Rec("StarMapObject." + name, gid, path + name + ".xml", v)


def _fixture_df():
    return _DF([
        _rec("Stanton", SYS, "@sys", "SolarSystem"),
        _rec("StantonStar", STAR, "@star", "Star", SYS, size=696000000.0),
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
    ])


def _loc(key):
    t = NAMES.get(key, key)
    return {"en": t, "de": "", "key": key}


# ── socpak fixtures ──────────────────────────────────────────────────────────

def _ent(name, pos, record=None, container=None):
    meta = f'<EntityComponentObjectMetadata starmapRecord="{_cry(record)}"/>' if record else ""
    oc = f'<EntityComponentObjectContainer objectContainer="{container}"/>' if container else ""
    return name, f'<Entity Name="{name}" Pos="{pos}" EntityClass="OrbitingObjectContainer">{meta}{oc}</Entity>'


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


def _p4k():
    system = _socpak([
        _ent("OOC_Stanton_1_Hurston", "1000,2000,3000", HUR, container="ObjectContainers/PU/system/stanton/stanton1.socpak"),
        _ent("OOC_Stanton1_L1", "-5,6,7", L1),
        _ent("Comm", "9,9,9", ARC),
        _ent("NoRecord", "1,1,1"),
    ])
    body = _socpak([
        _ent("Hurston_self", "0,0,0", HUR),               # the body inside its own frame: no position of its own
        _ent("Lorville_zone", "10.5,-20,30", LOR),
        _ent("Claim", "nan,0,0", CLAIM),                  # unreadable position: stays at the origin default
    ])
    return _P4K({
        ROOT + "stantonsystem.socpak": system,
        ROOT + "stanton1.socpak": body,
        "Data/ObjectContainers/PU/loc/other.socpak": b"never read",
    })


def _rows(positions):
    from sc_extract.starmap import collect_records
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


class TestSocpaks:
    def test_only_system_socpaks_are_read_and_entities_keep_their_data(self):
        paks = read_socpaks(_p4k(), _decode)
        assert sorted(paks) == ["stanton1.socpak", "stantonsystem.socpak"]
        hur = next(e for e in paks["stantonsystem.socpak"] if e["name"] == "OOC_Stanton_1_Hurston")
        assert hur["pos"] == (1000.0, 2000.0, 3000.0)
        assert [cry_guid_to_record_id(g) for g in hur["records"]] == [HUR]
        assert hur["container"].endswith("stanton1.socpak")

    def test_a_broken_entity_is_skipped_not_fatal(self):
        files = {ROOT + "stantonsystem.socpak": _socpak([("a", "<Entity Name='a' Pos='1,1,1'/>"), ("b", "<<<not xml")])}
        paks = read_socpaks(_P4K(files), _decode)
        assert [e["name"] for e in paks["stantonsystem.socpak"]] == ["a"]

    def test_the_socpak_decides_the_frame_and_the_body_comes_from_the_container_link(self):
        pos = positions_by_record(read_socpaks(_p4k(), _decode), {})
        assert pos[HUR] == ("system", (1000.0, 2000.0, 3000.0), None)   # not its own (0,0,0) body-frame entity
        assert pos[L1] == ("system", (-5.0, 6.0, 7.0), None)
        assert pos[LOR] == ("body", (10.5, -20.0, 30.0), HUR)
        assert pos[CLAIM] == ("body", (0.0, 0.0, 0.0), HUR)

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
        assert set(rows) == {"Stanton", "StantonStar", "Stanton1", "Stanton1_Lorville", "Stanton1_L1",
                             "Stanton1_Lorville_Clinic", "Stanton1_CommArray", "Lost", "MiningClaim1"}
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

    def test_a_hostless_place_has_no_frame_and_no_position(self, rows):
        lost = rows["Lost"]
        assert (lost["frame"], lost["pos_x"], lost["pos_y"], lost["pos_z"], lost["parent_id"]) == (None, None, None, None, None)
        assert lost["system_code"] == "PYRO"

    def test_star_and_system_sit_at_the_origin_of_the_system_frame(self, rows):
        for k in ("Stanton", "StantonStar"):
            assert (rows[k]["frame"], rows[k]["pos_x"], rows[k]["pos_y"], rows[k]["pos_z"]) == ("system", 0.0, 0.0, 0.0)
        assert rows["StantonStar"]["attributes"]["radiusM"] == 696000000.0

    def test_hidden_templates_and_unreadable_records_are_no_rows_but_hosts_still_count(self):
        pos = positions_by_record(read_socpaks(_p4k(), _decode), {})
        rows = _rows({**pos, HID: ("system", (1.0, 1.0, 1.0), None)})
        assert "HiddenThing" not in rows and "Template" not in rows and "Broken" not in rows
        # a hidden parent's position still serves its children, but the row points at a visible ancestor
        rows = _rows({HID: ("system", (7.0, 7.0, 7.0), None)})
        assert rows["Stanton1_Lorville"]["frame"] is None

    def test_parent_is_the_nearest_visible_ancestor(self):
        pos = {}
        rows = _rows(pos)
        assert rows["MiningClaim1"]["parent_id"] == "Stanton1" and rows["MiningClaim1"]["attributes"]["size"] == 400
        assert rows["Stanton1_L1"]["type"] == "lagrange" and rows["Stanton1_CommArray"]["type"] == "comm-array"

    def test_the_host_never_loops_on_a_parent_cycle(self):
        a, b = _id(90), _id(91)
        recs = [{"id": a, "className": "A", "name": "A", "type": "Outpost", "parent": b, "hidden": False, "filename": ""},
                {"id": b, "className": "B", "name": "B", "type": "Outpost", "parent": a, "hidden": False, "filename": ""}]
        assert [r["frame"] for r in build_rows(recs, {})] == [None, None]


class TestExtract:
    def test_writes_one_json_per_row_and_is_stable_across_runs(self, tmp_path: Path):
        n = extract_locations(_fixture_df(), _loc, _p4k(), tmp_path, decode=_decode)
        assert n == 9
        files = sorted((tmp_path / "locations").glob("*.json"))
        assert len(files) == 9
        again = extract_locations(_fixture_df(), _loc, _p4k(), tmp_path, decode=_decode)
        assert again == 9 and len(list((tmp_path / "locations").glob("*.json"))) == 9
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
