import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 스포일러 가드(서사편 §8.1) — 인게임 표면(표시명·라벨·설명 등 플레이어에게 보이는 문자열)에
// L4 어휘(계산/작업 어휘)가 실리면 서사 반전이 조기 누설된다. 런타임 데이터(JSON)의 표시
// 문자열을 스캔해 금지 어휘를 차단한다. 내부 id(영문 키)는 검사 대상이 아니다.

const FORBIDDEN = [
  "삭제", "프로세스", "시뮬레이션", "데이터", "컴팩션", "롤백", "리와인드", "재시도",
  "스냅샷", "아카이브", "백업", "직렬화", "버퍼", "tombstone", "sweep", "rollback",
  "marker", "compactor", "rewinder", "fork",
];

// 표시(플레이어 노출) 필드 — 이 키의 문자열 값만 검사한다. brief = 미션 브리핑(세계관 계시 통로 — 06-missions §7).
const DISPLAY_KEYS = new Set(["name", "displayName", "abbr", "label", "desc", "subtitle", "brief"]);

function collectDisplayStrings(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const v of node) collectDisplayStrings(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (typeof v === "string" && DISPLAY_KEYS.has(k)) out.push(v);
      else collectDisplayStrings(v, out);
    }
  }
}

const DIRS = ["public/drones", "public/weapons", "public/enemies", "public/missions"];

/** 문자열에 금지 어휘가 없는지 단언(출처 라벨 포함). */
function assertClean(s: string, where: string): void {
  const low = s.toLowerCase();
  for (const bad of FORBIDDEN) {
    expect(low.includes(bad.toLowerCase()), `${where}: "${s}" 에 금지 어휘 "${bad}"`).toBe(false);
  }
}

describe("스포일러 가드 — 표면 어휘(서사편 §8.1)", () => {
  for (const dir of DIRS) {
    it(`${dir} 표시 문자열에 금지 어휘 없음`, () => {
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const strings: string[] = [];
        collectDisplayStrings(JSON.parse(readFileSync(join(dir, f), "utf8")), strings);
        for (const s of strings) assertClean(s, `${dir}/${f}`);
      }
    });
  }
});

// TS 쪽 표시 문자열 상수 — JSON 스캔 밖의 표면 문자열도 같은 가드를 통과해야 한다.
describe("스포일러 가드 — 코드 내 표시 문자열 상수", () => {
  it("직무 표시명(DEPLOY_ROLE_NAMES)·내장 미션 풀(name/brief)", async () => {
    const { DEPLOY_ROLE_NAMES, DEFAULT_MISSIONS_V2 } = await import("../src/game/missionV2");
    for (const s of Object.values(DEPLOY_ROLE_NAMES)) assertClean(s, "DEPLOY_ROLE_NAMES");
    for (const m of DEFAULT_MISSIONS_V2) {
      assertClean(m.name, `mission ${m.id}`);
      if (m.brief) assertClean(m.brief, `mission ${m.id} brief`);
    }
  });

  it("얽힘 택소노미 표시명·브리핑(ENTANGLEMENT_CLASSES)", async () => {
    const { ENTANGLEMENT_CLASSES } = await import("../src/world/entanglement");
    for (const meta of Object.values(ENTANGLEMENT_CLASSES)) {
      assertClean(meta.name, `entanglement ${meta.cls}`);
      assertClean(meta.brief, `entanglement ${meta.cls} brief`);
    }
  });
});
