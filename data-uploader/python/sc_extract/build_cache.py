"""Content keys for reusing 3D build output across game patches.

The 3D step's output lives in ``skins-<patch>``; a new patch starts an empty
dir and used to convert every hull and every part again — hours of
cgf-converter + gltf-transform work for meshes that, in most patches, did not
change at all. Reuse is safe exactly when the INPUTS are byte-identical and the
code that turns them into a glb is the same, so every reusable output is keyed
by:

* the bytes of every P4K file the conversion reads (mesh, its ``.cgam`` /
  ``.cgfm`` companion, the ``.mtl`` handed to the converter), and
* a pipeline tag: a hash of the python modules on that path, the converter
  binary, and whatever the host passes as salt (the bundled gltf-transform /
  meshoptimizer versions).

Anything not provably identical is rebuilt — a wrong reuse would publish a
stale model, a missed one only costs time.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Callable, Iterable, Optional, Sequence

_HERE = Path(__file__).resolve().parent

#: Modules whose code decides what a hull / part / interior glb looks like.
PIPELINE_MODULES = (
    "hull3d.py",
    "glb_materials.py",
    "mesh_integrity.py",
    "gltf_worker.py",
    "gltf_worker.mjs",
    "build_cache.py",
    "assets3d/parts.py",
    "assets3d/ships.py",
)


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


#: Converter builds keyed as an earlier build, by sha256. Only for a build whose
#: output was compared with that one's for every mesh that one could convert
#: and came out the same (python/tools/cgf-converter/README.md): swapping the
#: binary then keeps every cached model, and a mesh only the newer build can
#: convert has no cached output to be mistaken for. A build that changes the
#: output of an existing mesh must NOT be listed — its own digest rebuilds.
CONVERTER_ALIASES = {
    # cgf-converter v2.0.0-sc.1 (v2.0.0 + index-buffer and null-<Textures> fixes) -> v2.0.0
    "89d73dd2ff76070dea5fb4dd4e130b1dd1d02b1128874b0d80b0141d4d552abe":
        "75feca2813a6517cad9a8e5df28687860a3b0bab9dcbcfeef65e56850d53b0b7",
}


def converter_identity(converter: Path) -> str:
    """The converter's digest as the caches key it (see ``CONVERTER_ALIASES``)."""
    digest = file_digest(converter)
    return CONVERTER_ALIASES.get(digest, digest)


def pipeline_tag(converter: Optional[Path] = None, salt: str = "",
                 modules: Iterable[str] = PIPELINE_MODULES, recipe: str = "") -> str:
    """Short hash of everything besides the P4K inputs that shapes the output.

    ``recipe`` (``model3d@3``, from the host's `build-recipes.ts`) stands in
    for the module bytes: it is bumped by hand only when the output changes,
    so an uploader update that leaves the 3D code's output alone keeps every
    cached model. Without it (dev / CLI runs) the modules themselves are hashed.
    """
    h = hashlib.sha256()
    if recipe:
        h.update(f"recipe:{recipe}".encode())
    else:
        for name in modules:
            try:
                h.update((_HERE / name).read_bytes())
            except OSError:
                h.update(f"missing:{name}".encode())
    if converter is not None:
        try:
            h.update(converter_identity(converter).encode())
        except OSError:
            h.update(b"no-converter")
    h.update(salt.encode("utf-8"))
    return h.hexdigest()[:16]


def content_key(read: Callable[[str], bytes], exists: Callable[[str], bool],
                paths: Sequence[Optional[str]], tag: str, extra: str = "") -> str:
    """sha256 over the bytes of every existing ``paths`` entry (a missing one
    is folded in as its name, so "now absent" differs from "never there"),
    the pipeline ``tag`` and ``extra`` (settings such as a size budget)."""
    h = hashlib.sha256()
    for p in paths:
        if not p:
            h.update(b"\0none\0")
            continue
        h.update(p.replace("\\", "/").lower().encode("utf-8"))
        if exists(p):
            h.update(read(p))
        else:
            h.update(b"\0absent\0")
    h.update(tag.encode())
    h.update(extra.encode("utf-8"))
    return h.hexdigest()


def seed_from_previous(out: Path, subdirs: Sequence[str] = ("_parts", "_interiors"),
                       log: Callable[[str, str], None] = lambda lvl, m: None) -> Optional[Path]:
    """Prime a fresh ``skins-<patch>`` dir from the newest older sibling.

    Hard links the content-addressed stores (no extra disk, instant) and copies
    the part index files; returns the sibling so ship hulls can be looked up
    there too. Every reused row is still checked against its content key, so
    a stale entry is rebuilt, never served.
    """
    out = out.resolve()
    parent = out.parent
    prefix = "skins-"
    if not out.name.startswith(prefix):
        return None
    candidates = [d for d in parent.glob(f"{prefix}*") if d.is_dir() and d.resolve() != out]
    if not candidates:
        return None
    prev = max(candidates, key=lambda d: d.stat().st_mtime)
    linked = 0
    for sub in subdirs:
        src_dir, dst_dir = prev / sub, out / sub
        if not src_dir.is_dir():
            continue
        dst_dir.mkdir(parents=True, exist_ok=True)
        for f in src_dir.iterdir():
            if not f.is_file() or f.suffix == ".tmp":
                continue
            dst = dst_dir / f.name
            if dst.exists():
                continue
            try:
                if f.suffix == ".json":
                    dst.write_bytes(f.read_bytes())  # indexes are rewritten — never share an inode
                else:
                    os.link(f, dst)
                linked += 1
            except OSError:
                try:
                    dst.write_bytes(f.read_bytes())
                    linked += 1
                except OSError:
                    pass
    log("info", f"3D cache: primed from {prev.name} ({linked} file(s))")
    return prev
