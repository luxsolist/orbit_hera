import { WalkerThrusters } from "../assets/WalkerThrusters";
import { WalkerMech } from "../assets/WalkerMech";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { rng } from "./helpers";

/** Procedural PBR surfaces. Local, deterministic assets; no remote downloads at playback. */
export function surface(kind: "stone" | "brick" | "wood" | "metal", repeat = 1) {
  const n = 256, random = rng(913 + kind.length);
  const pixels = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const row = Math.floor(y / 32);
    const joint = kind === "brick" ? y % 32 < 2 || (x + (row % 2) * 32) % 64 < 2
      : kind === "stone" ? y % 64 < 2 || (x + (Math.floor(y / 64) % 2) * 32) % 64 < 2 : false;
    const grain = kind === "wood" ? Math.sin(x * 0.6 + Math.sin(y * 0.025) * 2) * 18
      : Math.sin(x * 0.11) * Math.sin(y * 0.09) * 12;
    const v = joint ? 52 : 155 + grain + (random() - 0.5) * 42;
    const off = (y * n + x) * 4;
    pixels[off] = v; pixels[off + 1] = v; pixels[off + 2] = v; pixels[off + 3] = 255;
  }
  const tex = new THREE.DataTexture(pixels, n, n);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.needsUpdate = true;
  return tex;
}

export function material(kind: "stone" | "brick" | "wood" | "metal", color: number, repeat = 1) {
  const tex = surface(kind, repeat);
  return new THREE.MeshStandardMaterial({
    color, map: tex, bumpMap: tex, bumpScale: kind === "metal" ? 0.015 : 0.09,
    roughnessMap: tex, roughness: kind === "metal" ? 0.5 : 0.95,
    metalness: kind === "metal" ? 0.8 : 0,
  });
}

export function box(parent: THREE.Object3D, mat: THREE.Material, size: number[], pos: number[], rounded = false) {
  const mesh = new THREE.Mesh(rounded
    ? new RoundedBoxGeometry(size[0], size[1], size[2], 2, Math.min(...size) * 0.12)
    : new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.fromArray(pos); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function rod(parent: THREE.Object3D, mat: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 12), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  parent.add(mesh); return mesh;
}
export function glow(color: number, strength = 2) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: strength, roughness: 0.35 });
}

export function atmosphere(scene: THREE.Scene, warm = false) {
  scene.background = new THREE.Color(warm ? 0x182831 : 0x172c3c);
  scene.fog = new THREE.FogExp2(warm ? 0x31404a : 0x2f4557, 0.019);
  scene.add(new THREE.HemisphereLight(0xaacde3, 0x40382c, 1.5));
  const key = new THREE.DirectionalLight(warm ? 0xffc28e : 0xb4d4ef, 2.4);
  key.position.set(-12, 20, 8); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 0.5, far: 90 });
  key.shadow.bias = -0.0005; key.shadow.normalBias = 0.04;
  scene.add(key);
}
export interface Fragment { mesh: THREE.Mesh; home: THREE.Vector3; spin: number; }
export interface Street {
  building: THREE.Group; details: THREE.Group; fragments: Fragment[];
  lamp: THREE.PointLight; lampGlass: THREE.Mesh; masonry: THREE.MeshStandardMaterial;
  dust: THREE.Points;
}

/** A small authored set: rain-polished lane, tiled eaves, recessed windows, cables and a living lamp. */
export function street(scene: THREE.Scene, variant = 0): Street {
  atmosphere(scene, variant === 1);
  const stone = material("stone", 0x8f999d, 8);
  const brick = material("brick", variant === 1 ? 0xaaa18c : 0x88786b, 2);
  const wood = material("wood", 0x483328);
  const metal = material("metal", 0x4a5258);
  const roofMat = material("stone", 0x38464a, 2);
  const pavement = material("stone", 0x69757a, 32);
  pavement.roughness = 0.4; pavement.metalness = 0.2;
  box(scene, pavement, [75, 0.2, 120], [0, -0.16, -28]);
  // Puddles have restrained reflections; wet patches are not emissive decorations.
  const puddle = new THREE.MeshPhysicalMaterial({ color: 0x516d7b, metalness: 0.45, roughness: 0.12, clearcoat: 1 });
  for (let i = 0; i < 12; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(1, 40), puddle);
    p.rotation.x = -Math.PI / 2; p.scale.set(0.7 + i % 3, 1.4 + i % 4, 1);
    p.position.set(Math.sin(i * 12) * 6, -0.045, 7 - i * 3.2); scene.add(p);
  }
  const building = new THREE.Group(); scene.add(building);
  building.position.set(0, 0, -9);
  const fragments: Fragment[] = [];
  // Each masonry piece retains a real thickness and falls only after the details disappear.
  for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
    const m = box(building, brick, [0.99, 1, 1.1], [-3.5 + col, 0.5 + row, 0]);
    fragments.push({ mesh: m, home: m.position.clone(), spin: (col % 3 - 1) * 1.4 });
  }
  box(building, stone, [8.5, 0.36, 2.5], [0, 0.18, 0.1], true);
  const details = new THREE.Group(); building.add(details);
  for (const x of [-2.6, 0, 2.6]) {
    box(details, wood, [1.65, 2.5, 0.22], [x, 1.6, 0.67], true);
    box(details, new THREE.MeshPhysicalMaterial({ color: 0x192b30, roughness: 0.18, metalness: 0.45, clearcoat: 1 }),
      [1.34, 2.18, 0.1], [x, 1.65, 0.81]);
    for (let j = -2; j <= 2; j++) box(details, wood, [0.035, 2.2, 0.08], [x + j * 0.24, 1.65, 0.9]);
    for (const y of [0.75, 1.5, 2.25]) box(details, wood, [1.4, 0.05, 0.08], [x, y, 0.9]);
  }
  const roofBase=box(details,roofMat,[8.8,.13,2.7],[0,4.12,.05]);
  roofBase.rotation.x=-.18;
  // Rounded roof tiles catch the low morning light without flat-shaded facets.
  for (let i = 0; i < 30; i++) {
    const tile = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 2.6, 12, 1, false, 0, Math.PI), roofMat);
    tile.rotation.x = Math.PI / 2 - 0.18;
    tile.position.set(-4.2 + i * 0.29, 4.15, 0.1);
    tile.castShadow = true; details.add(tile);
  }
  box(details, wood, [9, 0.2, 2.9], [0, 3.97, 0.05], true);
  for (let i = 0; i < 3; i++) box(details, stone, [3.2 + i * 0.25, 0.15, 0.65], [0, 0.08 + i * 0.13, 2 - i * 0.52], true);
  // Name plate geometry: shallow strokes disappear before the structure.
  box(details, wood, [0.68, 0.36, 0.06], [1.18, 2.7, 0.72], true);
  for (let i = 0; i < 4; i++) box(details, stone, [0.055, 0.19, 0.015], [0.98 + i * 0.13, 2.7, 0.76]);

  const lampGlass = box(details, glow(0xffb866, 2.1), [0.22, 0.43, 0.2], [1.9, 2.5, 1.0], true);
  for (const x of [1.74, 2.06]) box(details, metal, [0.045, 0.56, 0.3], [x, 2.5, 1.0]);
  const lamp = new THREE.PointLight(0xffb56b, 12, 13, 2);
  lamp.position.set(1.9, 2.55, -7.5); scene.add(lamp);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const x = side * (8 + (i % 2) * 0.6), z = 10 - i * 9, h = 7 + (i % 3) * 2;
      box(scene, i % 2 ? brick : stone, [5, h, 8.5], [x, h / 2, z]);
      box(scene, roofMat, [5.5, 0.24, 9], [x, h, z], true);
      for (let floor = 0; floor < 3; floor++) for (let bay = 0; bay < 3; bay++) {
        const glass = box(scene, (i + bay + floor) % 4 === 0 ? glow(0xcba269, 0.45) : metal,
          [0.08, 1.35, 1.05], [x - side * 2.54, 1.6 + floor * 2.2, z - 2.7 + bay * 2.6]);
        glass.castShadow = false;
        box(scene,metal,[.13,.06,1.16],[x-side*2.59,1.6+floor*2.2,z-2.7+bay*2.6]);
        box(scene,stone,[.38,.10,1.3],[x-side*2.62,.90+floor*2.2,z-2.7+bay*2.6],true);
        for(const edge of [-1,1])box(scene,metal,[.13,1.46,.05],[x-side*2.6,1.6+floor*2.2,z-2.7+bay*2.6+edge*.56]);
      }
      rod(scene, metal, new THREE.Vector3(x - side * 2.7, 0, z + 3.5), new THREE.Vector3(x - side * 2.7, h, z + 3.5), 0.055);
    }
  }
  for (let i = 0; i < 4; i++) {
    const pts = [];
    for (let j = 0; j <= 12; j++) pts.push(new THREE.Vector3(-7 + j * 14 / 12, 7 - Math.sin(j / 12 * Math.PI) * 0.8, -i * 12));
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x172027 })));
  }
  const random = rng(173), positions = new Float32Array(220 * 3);
  for (let i = 0; i < 220; i++) {
    positions[i * 3] = (random() - 0.5) * 28;
    positions[i * 3 + 1] = random() * 10;
    positions[i * 3 + 2] = 15 - random() * 65;
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dust = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbcd4e2, size: 0.028, transparent: true, opacity: 0.34, depthWrite: false }));
  scene.add(dust);
  return { building, details, fragments, lamp, lampGlass, masonry: brick, dust };
}

/** Smooth luminous shell with animated spectral filaments, shared heartbeat supplied by the scene. */
export function entity(scene: THREE.Scene, color = 0xff593b, role: "disc" | "spindle" | "brand" = "disc") {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 32),
    new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 1.0, roughness: 0.24, metalness: 0.2, transparent: true, opacity: 0.72, depthWrite: false }));
  shell.scale.set(role === "spindle" ? 0.4 : 1.3, role === "spindle" ? 1.7 : 0.55, 0.8);
  group.add(shell);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), glow(color, 5));
  group.add(core);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62 + i * 0.09, 0.008, 6, 64), glow(color, 2));
    ring.rotation.set(i * 0.65, i * 1.1, 0.3); group.add(ring);
  }
  const light = new THREE.PointLight(color, 20, 8, 2); group.add(light);
  scene.add(group); return group;
}

/** Same plain chassis and functional nozzles as the mech preview; no skin garnish. */
export class CinematicWalker extends WalkerMech {
  private thrusters?: WalkerThrusters;
  constructor() {
    super({detail:"high"});
    this.thrusters=new WalkerThrusters(this);
  }
  override dispose():void {
    this.thrusters?.dispose();this.thrusters=undefined;
    super.dispose();
  }
}
export function drone(parent: THREE.Object3D): CinematicWalker {
  const mech = new CinematicWalker(); parent.add(mech); return mech;
}
