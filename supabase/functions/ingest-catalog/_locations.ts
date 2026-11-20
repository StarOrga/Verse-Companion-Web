// Verse locations (codex_locations) — ingest-catalog ops `clear_locations` and
// `locations` (table: migration 20261008123750_codex_locations). The uploader
// sends the extractor's locations/<id>.json bodies (sc_extract/starmap.py);
// this pins them to the table's columns, so a grown extractor field can never
// reach the table and a malformed row never fails the batch. Pure — unit tested
// in _locations.test.mjs.
//
// Replace-per-build: the primary key is (build_id, id) and NAT_CONFLICT (the
// natural key of the entity tables) does not exist on this table. `clear_locations`
// (first chunk of a fresh phase) empties the build's rows, `locations` upserts
// on (build_id, id) — a re-ingest of the same build therefore never duplicates
// and a resumed chunk is idempotent.

/** One request stays far inside a statement budget. */
export const MAX_LOCATION_ROWS = 1000;

/** Row identity of the source: only game data the uploader read itself. */
export const LOCATION_SOURCE = 'data-uploader';

const ID_RE = /^[A-Za-z0-9_.:+-]{1,200}$/;
const FRAMES = new Set(['system', 'body']);

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Map extractor bodies to codex_locations rows. Dropped: bodies without a valid
 * id, name, type, system code or licence. The position is all-or-nothing, as the
 * table's `codex_locations_pos_complete` check demands: a frame with a missing
 * coordinate (or a coordinate without a valid frame) becomes frame = null with
 * null positions. Duplicate ids: last wins.
 */
export function parseLocations(list: unknown, buildId: string): Record<string, unknown>[] {
  if (!Array.isArray(list)) return [];
  const out = new Map<string, Record<string, unknown>>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const m = raw as Record<string, unknown>;
    const id = typeof m.id === 'string' ? m.id.trim() : '';
    const name = str(m.name, 300);
    const type = str(m.type, 60);
    const systemCode = str(m.system_code, 60);
    const license = str(m.license, 500);
    if (!ID_RE.test(id) || !name || !type || !systemCode || !license) continue;
    const x = num(m.pos_x), y = num(m.pos_y), z = num(m.pos_z);
    const placed = typeof m.frame === 'string' && FRAMES.has(m.frame) && x !== null && y !== null && z !== null;
    const attrs = m.attributes && typeof m.attributes === 'object' && !Array.isArray(m.attributes)
      ? m.attributes : {};
    const aliases = Array.isArray(m.aliases)
      ? m.aliases.map((a) => str(a, 300)).filter((a): a is string => a !== null) : [];
    out.set(id, {
      build_id: buildId,
      id,
      name,
      type,
      system_code: systemCode,
      parent_id: str(m.parent_id, 200),
      frame: placed ? m.frame : null,
      pos_x: placed ? x : null,
      pos_y: placed ? y : null,
      pos_z: placed ? z : null,
      aliases,
      attributes: attrs,
      source: LOCATION_SOURCE,
      license,
    });
  }
  return [...out.values()];
}
