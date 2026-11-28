"""model_render: colour stills of part GLBs + the class -> render index (#402)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("PIL")

from sc_extract import model_render as mr  # noqa: E402
from test_mesh_integrity import cube, write_tris_glb  # noqa: E402


def _set_colour(glb: Path, index: int, rgba) -> None:
    from sc_extract import glb_materials as gm
    gltf, binary = gm.read_glb(glb)
    gltf["materials"][index]["pbrMetallicRoughness"] = {"baseColorFactor": list(rgba)}
    gm.write_glb(glb, gltf, binary)


def test_render_glb_writes_a_square_webp_with_the_material_colour(tmp_path: Path) -> None:
    from PIL import Image
    glb = tmp_path / "raw.glb"
    write_tris_glb(glb, [("body", cube(2.0))])
    _set_colour(glb, 0, (0.8, 0.1, 0.1, 1.0))
    out = tmp_path / "r.webp"
    assert mr.render_glb(glb, out)
    img = Image.open(out).convert("RGBA")
    assert img.size == (mr.SIZE, mr.SIZE)
    px = np.asarray(img)
    opaque = px[px[..., 3] > 200]
    assert len(opaque) > 0.1 * mr.SIZE * mr.SIZE
    assert px[0, 0, 3] == 0  # transparent corner: the padding stays free
    r, g, b = opaque[:, :3].astype(float).mean(axis=0)
    assert r > 2 * g and r > 2 * b  # red material reads red


def test_render_glb_skips_hidden_materials(tmp_path: Path) -> None:
    glb = tmp_path / "raw.glb"
    write_tris_glb(glb, [("proxy", cube(2.0))])
    assert not mr.render_glb(glb, tmp_path / "r.webp")


def test_render_glb_fails_soft_on_garbage(tmp_path: Path) -> None:
    bad = tmp_path / "bad.glb"
    bad.write_bytes(b"not a glb")
    logs = []
    assert not mr.render_glb(bad, tmp_path / "r.webp", lambda lvl, m: logs.append(lvl))
    assert logs == ["warn"]
    assert not (tmp_path / "r.webp").exists()


def test_render_triangles_empty_is_none() -> None:
    assert mr.render_triangles(np.zeros((0, 3, 3)), np.zeros((0, 3))) is None


def test_index_lists_only_classes_with_a_render(tmp_path: Path) -> None:
    rd = tmp_path / "model-renders"
    rd.mkdir()
    (rd / "aaa.webp").write_bytes(b"x")
    assert mr.update_index(rd, [("Gun_A", "aaa"), ("Gun_B", "bbb"), ("Gun_C", None)]) == 1
    assert mr.read_index(rd) == {"Gun_A": "aaa"}
    (rd / "aaa.webp").unlink()
    assert mr.update_index(rd, [("Gun_A", "aaa")]) == 0  # stale entry dropped
    assert json.loads((rd / "index.json").read_text())["version"] == mr.RENDER_VERSION


def test_render_index_copies_into_previews_once(tmp_path: Path) -> None:
    rd = tmp_path / "model-renders"
    rd.mkdir()
    sha = "f" * 64
    (rd / f"{sha}.webp").write_bytes(b"webp")
    mr.update_index(rd, [("Armor_A", sha), ("Armor_B", sha)])
    previews = tmp_path / "out" / "previews"
    idx = mr.RenderIndex(rd, previews)
    a, b = idx.resolve("Armor_A"), idx.resolve("Armor_B")
    assert a == b == f"model_{sha[:20]}.webp"
    assert (previews / a).read_bytes() == b"webp"
    assert idx.used == 1
    assert idx.resolve("Unknown") is None
    assert idx.resolve(None) is None


def test_render_index_without_dir_is_empty(tmp_path: Path) -> None:
    idx = mr.RenderIndex(None, tmp_path / "previews")
    assert len(idx) == 0 and idx.resolve("X") is None


def test_renders_dir_only_under_the_extract_root(tmp_path: Path) -> None:
    root = tmp_path / ".sc-companion-extracts"
    assert mr.renders_dir_for(root / "skins-4.4") == (root / "model-renders").resolve()
    assert mr.renders_dir_for(tmp_path / "elsewhere") is None
