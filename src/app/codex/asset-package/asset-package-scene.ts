/**
 * The three.js side of the asset package viewer. Imported ONLY dynamically
 * (`await import('./asset-package-scene')`) so three, GLTFLoader, OrbitControls
 * and the meshopt decoder land in a lazy chunk, never in the initial bundle.
 *
 * Contract: root GLB at the origin, every part GLB put under the scene root
 * with its placement's `position`/`rotation` verbatim (absolute, root-relative
 * — never nested under the parent placement). Geometry is parsed once per sha
 * and shared by every placement of it.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Bounds, PackagePlacement } from './asset-package.model';
import {
  HoloLook,
  HOLO_GHOST_FLAG,
  HOLO_OUTLINE_FLAG,
  HOLO_PART_LINE,
  HOLO_SELECT,
  countTriangles,
  type HoloRole,
  type Rgb,
} from '../holo-look';
import { type Rect, type SafeArea, fitDistance, rectOf, ringPose, usableSafeArea } from './holo-overlay';

export type { Rgb } from '../holo-look';

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  /** In front of the camera and inside the canvas. */
  readonly onScreen: boolean;
}

/**
 * Which end the start view shows. Packages are glTF Y-up with the nose on -Z
 * (CryEngine +Y forward), like the hulls. 'side' is the long-standing
 * three-quarter view from the +Z side (a ship's quarter); 'nose' is the same
 * view half a turn round, so a missile points its nose at the reader instead of its exhaust.
 */
export type StartFacing = 'side' | 'nose';

/**
 * Idle turntable seen from above: 'ccw' turns the model counter-clockwise, so a
 * 'nose' start (nose front-left) swings its nose across the front; 'cw' the
 * other way round; 'none' keeps it where the reader leaves it.
 */
export type TurntableSpin = 'none' | 'ccw' | 'cw';

/** Turntable rate, degrees per second (the landing hologram's model-viewer uses the same 14deg). */
const SPIN_DEG_PER_S = 14;
/** After the reader lets go of the model, the turntable waits this long before it picks up again. */
const SPIN_RESUME_MS = 2200;

/** Camera direction (from the orbit centre, not normalised) of the start view. */
export function startViewDir(facing: StartFacing): readonly [number, number, number] {
  return facing === 'nose' ? [-1, 0.55, -1.25] : [1, 0.55, 1.25];
}

// The dim factors live in holo-look.ts (HOLO_DIM_*, HOLO_BODY_*). No see-through
// on hover or selection: only the interior layer the user switches on glazes the hull.
const HULL_OPACITY_INTERIOR = 0.28;

/** Render order: hull → part bodies → the hovered / selected body. */
const ORDER_FOCUS = 10;
const ORDER_RING = 20;
const ORDER_PULSE = 40;
/** The select pulse: one expanding green ring, once per select (never with reduced motion). */
export const PULSE_S = 0.75;
/** Smallest on-screen start radius of the pulse ring, CSS px: a 12 px part is still found. */
export const PULSE_MIN_START_PX = 22;
/** Start radius of the ring as a share of the pulse quad's half size (it grows to ~0.95). */
const PULSE_START = 0.3;

const PULSE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uP;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  float aa = fwidth(r) * 1.5;
  float e = 1.0 - (1.0 - uP) * (1.0 - uP);
  float rad = mix(${PULSE_START.toFixed(2)}, 0.95, e);
  float w = mix(0.07, 0.025, uP);
  float ring = smoothstep(rad - w - aa, rad - w, r) * (1.0 - smoothstep(rad, rad + aa, r));
  float a = ring * (1.0 - uP);
  gl_FragColor = vec4(uColor * a, a);
}
`;

// The empty-slot ring: a dashed outer ring that rotates, a thin inner ring and
// a soft core, all in the manufacturer accent, drawn on a camera-facing quad.
const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uAngle;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  float r = length(vUv);
  float aa = fwidth(r) * 1.5;
  float outer = smoothstep(0.74 - aa, 0.74, r) * (1.0 - smoothstep(0.86, 0.86 + aa, r));
  float a = atan(vUv.y, vUv.x) + uAngle;
  float dash = step(0.42, fract(a / TAU * 12.0));
  float inner = smoothstep(0.5 - aa, 0.5, r) * (1.0 - smoothstep(0.54, 0.54 + aa, r));
  float core = (1.0 - smoothstep(0.0, 0.5, r)) * 0.35;
  float halo = (1.0 - smoothstep(0.86, 1.0, r)) * smoothstep(0.6, 0.86, r) * 0.25;
  float m = max(max(outer * dash, inner * 0.7), max(core, halo));
  vec3 c = mix(uColor, vec3(1.0), 0.25 * outer * dash);
  gl_FragColor = vec4(c * m * uAlpha, m * uAlpha);
}
`;

/** WebGL runs on the CPU (SwiftShader, llvmpipe, Microsoft Basic Render Driver). */
export function isSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  try {
    const gl = renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(String(name ?? ''));
  } catch {
    return false;
  }
}

/** How many points of the model the safe-area fit solves against. */
const MAX_FIT_POINTS_PER_MESH = 256;
const MAX_FIT_POINTS = 2500;
/** How much the straight top/bottom view counts in the fixed orbit distance (E4). */
const POLE_FIT_WEIGHT = 0.8;

function sameMatrix(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  return a.elements.every((v, i) => Math.abs(v - b.elements[i]) < 1e-5);
}

export class PackageScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.05, 5000);
  private readonly controls: OrbitControls;
  private readonly loader = new GLTFLoader();
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly envTarget: THREE.WebGLRenderTarget;

  /** Concept-hologram materials + cached crease edges (holo-look.ts). */
  private readonly look: HoloLook;
  private readonly t0 = performance.now();
  private readonly reducedMotion: boolean;

  private root: THREE.Object3D | null = null;
  private interior: THREE.Object3D | null = null;
  /** sha → parsed template (geometry owned here, shared by clones). */
  private readonly templates = new Map<string, THREE.Object3D>();
  /** placement id → its placed node (a clone of the template). */
  private readonly placed = new Map<string, THREE.Object3D>();
  /** placement id → its world position, for hotspot projection. */
  private readonly anchors = new Map<string, THREE.Vector3>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private hovered = new Set<string>();
  private selected = new Set<string>();
  /** Parts not relevant to the picked Einsatz: quieter, still there. */
  private quiet: ReadonlySet<string> = new Set();
  /** Current look role per placed node, so a role change only touches what changed. */
  private readonly roles = new Map<string, HoloRole>();
  /** Box of everything framed (hull + placed parts): its projection is the label's "silhouette". */
  private readonly contentBox = new THREE.Box3();
  private frameId = 0;
  private disposed = false;
  private paused = false;
  /** Wanted turntable; the controls' autoRotate follows it except while the reader drags. */
  private spin: TurntableSpin = 'none';
  private spinTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt = 0;
  private readonly tmp = new THREE.Vector3();

  // Safe-area framing (holotable). Null: the classic framing, untouched.
  private safe: SafeArea | null = null;
  private fitPoints: THREE.Vector3[] = [];
  private width = 0;
  private height = 0;
  /** The user's zoom relative to the fitted distance; 1 = exactly fitted. */
  private zoom = 1;
  /** Safe-area fit distance that holds from every view direction; null = solve again. */
  private baseDistance: number | null = null;
  private readonly lastDir = new THREE.Vector3();
  private lastDist = 0;
  private readonly seenView = new THREE.Matrix4();
  private readonly seenProjection = new THREE.Matrix4();

  // Empty-slot rings: hover in the part line colour, green when that slot is selected.
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1);
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly ringSelMat: THREE.ShaderMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly raycaster = new THREE.Raycaster();
  /** The select pulse quad; `pulseStart` (scene seconds) is null while none runs. */
  private readonly pulseMat: THREE.ShaderMaterial;
  private readonly pulse: THREE.Mesh;
  private pulseStart: number | null = null;
  private readonly pulseAt = new THREE.Vector3();
  private pulseRadius = 0;
  /** How many pulses fired (spec aid). */
  private pulseCount = 0;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    base: Rgb,
    accent: Rgb,
    reducedMotion: boolean,
    private readonly onFrame: () => void,
    /** Runs `fn` outside Angular's zone (the frame loop must not trigger change detection). */
    private readonly outsideZone: <T>(fn: () => T) => T = (fn) => fn(),
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true, powerPreference: 'high-performance' });
    // Without a GPU (software WebGL, hardware acceleration switched off) one
    // frame of the hull takes seconds; the animated loop would freeze the page.
    // Such a device gets the reduced-motion scene: rendered on demand only.
    reducedMotion ||= isSoftwareRenderer(this.renderer);
    this.reducedMotion = reducedMotion;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envTarget = this.pmrem.fromScene(room, 0.04);
    room.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose?.();
    });
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.35;
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    // Concept-hologram look (holo-look.ts): body in the app accent, rim and
    // highlight in the manufacturer accent; focus/x-ray only flip uniforms.
    this.look = new HoloLook(base, accent, reducedMotion, true);

    const ring = (c: Rgb) =>
      new THREE.ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: { uColor: { value: new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255) }, uAlpha: { value: 1 }, uAngle: { value: 0 } },
        transparent: true,
        // Never occluded: an empty slot is often inside the hull.
        depthTest: false,
        depthWrite: false,
        premultipliedAlpha: true,
        blending: THREE.NormalBlending,
        toneMapped: false,
      });
    this.ringMat = ring(HOLO_PART_LINE);
    this.ringSelMat = ring(HOLO_SELECT);
    this.pulseMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERTEX,
      fragmentShader: PULSE_FRAGMENT,
      uniforms: { uColor: { value: new THREE.Color(HOLO_SELECT[0] / 255, HOLO_SELECT[1] / 255, HOLO_SELECT[2] / 255) }, uP: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.pulse = new THREE.Mesh(this.ringGeo, this.pulseMat);
    this.pulse.visible = false;
    this.pulse.renderOrder = ORDER_PULSE;
    this.pulse.raycast = () => undefined;
    this.scene.add(this.pulse);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());
    // A grab stops the turntable; it resumes a moment after the reader lets go.
    this.controls.addEventListener('start', () => {
      this.clearSpinTimer();
      this.controls.autoRotate = false;
    });
    this.controls.addEventListener('end', () => {
      this.clearSpinTimer();
      if (this.spin === 'none') return;
      this.spinTimer = setTimeout(() => {
        this.spinTimer = null;
        this.applySpin();
      }, SPIN_RESUME_MS);
    });
    void this.disposed;
  }

  /** Seconds since the scene was created (scan band, ring pulse). */
  private elapsed(): number {
    return (performance.now() - this.t0) / 1000;
  }

  private parse(buf: ArrayBuffer): Promise<THREE.Object3D> {
    return new Promise((resolve, reject) => this.loader.parse(buf, '', (g) => resolve(g.scene), reject));
  }

  /** Dress every mesh in the look's `role` (GLBs are geometry-only), remember geometries for disposal. */
  private adopt(obj: THREE.Object3D, role: HoloRole): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const old = mesh.material;
      for (const m of Array.isArray(old) ? old : [old]) m?.dispose();
      this.geometries.add(mesh.geometry);
    });
    this.look.dress(obj, role);
  }

  async setRoot(buf: ArrayBuffer): Promise<void> {
    const obj = await this.parse(buf);
    // Fit first: the hull's line detail depends on its size and triangle count.
    this.look.fit(new THREE.Box3().setFromObject(obj), countTriangles(obj));
    this.adopt(obj, 'hull');
    this.root = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  async addPart(sha: string, buf: ArrayBuffer): Promise<void> {
    if (this.templates.has(sha)) return;
    const obj = await this.parse(buf);
    this.adopt(obj, 'part');
    this.templates.set(sha, obj);
  }

  /** Place every placement whose part template is loaded (clones share geometry). */
  place(placements: readonly PackagePlacement[]): void {
    for (const p of placements) {
      if (!p.position || !p.rotation) continue;
      this.anchors.set(p.id, new THREE.Vector3(p.position[0], p.position[1], p.position[2]));
      if (!p.partSha256 || this.placed.has(p.id)) continue;
      const tpl = this.templates.get(p.partSha256);
      if (!tpl) continue;
      const node = tpl.clone(true);
      node.position.set(p.position[0], p.position[1], p.position[2]);
      node.quaternion.set(p.rotation[0], p.rotation[1], p.rotation[2], p.rotation[3]);
      node.userData['placementId'] = p.id;
      this.placed.set(p.id, node);
      this.scene.add(node);
    }
    this.requestRender();
  }

  async setInterior(buf: ArrayBuffer): Promise<void> {
    if (this.interior) return;
    const obj = await this.parse(buf);
    this.adopt(obj, 'interior');
    this.interior = obj;
    this.scene.add(obj);
    this.requestRender();
  }

  hasInterior(): boolean {
    return !!this.interior;
  }

  /** Whether a placement has a rendered part (false = empty slot, marked by a ring). */
  hasPart(id: string): boolean {
    return this.placed.has(id);
  }

  setVisibility(visible: ReadonlySet<string>, interiorOn: boolean): void {
    for (const [id, node] of this.placed) node.visible = visible.has(id);
    if (this.interior) this.interior.visible = interiorOn;
    this.interiorOn = interiorOn && !!this.interior;
    this.applyOpacity();
  }

  private interiorOn = false;

  /** Hull translucency: only the interior layer (switched on by the user) glazes the hull. */
  private applyOpacity(): void {
    for (const role of ['hull', 'interior'] as const) {
      this.look.setOpacity(role, this.interiorOn && role === 'hull' ? HULL_OPACITY_INTERIOR : 1);
    }
    this.requestRender();
  }

  /** Lights parts: `hover` = pointer/keyboard focus look, `selected` = the green selection look. No see-through, ever. */
  setHighlight(state: { hover: readonly string[]; selected: readonly string[] }): void {
    const selected = new Set(state.selected);
    const hovered = new Set(state.hover.filter((id) => !selected.has(id)));
    if ([...hovered].some((id) => !this.hovered.has(id) && this.placed.has(id))) this.look.easeIn('hover');
    if ([...selected].some((id) => !this.selected.has(id) && this.placed.has(id))) this.look.easeIn('select');
    const fresh = [...selected].filter((id) => !this.selected.has(id) && (this.placed.has(id) || this.anchors.has(id)));
    // The green silhouette follows the selection (placed parts; an empty slot has its ring).
    for (const [id, node] of this.placed) {
      if (selected.has(id) !== this.selected.has(id)) this.look.setOutline(node, selected.has(id));
    }
    this.hovered = hovered;
    this.selected = selected;
    if (fresh.length) this.startPulse(fresh[fresh.length - 1]);
    this.applyRoles();
    // While a selection exists the hull lines and the other parts drop to about a third.
    this.look.setDim(selected.size > 0);
    const empty = (ids: ReadonlySet<string>) =>
      [...ids].filter((id) => !this.placed.has(id) && this.anchors.has(id)).map((id) => this.anchors.get(id)!);
    this.syncRings(empty(hovered), empty(selected));
    this.requestRender();
  }

  /** Placements currently in the hover / selected look (spec + debugging aid). */
  highlight(): { hover: readonly string[]; selected: readonly string[] } {
    return { hover: [...this.hovered], selected: [...this.selected] };
  }

  /**
   * The placement under a client point, or null. A ray hit on a placed part's meshes wins (front-most);
   * otherwise the nearest projected anchor within `slopPx` CSS pixels. Only ids in `candidates` are considered.
   * Parts inside the hull are pickable (the hull does not block the pick).
   */
  pick(clientX: number, clientY: number, slopPx: number, candidates: ReadonlySet<string>): string | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1), this.camera);
    let best: string | null = null;
    let bestDist = Infinity;
    for (const [id, node] of this.placed) {
      if (!candidates.has(id) || !node.visible) continue;
      // Ghost children and edge lines share the body's geometry: only the body mesh counts.
      const hit = this.raycaster
        .intersectObject(node, true)
        .find((h) => (h.object as THREE.Mesh).isMesh && !h.object.userData[HOLO_GHOST_FLAG] && !h.object.userData[HOLO_OUTLINE_FLAG] && !(h.object as THREE.LineSegments).isLineSegments);
      if (hit && hit.distance < bestDist) {
        bestDist = hit.distance;
        best = id;
      }
    }
    if (best) return best;
    // project() works in the canvas' CSS size; scale to the on-screen rect (CSS transforms).
    const sx = rect.width / Math.max(this.canvas.clientWidth, 1);
    const sy = rect.height / Math.max(this.canvas.clientHeight, 1);
    let near = slopPx;
    for (const [id, p] of this.project([...candidates])) {
      if (!p.onScreen) continue;
      const node = this.placed.get(id);
      if (node && !node.visible) continue;
      const d = Math.hypot(p.x * sx - x, p.y * sy - y);
      if (d <= near) {
        near = d;
        best = id;
      }
    }
    return best;
  }
  /** Mark the parts that stay quiet (another Einsatz); they keep their place and their hotspot. */
  setQuiet(ids: ReadonlySet<string>): void {
    this.quiet = ids;
    this.applyRoles();
    this.requestRender();
  }

  private applyRoles(): void {
    for (const [id, node] of this.placed) {
      const role: HoloRole = this.selected.has(id)
        ? 'select'
        : this.hovered.has(id)
          ? 'hover'
          : this.quiet.has(id)
            ? 'quiet'
            : 'part';
      if ((this.roles.get(id) ?? 'part') === role) continue;
      this.roles.set(id, role);
      this.look.setRole(node, role, role === 'select' || role === 'hover' ? ORDER_FOCUS : 0);
    }
  }

  /** One ring per highlighted empty slot (pooled); a selected slot's ring is green. */
  private syncRings(hoverAt: readonly THREE.Vector3[], selectedAt: readonly THREE.Vector3[]): void {
    const at = [...selectedAt, ...hoverAt];
    while (this.rings.length < at.length) {
      const m = new THREE.Mesh(this.ringGeo, this.ringMat);
      m.renderOrder = ORDER_RING;
      m.raycast = () => undefined;
      this.rings.push(m);
      this.scene.add(m);
    }
    this.rings.forEach((m, i) => {
      m.visible = i < at.length;
      if (!m.visible) return;
      m.position.copy(at[i]);
      m.material = i < selectedAt.length ? this.ringSelMat : this.ringMat;
    });
    this.poseRings(this.elapsed());
  }

  /**
   * One green ring that grows out from a newly selected part and fades, PULSE_S long.
   * It starts just outside the part (at least PULSE_MIN_START_PX on screen) and never
   * stays. None with reduced motion.
   */
  private startPulse(id: string): void {
    if (this.reducedMotion) return;
    const node = this.placed.get(id);
    if (node) {
      const box = new THREE.Box3().setFromObject(node);
      box.getCenter(this.pulseAt);
      this.pulseRadius = box.getSize(this.tmp).length() / 2;
    } else {
      this.pulseAt.copy(this.anchors.get(id)!);
      this.pulseRadius = 0;
    }
    this.pulseStart = this.elapsed();
    this.pulseCount++;
    this.pulse.visible = true;
    this.posePulse(this.pulseStart);
    this.requestRender();
  }

  private posePulse(seconds: number): void {
    if (this.pulseStart === null) return;
    const p = (seconds - this.pulseStart) / PULSE_S;
    if (p >= 1) {
      this.pulseStart = null;
      this.pulse.visible = false;
      return;
    }
    this.pulseMat.uniforms['uP'].value = Math.max(p, 0);
    // World size of one CSS pixel at the pulse's distance.
    const h = Math.max(this.canvas.clientHeight || this.height, 1);
    const dist = Math.max(this.camera.position.distanceTo(this.pulseAt), 1e-3);
    const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / h;
    const startR = Math.max(this.pulseRadius * 1.15, PULSE_MIN_START_PX * perPx);
    this.pulse.position.copy(this.pulseAt);
    this.pulse.quaternion.copy(this.camera.quaternion);
    // The quad is 1x1 with uv in [-1, 1]: half size = scale / 2.
    this.pulse.scale.setScalar((startR / PULSE_START) * 2);
  }

  /** Billboard + animate the rings (static pose with reduced motion). */
  private poseRings(seconds: number): void {
    const pose = ringPose(seconds, this.reducedMotion);
    for (const mat of [this.ringMat, this.ringSelMat]) {
      mat.uniforms['uAngle'].value = pose.angle;
      mat.uniforms['uAlpha'].value = pose.alpha;
    }
    const size = this.look.focusRadius * 1.6 * pose.scale;
    for (const m of this.rings) {
      if (!m.visible) continue;
      m.quaternion.copy(this.camera.quaternion);
      m.scale.setScalar(size);
    }
  }

  /** Frame the camera on `bounds` (manifest) or, when null, the loaded root's measured box. */
  frame(bounds: Bounds | null, facing: StartFacing = 'side'): void {
    const box = new THREE.Box3();
    if (bounds) box.set(new THREE.Vector3(...bounds.min), new THREE.Vector3(...bounds.max));
    else if (this.root) box.setFromObject(this.root);
    for (const node of this.placed.values()) box.expandByObject(node);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    this.contentBox.copy(box);
    this.baseDistance = null;
    this.fitPoints = this.safe ? this.sampleFitPoints(box) : [];
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(this.tmp).length() / 2, 0.1);
    const dir = new THREE.Vector3(...startViewDir(facing)).normalize();
    // Orientation first: the safe-area fit solves against the camera's axes.
    this.camera.position.copy(center).addScaledVector(dir, radius);
    this.camera.lookAt(center);
    // The bounding sphere overestimates a flat, long hull; 0.8 fills the stage.
    const dist = this.safe ? Math.max(this.stableDistance(), 0.1) : (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.8;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 200, 0.01);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.3;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
    this.zoom = 1;
    this.noteCamera();
    this.requestRender();
  }

  /**
   * Keep the model out of these insets (CSS px): the camera's centre moves to
   * the middle of what is left (view offset, so orbiting pivots there too) and
   * the distance is solved from the projected box. Null: classic framing.
   */
  setSafeArea(safe: SafeArea | null): void {
    if (safe && !this.safe && !this.contentBox.isEmpty()) this.fitPoints = this.sampleFitPoints(this.contentBox);
    this.safe = safe;
    this.baseDistance = null;
    this.applyViewOffset();
    this.refit();
  }

  private usable(): SafeArea {
    return usableSafeArea(this.safe ?? { left: 0, right: 0, top: 0, bottom: 0 }, { w: this.width, h: this.height });
  }

  private applyViewOffset(): void {
    if (!this.safe || this.width <= 0 || this.height <= 0) {
      this.camera.clearViewOffset();
      return;
    }
    const s = this.usable();
    this.camera.setViewOffset(this.width, this.height, (s.right - s.left) / 2, (s.bottom - s.top) / 2, this.width, this.height);
  }

  /**
   * Points on the model itself (hull + placed parts, inside the framed box). A
   * hull's box corners stand far off its silhouette from a three-quarter view;
   * fitting those leaves the model at half the safe area.
   */
  private sampleFitPoints(box: THREE.Box3): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const v = new THREE.Vector3();
    const margin = box.clone().expandByScalar(box.getSize(this.tmp).length() * 0.01);
    const take = (o: THREE.Object3D): void => {
      o.updateWorldMatrix(true, true);
      o.traverse((c) => {
        const pos = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry?.getAttribute('position') : null;
        if (!pos) return;
        const step = Math.max(1, Math.floor(pos.count / MAX_FIT_POINTS_PER_MESH));
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
          if (margin.containsPoint(v)) out.push(v.clone());
        }
      });
    };
    if (this.root) take(this.root);
    for (const node of this.placed.values()) take(node);
    if (out.length <= MAX_FIT_POINTS) return out;
    const thin = Math.ceil(out.length / MAX_FIT_POINTS);
    return out.filter((_, i) => i % thin === 0);
  }

  /**
   * One distance for the whole orbit: the largest fit over a ring of view
   * directions, so the model fits from every side and rotating never reads as
   * zoom. Solved once per model / viewport / safe area (cached).
   */
  private stableDistance(): number {
    if (this.baseDistance !== null) return this.baseDistance;
    const saved = this.camera.quaternion.clone();
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const dir = new THREE.Vector3();
    const zero = new THREE.Vector3();
    let best = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          if (x === 0 && y === 0 && z === 0) continue;
          dir.set(x, y, z).normalize();
          m.lookAt(dir, zero, Math.abs(dir.y) > 0.999 ? new THREE.Vector3(0, 0, -1) : up);
          q.setFromRotationMatrix(m);
          // E4: straight down/up turns a long hull's length onto the stage's short (vertical) axis and
          // used to set the distance for every side; it counts at POLE_FIT_WEIGHT, so the model fills
          // the stage on the views one actually orbits through, and a pole view may graze the margin.
          const pole = x === 0 && z === 0;
          best = Math.max(best, this.fittedDistance(q) * (pole ? POLE_FIT_WEIGHT : 1));
        }
      }
    }
    this.camera.quaternion.copy(saved);
    this.baseDistance = best;
    return best;
  }

  /** Distance at which the framed model fits the safe area, seen with this camera orientation. */
  private fittedDistance(orientation: THREE.Quaternion = this.camera.quaternion): number {
    const { min, max } = this.contentBox;
    const corners: THREE.Vector3[] = [];
    if (this.fitPoints.length > 0) corners.push(...this.fitPoints);
    else {
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    const q = orientation;
    return fitDistance(
      corners,
      this.contentBox.getCenter(new THREE.Vector3()),
      {
        right: new THREE.Vector3(1, 0, 0).applyQuaternion(q),
        up: new THREE.Vector3(0, 1, 0).applyQuaternion(q),
        back: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
      },
      this.camera.fov,
      { w: this.width, h: this.height },
      this.usable(),
    );
  }

  /** Put the camera at this distance from the orbit centre, widening the limits it would run into. */
  private placeAt(dir: THREE.Vector3, distance: number): void {
    this.camera.position.copy(this.controls.target).addScaledVector(dir, distance);
    if (distance * 4 > this.controls.maxDistance) {
      this.controls.maxDistance = distance * 4;
      this.camera.far = this.controls.maxDistance * 5;
      this.camera.updateProjectionMatrix();
    }
    this.noteCamera();
  }

  private noteCamera(): void {
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    this.lastDist = off.length();
    this.lastDir.copy(off).divideScalar(this.lastDist || 1);
  }

  /** Re-solve the distance for the current view, keeping the user's zoom (safe-area mode only). */
  private refit(): void {
    if (!this.safe || this.contentBox.isEmpty() || this.width <= 0) return;
    const dir = this.tmp.copy(this.camera.position).sub(this.controls.target).normalize().clone();
    this.placeAt(dir, this.stableDistance() * this.zoom);
    this.requestRender();
  }

  /**
   * The orbit keeps its distance: rotating never re-solves it (that read as
   * zoom). A changed distance is the user's zoom (pinch, wheel): it carries over.
   * Nothing changed (hover, selection): nothing moves.
   */
  private keepFit(): void {
    if (!this.safe || this.contentBox.isEmpty() || this.width <= 0) return;
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    const dist = off.length();
    if (dist <= 0) return;
    off.divideScalar(dist);
    const zoomed = Math.abs(dist - this.lastDist) > dist * 1e-4;
    if (zoomed && this.lastDist > 0) this.zoom *= dist / this.lastDist;
    if (zoomed || off.dot(this.lastDir) < 1 - 1e-7) this.noteCamera();
  }

  /** Zoom by a wheel delta (positive = out), inside the controls' limits. */
  zoomBy(delta: number): void {
    if (this.contentBox.isEmpty()) return;
    const off = this.tmp.copy(this.camera.position).sub(this.controls.target);
    const dist = off.length();
    if (dist <= 0) return;
    const next = THREE.MathUtils.clamp(dist * Math.exp(delta * 0.0015), this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).addScaledVector(off.divideScalar(dist), next);
    this.zoom = next / Math.max(this.stableDistance(), 1e-3);
    this.noteCamera();
    this.controls.update();
    this.requestRender();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.look.setViewport(width, height, this.renderer.getPixelRatio());
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.baseDistance = null;
    this.applyViewOffset();
    this.refit();
    this.requestRender();
  }

  /**
   * True once after the camera really moved since the last call. The look can
   * animate every frame with a resting camera; projecting 120 anchors is only
   * worth it when this says so.
   */
  viewChanged(): boolean {
    this.camera.updateMatrixWorld();
    // Not exact: OrbitControls' spherical round trip jitters the low bits on every update.
    if (sameMatrix(this.seenView, this.camera.matrixWorld) && sameMatrix(this.seenProjection, this.camera.projectionMatrix)) return false;
    this.seenView.copy(this.camera.matrixWorld);
    this.seenProjection.copy(this.camera.projectionMatrix);
    return true;
  }

  /** CSS-pixel position of each anchor (placement origin). */
  project(ids: readonly string[]): Map<string, ScreenPoint> {
    const out = new Map<string, ScreenPoint>();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    for (const id of ids) {
      const a = this.anchors.get(id);
      if (!a) continue;
      this.tmp.copy(a).project(this.camera);
      const onScreen = this.tmp.z < 1 && Math.abs(this.tmp.x) <= 1 && Math.abs(this.tmp.y) <= 1;
      out.set(id, { x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h, onScreen });
    }
    return out;
  }

  /** Screen rectangle of the framed content (its box's projected corners), CSS px; null before framing. */
  silhouette(): Rect | null {
    if (this.contentBox.isEmpty()) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const { min, max } = this.contentBox;
    const pts = [];
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          this.tmp.set(x, y, z).project(this.camera);
          if (this.tmp.z >= 1) continue;
          pts.push({ x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h });
        }
      }
    }
    return rectOf(pts);
  }

  /**
   * Screen rectangle of one placed part (its world box's projected corners), CSS px;
   * null for an unknown, hidden or behind-the-camera part. The name tag sits beside it.
   */
  partRect(id: string): Rect | null {
    const node = this.placed.get(id);
    if (!node?.visible) return null;
    node.updateWorldMatrix(true, true);
    const box = this.partBox.setFromObject(node);
    if (box.isEmpty()) return null;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pts = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          this.tmp.set(x, y, z).project(this.camera);
          if (this.tmp.z >= 1) continue;
          pts.push({ x: ((this.tmp.x + 1) / 2) * w, y: ((1 - this.tmp.y) / 2) * h });
        }
      }
    }
    return pts.length ? rectOf(pts) : null;
  }
  private readonly partBox = new THREE.Box3();

  /**
   * Idle turntable. OrbitControls' autoRotate orbits the CAMERA, so a positive
   * speed (camera clockwise) reads as the model turning counter-clockwise.
   */
  setSpin(spin: TurntableSpin): void {
    if (this.spin === spin) return;
    this.spin = spin;
    this.clearSpinTimer();
    this.applySpin();
  }

  private applySpin(): void {
    const on = this.spin !== 'none';
    this.controls.autoRotate = on;
    // autoRotateSpeed 1 = one orbit per 60 s = 6 degrees per second.
    this.controls.autoRotateSpeed = (this.spin === 'cw' ? -1 : 1) * (SPIN_DEG_PER_S / 6);
    if (on) this.requestRender();
  }

  private clearSpinTimer(): void {
    if (this.spinTimer) clearTimeout(this.spinTimer);
    this.spinTimer = null;
  }

  /** Pause the frame loop (viewer off screen / tab hidden); resuming draws a frame at once. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused && this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
    if (!paused) this.requestRender();
  }

  /** Render on demand: one frame, continued only while damping moves the camera or the look animates. */
  requestRender(): void {
    if (this.frameId || this.disposed || this.paused) return;
    this.frameId = this.outsideZone(() => requestAnimationFrame(() => {
      this.frameId = 0;
      const now = performance.now();
      const spinning = this.controls.autoRotate;
      // The turntable advances by real time, so a 144 Hz screen does not spin it faster.
      const dt = this.lastFrameAt ? Math.min((now - this.lastFrameAt) / 1000, 0.1) : 1 / 60;
      this.lastFrameAt = now;
      const moving = (this.controls.enableDamping || spinning) && this.controls.update(spinning ? dt : null);
      this.keepFit();
      const t = this.elapsed();
      this.look.tick(t);
      this.poseRings(t);
      this.posePulse(t);
      this.renderer.render(this.scene, this.camera);
      this.onFrame();
      // The scan band and the slot ring keep the loop alive; with reduced
      // motion the scene renders on demand only.
      if (moving || this.look.animated || this.look.tweening || this.pulseStart !== null) this.requestRender();
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.clearSpinTimer();
    if (this.frameId) cancelAnimationFrame(this.frameId);
    this.controls.dispose();
    for (const g of this.geometries) g.dispose();
    this.look.dispose();
    this.ringMat.dispose();
    this.ringSelMat.dispose();
    this.pulseMat.dispose();
    this.ringGeo.dispose();
    this.envTarget.dispose();
    this.pmrem.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
