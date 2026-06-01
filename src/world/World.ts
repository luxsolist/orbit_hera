import * as THREE from "three";

const TERRAIN_SIZE = 220;
const SEGMENTS = 110; // 로우 폴리 느낌을 위해 너무 촘촘하지 않게
export const TERRAIN_HALF = TERRAIN_SIZE / 2;

/**
 * 절차적 로우 폴리 지형 + 라이팅.
 * - 결정론적 노이즈로 높이를 만들고 flat shading 으로 각진 면을 강조(스펙 1장).
 * - heightAt(x,z) 로 플레이어/적이 지표면에 붙도록 함.
 */
export class World {
  readonly group = new THREE.Group();
  /** 통과 불가 오브젝트(바위)의 수평 원기둥 콜라이더 + 윗면 Y(올라설 수 있는 높이) */
  readonly colliders: { x: number; z: number; radius: number; top: number }[] = [];
  private amp = 7;
  private freq = 0.035;

  constructor(scene: THREE.Scene) {
    this.buildTerrain();
    this.buildLighting(scene);
    this.buildSky(scene);
    scene.add(this.group);
  }

  /**
   * 수평 충돌 해소.
   * 반지름 radius 의 원(플레이어)이 바위 콜라이더와 겹치면 바깥으로 밀어낸 좌표를 반환.
   * (XZ 평면 원-원 검사 → 겹친 만큼 법선 방향으로 분리)
   * feetY 가 바위 윗면 이상이면 그 위에 있는 것으로 보고 통과시킨다(올라타기/넘어가기 허용).
   */
  resolveCollision(
    x: number,
    z: number,
    radius: number,
    feetY: number
  ): { x: number; z: number } {
    for (const c of this.colliders) {
      // 윗면보다 발이 같거나 위면 디딘 상태 — 수평 차단하지 않음
      if (feetY >= c.top - 0.05) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const min = c.radius + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (min - d) / d; // 부족한 거리를 방향 벡터에 비례 적용
        x += dx * push;
        z += dz * push;
      } else {
        // 정확히 중심에 겹친 예외: 임의 방향(+x)으로 분리
        x += min;
      }
    }
    return { x, z };
  }

  /**
   * (x,z) 좌표 위에 디딜 수 있는 바위 윗면 중 가장 높은 Y. 없으면 -Infinity.
   * 플레이어 중심이 바위 수평 반경 안에 있을 때만 디딤판으로 인정.
   */
  topAt(x: number, z: number): number {
    let best = -Infinity;
    for (const c of this.colliders) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz <= c.radius * c.radius) {
        if (c.top > best) best = c.top;
      }
    }
    return best;
  }

  /** 결정론적 의사 노이즈(여러 사인파 합성) */
  heightAt(x: number, z: number): number {
    const f = this.freq;
    let h = 0;
    h += Math.sin(x * f) * Math.cos(z * f) * this.amp;
    h += Math.sin(x * f * 2.3 + 1.7) * Math.cos(z * f * 1.9 - 0.5) * this.amp * 0.4;
    h += Math.sin(x * f * 4.1 - 2.1) * Math.cos(z * f * 3.7 + 1.1) * this.amp * 0.18;
    // 중앙(스폰 지점)은 평평하게
    const d = Math.sqrt(x * x + z * z);
    const flatten = THREE.MathUtils.smoothstep(d, 6, 22);
    return h * flatten;
  }

  private buildTerrain() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const color = new THREE.Color();
    const colors: number[] = [];

    const low = new THREE.Color(0x1b2a33); // 골짜기 (차가운 청록)
    const mid = new THREE.Color(0x2e5d4b); // 평지 (이끼색)
    const high = new THREE.Color(0x6f7d57); // 고지대 (마른 풀)

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      const t = THREE.MathUtils.clamp((y + this.amp) / (this.amp * 2.2), 0, 1);
      if (t < 0.5) color.copy(low).lerp(mid, t * 2);
      else color.copy(mid).lerp(high, (t - 0.5) * 2);
      colors.push(color.r, color.g, color.b);
    }

    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true, // 로우 폴리 각진 면
      roughness: 0.95,
      metalness: 0.0,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = "terrain";
    this.group.add(mesh);

    this.scatterRocks();
    this.addGrid();
  }

  /** 분위기용 로우 폴리 바위 산포(통과 불가 콜라이더 등록) */
  private scatterRocks() {
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x6b6f63, // 낮 햇빛 아래 자연스러운 화강암 톤
      flatShading: true,
      roughness: 0.9,
    });

    // 시드 고정용 간단한 LCG
    let seed = 1337;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 0xffffffff;
      return seed / 0xffffffff;
    };

    for (let i = 0; i < 90; i++) {
      const x = (rand() - 0.5) * TERRAIN_SIZE * 0.92;
      const z = (rand() - 0.5) * TERRAIN_SIZE * 0.92;
      if (Math.sqrt(x * x + z * z) < 14) continue; // 스폰 근처 비움

      const s = 1.2 + rand() * 3.5;
      const sx = s * (0.7 + rand() * 0.6);
      const sz = s * (0.7 + rand() * 0.6);
      const sy = s * (1 + rand());
      const baseY = this.heightAt(x, z) + s * 0.3;
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, baseY, z);
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // 수평 콜라이더 + 윗면 Y(아이코사헤드론 반경 1 × 세로 스케일)
      this.colliders.push({
        x,
        z,
        radius: Math.max(sx, sz) * 0.85,
        top: baseY + sy,
      });
    }
  }

  /** 지면 위 옅은 그리드 — 원격 접속/SF 분위기 */
  private addGrid() {
    const grid = new THREE.GridHelper(TERRAIN_SIZE, SEGMENTS / 2, 0x34f5ff, 0x1a3a44);
    (grid.material as THREE.Material).opacity = 0.06;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.05;
    this.group.add(grid);
  }

  private buildLighting(scene: THREE.Scene) {
    // 맑은 낮 하늘광: 밝은 하늘색 + 따뜻한 지면 반사
    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6f7a55, 1.1);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3da, 2.0);
    sun.position.set(40, 80, 25);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 240;
    const s = 80;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    scene.add(sun);

    // 하늘 반대편에서 들어오는 옅은 푸른 보조광(그림자 디테일 보강)
    const fill = new THREE.DirectionalLight(0xaecbe6, 0.4);
    fill.position.set(-30, 24, -40);
    scene.add(fill);
  }

  private buildSky(scene: THREE.Scene) {
    // 자연스러운 대낮 하늘색(눈부시지 않게 살짝 가라앉힌 청색).
    const skyColor = new THREE.Color(0x6fa3cf);
    scene.background = skyColor;
    // 선형 안개: near 까지는 안개 0(근거리 완전 선명) → far 로 갈수록 하늘색에 녹아듦.
    // 지수 안개와 달리 가까운 물체에는 영향이 없어 화면이 뿌옇게 흐려지지 않는다.
    scene.fog = new THREE.Fog(0x86b3da, 360, 900);
  }
}
