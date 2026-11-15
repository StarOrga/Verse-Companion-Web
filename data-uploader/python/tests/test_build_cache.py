"""Cross-patch reuse of 3D build output (sc_extract.build_cache).

A new patch's ``skins-<patch>`` dir starts from the previous patch's stores,
and only byte-identical inputs are ever reused.
"""
from __future__ import annotations

import json
from pathlib import Path

from sc_extract import build_cache
from sc_extract.assets3d import ships
from sc_extract.assets3d.parts import PartRef, PartStore
from sc_extract.hull3d import EXPORT_FORMAT, Hull3DExporter, HullExportConfig, Paint, ShipSpec


def _store(root: Path, files: dict, pipeline: str = "p1") -> PartStore:
    return PartStore(root / "_parts", lambda p: files[p], lambda p: p in files, Path("conv.exe"),
                     lambda *a: None, root / "w", pipeline=pipeline)


def _fake_build(built):
    def fake_build(self, geo, mtl):
        built.append(geo)
        sha = (geo.encode().hex() * 64)[:64]
        self.path_of(sha).write_bytes(b"glb")
        return PartRef(sha, 3, geo)
    return fake_build


def test_part_rows_are_reused_only_for_identical_inputs(tmp_path, monkeypatch):
    built: list = []
    monkeypatch.setattr(PartStore, "_build", _fake_build(built))
    files = {"Data/gun.cgf": b"v1", "Data/hull.cga": b"h"}
    old = tmp_path / "skins-4.2"
    s = _store(old, files)
    s.export("Data/gun.cgf")
    s.export("Data/hull.cga")
    s.save_index()

    new = tmp_path / "skins-4.3"
    assert build_cache.seed_from_previous(new) == old.resolve()
    files2 = {"Data/gun.cgf": b"v2 changed", "Data/hull.cga": b"h"}
    s2 = _store(new, files2)
    assert s2.export("Data/hull.cga").cached          # unchanged → reused
    assert not s2.export("Data/gun.cgf").cached       # changed → rebuilt
    assert built == ["Data/gun.cgf", "Data/hull.cga", "Data/gun.cgf"]


def test_a_pipeline_change_rebuilds_everything(tmp_path, monkeypatch):
    built: list = []
    monkeypatch.setattr(PartStore, "_build", _fake_build(built))
    files = {"Data/gun.cgf": b"v1"}
    s = _store(tmp_path, files, pipeline="p1")
    s.export("Data/gun.cgf")
    s.save_index()
    assert not _store(tmp_path, files, pipeline="p2").export("Data/gun.cgf").cached


def test_helpers_follow_the_mesh_content(tmp_path, monkeypatch):
    calls: list = []

    def fake_convert(self, geo, mtl, scratch):
        calls.append(geo)
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(PartStore, "convert_raw", fake_convert)
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_materials.read_glb", lambda p: ({}, b""))
    monkeypatch.setattr("sc_extract.assets3d.parts.glb_node_transforms", lambda g: {"a": {}})
    files = {"Data/t.cga": b"1"}
    s = _store(tmp_path, files)
    s.helpers("Data/t.cga")
    s.helpers("Data/t.cga")
    assert calls == ["Data/t.cga"]
    s.save_index()
    files["Data/t.cga"] = b"2"
    _store(tmp_path, files).helpers("Data/t.cga")
    assert calls == ["Data/t.cga", "Data/t.cga"]


def test_interior_is_reused_for_the_same_hull_and_paint(tmp_path, monkeypatch):
    files = {"Data/h.cga": b"h", "Data/p.mtl": b"m"}
    store = _store(tmp_path, files)
    converted: list = []

    def fake_convert(geo, mtl, scratch):
        converted.append(geo)
        scratch.mkdir(parents=True, exist_ok=True)
        (scratch / "raw.glb").write_bytes(b"raw")
        return scratch / "raw.glb"

    monkeypatch.setattr(store, "convert_raw", fake_convert)
    monkeypatch.setattr(ships, "keep_only_interior", lambda raw, log: 1)
    monkeypatch.setattr(ships.glb_materials, "strip_to_geometry", lambda raw, log: None)

    def optimize(raw, out, size, err):
        out.write_bytes(b"interior")

    out = tmp_path / "_interiors"
    first = ships.export_interior(store, "Data/h.cga", "Data/p.mtl", out, optimize)
    second = ships.export_interior(store, "Data/h.cga", "Data/p.mtl", out, optimize)
    assert first == second and first is not None and first.exists()
    assert converted == ["Data/h.cga"]


class _Info:
    def __init__(self, filename):
        self.filename = filename


class _P4K:
    def __init__(self, files):
        self.files = files

    def infolist(self):
        return [_Info(n) for n in self.files]

    def open(self, info):
        data = self.files[info.filename]

        class R:
            def read(self_inner):
                return data
        return R()


def test_an_unchanged_hull_is_taken_from_the_previous_patch(tmp_path):
    files = {"Data/Ships/h.cga": b"hull", "Data/Ships/p.mtl": b"paint"}
    prev = tmp_path / "skins-4.2"
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "skins-4.3",
                           work_dir=tmp_path / "w", reuse_dirs=[prev], pipeline="p1")
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("AEGS_Gladius", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    src = exp.hull_src(spec, spec.paints[0])
    (prev / "AEGS_Gladius" / "models").mkdir(parents=True)
    (prev / "AEGS_Gladius" / "models" / "AEGS_Gladius_standard.glb").write_bytes(b"glb")
    (prev / "AEGS_Gladius" / "skins.json").write_text(json.dumps({
        "ship": "AEGS_Gladius", "format": EXPORT_FORMAT,
        "skins": [{"id": "standard", "model": "models/AEGS_Gladius_standard.glb",
                   "model_mb": 0.5, "hull_src": src}]}))
    out = cfg.out_dir / "AEGS_Gladius"
    (out / "models").mkdir(parents=True)
    got = exp._export_hull(spec, spec.paints[0], out)
    assert got["reused"] and got["hull_src"] == src and got["model_mb"] == 0.5
    assert (out / "models" / "AEGS_Gladius_standard.glb").read_bytes() == b"glb"


def _prev_hull(tmp_path, entry_extra: dict):
    files = {"Data/Ships/h.cga": b"hull", "Data/Ships/p.mtl": b"paint"}
    prev = tmp_path / "skins-4.2"
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "o",
                           work_dir=tmp_path / "w", reuse_dirs=[prev], pipeline="p1")
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("S", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    src = exp.hull_src(spec, spec.paints[0])
    (prev / "S" / "models").mkdir(parents=True)
    (prev / "S" / "models" / "S_standard.glb").write_bytes(b"glb")
    (prev / "S" / "skins.json").write_text(json.dumps({
        "format": EXPORT_FORMAT,
        "skins": [{"id": "standard", "model": "models/S_standard.glb", "hull_src": src,
                   **entry_extra}]}))
    (tmp_path / "o" / "S" / "models").mkdir(parents=True)
    return exp._reuse_hull(spec, spec.paints[0], tmp_path / "o" / "S", src)


def test_an_over_budget_hull_from_an_older_fit_search_is_built_again(tmp_path):
    # 8.38 MB, built before the bisection: the same inputs, but not reused.
    assert _prev_hull(tmp_path, {"model_mb": 8.38}) is None


def test_an_over_budget_hull_from_the_current_fit_search_is_reused(tmp_path):
    from sc_extract.hull3d import FIT_REVISION
    got = _prev_hull(tmp_path, {"model_mb": 3.1, "fit": FIT_REVISION})
    assert got is not None and got["reused"] and got["fit"] == FIT_REVISION


def test_a_hull_within_the_budget_is_reused_without_a_fit_marker(tmp_path):
    got = _prev_hull(tmp_path, {"model_mb": 1.44})
    assert got is not None and "fit" not in got


def test_needs_refit_only_for_over_budget_models_of_an_older_search():
    from sc_extract.hull3d import FIT_REVISION, needs_refit
    m = {"model": "models/S.glb"}
    assert needs_refit({**m, "model_mb": 8.38}, 1_500_000)
    assert not needs_refit({**m, "model_mb": 8.38, "fit": FIT_REVISION}, 1_500_000)
    assert not needs_refit({**m, "model_mb": 1.5}, 1_500_000)
    assert not needs_refit({**m, "model_mb": 8.38}, 0)  # budget off
    assert not needs_refit({"model": None, "model_mb": 8.38}, 1_500_000)


def test_a_cached_ship_with_an_over_budget_hull_is_built_again(tmp_path):
    from sc_extract.hull3d import FIT_REVISION
    from sc_extract.skin_export_app import _cached_catalog
    stamp = {"game_build": "100", "pipeline": "p1"}
    (tmp_path / "S").mkdir(parents=True)
    cat = {"ship": "S", "format": EXPORT_FORMAT, "stamp": stamp,
           "skins": [{"id": "standard", "model": "models/S_standard.glb", "model_mb": 8.38}]}
    (tmp_path / "S" / "skins.json").write_text(json.dumps(cat))
    assert _cached_catalog(tmp_path, "S", stamp, 1_500_000) is None
    assert _cached_catalog(tmp_path, "S", stamp, 0) is not None  # budget off
    cat["skins"][0]["fit"] = FIT_REVISION
    (tmp_path / "S" / "skins.json").write_text(json.dumps(cat))
    assert _cached_catalog(tmp_path, "S", stamp, 1_500_000) is not None


def test_a_changed_hull_is_not_taken_from_the_previous_patch(tmp_path):
    files = {"Data/Ships/h.cga": b"hull v2", "Data/Ships/p.mtl": b"paint"}
    prev = tmp_path / "skins-4.2"
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "o",
                           work_dir=tmp_path / "w", reuse_dirs=[prev], pipeline="p1")
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("S", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    (prev / "S" / "models").mkdir(parents=True)
    (prev / "S" / "models" / "S_standard.glb").write_bytes(b"glb")
    (prev / "S" / "skins.json").write_text(json.dumps({
        "format": EXPORT_FORMAT,
        "skins": [{"id": "standard", "model": "models/S_standard.glb", "hull_src": "stale"}]}))
    assert exp._reuse_hull(spec, spec.paints[0], tmp_path / "o" / "S",
                           exp.hull_src(spec, spec.paints[0])) is None


def test_seed_links_stores_and_ignores_unrelated_dirs(tmp_path):
    root = tmp_path / ".sc-companion-extracts"
    (root / "skins-4.2" / "_parts").mkdir(parents=True)
    (root / "skins-4.2" / "_parts" / "abc.glb").write_bytes(b"x")
    (root / "skins-4.2" / "_parts" / "index.json").write_text("{}")
    assert build_cache.seed_from_previous(root / "LIVE-4.3") is None
    new = root / "skins-4.3"
    assert build_cache.seed_from_previous(new) == (root / "skins-4.2").resolve()
    assert (new / "_parts" / "abc.glb").read_bytes() == b"x"
    assert (new / "_parts" / "index.json").read_text() == "{}"


def test_content_key_distinguishes_absent_from_empty():
    files = {"a": b""}
    k1 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["a"], "t")
    k2 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["b"], "t")
    k3 = build_cache.content_key(lambda p: files[p], lambda p: p in files, ["a"], "u")
    assert len({k1, k2, k3}) == 3


# ---- same patch dir, another game build / pipeline -------------------------
def _cached_ship(out: Path, stamp: dict) -> None:
    (out / "S").mkdir(parents=True)
    (out / "S" / "skins.json").write_text(json.dumps(
        {"ship": "S", "format": EXPORT_FORMAT, "stamp": stamp, "skins": []}))


def test_a_cached_ship_counts_only_for_the_same_build_and_pipeline(tmp_path):
    from sc_extract.skin_export_app import _cached_catalog
    stamp = {"game_build": "100", "pipeline": "p1"}
    _cached_ship(tmp_path, stamp)
    assert _cached_catalog(tmp_path, "S", stamp) is not None
    assert _cached_catalog(tmp_path, "S", {"game_build": "101", "pipeline": "p1"}) is None
    assert _cached_catalog(tmp_path, "S", {"game_build": "100", "pipeline": "p2"}) is None
    assert _cached_catalog(tmp_path, "S") is not None  # no stamp given = format only


def _modeled_ship(out: Path, stamp: dict) -> None:
    (out / "S").mkdir(parents=True)
    (out / "S" / "skins.json").write_text(json.dumps(
        {"ship": "S", "format": EXPORT_FORMAT, "stamp": stamp,
         "skins": [{"id": "standard", "model": "models/S_standard.glb"}]}))


def test_a_ship_with_a_model_stays_cached_across_an_aliased_converter(tmp_path):
    from sc_extract.skin_export_app import _cached_catalog
    # Built before the stamp carried the converter, or by the older build.
    _modeled_ship(tmp_path, {"game_build": "100", "pipeline": "p1"})
    now = {"game_build": "100", "pipeline": "p1", "converter": "new"}
    assert _cached_catalog(tmp_path, "S", now) is not None
    assert _cached_catalog(tmp_path, "S", {**now, "pipeline": "p2"}) is None


def test_a_ship_without_a_model_is_retried_once_by_another_converter(tmp_path):
    from sc_extract.skin_export_app import _cached_catalog
    _cached_ship(tmp_path, {"game_build": "100", "pipeline": "p1"})  # hull failed, no model
    now = {"game_build": "100", "pipeline": "p1", "converter": "new"}
    assert _cached_catalog(tmp_path, "S", now) is None
    # Once the new converter has tried it, the miss is cached like any result.
    (tmp_path / "S" / "skins.json").unlink()
    (tmp_path / "S").rmdir()
    _cached_ship(tmp_path, now)
    assert _cached_catalog(tmp_path, "S", now) is not None


def test_an_aliased_converter_keys_the_pipeline_like_the_build_it_matches(tmp_path, monkeypatch):
    old, new, other = (tmp_path / n for n in ("old.exe", "new.exe", "other.exe"))
    old.write_bytes(b"v2.0.0")
    new.write_bytes(b"v2.0.0-sc.1")
    other.write_bytes(b"v3")
    monkeypatch.setattr(build_cache, "CONVERTER_ALIASES",
                        {build_cache.file_digest(new): build_cache.file_digest(old)})
    tag = build_cache.pipeline_tag(old, "s", recipe="model3d@2")
    assert build_cache.pipeline_tag(new, "s", recipe="model3d@2") == tag
    assert build_cache.pipeline_tag(other, "s", recipe="model3d@2") != tag


def test_the_shipped_converter_alias_points_at_upstream_v2():
    # v2.0.0 as released by Markemp/Cryengine-Converter; the patched build is
    # pinned in src/lib/cgf-converter.ts (a vitest checks both pins match).
    assert "75feca2813a6517cad9a8e5df28687860a3b0bab9dcbcfeef65e56850d53b0b7" in \
        build_cache.CONVERTER_ALIASES.values()


def test_an_unstamped_cache_is_rebuilt(tmp_path):
    from sc_extract.skin_export_app import _cached_catalog
    (tmp_path / "S").mkdir()
    (tmp_path / "S" / "skins.json").write_text(json.dumps({"format": EXPORT_FORMAT, "skins": []}))
    assert _cached_catalog(tmp_path, "S", {"game_build": "100", "pipeline": "p1"}) is None


def _built_ship(exp, spec, out: Path, src: str, stamp: dict, glb: bytes = b"glb") -> None:
    (out / "models").mkdir(parents=True)
    (out / "models" / "S_standard.glb").write_bytes(glb)
    (out / "skins.json").write_text(json.dumps({
        "ship": "S", "format": EXPORT_FORMAT, "stamp": stamp,
        "skins": [{"id": "standard", "model": "models/S_standard.glb",
                   "model_mb": 0.5, "hull_src": src}]}))


def _same_dir_exporter(tmp_path, files):
    cfg = HullExportConfig(cgf_converter=Path("c.exe"), out_dir=tmp_path / "skins-4.3",
                           work_dir=tmp_path / "w", pipeline="p1",
                           stamp={"game_build": "101", "pipeline": "p1"})
    exp = Hull3DExporter(_P4K(files), cfg)
    spec = ShipSpec("S", "Data/Ships/h.cga", "Data", [Paint("Data/Ships/p.mtl", "standard")])
    return exp, spec, cfg.out_dir / "S"


def test_a_hotfix_build_takes_the_unchanged_hull_back_and_keeps_the_upload(tmp_path):
    files = {"Data/Ships/h.cga": b"hull", "Data/Ships/p.mtl": b"paint"}
    exp, spec, out = _same_dir_exporter(tmp_path, files)
    src = exp.hull_src(spec, spec.paints[0])
    _built_ship(exp, spec, out, src, {"game_build": "100", "pipeline": "p1"})
    (out / ".uploaded").write_text("S 1 rows")
    (out / ".package-uploaded").write_text("abc")

    prev = exp._park_previous(out)
    assert prev is not None and not out.exists()
    (out / "models").mkdir(parents=True)
    got = exp._export_hull(spec, spec.paints[0], out)
    assert got["reused"] and (out / "models" / "S_standard.glb").read_bytes() == b"glb"
    (out / "skins.json").write_text(json.dumps({
        "ship": "S", "format": EXPORT_FORMAT, "stamp": exp.cfg.stamp,
        "skins": [{"id": "standard", **got}]}))
    exp._settle_previous(prev, out)
    assert (out / ".uploaded").is_file() and (out / ".package-uploaded").read_text() == "abc"
    assert not prev.exists()


def test_a_changed_rebuild_loses_the_upload_marker(tmp_path):
    files = {"Data/Ships/h.cga": b"hull v2", "Data/Ships/p.mtl": b"paint"}
    exp, spec, out = _same_dir_exporter(tmp_path, files)
    _built_ship(exp, spec, out, "stale", {"game_build": "100", "pipeline": "p1"})
    (out / ".uploaded").write_text("S 1 rows")
    prev = exp._park_previous(out)
    assert exp._reuse_hull(spec, spec.paints[0], out, exp.hull_src(spec, spec.paints[0])) is None
    _built_ship(exp, spec, out, exp.hull_src(spec, spec.paints[0]), exp.cfg.stamp, glb=b"new glb")
    exp._settle_previous(prev, out)
    assert not (out / ".uploaded").exists()
    assert not prev.exists()


# ---- build recipes (data-uploader/src/lib/build-recipes.ts) -----------------
def test_a_recipe_keys_the_pipeline_instead_of_the_module_bytes():
    a = build_cache.pipeline_tag(salt="s", recipe="model3d@1")
    # Other module bytes (a refactor, a log line) leave a recipe-keyed tag alone …
    assert build_cache.pipeline_tag(salt="s", recipe="model3d@1", modules=("nope.py",)) == a
    # … a bumped recipe or another tool version does not.
    assert build_cache.pipeline_tag(salt="s", recipe="model3d@2") != a
    assert build_cache.pipeline_tag(salt="t", recipe="model3d@1") != a
    # Without a recipe (dev / CLI runs) the modules are hashed as before.
    assert build_cache.pipeline_tag(salt="s") != build_cache.pipeline_tag(salt="s", modules=("nope.py",))


def test_a_recipe_keys_the_silhouette_cache():
    from sc_extract.silhouette_export import algo_tag
    assert algo_tag("silhouette@1") == algo_tag("silhouette@1")
    assert algo_tag("silhouette@1") != algo_tag("silhouette@2")
    assert algo_tag("silhouette@1") != algo_tag()
