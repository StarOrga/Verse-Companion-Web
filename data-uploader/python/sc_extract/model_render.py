"""Model renders: a small colour still of an item's 3D model as WebP (#402).

The only item art in the DataCore is ``displayIcon`` — the game's white 64×64
family glyph. The asset-package build (``assets3d``) already converts every
FPS weapon, armour piece and ship item to a GLB, so this module draws that
mesh once more into a 256 px thumbnail the catalog can show next to the icon.

What is drawn: the RAW converter GLB of a part, before ``strip_to_geometry``
throws its materials away. Each primitive keeps its material's
``baseColorFactor`` when the converter wrote a real one (anything but the
default white), otherwise the neutral class colour of
``glb_materials.material_class`` (hull / glass / glow). Hidden materials
(proxies, shields, decals) are left out like everywhere else.

What is NOT drawn (yet): textures. The converter output references the
``.dds`` diffuse/normal maps of the ``.mtl`` but the part pipeline never
extracts them, and the game's layered HardSurface shader (wear masks, tint
palettes) has no offline equivalent here. A render is therefore a shaded
model in its material colours, not a final in-game picture.

Renderer: orthographic three-quarter view, Lambert key light + ambient,
painter's algorithm (depth-sorted polygons drawn by Pillow), supersampled and
downscaled. No GPU, no new dependency (numpy + Pillow are already pinned),
deterministic, so CI can test it. A mesh above ``MAX_TRIANGLES`` is reduced
to its largest triangles first — at 256 px the small ones are sub-pixel.

Every failure returns ``None``: an item without a render simply has no
``renderImage`` and the web keeps its icon.

On disk: ``.sc-companion-extracts/model-renders/`` (kept by the host's
cleanup sweeps, ``cleanup.ts`` ``PERSISTENT_CACHE_DIRS``):

- ``<part sha256>.webp`` — one render per distinct part, written by
  ``PartStore._publish`` when the store has a ``render_dir``;
- ``index.json`` — ``{className: partSha256}`` for every standalone package
  (FPS weapon, item, armour) whose root part has a render, written by
  ``skin_export_app``. The catalog extract reads it (``RenderIndex``) and
  ships each listed render as ``payload.renderImage`` through the same
  ``previews/`` upload as ``previewImage``.
"""

from __future__ import annotations

import json
import math
import shutil
from pathlib import Path
from typing import Callable, Dict, List, Optional, Sequence, Tuple

RENDER_VERSION = 1
RENDER_DIR = "model-renders"
INDEX_NAME = "index.json"
SIZE = 256                # edge of the emitted square WebP
SUPERSAMPLE = 3           # drawn at SIZE * SUPERSAMPLE, then downscaled
MAX_TRIANGLES = 60_000
WEBP_QUALITY = 82
PADDING = 0.08            # share of the edge left free on every side

# Neutral class colours (linear-ish sRGB 0..1). Hull is a light gunmetal so
# the shading reads on the app's dark surfaces; glass a cool translucent blue.
CLASS_COLOURS: Dict[str, Tuple[float, float, float]] = {
    "hull": (0.62, 0.64, 0.68),
    "glass": (0.45, 0.62, 0.78),
    "glow": (0.55, 0.85, 1.0),
}
_YAW = math.radians(-35.0)
_PITCH = math.radians(20.0)
_LIGHT = (-0.45, 0.65, 0.62)  # view space, towards the viewer's upper left

LogFn = Callable[[str, str], None]


def renders_dir_for(out_dir: Path) -> Optional[Path]:
    """`.sc-companion-extracts/model-renders` for a dir there, else None."""
    parent = Path(out_dir).resolve().parent
    return parent / RENDER_DIR if parent.name == ".sc-companion-extracts" else None


def _material_colours(gltf: dict) -> List[Optional[Tuple[float, float, float]]]:
    from .glb_materials import is_hidden_material, material_class
    out: List[Optional[Tuple[float, float, float]]] = []
    for m in gltf.get("materials", []):
        name = m.get("name", "")
        if is_hidden_material(name):
            out.append(None)
            continue
        factor = (m.get("pbrMetallicRoughness") or {}).get("baseColorFactor")
        if (isinstance(factor, list) and len(factor) >= 3
                and all(isinstance(v, (int, float)) for v in factor[:3])
                and not all(v >= 0.999 for v in factor[:3])):
            out.append(tuple(max(0.0, min(1.0, float(v))) for v in factor[:3]))
        else:
            out.append(CLASS_COLOURS.get(material_class(name), CLASS_COLOURS["hull"]))
    return out


def _view_matrix():
    import numpy as np
    cy, sy = math.cos(_YAW), math.sin(_YAW)
    cp, sp = math.cos(_PITCH), math.sin(_PITCH)
    yaw = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    pitch = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
    return pitch @ yaw


def render_triangles(tris, colours, size: int = SIZE):
    """``tris`` (N, 3, 3) glTF space, ``colours`` (N, 3) 0..1 -> RGBA PIL image
    or None when nothing is visible."""
    import numpy as np
    from PIL import Image, ImageDraw

    tris = np.asarray(tris, dtype=np.float64)
    colours = np.asarray(colours, dtype=np.float64)
    if tris.ndim != 3 or len(tris) == 0:
        return None
    finite = np.isfinite(tris).all(axis=(1, 2))
    tris, colours = tris[finite], colours[finite]
    v = tris @ _view_matrix().T                      # view space, +z towards viewer
    e1, e2 = v[:, 1] - v[:, 0], v[:, 2] - v[:, 0]
    normals = np.cross(e1, e2)
    area = np.linalg.norm(normals, axis=1)
    keep = area > 1e-12
    v, colours, normals, area = v[keep], colours[keep], normals[keep], area[keep]
    if not len(v):
        return None
    if len(v) > MAX_TRIANGLES:
        top = np.argsort(area)[-MAX_TRIANGLES:]
        v, colours, normals, area = v[top], colours[top], normals[top], area[top]
    normals = normals / area[:, None]
    # Two-sided: converter meshes are not reliably closed or consistently wound.
    light = np.array(_LIGHT) / np.linalg.norm(_LIGHT)
    lambert = np.abs(normals @ light)
    shade = 0.32 + 0.68 * lambert
    rgb = np.clip(colours * shade[:, None], 0, 1)

    lo, hi = v[:, :, :2].reshape(-1, 2).min(axis=0), v[:, :, :2].reshape(-1, 2).max(axis=0)
    extent = float(max(hi[0] - lo[0], hi[1] - lo[1]))
    if not math.isfinite(extent) or extent <= 0:
        return None
    big = size * SUPERSAMPLE
    scale = big * (1 - 2 * PADDING) / extent
    centre = (lo + hi) / 2
    px = (v[:, :, :2] - centre) * scale
    px[:, :, 0] += big / 2
    px[:, :, 1] = big / 2 - px[:, :, 1]              # image rows grow downwards
    order = np.argsort(v[:, :, 2].mean(axis=1))       # far (small z) first

    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cols = (rgb * 255).round().astype(np.uint8)
    for i in order:
        p = px[i]
        c = cols[i]
        draw.polygon([(p[0, 0], p[0, 1]), (p[1, 0], p[1, 1]), (p[2, 0], p[2, 1])],
                     fill=(int(c[0]), int(c[1]), int(c[2]), 255))
    if img.getbbox() is None:
        return None
    return img.resize((size, size), Image.LANCZOS)


def render_glb(glb: Path, out: Path, on_log: Optional[LogFn] = None) -> bool:
    """Raw (uncompressed) GLB -> ``out`` WebP. False on any failure."""
    try:
        import numpy as np
        from . import glb_materials
        from .mesh_integrity import load_triangles

        gltf, _ = glb_materials.read_glb(Path(glb))
        palette = _material_colours(gltf)
        tris, mats = load_triangles(Path(glb), with_materials=True)
        if not len(tris):
            return False
        default = CLASS_COLOURS["hull"]
        keep = np.array([m < 0 or m >= len(palette) or palette[m] is not None for m in mats],
                        dtype=bool)
        tris, mats = tris[keep], mats[keep]
        colours = np.array([palette[m] if 0 <= m < len(palette) else default for m in mats],
                           dtype=np.float64).reshape(-1, 3)
        img = render_triangles(tris, colours)
        if img is None:
            return False
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_suffix(".tmp.webp")
        img.save(tmp, "WEBP", quality=WEBP_QUALITY, method=6)
        tmp.replace(out)
        return True
    except Exception as exc:  # noqa: BLE001 — a render never costs the part
        if on_log:
            on_log("warn", f"  render {Path(glb).name}: {type(exc).__name__}: {exc}"[:300])
        return False


def render_path(render_dir: Path, sha: str) -> Path:
    return Path(render_dir) / f"{sha}.webp"


def read_index(render_dir: Optional[Path]) -> Dict[str, str]:
    if not render_dir:
        return {}
    try:
        data = json.loads((Path(render_dir) / INDEX_NAME).read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    rows = data.get("classes") if isinstance(data, dict) else None
    if not isinstance(rows, dict):
        return {}
    return {str(k): str(v) for k, v in rows.items() if isinstance(v, str) and v}


def update_index(render_dir: Path, rows: Sequence[Tuple[str, Optional[str]]]) -> int:
    """Merge ``(className, rootSha256)`` pairs whose render exists; returns how
    many classes the index lists afterwards. A class whose root has no render
    (or no root) is dropped, so a stale render never outlives its geometry."""
    index = read_index(render_dir)
    for cls, sha in rows:
        if sha and render_path(render_dir, sha).exists():
            index[cls] = sha
        else:
            index.pop(cls, None)
    Path(render_dir).mkdir(parents=True, exist_ok=True)
    tmp = Path(render_dir) / (INDEX_NAME + ".tmp")
    tmp.write_text(json.dumps({"version": RENDER_VERSION, "classes": index}, sort_keys=True),
                   "utf-8")
    tmp.replace(Path(render_dir) / INDEX_NAME)
    return len(index)


class RenderIndex:
    """Catalog side: className -> WebP name in ``previews/`` (copied on first use)."""

    def __init__(self, render_dir: Optional[Path], previews_dir: Path,
                 on_log: LogFn = lambda lvl, m: None) -> None:
        self.dir = render_dir
        self.previews = Path(previews_dir)
        self.index = read_index(render_dir)
        self.on_log = on_log
        self._done: Dict[str, Optional[str]] = {}
        self.used = 0

    def __len__(self) -> int:
        return len(self.index)

    def resolve(self, class_name: Optional[str]) -> Optional[str]:
        if not class_name or not self.dir:
            return None
        sha = self.index.get(class_name)
        if not sha:
            return None
        if sha in self._done:
            return self._done[sha]
        src = render_path(self.dir, sha)
        name: Optional[str] = f"model_{sha[:20]}.webp"
        try:
            self.previews.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, self.previews / name)
            self.used += 1
        except OSError as exc:
            self.on_log("warn", f"model render {class_name}: {exc}")
            name = None
        self._done[sha] = name
        return name
