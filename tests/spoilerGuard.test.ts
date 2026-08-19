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

// 표시(플레이어 노출) 필드 — 이 키의 문자열 값만 검사한다.
const DISPLAY_KEYS = new Set(["name", "displayName", "abbr", "label", "desc", "subtitle"]);

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

describe("스포일러 가드 — 표면 어휘(서사편 §8.1)", () => {
  for (const dir of DIRS) {
    it(`${dir} 표시 문자열에 금지 어휘 없음`, () => {
      for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
        const strings: string[] = [];
        collectDisplayStrings(JSON.parse(readFileSync(join(dir, f), "utf8")), strings);
        for (const s of strings) {
          const low = s.toLowerCase();
          for (const bad of FORBIDDEN) {
            expect(low.includes(bad.toLowerCase()), `${dir}/${f}: "${s}" 에 금지 어휘 "${bad}"`).toBe(false);
          }
        }
      }
    });
  }
});
