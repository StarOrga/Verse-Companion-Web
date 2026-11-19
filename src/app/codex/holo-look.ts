/**
 * Concept-hologram look for the texture-free hull GLBs.
 *
 * The hulls carry geometry only (no CIG textures, Fankit rules — see
 * ship-hologram.ts). A flat PBR material on bare geometry reads as a grey
 * silhouette: the surfaces between the outline say nothing. This module draws
 * the character lines instead: one small ShaderMaterial per role (no post
 * processing) plus crease edges ({@link creaseEdges}), so panel breaks,
 * intakes and wing roots show without every triangle doing so.
 *
 * Two colours: the body (fill, scanlines, edge lines) is the app accent for
 * every ship; the accents (Fresnel rim, the glow cloud of a highlight, the lit
 * focused component) take the manufacturer's colour (holo-manufacturer.ts).
 *
 * Big hulls thin their edge lines to the coarse character edges
 * ({@link edgeDetail}): a Reclaimer with every greeble outlined is a white
 * blob, not a hologram.
 *
 * Only imported from lazy chunks (the model-viewer chunk and the asset
 * package scene), never from the initial bundle.
 */
import * as THREE from 'three';
import type { Rgb } from './holo-manufacturer';
import { HoloEdgeJob, creaseEdgeArray } from './holo-edges';
import type { HoloEdgeCompute } from './holo-edges-link';

export type { Rgb } from './holo-manufacturer';
/**
 * `part` / `quiet` / `hover` / `select` are lit bodies (fixed colours, a ghost pass
 * through the hull); `hull` / `interior` are the hologram surface; `focus` is the
 * legacy accent-lit model (kept for the landing hologram's API, unused by the package scene).
 */
export type HoloRole = 'hull' | 'part' | 'interior' | 'focus' | 'quiet' | 'hover' | 'select';

const ROLES: readonly HoloRole[] = ['hull', 'part', 'interior', 'focus', 'quiet', 'hover', 'select'];
/** Roles drawn as lit bodies (fixed colours, ghost pass through the hull). */
export const HOLO_BODY_ROLES: readonly HoloRole[] = ['part', 'quiet', 'hover', 'select'];
const isBody = (role: HoloRole) => HOLO_BODY_ROLES.includes(role);

/**
 * The one selection colour of every ship (concept 20261117-1809, "Grün", like the
 * game's selection). Same value as the CSS token `--sc-holo-select` in src/styles.scss.
 */
export const HOLO_SELECT: Rgb = [125, 255, 156];
/** Idle part body (concept d1): line `#a6eaff`, fill 36 % of `rgb(96,205,240)`. */
export const HOLO_PART_LINE: Rgb = [166, 234, 255];
export const HOLO_PART_FILL: Rgb = [96, 205, 240];
/** Hovered part: white line, fill 36 % of `rgb(196,240,255)`. */
export const HOLO_HOVER_FILL: Rgb = [196, 240, 255];
/** Parts that are not the selection while one exists: line `rgba(82,193,230,.42)`, fill 5 %. */
export const HOLO_DIM_PART: Rgb = [82, 193, 230];

export interface BodyLook {
  readonly line: Rgb;
  readonly lineAlpha: number;
  readonly fill: Rgb;
  readonly fillAlpha: number;
  /** Fresnel glow in the fill colour (the mock's box-shadow). */
  readonly glow: number;
}
export const HOLO_BODY_IDLE: BodyLook = { line: HOLO_PART_LINE, lineAlpha: 1, fill: HOLO_PART_FILL, fillAlpha: 0.36, glow: 0.55 };
// The mock's .42 is per outline; a 3D part has dozens of crease lines that add up in
// coverage, so .42 (and still .2) per line read as solid cyan on small, dense parts. .08 lands on "a third".
export const HOLO_BODY_DIM: BodyLook = { line: HOLO_DIM_PART, lineAlpha: 0.08, fill: HOLO_DIM_PART, fillAlpha: 0.05, glow: 0 };
export const HOLO_BODY_HOVER: BodyLook = { line: [255, 255, 255], lineAlpha: 1, fill: HOLO_HOVER_FILL, fillAlpha: 0.36, glow: 0.7 };
export const HOLO_BODY_SELECT: BodyLook = { line: HOLO_SELECT, lineAlpha: 1, fill: HOLO_SELECT, fillAlpha: 0.64, glow: 0.9 };
/** A part of another Einsatz: between idle and dimmed. */
export const HOLO_BODY_QUIET: BodyLook = mixBody(HOLO_BODY_IDLE, HOLO_BODY_DIM, 0.6);
/**
 * Strength of a body where the hull (or another part) is in front of it: the ghost
 * pass (depthFunc GreaterDepth). Quieter than the visible body; the selection stays
 * readable through the hull.
 */
export const HOLO_GHOST: Readonly<Record<'part' | 'quiet' | 'hover' | 'select', number>> = {
  part: 0.5,
  quiet: 0.4,
  hover: 0.7,
  select: 1,
};

export function mixBody(a: BodyLook, b: BodyLook, t: number): BodyLook {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    line: [m(a.line[0], b.line[0]), m(a.line[1], b.line[1]), m(a.line[2], b.line[2])],
    lineAlpha: m(a.lineAlpha, b.lineAlpha),
    fill: [m(a.fill[0], b.fill[0]), m(a.fill[1], b.fill[1]), m(a.fill[2], b.fill[2])],
    fillAlpha: m(a.fillAlpha, b.fillAlpha),
    glow: m(a.glow, b.glow),
  };
}

/** Crease angle for panel/character lines on a normal-sized hull: below it a seam is "smooth surface". */
export const HOLO_CREASE_DEG = 30;
/** Crease angle the biggest hulls reach: only the coarse character edges remain. */
export const HOLO_CREASE_DEG_MAX = 60;
/** Above this many triangles a geometry gets no edge lines (EdgesGeometry is O(n) with a hash per edge). */
export const HOLO_EDGE_MAX_TRIANGLES = 1_200_000;
/** Focus points the shader can glow at once. */
export const HOLO_MAX_FOCUS = 4;
/** Strength of the fine static scanlines (the concept study had 0.05 — kept, but quieter). */
export const HOLO_SCANLINES = 0.022;
/**
 * Strength of the slow sweep band (concept study: 0.32). Subtle: the band must
 * not light a whole flat hull panel (brightness would swing with the angle).
 */
export const HOLO_SWEEP = 0.08;
/** Opacity of the hull's crease lines (concept d1: `rgba(82,193,230,.46)`). */
export const HOLO_EDGE_OPACITY = 0.46;

// Highlight tuning, in one place so the look can be A/B-compared by editing a
// number. There is no see-through any more (concept 20261117-1809, C1): a hover
// or a selection never makes the hull translucent; the parts carry the highlight.
// The mock's hull drop (.46 → .30 per line) does not carry on a wireframe with
// thousands of crease lines (coverage saturates), so the factors are stronger:
// the hull's mean luminance on ANVL_Valkyrie falls by about 40 % (w1b shots).
/** Fill colour factor of the hull while a selection exists (1 = no dimming). */
export const HOLO_DIM_FILL = 0.55;
/** Crease-line colour factor of the hull while a selection exists. */
export const HOLO_DIM_EDGE_COLOR = 0.9;
/** Crease-line alpha factor of the hull while a selection exists: `.46` → about `.29` (with the colour factor about 40 % less light). */
export const HOLO_DIM_EDGE_ALPHA = 0.62;
/** Width of the selected part's green silhouette, CSS px. */
export const HOLO_OUTLINE_PX = 2;
/** Mark on the outline kit (stencil mask + offset copies) of a selected body. */
export const HOLO_OUTLINE_FLAG = 'holoOutline';
const OUTLINE_DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071],
];
/** Render order of the outline: after the hull, the ghosts and the selected body. */
const ORDER_OUTLINE = 30;

// Silhouette outline: the mesh drawn again, shifted by a few pixels in clip
// space in 8 directions, only where the stencil mask of the unshifted mesh is
// not set. Screen-space, so it needs no reliable normals (the stripped exports
// have none) and stays 2 px wide at any zoom; depth test off, so it reads
// through the hull too.
const OUTLINE_VERTEX = /* glsl */ `
uniform vec2 uOffset;
uniform vec2 uViewport;
uniform float uPx;
void main() {
  vec4 local = vec4(position, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif
  vec4 clip = projectionMatrix * modelViewMatrix * local;
  clip.xy += uOffset * uPx * 2.0 / uViewport * clip.w;
  gl_Position = clip;
}
`;
const OUTLINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
}
`;
/** Brightness of a part that is not relevant to the picked Einsatz (`part` is 1.1). */
export const HOLO_QUIET_LEVEL = 0.42;
/** Crease-line factor of such a part. */
export const HOLO_QUIET_EDGE = 0.4;
/** Duration of the opacity / dim change when the focus switches on or off, seconds. */
export const HOLO_TWEEN_S = 0.14;

export interface EdgeDetail {
  /** Crease angle (degrees). */
  readonly creaseDeg: number;
  /**
   * A crease draws only when one of its triangles has this area (world units
   * squared): the greebles of a big hull — small triangles only — drop out.
   */
  readonly minArea: number;
  /** 0 = full detail (fighter) … 1 = coarsest (capital hull). */
  readonly thinning: number;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * How much line detail a hull of `extent` (largest bounding-box side, metres)
 * and `triangles` keeps. A fighter keeps every crease line; from ~40 m or
 * ~160 k triangles on the lines thin out, reaching the coarsest character
 * edges at ~150 m or ~1.6 M triangles.
 */
export function edgeDetail(extent: number, triangles: number): EdgeDetail {
  const bySize = clamp01((extent - 40) / 110);
  const byTris = clamp01((Math.log10(Math.max(triangles, 1)) - 5.2) / 1.0);
  const t = Math.max(bySize, byTris);
  return {
    creaseDeg: HOLO_CREASE_DEG + (HOLO_CREASE_DEG_MAX - HOLO_CREASE_DEG) * t,
    minArea: (Math.max(extent, 0) * 0.012 * t) ** 2,
    thinning: t,
  };
}

/** Full detail: parts, focused components, anything not fitted. */
export const FULL_DETAIL: EdgeDetail = { creaseDeg: HOLO_CREASE_DEG, minArea: 0, thinning: 0 };

/** Triangles of every mesh under `root`. */
export function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh).geometry : null;
    if (g) n += trianglesOf(g);
  });
  return n;
}

function trianglesOf(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
}

// Normals come from screen-space derivatives of the view position, not from
// the normal attribute: the stripped hull exports carry unreliable normals
// (mirrored parts, quantised or missing), which lit whole panels as rim.
// Faceted shading also suits a concept model — every panel reads as a plane.
const VERTEX = /* glsl */ `
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vec4 local = vec4(position, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif
  vec4 world = modelMatrix * local;
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const EDGE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 local = vec4(position, 1.0);
#ifdef USE_INSTANCING
  local = instanceMatrix * local;
#endif
  vec4 world = modelMatrix * local;
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FOCUS_CHUNK = /* glsl */ `
uniform vec3 uFocus[${HOLO_MAX_FOCUS}];
uniform int uFocusCount;
uniform float uFocusRadius;
float focusMask() {
  float f = 0.0;
  for (int i = 0; i < ${HOLO_MAX_FOCUS}; i++) {
    if (i >= uFocusCount) break;
    float d = distance(vWorld, uFocus[i]);
    f = max(f, 1.0 - smoothstep(uFocusRadius * 0.3, uFocusRadius, d));
  }
  return f;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform vec3 uAccent;
uniform float uLevel;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
uniform float uTime;
uniform float uScan;
uniform float uScale;
uniform float uLines;
uniform float uSweep;
varying vec3 vViewPos;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  float rim = pow(1.0 - ndv, 4.0);
  float up = N.y * 0.5 + 0.5;
  // Body in the app accent: a faint fill, fine static scanlines and one slow
  // sweep band. The facing / height grading is held to a narrow range, so a
  // dense, steep side (a Valkyrie's underside) reads as bright as a flat top.
  float y = vWorld.y * uScale;
  float lines = smoothstep(0.55, 1.0, sin(y * 520.0)) * uLines;
  float band = fract(y * 0.8 - uTime * 0.05);
  float sweep = smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.14, band)) * uScan;
  vec3 col = uTint * (0.058 + 0.034 * ndv * (0.6 + 0.4 * up));
  col += uTint * (lines + sweep * uSweep) * 0.7;
  // A soft Fresnel rim in the body colour; the grazing fringe of it in the
  // manufacturer's accent. Kept narrow and quiet: many grazing facets must not
  // add up to a bright side.
  col += mix(uTint, vec3(1.0), 0.25) * rim * 0.28;
  float fringe = smoothstep(0.85, 0.98, 1.0 - ndv);
  col += mix(uAccent, vec3(1.0), 0.15) * fringe * 0.4;
  col *= uLevel;
  // Highlight: everything else dims, a glow cloud lights the hull around the
  // focus points, a focused component renders as a lit model in the accent.
  float fm = focusMask();
  col *= mix(1.0, ${HOLO_DIM_FILL.toFixed(3)}, uDim * (1.0 - max(fm, uGlow)));
  vec3 cloud = mix(uAccent, vec3(1.0), 0.3) * (0.55 + 0.35 * ndv + 0.9 * fres);
  col = mix(col, cloud, fm * 0.85 * (1.0 - uGlow));
  vec3 lit = uAccent * (0.22 + 0.78 * ndv * (0.4 + 0.6 * up));
  lit += mix(uAccent, vec3(1.0), 0.55) * rim * 1.1;
  col = mix(col, lit, uGlow);
  // Alpha is only the x-ray opacity: the canvas composites premultiplied, so
  // a partial alpha on an opaque pass would wash the colour out to white.
  // The glow cloud stays visible on an x-rayed hull.
  gl_FragColor = vec4(col, max(uOpacity, fm * 0.7 * (1.0 - uGlow)));
}
`;

const EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform float uOpacity;
uniform float uDim;
uniform float uGlow;
varying vec3 vWorld;
${FOCUS_CHUNK}
void main() {
  float fm = max(focusMask(), uGlow);
  vec3 c = uColor * mix(1.0, ${HOLO_DIM_EDGE_COLOR.toFixed(3)}, uDim * (1.0 - fm));
  c = mix(c, mix(uAccent, vec3(1.0), 0.5), fm);
  float a = uOpacity * mix(1.0, ${HOLO_DIM_EDGE_ALPHA.toFixed(3)}, uDim * (1.0 - fm));
  gl_FragColor = vec4(c, mix(a, 1.0, fm));
}
`;

// Lit bodies (clickable parts): a flat fill in the body colour plus a Fresnel
// glow. The main pass is opaque (over the dark stage the mock's 36 % fill is
// colour × alpha); the ghost pass (uGhost > 0, depthFunc GreaterDepth) only
// draws where something is in front and blends over it.
const BODY_FRAGMENT = /* glsl */ `
uniform vec3 uBodyColor;
uniform float uBodyAlpha;
uniform float uGlowAmt;
uniform float uGhost;
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vec3 N = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  vec3 V = normalize(-vViewPos);
  if (dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.0);
  vec3 glow = mix(uBodyColor, vec3(1.0), 0.25) * rim * uGlowAmt * 0.55;
  if (uGhost > 0.0) {
    gl_FragColor = vec4(uBodyColor * (0.85 + 0.15 * ndv) + glow, clamp((uBodyAlpha + rim * uGlowAmt * 0.25) * uGhost, 0.0, 1.0));
    return;
  }
  gl_FragColor = vec4(uBodyColor * uBodyAlpha * (0.8 + 0.25 * ndv) + glow, 1.0);
}
`;

const BODY_EDGE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uGhostMul;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * uGhostMul);
}
`;

const ROLE_LEVEL: Record<HoloRole, number> = {
  hull: 1,
  part: 1.1,
  interior: 0.6,
  focus: 1,
  quiet: HOLO_QUIET_LEVEL,
  hover: 1,
  select: 1,
};
/** Crease-line opacity per role: the interior and quiet parts recede. */
const edgeOpacity = (role: HoloRole) => HOLO_EDGE_OPACITY * (role === 'interior' ? 0.5 : role === 'quiet' ? HOLO_QUIET_EDGE : 1);

/** Mark on a LineSegments child this module added. */
const EDGE_FLAG = 'holoEdges';
/** Mark on the ghost children (fill mesh, edge lines) of a lit body. */
export const HOLO_GHOST_FLAG = 'holoGhost';
/** Render order of a body's ghost pass per role (after the hull; the selection last). */
const GHOST_ORDER: Readonly<Record<string, number>> = { part: 2, quiet: 2, hover: 6, select: 8 };

/** A value that eases to its target over {@link HOLO_TWEEN_S}; the start time is taken from the first tick (on-demand renders can be seconds apart). */
class Eased {
  value: number;
  private from: number;
  private to: number;
  private start: number | null = null;
  private running = false;

  constructor(v: number) {
    this.value = this.from = this.to = v;
  }

  get target(): number {
    return this.to;
  }

  get active(): boolean {
    return this.running;
  }

  set(to: number, animate: boolean): void {
    if (to === this.to && (this.running || this.value === to)) return;
    this.to = to;
    if (!animate) {
      this.value = this.from = to;
      this.running = false;
      this.start = null;
      return;
    }
    this.from = this.value;
    this.start = null;
    this.running = true;
  }

  /** Advance to `seconds`; true while still moving. */
  step(seconds: number): boolean {
    if (!this.running) return false;
    this.start ??= seconds;
    const p = clamp01((seconds - this.start) / HOLO_TWEEN_S);
    const e = p * p * (3 - 2 * p);
    this.value = this.from + (this.to - this.from) * e;
    if (p >= 1) {
      this.value = this.to;
      this.running = false;
    }
    return this.running;
  }
}

const toColor = (c: Rgb) => new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);

type BodyRole = 'part' | 'quiet' | 'hover' | 'select';

export class HoloLook {
  /** Animated scan running (off with reduced motion). */
  readonly animated: boolean;
  private readonly tint: THREE.Color;
  private readonly accentColor: THREE.Color;
  private readonly fills = new Map<HoloRole, THREE.ShaderMaterial>();
  private readonly lines = new Map<HoloRole, THREE.ShaderMaterial>();
  /** Ghost pass of the body roles (where the hull or another part is in front). */
  private readonly ghostFills = new Map<HoloRole, THREE.ShaderMaterial>();
  private readonly ghostLines = new Map<HoloRole, THREE.ShaderMaterial>();
  /** source geometry → its crease edges; computed once, disposed with the look. */
  private readonly edgeCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry | null>();
  /** Edges in flight from {@link dressAsync}, per source geometry. */
  private readonly edgeJobs = new Map<THREE.BufferGeometry, Promise<THREE.BufferGeometry | null>>();
  private disposed = false;
  /** Line detail of the fitted hull (hull + interior roles). */
  private hullDetail: EdgeDetail = FULL_DETAIL;
  private readonly easeDim = new Eased(0);
  /** Hover / select looks ease in from the part look when a part takes them. */
  private readonly easeHover = new Eased(1);
  private readonly easeSelect = new Eased(1);
  private readonly easeOpacity = new Map<HoloRole, Eased>(ROLES.map((r) => [r, new Eased(1)]));
  /** Focus / x-ray changes ease in (off: they apply instantly, as the legacy viewer expects). */
  private readonly tweenFocus: boolean;
  // Uniform objects shared by every material, so one write reaches all roles.
  private readonly shared = {
    uDim: { value: 0 },
    uTime: { value: 0 },
    uScan: { value: 0 },
    uScale: { value: 1 },
    uFocus: { value: Array.from({ length: HOLO_MAX_FOCUS }, () => new THREE.Vector3()) },
    uFocusCount: { value: 0 },
    uFocusRadius: { value: 1 },
  };
  private readonly outlineViewport = { value: new THREE.Vector2(1, 1) };
  private readonly outlinePx = { value: HOLO_OUTLINE_PX };
  private readonly outlineMats: THREE.ShaderMaterial[] = [];
  /** Body uniforms per body role, shared by its main and ghost materials. */
  private readonly body = new Map<HoloRole, { color: { value: THREE.Color }; alpha: { value: number }; glow: { value: number }; line: { value: THREE.Color }; lineAlpha: { value: number } }>();

  /**
   * @param base   body colour (the app accent, same for every ship)
   * @param accent manufacturer accent (rim fringe; the legacy focus model)
   * @param tweenFocus ease dim / hover / select over {@link HOLO_TWEEN_S}; the caller must keep
   *        rendering while {@link tweening} (never with reduced motion: instant there)
   */
  constructor(base: Rgb, accent: Rgb, reducedMotion: boolean, tweenFocus = false) {
    this.animated = !reducedMotion;
    this.tweenFocus = tweenFocus && !reducedMotion;
    this.shared.uScan.value = this.animated ? 1 : 0;
    this.tint = toColor(base);
    this.accentColor = toColor(accent);
    for (const role of ROLES) {
      if (isBody(role)) {
        this.makeBody(role);
        continue;
      }
      const focus = role === 'focus';
      const fill = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          ...this.shared,
          uTint: { value: this.tint.clone() },
          uAccent: { value: this.accentColor.clone() },
          uLevel: { value: ROLE_LEVEL[role] },
          uOpacity: { value: 1 },
          uGlow: { value: focus ? 1 : 0 },
          uLines: { value: HOLO_SCANLINES },
          uSweep: { value: HOLO_SWEEP },
        },
        side: THREE.DoubleSide,
        // Opaque: a translucent hull over its own interior surfaces adds up
        // to a white blob and needs sorting. The legacy focus model sits in the
        // transparent pass (alpha 1, depth written).
        transparent: focus,
        depthWrite: true,
        // Pushed back a hair so the crease lines draw on top without z-fighting.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        toneMapped: false,
      });
      const line = new THREE.ShaderMaterial({
        vertexShader: EDGE_VERTEX,
        fragmentShader: EDGE_FRAGMENT,
        uniforms: {
          uDim: this.shared.uDim,
          uFocus: this.shared.uFocus,
          uFocusCount: this.shared.uFocusCount,
          uFocusRadius: this.shared.uFocusRadius,
          // The hull lines are the body colour itself (concept d1: rgba(82,193,230,.46)).
          uColor: { value: focus ? this.tint.clone().lerp(new THREE.Color(1, 1, 1), 0.3) : this.tint.clone() },
          uAccent: { value: this.accentColor.clone() },
          uOpacity: { value: edgeOpacity(role) },
          uGlow: { value: focus ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        // Lines blend over, never add up: a side dense with creases (the
        // Valkyrie's underside) must not read several times brighter than a sparse one.
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
      this.fills.set(role, fill);
      this.lines.set(role, line);
    }
    this.applyBody();
  }

  private makeBody(role: HoloRole): void {
    const u = {
      color: { value: new THREE.Color() },
      alpha: { value: 0 },
      glow: { value: 0 },
      line: { value: new THREE.Color() },
      lineAlpha: { value: 1 },
    };
    this.body.set(role, u);
    const fill = (ghost: number) =>
      new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: BODY_FRAGMENT,
        uniforms: { uBodyColor: u.color, uBodyAlpha: u.alpha, uGlowAmt: u.glow, uGhost: { value: ghost } },
        side: THREE.DoubleSide,
        transparent: ghost > 0,
        depthWrite: ghost === 0,
        depthFunc: ghost > 0 ? THREE.GreaterDepth : THREE.LessEqualDepth,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        toneMapped: false,
      });
    const line = (ghost: number) =>
      new THREE.ShaderMaterial({
        vertexShader: EDGE_VERTEX,
        fragmentShader: BODY_EDGE_FRAGMENT,
        uniforms: { uColor: u.line, uAlpha: u.lineAlpha, uGhostMul: { value: ghost || 1 } },
        transparent: true,
        depthWrite: false,
        depthFunc: ghost > 0 ? THREE.GreaterDepth : THREE.LessEqualDepth,
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
    const g = HOLO_GHOST[role as BodyRole];
    this.fills.set(role, fill(0));
    this.lines.set(role, line(0));
    this.ghostFills.set(role, fill(g));
    this.ghostLines.set(role, line(g));
  }

  /** Write the body uniforms from the eased dim / hover / select state. */
  private applyBody(): void {
    const d = this.easeDim.value;
    const part = mixBody(HOLO_BODY_IDLE, HOLO_BODY_DIM, d);
    const looks: Record<BodyRole, BodyLook> = {
      part,
      quiet: mixBody(HOLO_BODY_QUIET, HOLO_BODY_DIM, d),
      hover: mixBody(part, HOLO_BODY_HOVER, this.easeHover.value),
      select: mixBody(part, HOLO_BODY_SELECT, this.easeSelect.value),
    };
    for (const [role, u] of this.body) {
      const l = looks[role as BodyRole];
      u.color.value.setRGB(l.fill[0] / 255, l.fill[1] / 255, l.fill[2] / 255);
      u.alpha.value = l.fillAlpha;
      u.glow.value = l.glow;
      u.line.value.setRGB(l.line[0] / 255, l.line[1] / 255, l.line[2] / 255);
      u.lineAlpha.value = l.lineAlpha;
    }
  }

  fill(role: HoloRole): THREE.ShaderMaterial {
    return this.fills.get(role)!;
  }

  line(role: HoloRole): THREE.ShaderMaterial {
    return this.lines.get(role)!;
  }

  /** Ghost pass of a body role (drawn only where something is in front); undefined for hull roles. */
  ghostFill(role: HoloRole): THREE.ShaderMaterial | undefined {
    return this.ghostFills.get(role);
  }

  ghostLine(role: HoloRole): THREE.ShaderMaterial | undefined {
    return this.ghostLines.get(role);
  }

  /** The manufacturer accent as a three colour (for markers the scene draws itself). */
  get accent(): THREE.Color {
    return this.accentColor.clone();
  }

  /** Line detail the hull roles use (set by {@link fit}). */
  get detail(): EdgeDetail {
    return this.hullDetail;
  }

  /** Number of geometries whose edges were computed (cache size). */
  get edgeCacheSize(): number {
    return this.edgeCache.size;
  }

  /**
   * Crease edges of `geometry` at `detail`, computed on first request and
   * cached. `worldScale` converts the detail's world-space minimum area into
   * the geometry's own units.
   */
  edgesFor(geometry: THREE.BufferGeometry, detail: EdgeDetail = FULL_DETAIL, worldScale = 1): THREE.BufferGeometry | null {
    if (this.edgeCache.has(geometry)) return this.edgeCache.get(geometry) ?? null;
    const tris = trianglesOf(geometry);
    const s = worldScale > 0 ? worldScale : 1;
    const edges =
      tris > 0 && tris <= HOLO_EDGE_MAX_TRIANGLES ? creaseEdges(geometry, detail.creaseDeg, detail.minArea / (s * s)) : null;
    this.edgeCache.set(geometry, edges);
    return edges;
  }

  /**
   * Fill the edge cache for every mesh under `root` with edges computed by `compute` (the edge
   * worker), so a following {@link dress} finds them cached and computes nothing in its frame.
   * Same detail and scale rule as `dress`; a geometry already cached or in flight is skipped.
   */
  prepareEdges(root: THREE.Object3D, role: HoloRole, compute: HoloEdgeCompute): Promise<void> {
    const detail = role === 'hull' || role === 'interior' ? this.hullDetail : FULL_DETAIL;
    if (detail.minArea > 0) root.updateWorldMatrix(true, true);
    const jobs: Promise<unknown>[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.userData[HOLO_GHOST_FLAG] || o.userData[HOLO_OUTLINE_FLAG]) return;
      const geometry = mesh.geometry;
      if (this.edgeCache.has(geometry)) return;
      let edges = this.edgeJobs.get(geometry);
      if (!edges) {
        const scale = detail.minArea > 0 ? mesh.matrixWorld.getMaxScaleOnAxis() || 1 : 1;
        const tris = trianglesOf(geometry);
        edges =
          tris > 0 && tris <= HOLO_EDGE_MAX_TRIANGLES
            ? compute(edgeJobOf(geometry, detail.creaseDeg, detail.minArea / (scale * scale))).then((arr) => {
                if (this.disposed) return null;
                // No edges from the worker: cache the miss, so dress() does not compute them here.
                if (!arr) {
                  this.edgeCache.set(geometry, null);
                  return null;
                }
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
                this.edgeCache.set(geometry, g);
                return g;
              })
            : Promise.resolve(null);
        this.edgeJobs.set(geometry, edges);
      }
      jobs.push(edges);
    });
    return Promise.all(jobs).then(() => undefined);
  }

  /**
   * Put every mesh under `root` into `role`: swap its material for the look's
   * fill and give it one crease-edge child. A body role also gets its ghost
   * children (fill + lines through the hull). Re-dressing an already dressed
   * mesh only swaps materials (the children are reused). Hull and interior
   * use the fitted line detail, parts keep every crease.
   */
  dress(root: THREE.Object3D, role: HoloRole, accept: (mesh: THREE.Mesh) => boolean = () => true): void {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData[HOLO_GHOST_FLAG] && !o.userData[HOLO_OUTLINE_FLAG] && accept(o as THREE.Mesh)) {
        meshes.push(o as THREE.Mesh);
      }
    });
    const detail = role === 'hull' || role === 'interior' ? this.hullDetail : FULL_DETAIL;
    if (detail.minArea > 0) root.updateWorldMatrix(true, true);
    for (const mesh of meshes) {
      mesh.material = this.fill(role);
      let edge = mesh.children.find((c) => c.userData[EDGE_FLAG] && !c.userData[HOLO_GHOST_FLAG]) as THREE.LineSegments | undefined;
      if (!edge) {
        const scale = detail.minArea > 0 ? mesh.matrixWorld.getMaxScaleOnAxis() : 1;
        const geo = this.edgesFor(mesh.geometry, detail, scale);
        if (geo) {
          edge = new THREE.LineSegments(geo, this.line(role));
          edge.userData[EDGE_FLAG] = true;
          edge.raycast = () => undefined;
          edge.matrixAutoUpdate = false;
          mesh.add(edge);
        }
      }
      if (edge) edge.material = this.line(role);
      if (isBody(role) && !mesh.children.some((c) => c.userData[HOLO_GHOST_FLAG])) {
        const ghost = new THREE.Mesh(mesh.geometry, this.ghostFill(role));
        ghost.userData[HOLO_GHOST_FLAG] = true;
        ghost.raycast = () => undefined;
        ghost.matrixAutoUpdate = false;
        mesh.add(ghost);
        if (edge) {
          const gl = new THREE.LineSegments(edge.geometry, this.ghostLine(role));
          gl.userData[EDGE_FLAG] = true;
          gl.userData[HOLO_GHOST_FLAG] = true;
          gl.raycast = () => undefined;
          gl.matrixAutoUpdate = false;
          mesh.add(gl);
        }
      }
      for (const g of mesh.children) {
        if (!g.userData[HOLO_GHOST_FLAG]) continue;
        g.visible = isBody(role);
        if (!g.visible) continue;
        const isLine = !!g.userData[EDGE_FLAG];
        (g as THREE.Mesh).material = isLine ? this.ghostLine(role)! : this.ghostFill(role)!;
        g.renderOrder = (GHOST_ORDER[role] ?? 2) + (isLine ? 1 : 0);
      }
    }
  }

  /**
   * {@link dress} with the crease edges computed by `compute` (the edge worker): the fill
   * materials are on at once, each mesh's edge child follows when its edges arrive, then
   * `onEdges` runs (queue a render). A look disposed in the meantime adds nothing.
   * Hull roles only (no ghost pass).
   */
  dressAsync(
    root: THREE.Object3D,
    role: HoloRole,
    compute: HoloEdgeCompute,
    onEdges: () => void,
    accept: (mesh: THREE.Mesh) => boolean = () => true,
  ): Promise<void> {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && accept(o as THREE.Mesh)) meshes.push(o as THREE.Mesh);
    });
    const detail = role === 'hull' || role === 'interior' ? this.hullDetail : FULL_DETAIL;
    if (detail.minArea > 0) root.updateWorldMatrix(true, true);
    const jobs: Promise<void>[] = [];
    for (const mesh of meshes) {
      mesh.material = this.fill(role);
      if (mesh.children.some((c) => c.userData[EDGE_FLAG])) continue;
      const geometry = mesh.geometry;
      const scale = detail.minArea > 0 ? mesh.matrixWorld.getMaxScaleOnAxis() || 1 : 1;
      let edges = this.edgeJobs.get(geometry);
      if (!edges) {
        const tris = trianglesOf(geometry);
        edges =
          tris > 0 && tris <= HOLO_EDGE_MAX_TRIANGLES
            ? compute(edgeJobOf(geometry, detail.creaseDeg, detail.minArea / (scale * scale))).then((arr) => {
                if (this.disposed || !arr) return null;
                const g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
                this.edgeCache.set(geometry, g);
                return g;
              })
            : Promise.resolve(null);
        this.edgeJobs.set(geometry, edges);
      }
      jobs.push(
        edges.then((geo) => {
          if (!geo || this.disposed || mesh.children.some((c) => c.userData[EDGE_FLAG])) return;
          const edge = new THREE.LineSegments(geo, this.line(role));
          edge.userData[EDGE_FLAG] = true;
          edge.raycast = () => undefined;
          edge.matrixAutoUpdate = false;
          // The role may have changed while the edges were computed (focus): follow the fill.
          edge.renderOrder = mesh.renderOrder + 1;
          mesh.add(edge);
        }),
      );
    }
    return Promise.all(jobs).then(() => {
      if (!this.disposed) onEdges();
    });
  }

  /** Swap materials of an already dressed subtree (role change: hover, select, quiet). */
  setRole(root: THREE.Object3D, role: HoloRole, renderOrder = 0): void {
    const body = isBody(role);
    const ghostOrder = GHOST_ORDER[role] ?? 2;
    root.traverse((o) => {
      if (o.userData[HOLO_OUTLINE_FLAG]) return;
      const ghost = !!o.userData[HOLO_GHOST_FLAG];
      if (ghost) {
        o.visible = body;
        if (!body) return;
        const edge = !!o.userData[EDGE_FLAG];
        (o as THREE.Mesh).material = edge ? this.ghostLine(role)! : this.ghostFill(role)!;
        o.renderOrder = ghostOrder + (edge ? 1 : 0);
      } else if ((o as THREE.Mesh).isMesh) {
        (o as THREE.Mesh).material = this.fill(role);
        o.renderOrder = renderOrder;
      } else if (o.userData[EDGE_FLAG]) {
        (o as THREE.LineSegments).material = this.line(role);
        o.renderOrder = renderOrder + 1;
      }
    });
  }

  /** Drawing-buffer size the outline offsets are measured in; call on every resize. */
  setViewport(width: number, height: number, pixelRatio = 1): void {
    this.outlineViewport.value.set(Math.max(width * pixelRatio, 1), Math.max(height * pixelRatio, 1));
    this.outlinePx.value = HOLO_OUTLINE_PX * pixelRatio;
  }

  /**
   * The green silhouette (HOLO_OUTLINE_PX wide) around every body mesh under
   * `root`, on or off. Built on first use per mesh and kept hidden afterwards.
   * Needs a renderer with a stencil buffer.
   */
  setOutline(root: THREE.Object3D, on: boolean): void {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !o.userData[HOLO_GHOST_FLAG] && !o.userData[HOLO_OUTLINE_FLAG]) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      let kit = mesh.children.find((c) => c.userData[HOLO_OUTLINE_FLAG]);
      if (!kit && on) {
        kit = new THREE.Group();
        kit.userData[HOLO_OUTLINE_FLAG] = true;
        kit.matrixAutoUpdate = false;
        const mats = this.outlineMaterials();
        mats.forEach((mat, i) => {
          const m = new THREE.Mesh(mesh.geometry, mat);
          m.userData[HOLO_OUTLINE_FLAG] = true;
          m.raycast = () => undefined;
          m.matrixAutoUpdate = false;
          m.renderOrder = ORDER_OUTLINE + (i === 0 ? 0 : 1);
          kit!.add(m);
        });
        mesh.add(kit);
      }
      if (kit) kit.visible = on;
    }
  }

  /** [stencil mask, 8 shifted copies], created once. */
  private outlineMaterials(): THREE.ShaderMaterial[] {
    if (this.outlineMats.length) return this.outlineMats;
    const color = { value: new THREE.Color(HOLO_SELECT[0] / 255, HOLO_SELECT[1] / 255, HOLO_SELECT[2] / 255) };
    const make = (offset: readonly [number, number], mask: boolean) =>
      new THREE.ShaderMaterial({
        vertexShader: OUTLINE_VERTEX,
        fragmentShader: OUTLINE_FRAGMENT,
        uniforms: {
          uOffset: { value: new THREE.Vector2(offset[0], offset[1]) },
          uViewport: this.outlineViewport,
          uPx: this.outlinePx,
          uColor: color,
        },
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        colorWrite: !mask,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: mask ? THREE.AlwaysStencilFunc : THREE.NotEqualStencilFunc,
        stencilZPass: mask ? THREE.ReplaceStencilOp : THREE.KeepStencilOp,
        toneMapped: false,
      });
    this.outlineMats.push(make([0, 0], true), ...OUTLINE_DIRS.map((d) => make(d, false)));
    return this.outlineMats;
  }

  /**
   * Scale scan density, focus radius and the hull's line detail to the model
   * (its world bounding box and triangle count). Call before dressing the hull.
   */
  fit(box: THREE.Box3, triangles = 0): void {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 1e-3);
    this.shared.uScale.value = 1 / extent;
    this.shared.uFocusRadius.value = extent * 0.07;
    this.hullDetail = edgeDetail(extent, triangles);
  }

  /** World radius of the glow cloud / slot ring (after {@link fit}). */
  get focusRadius(): number {
    return this.shared.uFocusRadius.value;
  }

  /**
   * Overall opacity of a hull role (the interior layer the user switches on);
   * the fill turns transparent below 1. Body roles stay opaque (no-op).
   */
  setOpacity(role: HoloRole, opacity: number): void {
    if (isBody(role)) return;
    this.easeOpacity.get(role)!.set(opacity, this.tweenFocus);
    this.applyOpacity(role);
  }

  private applyOpacity(role: HoloRole): void {
    const ease = this.easeOpacity.get(role)!;
    const opacity = ease.value;
    const fill = this.fill(role);
    fill.uniforms['uOpacity'].value = opacity;
    // Transparent from the first frame of a fade-out to the last of a fade-in,
    // so the pass flip never lands mid-fade.
    const transparent = role === 'focus' || opacity < 1 || ease.target < 1;
    if (fill.transparent !== transparent) {
      fill.transparent = transparent;
      fill.depthWrite = role === 'focus' || !transparent;
      fill.needsUpdate = true;
    }
    // Lines keep a floor so a glassy hull still reads as a wireframe.
    this.line(role).uniforms['uOpacity'].value = edgeOpacity(role) * Math.max(opacity, 0.45);
  }

  /** A selection exists: the hull lines and the other parts drop to about a third. */
  setDim(dim: boolean): void {
    this.easeDim.set(dim ? 1 : 0, this.tweenFocus);
    this.shared.uDim.value = this.easeDim.value;
    this.applyBody();
  }

  /** A part just took the hover / select look: ease it in from the part look (instant with reduced motion). */
  easeIn(role: 'hover' | 'select'): void {
    const e = role === 'hover' ? this.easeHover : this.easeSelect;
    if (!this.tweenFocus) return;
    e.set(0, false);
    e.set(1, true);
    this.applyBody();
  }

  /** A dim / opacity / hover / select change is still easing: keep rendering. */
  get tweening(): boolean {
    if (this.easeDim.active || this.easeHover.active || this.easeSelect.active) return true;
    for (const e of this.easeOpacity.values()) if (e.active) return true;
    return false;
  }

  get dimmed(): boolean {
    return this.shared.uDim.value > 0;
  }

  /** World-space points the hull glows around (legacy glow cloud); empty clears. */
  setFocusPoints(points: readonly THREE.Vector3[]): void {
    const n = Math.min(points.length, HOLO_MAX_FOCUS);
    for (let i = 0; i < n; i++) this.shared.uFocus.value[i].copy(points[i]);
    this.shared.uFocusCount.value = n;
  }

  get focusCount(): number {
    return this.shared.uFocusCount.value;
  }

  /** Advance the scan and any running tween (seconds). Scan: a no-op when the look is not animated. */
  tick(seconds: number): void {
    if (this.animated) this.shared.uTime.value = seconds;
    if (!this.tweening) return;
    if (this.easeDim.active || this.easeHover.active || this.easeSelect.active) {
      this.easeDim.step(seconds);
      this.easeHover.step(seconds);
      this.easeSelect.step(seconds);
      this.shared.uDim.value = this.easeDim.value;
      this.applyBody();
    }
    for (const [role, e] of this.easeOpacity) {
      if (!e.active) continue;
      e.step(seconds);
      this.applyOpacity(role);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.edgeJobs.clear();
    for (const map of [this.fills, this.lines, this.ghostFills, this.ghostLines]) for (const m of map.values()) m.dispose();
    for (const m of this.outlineMats) m.dispose();
    for (const g of this.edgeCache.values()) g?.dispose();
    this.edgeCache.clear();
  }
}

/**
 * THREE.EdgesGeometry plus a size gate: a crease edge only draws when at least
 * one of its two triangles has `minArea` (geometry units squared). Greebles —
 * crease edges between small triangles only — drop out; a long character edge
 * keeps every one of its segments, because a big panel borders it. (A plain
 * segment-length filter would dash those edges: they are chains of short
 * segments.)
 */
export function creaseEdges(geometry: THREE.BufferGeometry, creaseDeg: number, minArea = 0): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(creaseEdgeArray(edgeJobOf(geometry, creaseDeg, minArea)), 3));
  return g;
}

/** The plain arrays {@link creaseEdgeArray} (and the edge worker) work on: copies, never views of the mesh. */
export function edgeJobOf(geometry: THREE.BufferGeometry, creaseDeg: number, minArea = 0): HoloEdgeJob {
  const pos = geometry.getAttribute('position');
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const idx = geometry.getIndex();
  let index: Uint32Array | null = null;
  if (idx) {
    index = new Uint32Array(idx.count);
    for (let i = 0; i < idx.count; i++) index[i] = idx.getX(i);
  }
  return { positions, index, creaseDeg, minArea };
}
