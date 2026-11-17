import * as THREE from 'three';
import { PackageScene, isSoftwareRenderer, startViewDir } from './asset-package-scene';

/** A renderer whose GL context reports `name` as its unmasked renderer string. */
function rendererNamed(name: string | null, withDebugInfo = true): THREE.WebGLRenderer {
  const gl = {
    RENDERER: 0x1f01,
    getExtension: (ext: string) => (withDebugInfo && ext === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 0x9246 } : null),
    getParameter: () => name,
  };
  return { getContext: () => gl } as unknown as THREE.WebGLRenderer;
}

describe('isSoftwareRenderer', () => {
  it('flags CPU WebGL, where the animated loop would freeze the page', () => {
    expect(isSoftwareRenderer(rendererNamed('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))).toBe(true);
    expect(isSoftwareRenderer(rendererNamed('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe(true);
    expect(isSoftwareRenderer(rendererNamed('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)'))).toBe(true);
  });

  it('keeps real GPUs animated, and falls back to the plain renderer name', () => {
    expect(isSoftwareRenderer(rendererNamed('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)'))).toBe(false);
    expect(isSoftwareRenderer(rendererNamed('Apple GPU', false))).toBe(false);
    expect(isSoftwareRenderer(rendererNamed(null))).toBe(false);
  });
});

describe('startViewDir', () => {
  it('keeps the side quarter by default and turns half round for the nose view', () => {
    const side = startViewDir('side');
    const nose = startViewDir('nose');
    expect(side).toEqual([1, 0.55, 1.25]);
    // Same height, opposite horizontal side: the camera sits off the -Z (nose) end.
    expect(nose[1]).toBe(side[1]);
    expect(nose[0]).toBe(-side[0]);
    expect(nose[2]).toBeLessThan(0);
  });
});

interface SceneInternals {
  camera: THREE.PerspectiveCamera;
  controls: { target: THREE.Vector3; update(): void };
  keepFit(): void;
}

describe('PackageScene camera distance', () => {
  let scene: PackageScene;
  let internals: SceneInternals;

  beforeEach(() => {
    const canvas = document.createElement('canvas');
    scene = new PackageScene(canvas, [0.2, 0.6, 0.8], [0.9, 0.5, 0.2], true, () => undefined);
    internals = scene as unknown as SceneInternals;
    scene.resize(1200, 700);
    scene.setSafeArea({ left: 120, right: 120, top: 80, bottom: 80 });
    // A long, flat hull: its fit differs a lot between side and nose views.
    scene.frame({ min: [-20, -2, -5], max: [20, 2, 5] }, 'side');
  });

  afterEach(() => scene.dispose());

  const distance = (): number => internals.camera.position.distanceTo(internals.controls.target);

  /** What OrbitControls does when dragged: swing the camera on a sphere round the target. */
  function orbitTo(azimuth: number, polar: number): void {
    const d = distance();
    const p = new THREE.Vector3().setFromSphericalCoords(d, polar, azimuth);
    internals.camera.position.copy(internals.controls.target).add(p);
    internals.camera.lookAt(internals.controls.target);
    internals.keepFit();
  }

  it('keeps the distance constant while rotating from side to nose to top', () => {
    const start = distance();
    for (const [az, polar] of [[0, 1.2], [Math.PI / 2, 1.4], [Math.PI, 1.1], [1, 0.4], [2, 2.4]]) {
      orbitTo(az, polar);
      expect(distance()).toBeCloseTo(start, 6);
    }
  });

  it('still zooms with the wheel and carries the zoom through a rotation', () => {
    const start = distance();
    scene.zoomBy(-200);
    const zoomed = distance();
    expect(zoomed).toBeLessThan(start);
    orbitTo(Math.PI / 2, 1.3);
    expect(distance()).toBeCloseTo(zoomed, 6);
  });

  it('re-solves on a viewport change and on re-framing', () => {
    const start = distance();
    scene.resize(500, 700);
    expect(distance()).not.toBeCloseTo(start, 3);
    scene.frame({ min: [-20, -2, -5], max: [20, 2, 5] }, 'side');
    scene.resize(1200, 700);
    expect(distance()).toBeCloseTo(start, 3);
  });
});

interface HighlightInternals {
  look: import('../holo-look').HoloLook;
  placed: Map<string, THREE.Object3D>;
  anchors: Map<string, THREE.Vector3>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  reducedMotion: boolean;
  pulse: THREE.Mesh;
  pulseCount: number;
  pulseStart: number | null;
}

describe('PackageScene highlight and pick', () => {
  let scene: PackageScene;
  let internals: HighlightInternals;
  let canvas: HTMLCanvasElement;

  /** A part as place() leaves it: a dressed box at `at`, registered by id. */
  function part(id: string, at: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    internals.look.dress(mesh, 'part');
    mesh.position.set(...at);
    mesh.userData['placementId'] = id;
    internals.placed.set(id, mesh);
    internals.anchors.set(id, new THREE.Vector3(...at));
    internals.scene.add(mesh);
    return mesh;
  }

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
    document.body.appendChild(canvas);
    scene = new PackageScene(canvas, [82, 193, 230], [255, 176, 46], true, () => undefined);
    internals = scene as unknown as HighlightInternals;
    scene.resize(800, 600);
  });

  afterEach(() => {
    scene.dispose();
    canvas.remove();
  });

  it('a selection never turns the see-through on; it fills the part green and dims the rest', () => {
    const a = part('a', [0, 0, 0]);
    const b = part('b', [3, 0, 0]);
    scene.setHighlight({ hover: ['b'], selected: ['a'] });
    const look = internals.look;
    expect(look.fill('hull').transparent).toBe(false);
    expect(look.fill('hull').uniforms['uOpacity'].value).toBe(1);
    expect(a.material).toBe(look.fill('select'));
    expect(b.material).toBe(look.fill('hover'));
    expect(look.dimmed).toBe(true);
    // Reduced motion: the selected look is there at once, in the one fixed green.
    const green = look.fill('select').uniforms['uBodyColor'].value as THREE.Color;
    expect([green.r, green.g, green.b].map((v) => Math.round(v * 255))).toEqual([125, 255, 156]);
    scene.setHighlight({ hover: ['a'], selected: [] });
    expect(a.material).toBe(look.fill('hover'));
    expect(b.material).toBe(look.fill('part'));
    expect(look.dimmed).toBe(false);
    expect(look.fill('hull').transparent).toBe(false);
  });

  it('pulses once per select, never on a hover, a repeat or with reduced motion', () => {
    part('a', [0, 0, 0]);
    part('b', [3, 0, 0]);
    internals.reducedMotion = false;
    scene.setHighlight({ hover: ['a'], selected: [] });
    expect(internals.pulseCount).toBe(0);
    scene.setHighlight({ hover: [], selected: ['a'] });
    expect(internals.pulseCount).toBe(1);
    expect(internals.pulse.visible).toBe(true);
    // The same selection again (a hover elsewhere re-sends it): no second pulse.
    scene.setHighlight({ hover: ['b'], selected: ['a'] });
    expect(internals.pulseCount).toBe(1);
    // It never stays: past PULSE_S the ring is gone.
    internals.pulseStart = -10;
    (scene as unknown as { posePulse(t: number): void }).posePulse(0);
    expect(internals.pulse.visible).toBe(false);
    internals.reducedMotion = true;
    scene.setHighlight({ hover: [], selected: ['b'] });
    expect(internals.pulseCount).toBe(1);
    expect(internals.pulse.visible).toBe(false);
  });

  it('draws the green silhouette around the selected part only', () => {
    const a = part('a', [0, 0, 0]);
    const kit = () => a.children.find((c) => c.userData['holoOutline']);
    scene.setHighlight({ hover: ['a'], selected: [] });
    expect(kit()).toBeUndefined();
    scene.setHighlight({ hover: [], selected: ['a'] });
    expect(kit()!.visible).toBe(true);
    // Mask + 8 shifted copies, through the hull (no depth test), stencil-gated.
    const copies = kit()!.children as THREE.Mesh[];
    expect(copies.length).toBe(9);
    const outline = copies[1].material as THREE.ShaderMaterial;
    expect(outline.depthTest).toBe(false);
    expect(outline.stencilFunc).toBe(THREE.NotEqualStencilFunc);
    // A role change keeps the outline's own materials.
    expect(copies[1].material).toBe(outline);
    scene.setHighlight({ hover: [], selected: [] });
    expect(kit()!.visible).toBe(false);
  });

  it('picks the part under the pointer, else the nearest anchor within the slop, only among the candidates', () => {
    part('a', [0, 0, 0]);
    part('b', [0, 0, -4]);
    internals.camera.position.set(0, 0, 10);
    internals.camera.lookAt(0, 0, 0);
    internals.camera.updateMatrixWorld();
    const all = new Set(['a', 'b', 'slot']);
    // Centre: a is in front of b.
    expect(scene.pick(400, 300, 24, all)).toBe('a');
    expect(scene.pick(400, 300, 24, new Set(['b']))).toBe('b');
    // An empty slot (anchor only) is found through the slop.
    internals.anchors.set('slot', new THREE.Vector3(3, 0, 0));
    const p = scene.project(['slot']).get('slot')!;
    expect(scene.pick(p.x + 10, p.y, 24, all)).toBe('slot');
    expect(scene.pick(p.x + 40, p.y, 24, all)).toBeNull();
  });
});

interface HighlightInternals {
  look: import('../holo-look').HoloLook;
  placed: Map<string, THREE.Object3D>;
  anchors: Map<string, THREE.Vector3>;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

describe('PackageScene highlight and pick', () => {
  let scene: PackageScene;
  let internals: HighlightInternals;
  let canvas: HTMLCanvasElement;

  /** A part as place() leaves it: a dressed box at `at`, registered by id. */
  function part(id: string, at: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    internals.look.dress(mesh, 'part');
    mesh.position.set(...at);
    mesh.userData['placementId'] = id;
    internals.placed.set(id, mesh);
    internals.anchors.set(id, new THREE.Vector3(...at));
    internals.scene.add(mesh);
    return mesh;
  }

  beforeEach(() => {
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:600px';
    document.body.appendChild(canvas);
    scene = new PackageScene(canvas, [82, 193, 230], [255, 176, 46], true, () => undefined);
    internals = scene as unknown as HighlightInternals;
    scene.resize(800, 600);
  });

  afterEach(() => {
    scene.dispose();
    canvas.remove();
  });

  it('a selection never turns the see-through on; it fills the part green and dims the rest', () => {
    const a = part('a', [0, 0, 0]);
    const b = part('b', [3, 0, 0]);
    scene.setHighlight({ hover: ['b'], selected: ['a'] });
    const look = internals.look;
    expect(look.fill('hull').transparent).toBe(false);
    expect(look.fill('hull').uniforms['uOpacity'].value).toBe(1);
    expect(a.material).toBe(look.fill('select'));
    expect(b.material).toBe(look.fill('hover'));
    expect(look.dimmed).toBe(true);
    // Reduced motion: the selected look is there at once, in the one fixed green.
    const green = look.fill('select').uniforms['uBodyColor'].value as THREE.Color;
    expect([green.r, green.g, green.b].map((v) => Math.round(v * 255))).toEqual([125, 255, 156]);
    scene.setHighlight({ hover: ['a'], selected: [] });
    expect(a.material).toBe(look.fill('hover'));
    expect(b.material).toBe(look.fill('part'));
    expect(look.dimmed).toBe(false);
    expect(look.fill('hull').transparent).toBe(false);
  });

  it('picks the part under the pointer, else the nearest anchor within the slop, only among the candidates', () => {
    part('a', [0, 0, 0]);
    part('b', [0, 0, -4]);
    internals.camera.position.set(0, 0, 10);
    internals.camera.lookAt(0, 0, 0);
    internals.camera.updateMatrixWorld();
    const all = new Set(['a', 'b', 'slot']);
    // Centre: a is in front of b.
    expect(scene.pick(400, 300, 24, all)).toBe('a');
    expect(scene.pick(400, 300, 24, new Set(['b']))).toBe('b');
    // An empty slot (anchor only) is found through the slop.
    internals.anchors.set('slot', new THREE.Vector3(3, 0, 0));
    const p = scene.project(['slot']).get('slot')!;
    expect(scene.pick(p.x + 10, p.y, 24, all)).toBe('slot');
    expect(scene.pick(p.x + 40, p.y, 24, all)).toBeNull();
  });
});
