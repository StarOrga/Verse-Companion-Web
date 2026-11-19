"""Fetch the external *build tool* binaries the 3D hull export needs.

These are NOT data sources — all SC data comes from the local Data.p4k. These
are geometry/optimization tools that are too large to commit:

  * cgf-converter (Markemp/Cryengine-Converter) — converts SC 4.x Ivo .cga/.cgf
    geometry (which scdatatools 1.0.4 cannot parse) to glTF. v2.0.0 is required
    for SC 4.x; v1.7.1 fails silently (empty glb). We run v2.0.0 plus the
    patches in `cgf-converter/` (build recipe in its README), hosted on the
    public binaries mirror and pinned by sha256 — the same build the app
    downloads (`src/lib/cgf-converter.ts`).

`@gltf-transform/cli` is fetched on demand via `npx`, so it is not handled here.

Usage:
    python tools/fetch_tools.py            # downloads to ./tools/
"""
from __future__ import annotations

import hashlib
import sys
import urllib.request
from pathlib import Path

TOOLS = Path(__file__).resolve().parent

# pinned: v2.0.0 + the cgf-converter/ patches (keep in sync with src/lib/cgf-converter.ts)
CGF_CONVERTER_URL = (
    "https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/"
    "cgf-converter-v2.0.0-sc.1/cgf-converter.exe"
)
CGF_CONVERTER_SHA256 = "89d73dd2ff76070dea5fb4dd4e130b1dd1d02b1128874b0d80b0141d4d552abe"
CGF_CONVERTER_DEST = TOOLS / "cgf-converter-2.0.0-sc.1.exe"
CGF_CONVERTER_MIN_BYTES = 100_000_000  # ~117 MB self-contained .NET binary


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def _download(url: str, dest: Path, min_bytes: int, sha256: str) -> None:
    if dest.exists() and dest.stat().st_size >= min_bytes:
        if _sha256(dest) == sha256:
            print(f"[skip] {dest.name} already present ({dest.stat().st_size:,} B)")
            return
        print(f"[warn] {dest.name} does not match its pinned sha256 — downloading it again")
        dest.unlink()
    print(f"[get ] {url}\n   -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:  # noqa: S310
        while chunk := r.read(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if tmp.stat().st_size < min_bytes:
        size = tmp.stat().st_size
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"download too small ({size} B) — aborted")
    if h.hexdigest() != sha256:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"download does not match its pinned sha256 ({h.hexdigest()[:12]}...) — aborted")
    tmp.replace(dest)
    print(f"[ok  ] {dest.name} ({dest.stat().st_size:,} B)")


def main() -> int:
    TOOLS.mkdir(parents=True, exist_ok=True)
    _download(CGF_CONVERTER_URL, CGF_CONVERTER_DEST, CGF_CONVERTER_MIN_BYTES, CGF_CONVERTER_SHA256)
    print("\nAll build tools ready. (gltf-transform is fetched via `npx` at runtime.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
