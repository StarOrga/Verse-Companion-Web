"""Part-index writes: only when something changed, and throttled inside a run.

Field log 2026-11-15: the standalone package loops (fps/items/armor, ~6,300
classes) rewrote the ~17 MB `_parts/index.json` after every class — ~2 s of
JSON each, hours per run, even when every part was a cache hit.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

from sc_extract.assets3d import parts as parts_mod
from sc_extract.assets3d.parts import PART_FORMAT, PartStore
from sc_extract.converter_report import converter_reason


def _store(tmp_path):
    return PartStore(tmp_path / "store", lambda p: b"", lambda p: False,
                     tmp_path / "cgf-converter.exe", lambda *a, **k: None, tmp_path / "work")


def test_a_freshly_loaded_index_is_clean(tmp_path):
    (tmp_path / "store").mkdir()
    (tmp_path / "store" / "index.json").write_text(
        json.dumps({"_format": PART_FORMAT, "a.cga": {"sha256": None, "src": "x"}}), encoding="utf-8")
    store = _store(tmp_path)
    assert store.index["a.cga"]["src"] == "x"
    assert store.flush() is False


def test_checkpoint_waits_for_the_interval_then_writes(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(parts_mod.time, "monotonic", lambda: clock[0])
    store = _store(tmp_path)
    store.index["b.cga"] = {"sha256": None, "src": "y"}
    assert store.checkpoint(interval_s=60) is False  # too soon after the load
    assert not store.index_path.exists()
    clock[0] += 61
    assert store.checkpoint(interval_s=60) is True
    assert json.loads(store.index_path.read_text(encoding="utf-8"))["b.cga"]["src"] == "y"
    clock[0] += 61
    assert store.checkpoint(interval_s=60) is False  # nothing changed since


def test_flush_writes_pending_rows_and_nothing_else(tmp_path):
    store = _store(tmp_path)
    store.index["c.cga"] = {"sha256": None, "src": "z"}
    assert store.flush() is True
    assert store.flush() is False
    assert json.loads(store.index_path.read_text(encoding="utf-8"))["c.cga"]["src"] == "z"


def test_every_kind_of_write_marks_the_index_dirty(tmp_path):
    store = _store(tmp_path)
    for mutate in (lambda i: i.update({"d": {}}), lambda i: i.setdefault("e", {}),
                   lambda i: i.pop("d"), lambda i: i.__delitem__("e")):
        store.save_index()
        mutate(store.index)
        assert store.index.dirty


GALAXY = (b"[ERR:Program] Failed to render: Data/Objects/rsi_galaxy.cga\r\n"
          b"  AggregateException: One or more errors occurred. (One or more errors occurred.)\r\n"
          b"    AggregateException: One or more errors occurred. (Arithmetic operation resulted in an overflow.)\r\n"
          b"      OverflowException: Arithmetic operation resulted in an overflow.\r\n"
          b"         at System.Linq.Enumerable.Sum[TSource,TResult](IEnumerable`1 source)\r\n"
          b"         at CgfConverter.Renderers.Gltf.BaseGltfRenderer.Compile()\r\n"
          b"[INF:Program] Finished. Rendered 0 file(s)\r\n"
          b"[ERR:Program] Failed to convert 1 file(s).\r\n")


def test_reason_names_the_innermost_exception_and_its_converter_frame():
    reason = converter_reason(SimpleNamespace(stdout=GALAXY, stderr=b""))
    assert reason == (": OverflowException: Arithmetic operation resulted in an overflow. "
                      "in CgfConverter.Renderers.Gltf.BaseGltfRenderer.Compile")


def test_reason_never_falls_back_to_the_generic_summary_line():
    out = b"[ERR:Program] Failed to render: x.cga\r\n[ERR:Program] Failed to convert 1 file(s).\r\n"
    assert converter_reason(SimpleNamespace(stdout=out, stderr=None)) == ": [ERR:Program] Failed to render: x.cga"


def test_reason_is_empty_without_output():
    assert converter_reason(SimpleNamespace(stdout=b"", stderr=b"")) == ""
