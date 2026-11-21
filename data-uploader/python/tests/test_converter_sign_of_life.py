"""Every converter / optimizer call logs one line naming its file BEFORE it runs.

The host's stall watchdog (`main/index.ts`, `JobStall`) resets on every sidecar
event. cgf-converter may take up to 600 s and gltf-transform up to 900 s per
call, so a slow part used to stay silent for minutes; with the line first, a
slow part resets the watchdog and a real hang names the part it hung on.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from sc_extract import hull3d as hull3d_mod
from sc_extract.assets3d import parts as parts_mod
from sc_extract.assets3d.parts import PartStore
from sc_extract.glb_materials import write_glb
from sc_extract.hull3d import Hull3DExporter, HullExportConfig, Paint, ShipSpec, _describe_gltf_args

MESH = "Data/Objects/Ships/AEGS/part.cgf"
FILES = {MESH: b"mesh"}


class _P4K:
    def infolist(self):
        return []


def test_a_part_conversion_logs_its_path_before_the_converter_runs(tmp_path, monkeypatch):
    logs = []

    def fake_converter(cmd, cwd=None, **kwargs):
        # The line is out before the (possibly long) converter call starts.
        assert logs == [("info", f"  convert {MESH}")]
        write_glb((Path(cwd) / cmd[1]).with_suffix(".glb"),
                  {"asset": {"version": "2.0", "generator": "x" * 256}}, b"")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(parts_mod.subprocess, "run", fake_converter)
    store = PartStore(tmp_path / "store", FILES.__getitem__, FILES.__contains__,
                      tmp_path / "cgf-converter.exe", lambda *a, **k: None, tmp_path / "work",
                      on_log=lambda lvl, m: logs.append((lvl, m)))
    store.convert_raw(MESH, None, tmp_path / "work" / "part_x")
    assert logs[0] == ("info", f"  convert {MESH}")


def test_a_hull_conversion_logs_its_mesh_before_the_converter_runs(tmp_path, monkeypatch):
    logs = []
    cfg = HullExportConfig(cgf_converter=tmp_path / "cgf-converter.exe",
                           out_dir=tmp_path / "out", work_dir=tmp_path / "work",
                           on_log=lambda lvl, m: logs.append((lvl, m)))
    exp = Hull3DExporter(_P4K(), cfg)
    cga = tmp_path / "work" / "Data" / "hull.cga"
    cga.parent.mkdir(parents=True)
    cga.write_bytes(b"mesh")

    def fake_converter(cmd, cwd=None, **kwargs):
        assert logs == [("info", "  convert hull.cga")]
        (Path(cwd) / cmd[1]).with_suffix(".glb").write_bytes(b"g" * 5000)
        return SimpleNamespace(returncode=0, stdout=b"")

    monkeypatch.setattr(hull3d_mod.subprocess, "run", fake_converter)
    exp._cgf_to_glb(cga, tmp_path / "work" / "Data", None, tmp_path / "raw.glb")
    assert logs == [("info", "  convert hull.cga")]


def test_an_optimizer_call_logs_its_command_and_input_first(tmp_path, monkeypatch):
    logs = []
    cfg = HullExportConfig(cgf_converter=tmp_path / "cgf-converter.exe",
                           out_dir=tmp_path / "out", work_dir=tmp_path / "work",
                           on_log=lambda lvl, m: logs.append((lvl, m)))
    exp = Hull3DExporter(_P4K(), cfg)
    monkeypatch.setenv("SC_GLTF_TRANSFORM_ARGV", '["node", "cli.js"]')
    monkeypatch.setenv("SC_GLTF_WORKER", "0")
    exp._worker_failed = True  # one Node per call — no long-lived worker in a test

    def fake_run(cmd, **kwargs):
        assert logs == [("info", "  gltf-transform simplify in.glb")]
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(hull3d_mod.subprocess, "run", fake_run)
    exp._gltf_transform(["simplify", str(tmp_path / "in.glb"), str(tmp_path / "out.glb")])
    assert logs == [("info", "  gltf-transform simplify in.glb")]


def test_every_paint_icon_logs_its_paint_before_the_export_runs(tmp_path, monkeypatch):
    # #382: 15 icons under heavy throttling took 21 min without a line and
    # tripped the 20-min stall watchdog right before the ship finished.
    logs = []
    cfg = HullExportConfig(cgf_converter=tmp_path / "cgf-converter.exe",
                           out_dir=tmp_path / "out", work_dir=tmp_path / "work",
                           on_log=lambda lvl, m: logs.append((lvl, m)))
    exp = Hull3DExporter(_P4K(), cfg)
    seen = []

    def fake_icon(paint, ship_out):
        # The paint's line is out before its (possibly slow) icon export starts.
        assert logs[-1] == ("info", f"  icon {paint.id}")
        seen.append(paint.id)
        return f"icons/{paint.id}.webp"

    monkeypatch.setattr(exp, "_export_icon", fake_icon)
    paints = [Paint(mtl="", id="pirate", icon_dds="a.dds"),
              Paint(mtl="", id="no_icon"),
              Paint(mtl="", id="gold", icon_dds="b.dds")]
    out = exp.export_ship(ShipSpec("TEST_Ship", "hull.cga", "Data", paints))
    assert seen == ["pirate", "gold"]
    icon_lines = [m for _, m in logs if m.startswith("  icon ")]
    assert icon_lines == ["  icon pirate", "  icon gold"]  # none for a paint without icon
    assert [s["icon"] for s in out["skins"]] == ["icons/pirate.webp", None, "icons/gold.webp"]


def test_describe_gltf_args_names_the_command_and_the_input_file():
    assert _describe_gltf_args(["weld", "C:/w/a/b.glb", "C:/w/a/c.glb"]) == "weld b.glb"
    assert _describe_gltf_args(["inspect"]) == "inspect"
    assert _describe_gltf_args([]) == "?"


def test_the_parallel_build_enters_extract_before_the_first_ship_finishes(monkeypatch):
    # #382: the parent set `extract` only on the first finished ship, so a stall
    # during a long first ship was reported as `(discover)`.
    from sc_extract import events, skin_export_app

    seen = []

    class _Sink:
        def put(self, event):
            seen.append(event)

    events.set_event_sink(_Sink())
    try:
        skin_export_app._build_parallel(SimpleNamespace(), [], 0, total=10, done_before=4,
                                        results={}, pkg_parts=[], timing={})
    finally:
        events.set_event_sink(None)
    assert {"type": "phase", "phase": "extract", "pct": 40} in seen
    assert {"type": "progress", "stage": "ships", "current": 4, "total": 10} in seen
