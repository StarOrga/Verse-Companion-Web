/**
 * "3D mit Hülle" (concept 20261117-1810 r2d1, `prototype/render3d.py`): an
 * orthographic projection of the interior inside a ghost of the hull. The
 * hull is three rings of the ship's top outline (bottom, middle, top) joined
 * by ribs; the focused deck is extruded (room floors + their tops at room
 * height), every other deck a faint floor; cargo grids are boxes, lifts glowing
 * shafts with a dot per stop, ladders dashed lines, elements icons.
 *
 * Pure: model frame in (metres, +X starboard, +Y nose, +Z up), SVG path data
 * out. The component only turns yaw / pitch / zoom and renders the result.
 */
import type { ShipDeck, ShipInterior, ShipInteriorCat, ShipInteriorGroup } from '../codex.types';
import type { HoloSilhouette } from '../holo-silhouette';
import { GROUP_OF_CAT, InteriorGlyph, InteriorPick, glyphOf } from './holo-interior';

type P2 = [number, number];

export class OrthoCam {
  private readonly cy: number;
  private readonly sy: number;
  private readonly ce: number;
  private readonly se: number;
  constructor(yawDeg: number, pitchDeg: number) {
    const yaw = (yawDeg * Math.PI) / 180;
    const pitch = (pitchDeg * Math.PI) / 180;
    this.cy = Math.cos(yaw);
    this.sy = Math.sin(yaw);
    this.ce = Math.cos(pitch);
    this.se = Math.sin(pitch);
  }
  /** Screen point (SVG units, y down) of a model point. */
  p(x: number, y: number, z: number): P2 {
    const x1 = x * this.cy - y * this.sy;
    const y1 = x * this.sy + y * this.cy;
    return [x1, -(z * this.ce + y1 * this.se)];
  }
  /** Distance from the viewer along the view axis: larger = further away. */
  depth(x: number, y: number, z: number): number {
    const y1 = x * this.sy + y * this.cy;
    return y1 * this.ce - z * this.se;
  }
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

function polyPath(cam: OrthoCam, pts: readonly P2[], z: number, close = true): string {
  if (pts.length === 0) return '';
  return 'M' + pts.map(([x, y]) => cam.p(x, y, z).map(f1).join(',')).join('L') + (close ? 'Z' : '');
}

// ── Hull outline ───────────────────────────────────────────────────────────

/** The numbers of the silhouette path's longest sub-path, as points. */
function silhouettePoints(path: string): P2[] {
  let best: P2[] = [];
  for (const sub of path.split(/(?=[Mm])/)) {
    const nums = sub.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
    const pts: P2[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.length > best.length) best = pts;
  }
  return best;
}

/** At most `max` points, evenly picked (a traced outline carries thousands). */
function decimate(pts: readonly P2[], max: number): P2[] {
  if (pts.length <= max) return [...pts];
  const step = pts.length / max;
  return Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)]);
}

/** Convex hull (monotone chain) — the ghost of a ship without a usable silhouette. */
export function convexHull(points: readonly P2[]): P2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The hull's top outline in the model frame. The silhouette is a nose-up top
 * view; its bbox spans the model frame's X/Y extent (`source.frame`), so the
 * mapping needs no guess of the traced scale. Without a frame the room
 * footprints' convex hull, padded, stands in.
 */
export function hullOutline(sil: HoloSilhouette | null, fallback: readonly P2[]): P2[] {
  const frame = sil?.source?.frame;
  if (sil && frame && sil.bbox.w > 0 && sil.bbox.h > 0) {
    const pts = silhouettePoints(sil.path);
    if (pts.length >= 3) {
      const [x0, y0] = [frame.min[0], frame.min[1]];
      const [x1, y1] = [frame.max[0], frame.max[1]];
      const out = pts.map(([vx, vy]): P2 => [
        x0 + ((vx - sil.bbox.x) / sil.bbox.w) * (x1 - x0),
        y1 - ((vy - sil.bbox.y) / sil.bbox.h) * (y1 - y0),
      ]);
      return decimate(out, 140);
    }
  }
  const hull = convexHull(fallback);
  if (hull.length < 3) return hull;
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  return hull.map(([x, y]): P2 => [cx + (x - cx) * 1.08, cy + (y - cy) * 1.04]);
}

// ── Scene ──────────────────────────────────────────────────────────────────

export interface Scene3dDeck {
  key: string;
  state: 'on' | 'ghost' | 'all';
  floor: string;
  top: string;
}
export interface Scene3dGrid {
  index: number;
  sides: string[];
  bottom: string;
  top: string;
  scu: number;
  at: P2;
  on: boolean;
}
export interface Scene3dIcon {
  index: number;
  cat: ShipInteriorCat;
  group: ShipInteriorGroup;
  glyph: InteriorGlyph;
  at: P2;
  door: boolean;
}
export interface Scene3d {
  viewBox: string;
  /** Icon radius in SVG units (a fixed share of the view). */
  r: number;
  rings: string[];
  ribs: string[];
  decks: Scene3dDeck[];
  grids: Scene3dGrid[];
  lifts: { line: string; stops: P2[] }[];
  ladders: string[];
  icons: Scene3dIcon[];
  /** Ring around the picked element. */
  picked: P2 | null;
  label: { at: P2; size: number } | null;
}

export interface Scene3dInput {
  decks: readonly ShipDeck[];
  interior: ShipInterior | null;
  silhouette: HoloSilhouette | null;
  /** The focused deck; null = every deck equal ("Alle"). */
  focus: string | null;
  groups: ReadonlySet<ShipInteriorGroup>;
  pick: InteriorPick | null;
  yaw: number;
  pitch: number;
  /** 1 = the whole ship fits; larger zooms in on the focused deck's centre. */
  zoom: number;
}

/** Floor height per deck: its own, else the median of its rooms, else stacked by order. */
export function deckFloors(decks: readonly ShipDeck[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of decks) {
    if (typeof d.floorZ === 'number') {
      out.set(d.key, d.floorZ);
      continue;
    }
    const zs = (d.rooms ?? []).map((r) => r.floorZ).filter((z): z is number => typeof z === 'number').sort((a, b) => a - b);
    out.set(d.key, zs.length ? zs[Math.floor(zs.length / 2)] : (d.order ?? 0) * 3);
  }
  return out;
}

export function buildScene3d(input: Scene3dInput): Scene3d | null {
  const decks = input.decks.filter((d) => (d.rooms ?? []).length > 0 && !d.fallback);
  const list = decks.length > 0 ? decks : input.decks.filter((d) => (d.rooms ?? []).length > 0);
  if (list.length === 0) return null;
  const cam = new OrthoCam(input.yaw, input.pitch);
  const floors = deckFloors(list);
  const zs = [...floors.values()];
  const zlo = Math.min(...zs) - 3;
  const zhi = Math.max(...zs) + 5;
  const zmid = (zlo + zhi) / 2;

  const roomPts: P2[] = list.flatMap((d) => (d.rooms ?? []).flatMap((r) => [...(r.shapes ?? []), ...(r.tris ?? [])].flat() as P2[]));
  const hull = hullOutline(input.silhouette, roomPts);
  const screen: P2[] = [];
  for (const z of [zlo, zhi]) for (const [x, y] of hull) screen.push(cam.p(x, y, z));
  for (const [x, y] of roomPts) screen.push(cam.p(x, y, zmid));

  const rings = hull.length >= 3 ? [polyPath(cam, hull, zlo), polyPath(cam, hull, zmid), polyPath(cam, hull, zhi)] : [];
  const ribs: string[] = [];
  const ribStep = Math.max(1, Math.round(hull.length / 28));
  for (let i = 0; i < hull.length; i += ribStep) {
    const [x, y] = hull[i];
    ribs.push('M' + cam.p(x, y, zlo).map(f1).join(',') + 'L' + cam.p(x, y, zhi).map(f1).join(','));
  }

  const all = input.focus === null;
  const sorted = [...list].sort((a, b) => (floors.get(a.key) ?? 0) - (floors.get(b.key) ?? 0));
  const sceneDecks: Scene3dDeck[] = sorted.map((d) => {
    const z = floors.get(d.key) ?? 0;
    const focus = !all && d.key === input.focus;
    let floor = '';
    let top = '';
    for (const r of d.rooms ?? []) {
      const fz = typeof r.floorZ === 'number' ? r.floorZ : z;
      const h = typeof r.height === 'number' && r.height > 0 ? Math.min(r.height, 6) : 2.6;
      for (const poly of [...(r.shapes ?? []), ...(r.tris ?? [])]) {
        if (poly.length < 3) continue;
        floor += polyPath(cam, poly as P2[], fz);
      }
      if (focus) for (const poly of r.shapes ?? []) if (poly.length >= 3) top += polyPath(cam, poly as P2[], fz + h);
    }
    return { key: d.key, state: all ? 'all' : focus ? 'on' : 'ghost', floor, top };
  });

  const shown = (deck: string) => all || deck === input.focus;
  const interior = input.interior;
  const grids: Scene3dGrid[] = [];
  interior?.cargoGrids.forEach((g, index) => {
    if (!shown(g.deck)) return;
    const [cx, cy, cz] = g.pos;
    const [w, l, h] = g.dims;
    const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - l / 2, y1 = cy + l / 2;
    const z0 = cz;
    const z1 = cz + h;
    const rect: P2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    const edges: [P2, P2][] = [[rect[0], rect[1]], [rect[1], rect[2]], [rect[2], rect[3]], [rect[3], rect[0]]];
    const sides = edges
      .map(([a, b]) => ({
        dep: cam.depth((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z0),
        d: 'M' + [cam.p(a[0], a[1], z0), cam.p(b[0], b[1], z0), cam.p(b[0], b[1], z1), cam.p(a[0], a[1], z1)].map((q) => q.map(f1).join(',')).join('L') + 'Z',
      }))
      .sort((a, b) => b.dep - a.dep)
      .map((s) => s.d);
    grids.push({ index, sides, bottom: polyPath(cam, rect, z0), top: polyPath(cam, rect, z1), scu: g.scu, at: cam.p(cx, cy, z1), on: input.groups.has('cargo') });
  });

  const ways = input.groups.has('ways');
  const lifts = !ways ? [] : (interior?.lifts ?? [])
    .filter((l) => l.stops.length >= 2 || all || l.decks.includes(input.focus ?? ''))
    .map((l) => {
      const lo = Math.min(...l.stops, ...(l.stops.length < 2 ? [l.stops[0] - 2.5] : []));
      const hi = Math.max(...l.stops, ...(l.stops.length < 2 ? [l.stops[0] + 2.5] : []));
      const a = cam.p(l.at[0], l.at[1], lo);
      const b = cam.p(l.at[0], l.at[1], hi);
      return { line: `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}`, stops: l.stops.map((s) => cam.p(l.at[0], l.at[1], s)) };
    });
  const ladders = !ways ? [] : (interior?.pois ?? [])
    .filter((p) => p.cat === 'ladder' || p.cat === 'stairs')
    .map((p) => {
      const span = (p.connects ?? []).map((k) => floors.get(k)).filter((z): z is number => typeof z === 'number');
      const lo = span.length >= 2 ? Math.min(...span) : p.pos[2];
      const hi = span.length >= 2 ? Math.max(...span) : p.pos[2] + 3.2;
      const a = cam.p(p.pos[0], p.pos[1], lo);
      const b = cam.p(p.pos[0], p.pos[1], hi);
      return `M${f1(a[0])},${f1(a[1])}L${f1(b[0])},${f1(b[1])}`;
    });

  const icons: Scene3dIcon[] = [];
  interior?.pois.forEach((p, index) => {
    const group = GROUP_OF_CAT[p.cat];
    if (!shown(p.deck) || !input.groups.has(group) || p.cat === 'ladder') return;
    icons.push({ index, cat: p.cat, group, glyph: glyphOf(p.cat), at: cam.p(p.pos[0], p.pos[1], p.pos[2]), door: p.cat === 'door' });
  });
  // Far icons first, so a near one is drawn over them.
  icons.sort((a, b) => {
    const pa = interior!.pois[a.index].pos;
    const pb = interior!.pois[b.index].pos;
    return cam.depth(pb[0], pb[1], pb[2]) - cam.depth(pa[0], pa[1], pa[2]);
  });

  let picked: P2 | null = null;
  if (interior && input.pick) {
    const el = input.pick.kind === 'grid' ? interior.cargoGrids[input.pick.index] : interior.pois[input.pick.index];
    if (el && shown(el.deck)) picked = cam.p(el.pos[0], el.pos[1], el.pos[2] + (input.pick.kind === 'grid' ? (el as { dims: number[] }).dims[2] : 0));
  }

  const xs = screen.map((p) => p[0]);
  const ys = screen.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 4);
  const pad = span * 0.05;
  let vb = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  const zoom = Math.max(1, Math.min(input.zoom, 8));
  if (zoom > 1) {
    // Zoom in on the focused deck's centre (the whole ship's centre under "Alle").
    const focusDeck = all ? null : list.find((d) => d.key === input.focus);
    const pts = focusDeck ? (focusDeck.rooms ?? []).flatMap((r) => [...(r.shapes ?? [])].flat() as P2[]) : [];
    const c = pts.length
      ? cam.p(pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length, floors.get(focusDeck!.key) ?? zmid)
      : ([vb.x + vb.w / 2, vb.y + vb.h / 2] as P2);
    const w = vb.w / zoom, h = vb.h / zoom;
    vb = { x: c[0] - w / 2, y: c[1] - h / 2, w, h };
  }
  const r = Math.max(vb.w, vb.h) / 110;
  let label: Scene3d['label'] = null;
  if (!all && input.focus) {
    const nose = hull.length ? hull.reduce((b, q) => (q[1] > b[1] ? q : b), hull[0]) : null;
    if (nose) label = { at: cam.p(nose[0], nose[1] + 4, floors.get(input.focus) ?? zmid), size: Math.max(vb.w, vb.h) / 45 };
  }
  return {
    viewBox: `${f1(vb.x)} ${f1(vb.y)} ${f1(vb.w)} ${f1(vb.h)}`,
    r,
    rings,
    ribs,
    decks: sceneDecks,
    grids,
    lifts,
    ladders,
    icons,
    picked,
    label,
  };
}
