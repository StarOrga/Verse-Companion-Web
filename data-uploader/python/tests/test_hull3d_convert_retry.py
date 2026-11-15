"""`Hull3DExporter._cgf_to_glb` retries a paint .mtl the converter cannot read.

cgf-converter dies with "An item with the same key has already been added" on
a material with two texture slots it cannot name (RSI Salvation, VNCL Blade).
The geometry is fine and the published hull is geometry-only, so the hull gets
the same texture-free retry the parts already had. A hull that converts on the
first try never sees the retry — its output stays what it was.

Run via: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest data-uploader/python/tests/
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from sc_extract import hull3d as hull3d_mod
from sc_extract.hull3d import Hull3DExporter, HullExportConfig

DUP_KEY = (b"[ERR:Program] Failed to render\r\n  ArgumentException: An item with the same key "
           b"has already been added. Key: Unknown\r\n")
MTL_XML = (b'<Material><SubMaterials><Material Name="a"><Textures>'
           b'<Texture Map="TexSlot1" File="x.tif"/><Texture Map="TexSlot2" File="x.tif"/>'
           b'</Textures></Material></SubMaterials></Material>')


class _P4K:
    def infolist(self):
        return []


def _exporter(tmp_path) -> Hull3DExporter:
    cfg = HullExportConfig(cgf_converter=tmp_path / "cgf-converter.exe",
                           out_dir=tmp_path / "out", work_dir=tmp_path / "work")
    return Hull3DExporter(_P4K(), cfg)


def _mirror(tmp_path):
    cga = tmp_path / "work" / "Data" / "Ships" / "hull.cga"
    cga.parent.mkdir(parents=True)
    cga.write_bytes(b"mesh")
    (cga.parent / "paint.mtl").write_bytes(MTL_XML)
    return cga


def _fake_converter(seen, fail_with_textures: bool):
    def run(cmd, cwd=None, **kwargs):
        mtl = Path(cwd) / cmd[cmd.index("-mtl") + 1]
        has_textures = b"<Texture " in mtl.read_bytes()
        seen.append(has_textures)
        if has_textures and fail_with_textures:
            return SimpleNamespace(returncode=1, stdout=DUP_KEY)
        (Path(cwd) / cmd[1]).with_suffix(".glb").write_bytes(b"g" * 5000)
        return SimpleNamespace(returncode=0, stdout=b"")
    return run


def test_a_material_the_converter_cannot_read_is_retried_texture_free(tmp_path, monkeypatch):
    exp, cga, seen = _exporter(tmp_path), _mirror(tmp_path), []
    monkeypatch.setattr(hull3d_mod.subprocess, "run", _fake_converter(seen, True))
    out = tmp_path / "raw.glb"
    exp._cgf_to_glb(cga, tmp_path / "work" / "Data", "paint.mtl", out)
    assert seen == [True, False]
    assert out.exists()


def test_a_hull_that_converts_first_time_keeps_its_material(tmp_path, monkeypatch):
    exp, cga, seen = _exporter(tmp_path), _mirror(tmp_path), []
    monkeypatch.setattr(hull3d_mod.subprocess, "run", _fake_converter(seen, False))
    exp._cgf_to_glb(cga, tmp_path / "work" / "Data", "paint.mtl", tmp_path / "raw.glb")
    assert seen == [True]
    assert (cga.parent / "paint.mtl").read_bytes() == MTL_XML
