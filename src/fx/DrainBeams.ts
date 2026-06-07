import * as THREE from "three";

// 드레인 빔 연출 — 적→플레이어로 짧게 번쩍이는 가산발광 선(개체 색). 수명 동안 페이드 후 자동 해제.
// 적 로직(EnemyManager)에서 분리한 순수 시각 효과 풀.

const LIFE = 0.3; // 빔 수명(s)
const RADIUS = 0.12; // 빔 굵기(m)
const OPACITY = 0.85; // 최대 불투명도

const _up = new THREE.Vector3(0, 1, 0);
const _axis = new THREE.Vector3();

/** 짧게 명멸하는 드레인 빔 풀. spawn 으로 추가, 매 프레임 update(dt) 로 페이드/정리. */
export class DrainBeams {
  private beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number }[] = [];

  constructor(private scene: THREE.Scene) {}

  /** from→to 가산발광 선 1개 추가(color = 개체 색). 길이 0 에 가까우면 무시. */
  spawn(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    _axis.subVectors(to, from);
    const len = _axis.length();
    if (len < 0.05) return;
    const geo = new THREE.CylinderGeometry(RADIUS, RADIUS, len, 5, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: OPACITY, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(_up, _axis.normalize());
    this.scene.add(mesh);
    this.beams.push({ mesh, mat, life: LIFE });
  }

  /** 수명 감쇠 + 페이드, 만료분 씬 제거·해제. */
  update(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.beams.splice(i, 1);
      } else {
        b.mat.opacity = OPACITY * (b.life / LIFE);
      }
    }
  }

  /** 전부 즉시 제거·해제(전투 종료/재입장). */
  clear(): void {
    for (const b of this.beams) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mat.dispose();
    }
    this.beams.length = 0;
  }
}
