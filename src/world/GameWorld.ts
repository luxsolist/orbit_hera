// 전장(맵) 런타임의 공통 표면 — 모놀리식 `World`(JSON 1장 전체)와 `StreamingWorld`(청크 스트리밍)가
// 동일하게 구현한다. 소비자(PlayerController/EnemyManager/Minimap/Game)는 이 인터페이스에만 의존해
// 두 월드 구현을 코드 분기 없이 교체한다.
import type * as THREE from "three";
import type { SpawnPoint } from "./MapData";
import type { BuildingCombat } from "./BuildingCombat";

/** 미니맵 등 표현 레이어가 World 의 근처 지형/건물 형상을 (내부 구조 노출 없이) 받는 싱크. */
export interface MinimapSink {
  water(points: ReadonlyArray<number>): void;
  road(ax: number, az: number, bx: number, bz: number, width: number): void;
  building(corners: ReadonlyArray<number>): void;
  triangle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): void;
  rock(x: number, z: number, radius: number): void;
}

/** 플레이/충돌/표현이 의존하는 전장 표면(모놀리식·스트리밍 공통). */
export interface GameWorld {
  /** 씬에 추가된 월드 메시 루트. */
  readonly group: THREE.Group;
  /** 플레이어 스폰(로컬 미터). */
  readonly spawn: SpawnPoint;
  /** 플레이 가능한 수평 반경(±m) — 플레이어/적 이동 클램프. 모놀리식=TERRAIN_HALF, 스트리밍=셀 범위. */
  readonly bounds: number;
  /** 건물 전투(체력/피격/파괴) — 건물 없는 전장이면 null. 플라즈모이드의 2순위 표적. */
  readonly buildings: BuildingCombat | null;

  /** 지형 높이(m). */
  heightAt(x: number, z: number): number;
  /** (x,z) 에서 디딜 수 있는 가장 높은 윗면(없으면 -Infinity). */
  topAt(x: number, z: number): number;
  /** 원(반경 radius, 발높이 feetY)을 장애물 밖으로 밀어낸 위치. */
  resolveCollision(x: number, z: number, radius: number, feetY: number): { x: number; z: number };
  /** 시야 반경 내 지형/건물/콜라이더를 (내부 노출 없이) 싱크로 방문. */
  queryMinimap(cx: number, cz: number, radius: number, sink: MinimapSink): void;
  /** 매 프레임 — 그림자 추종 + (스트리밍) 청크 로드/언로드. y=현재 고도(스트리밍 LOD용, 모놀리식은 무시). */
  update(px: number, pz: number, py?: number): void;
}
