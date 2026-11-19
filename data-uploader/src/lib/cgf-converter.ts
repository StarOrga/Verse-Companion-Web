/**
 * The cgf-converter build tool the 3D hull / part / silhouette steps run.
 *
 * Upstream Cryengine-Converter v2.0.0 (Markemp) with two fixes on top
 * (`data-uploader/python/tools/cgf-converter/`, built from commit 7b951dbb):
 *
 *  1. Ivo meshes no longer write the file's whole index stream once per
 *     node — that grew the glb past 2 GiB and threw an OverflowException on
 *     the big hulls (Galaxy, Polaris, Perseus, the Constellations, Hull B …).
 *  2. A submaterial without `<Textures>` no longer fails the whole file
 *     (every AEGS Vanguard).
 *
 * For every mesh v2.0.0 could convert, the glb carries the same scene and the
 * same accessor values (the binary is smaller, the published models are
 * byte-identical) — which is why `build_cache.CONVERTER_ALIASES` keys it as
 * v2.0.0 and no cached model is rebuilt.
 *
 * The binary is a GPL-2.0 build hosted next to the uploader on the public
 * binaries mirror, pinned by its sha256: a download that does not match is
 * thrown away, never run.
 *
 * Pure data — no Node, no Electron — so it can be unit-tested.
 */

export const CGF_CONVERTER_URL =
  'https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/' +
  'cgf-converter-v2.0.0-sc.1/cgf-converter.exe';

export const CGF_CONVERTER_SHA256 = '89d73dd2ff76070dea5fb4dd4e130b1dd1d02b1128874b0d80b0141d4d552abe';

/** File name under userData/tools — versioned, so an installed older build is never mistaken for it. */
export const CGF_CONVERTER_FILE = 'cgf-converter-2.0.0-sc.1.exe';

/** Earlier converter downloads, removed once the current one is in place (~117 MB each). */
export const CGF_CONVERTER_LEGACY_FILES: readonly string[] = ['cgf-converter-2.exe'];

export const CGF_CONVERTER_MIN_BYTES = 100_000_000; // ~117 MB self-contained .NET binary
