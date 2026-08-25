import * as THREE from "three";

// 처치 순간 FX — 살점이 아니라 "정보/에너지"가 흩어지는 연출(무텍스처·플랫 셰이딩·발광 채널만
// 사실적이라는 세계관 아트 룰 준수, 물리편 §3). 처치 지점에서 튀어나오는 각진 저폴리 **코어 파편**
// 으로 "파괴됐다"는 즉각적 임팩트를 만든다. 처치당 3~6개뿐이라 인스턴싱 없이 개별 메시 + 배열
// 관리로 충분(damageNumbers.ts 와 동일한 규모의 패턴).
//
// 한때 여기에 **환수 실선**(처치 지점 → 플레이어로 빨려드는 입자)도 있었으나 HP 환수 폐지
// (2026-08-25)와 함께 제거했다 — 회복이 없는데 흡수 연출을 그리면 화면이 거짓 신호를 준다.

const SHARD_LIFE = 0.42; // 파편 수명(s) — 짧고 굵게
const SHARD_GRAVITY = 5.5; // 파편을 끌어내리는 가속도(월드 단위/초²)

interface Shard {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  life: number;
  baseScale: number;
  velocity: THREE.Vector3;
  spin: THREE.Vector3; // 축별 회전 속도(rad/s) — 텀블링
}

/** 처치 파편 공용 지오메트리(모든 인스턴스가 공유 — 처치 빈도가 높아도 GC 압박 최소화). */
let sharedShardGeo: THREE.BufferGeometry | null = null;

/** 각진 저폴리 파편 지오메트리 — 사면체를 살짝 찌그러뜨려 "조각"처럼(정다면체는 너무 매끈해 보임). */
function shardGeometry(): THREE.BufferGeometry {
  if (sharedShardGeo) return sharedShardGeo;
  const g = new THREE.TetrahedronGeometry(1, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // 정점을 축별로 다르게 눌러 비대칭 조각으로(플랫 셰이딩이라 면 하나하나가 또렷이 갈라져 보인다)
    pos.setXYZ(i, pos.getX(i) * 1.0, pos.getY(i) * 0.55, pos.getZ(i) * 0.7);
  }
  g.computeVertexNormals();
  sharedShardGeo = g;
  return g;
}

/**
 * 처치 파편 FX 매니저. `Game.ts` 가 `EnemyManager.onKill` 에서 `spawnShards` 를 호출하고,
 * 매 프레임 `update(dt)` 로 진행시킨다.
 */
export class KillBurst {
  private shards: Shard[] = [];

  constructor(private scene: THREE.Scene) {}

  /**
   * 코어 파편 버스트 — point 에서 튀어나와 중력에 끌리며 소산. color(강체일수록 밝은 청백 계열,
   * enemy.color 그대로 전달)로 KK 색 문법을 잇는다. strength(0..1) 비례 개수(3~6)·크기.
   */
  spawnShards(point: THREE.Vector3, color: THREE.Color, strength: number): void {
    const s = Math.max(0, Math.min(1, strength));
    const count = 3 + Math.round(3 * s);
    const geo = shardGeometry();
    // 파편은 emissive 만 사실적이라는 룰대로 순수 발광색(선형 >1 로 블룸 유발) — coreBright 계열과 동일 어법.
    const bright = 1.6 + 1.4 * s;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: color.clone().multiplyScalar(bright),
        transparent: true,
        depthWrite: false,
        toneMapped: false, // 리니어 발광값을 그대로 블룸에 태움(팔레트의 다른 발광 요소와 동일 취급)
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.copy(point);
      const scale = (0.35 + 0.25 * s) * (0.7 + Math.random() * 0.6);
      mesh.scale.setScalar(scale);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.renderOrder = 998;
      this.scene.add(mesh);

      const ang = Math.random() * Math.PI * 2;
      const upBias = 2.0 + Math.random() * 2.5;
      const spread = (2.0 + 3.0 * s) * (0.6 + Math.random() * 0.8);
      const velocity = new THREE.Vector3(Math.cos(ang) * spread, upBias, Math.sin(ang) * spread);
      const spin = new THREE.Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14
      );
      this.shards.push({ mesh, material, life: SHARD_LIFE, baseScale: scale, velocity, spin });
    }
  }

  /** 매 프레임 진행 — 파편의 낙하·회전·소산. */
  update(dt: number): void {
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const sh = this.shards[i];
      sh.life -= dt;
      sh.velocity.y -= SHARD_GRAVITY * dt;
      sh.mesh.position.addScaledVector(sh.velocity, dt);
      sh.mesh.rotation.x += sh.spin.x * dt;
      sh.mesh.rotation.y += sh.spin.y * dt;
      sh.mesh.rotation.z += sh.spin.z * dt;
      const t = Math.max(0, sh.life / SHARD_LIFE);
      sh.material.opacity = t;
      sh.mesh.scale.setScalar(sh.baseScale * (0.4 + 0.6 * t)); // 끝물에 오그라들며 사라짐(디졸브와 같은 "상실" 어휘)
      if (sh.life <= 0) {
        this.scene.remove(sh.mesh);
        sh.material.dispose();
        this.shards.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const sh of this.shards) { this.scene.remove(sh.mesh); sh.material.dispose(); }
    this.shards = [];
  }
}
