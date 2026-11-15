# cgf-converter — the build the uploader runs

The 3D steps (hulls, parts, interiors, silhouettes) convert SC 4.x Ivo meshes
with [Cryengine-Converter](https://github.com/Markemp/Cryengine-Converter)
(GPL-2.0). The uploader runs **v2.0.0 plus the patches in this folder**,
published as `cgf-converter-v2.0.0-sc.1` on the public binaries mirror and
pinned by sha256 in `src/lib/cgf-converter.ts` and `python/tools/fetch_tools.py`.

| Patch | Fixes |
|-------|-------|
| `0001-fix-gltf-write-only-a-node-s-own-index-ranges-for-Iv.patch` | Ivo files share one index stream across all nodes, and v2.0.0 wrote the whole stream once **per node** as that node's index bufferView. The glb binary chunk grew nodes × stream (RSI Galaxy: 219 × 9.9 MB = 2.18 GB) and `BaseGltfRenderer.Compile()` threw `OverflowException` past `int.MaxValue`. Most of the 25 hulls without a model on LIVE 4.10 died here (Galaxy, Polaris, Perseus, Constellations, Vulture, Hull B, Guardian MX, San'tok.yāi …). The patch packs the node's own subset ranges back to back; accessor values, names and min/max are unchanged. |
| `0002-fix-materials-treat-a-submaterial-without-Textures-a.patch` | A submaterial without `<Textures>` (every AEGS Vanguard's paint `.mtl`) dereferenced `null` in `MaterialTextureManager.CreateSet` and failed the whole file. It is now an untextured material. |

RSI Salvation and VNCL Blade hit a third converter bug, `An item with the same
key has already been added` on a paint `.mtl` with two texture slots it cannot
name. That one is not patched here: `hull3d._cgf_to_glb` retries with a
texture-free copy of the `.mtl`, as `PartStore.convert_raw` already did —
the published hull is geometry-only either way.

## Same output for everything v2.0.0 could convert

For each mesh v2.0.0 converts, the patched build writes the same glTF scene and
the same accessor data — only the binary chunk is smaller, because the zero
padding of other nodes' index ranges is gone (Gladius raw glb 442 MB → 22 MB,
Cutlass Black 78 MB → 19 MB). Checked two ways before the switch:

* raw glbs, stock vs. patched: scene JSON minus buffer layout plus a sha256 of
  every accessor's decoded data — identical;
* the full uploader build (`skin_export_app --package --interior --no-reuse`)
  of working ships with both converters — every published file identical.

That is why `build_cache.CONVERTER_ALIASES` keys the patched digest as the
v2.0.0 digest: swapping the binary keeps every cached model. A future build
that changes output for an existing mesh must **not** be aliased — let its new
digest rebuild the caches (and bump `model3d` if the pipeline code changed).

## Rebuilding the binary

```bash
git clone https://github.com/Markemp/Cryengine-Converter.git
cd Cryengine-Converter
git checkout 7b951dbb   # v2.0.0
git am <repo>/data-uploader/python/tools/cgf-converter/*.patch
dotnet publish cgf-converter/cgf-converter.csproj -c Release -o publish   # .NET SDK 9.0.321
```

`publish/cgf-converter.exe` is the self-contained single-file build (~117 MB).
`dotnet publish` is not byte-reproducible: a rebuilt binary gets a new sha256,
so publishing one means a new mirror release, a new pin in both places and a
fresh equivalence check before it may join `CONVERTER_ALIASES`.

Both patches are proposed upstream in
[Markemp/Cryengine-Converter#267](https://github.com/Markemp/Cryengine-Converter/pull/267)
(0002 also adds a unit test; the test project is not part of the exe, so the
pinned binary is unaffected). Once a release contains them, the uploader can go
back to the upstream asset.
