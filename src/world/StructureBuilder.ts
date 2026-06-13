import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Landmark, Part } from "./MapData";
import type { CollisionWorld } from "./CollisionWorld";
import { normalizeGeo, makeMaterial } from "./geo";

/**
 * 데이터 구동 랜드마크(structure) 공통 인터프리터 — parts/mats(JSON)를 메시로 그린다.
 * 타입별 코드가 없고, 한·일 등 양식 차이는 전부 Part 파라미터(데이터)로 표현된다.
 * (예: 지붕 양식 = hiproof 의 ridge/cap/fin/up)
 */
export class StructureBuilder {
  /** lm(랜드마크)을 group 에 그리고, 콜라이더를 collision 에 등록. 생성한 Group(파괴 연출 대상)을 반환. */
  build(lm: Landmark, group: THREE.Group, collision: CollisionWorld): THREE.Group {
    const mats = (lm.mats ?? []).map(makeMaterial);

    // 재질별로 지오메트리 모아 병합(드로콜 최소화)
    const byMat = new Map<number, THREE.BufferGeometry[]>();
    for (const part of lm.parts ?? []) {
      const geo = this.partGeometry(part);
      if (!geo) continue;
      if (!byMat.has(part.m)) byMat.set(part.m, []);
      byMat.get(part.m)!.push(geo);
    }
    const grp = new THREE.Group();
    for (const [mi, geos] of byMat) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      geos.forEach((g) => g !== merged && g.dispose());
      const mesh = new THREE.Mesh(merged, mats[mi] ?? new THREE.MeshStandardMaterial());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    const rot = lm.rot ?? 0;
    grp.rotation.y = rot;
    grp.position.set(lm.x, 0, lm.z);
    group.add(grp);

    // 콜라이더(로컬 → 회전·이동 적용)
    const c = Math.cos(rot),
      s = Math.sin(rot);
    for (const col of lm.colliders ?? [])
      collision.addCircle(lm.x + col.x * c + col.z * s, lm.z - col.x * s + col.z * c, col.r, col.top);
    // 축정렬 통과 불가 박스(rot=0 가정 — 광화문 피어 등)
    for (const b of lm.boxColliders ?? [])
      collision.addAabbBox(lm.x + b.x0, lm.x + b.x1, lm.z + b.z0, lm.z + b.z1);
    return grp;
  }

  /** 부품(Part) → 비인덱스 BufferGeometry(로컬 변환 반영, 병합 일관성 위해 uv 제거). */
  private partGeometry(part: Part): THREE.BufferGeometry | null {
    let g: THREE.BufferGeometry;
    switch (part.g) {
      case "box":
        g = new THREE.BoxGeometry(part.s![0], part.s![1], part.s![2]);
        break;
      case "cyl":
        g = new THREE.CylinderGeometry(part.rt!, part.rb!, part.h!, part.seg ?? 8, 1, part.open ?? false, part.t0 ?? 0, part.tl ?? Math.PI * 2);
        break;
      case "cone":
        g = new THREE.ConeGeometry(part.r!, part.h!, part.seg ?? 8);
        break;
      case "plane":
        g = new THREE.PlaneGeometry(part.s![0], part.s![1]);
        g.rotateX(-Math.PI / 2);
        break;
      case "hiproof":
        g = this.hipRoofGeometry(
          part.W!, part.D!, part.H!,
          part.ridge ?? 0.42, part.t ?? 0.8, part.cap ?? 0, part.fin ?? 0, part.up ?? 0
        );
        break;
      case "strut":
        g = this.strutGeometry(part.a!, part.b!, part.thick ?? 1);
        break;
      default:
        return null;
    }
    if (part.g !== "strut") {
      if (part.rx || part.ry || part.rz) {
        g.applyMatrix4(
          new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(part.rx ?? 0, part.ry ?? 0, part.rz ?? 0, "XYZ")
          )
        );
      }
      if (part.p) g.translate(part.p[0], part.p[1], part.p[2]);
    }
    return normalizeGeo(g);
  }

  /** 두 점을 잇는 각진 보(strut) 지오메트리 — 변환 베이크. */
  private strutGeometry(a: number[], b: number[], thick: number): THREE.BufferGeometry {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 0.01;
    const g = new THREE.BoxGeometry(thick, len, thick);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize()
    );
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    g.applyMatrix4(m);
    return g;
  }

  /**
   * 팔작/우진각 계열 지붕 — 양식 무지(無知)의 제네릭 생성기. 양식은 모두 파라미터(데이터):
   *  ridge(용마루 길이) · cap(용마루 마루) · fin(망새/취두) · up(처마 끝 들림).
   * 처마는 8점(모서리 4 + 변 중점 4)으로 두어 up>0 일 때 모서리만 들려 한·일·중 처마 곡선을
   * 표현(up=0 이면 변 중점이 슬로프 위에 있어 기존 직선 처마와 동일).
   */
  private hipRoofGeometry(
    W: number, D: number, H: number,
    ridge = 0.42, t = 0.8, cap = 0, fin = 0, up = 0
  ): THREE.BufferGeometry {
    const rW = W * ridge;
    const L = up > 0 ? up * Math.max(1.5, H * 0.35) : 0; // 모서리 들림 높이
    const A = [-W, L, -D], B = [W, L, -D], C = [W, L, D], Dd = [-W, L, D];
    const mAB = [0, 0, -D], mBC = [W, 0, 0], mCD = [0, 0, D], mDA = [-W, 0, 0];
    const R0 = [-rW, H, 0], R1 = [rW, H, 0];
    const lo = (p: number[]) => [p[0], p[1] - t, p[2]];

    const verts: number[] = [];
    const tri = (a: number[], b: number[], c: number[]) => verts.push(...a, ...b, ...c);
    const top: number[][][] = [
      [Dd, mCD, R0], [mCD, R1, R0], [mCD, C, R1], // +Z
      [B, mAB, R1], [mAB, R0, R1], [mAB, A, R0], // -Z
      [C, mBC, R1], [mBC, B, R1], // +X
      [A, mDA, R0], [mDA, Dd, R0], // -X
    ];
    for (const [a, b, c] of top) tri(a, b, c); // 윗면
    for (const [a, b, c] of top) tri(lo(a), lo(c), lo(b)); // 아랫면(반전)
    const E = [A, mAB, B, mBC, C, mCD, Dd, mDA];
    for (let i = 0; i < 8; i++) {
      const P = E[i], Q = E[(i + 1) % 8], Pb = lo(P), Qb = lo(Q);
      tri(P, Q, Qb);
      tri(P, Qb, Pb);
    }
    const slope = new THREE.BufferGeometry();
    slope.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    slope.computeVertexNormals();
    const geos: THREE.BufferGeometry[] = [slope];

    // 용마루 마루(cap>0) + 양끝 망새/취두(fin>0)
    if (cap > 0) {
      const rcH = Math.max(0.5, H * cap);
      const rcW = rW + Math.min(0.6, W * 0.06);
      const rcZ = Math.max(0.6, D * 0.1);
      const capBox = (w: number, h: number, d: number, x: number, y: number) => {
        const b = new THREE.BoxGeometry(w, h, d).toNonIndexed();
        b.deleteAttribute("uv");
        b.translate(x, y, 0);
        geos.push(b);
      };
      capBox(rcW * 2, rcH, rcZ * 2, 0, H - 0.15 + rcH / 2);
      if (fin > 0)
        for (const sx of [-1, 1]) capBox(0.7, rcH * fin, rcZ * 1.6, sx * rcW, H - 0.15 + (rcH * fin) / 2);
    }
    return geos.length === 1 ? slope : mergeGeometries(geos, false);
  }
}
