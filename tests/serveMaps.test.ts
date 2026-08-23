import { describe, it, expect } from "vitest";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { mapsMiddleware } from "../scripts/vite-serve-maps.mjs";

// 개발 서버의 맵 청크 서빙. 회귀 이력: `watch.ignored` 로 public/maps 를 워처에서 빼자 Vite 의
// public 파일 색인이 새 셀을 못 보고 **SPA 폴백(200 + index.html)** 을 돌려줬다 — 로마를 새로 구워도
// "타일 매니페스트 없음"으로 선택이 안 됐고, 서버를 재시작해야만 고쳐졌다.
// 실패가 404 가 아니라 200 이라는 게 문제의 핵심이었으므로 상태코드를 특히 못박는다.

/** connect 미들웨어를 구동하고 결과(상태·헤더·본문·next 호출 여부)를 모은다. */
function run(mw: (req: unknown, res: unknown, next: () => void) => void, url: string) {
  const chunks: Buffer[] = [];
  let ended = false, nexted = false;
  const headers: Record<string, string | number> = {};
  const res = {
    statusCode: 200,
    setHeader(k: string, v: string | number) { headers[k.toLowerCase()] = v; },
    end(body?: string) { if (body) chunks.push(Buffer.from(body)); ended = true; },
    // createReadStream(...).pipe(res) 대응 — 스트림이 쓰는 최소 인터페이스
    on() { return res; },
    once() { return res; },
    emit() { return true; },
    write(c: Buffer) { chunks.push(Buffer.from(c)); return true; },
    destroy() {},
  };
  mw(
    { url } as unknown,
    res as unknown,
    () => { nexted = true; }
  );
  return { res, headers, nexted, ended, body: () => Buffer.concat(chunks).toString() };
}

const MW = () => mapsMiddleware({ root: "public/maps", prefix: "maps", base: "/" });

describe("mapsMiddleware — 맵 경로 선점", () => {
  it("맵 경로가 아니면 통과(next)", () => {
    for (const url of ["/", "/index.html", "/src/main.ts", "/drones/index.json"]) {
      expect(run(MW(), url).nexted, url).toBe(true);
    }
  });

  it("맵 경로는 선점한다(next 호출 안 함)", () => {
    expect(run(MW(), "/maps/index.json").nexted).toBe(false);
  });
});

describe("mapsMiddleware — 없는 파일은 404(SPA 폴백으로 새지 않는다)", () => {
  it("존재하지 않는 셀은 404 — 200+HTML 이면 데이터 누락이 조용히 묻힌다", () => {
    const r = run(MW(), "/maps/99/99/tiles.json");
    expect(r.res.statusCode).toBe(404);
    expect(r.nexted).toBe(false); // next() 로 넘기면 SPA 폴백이 200 을 준다
  });

  it("디렉터리 요청도 404", () => {
    expect(run(MW(), "/maps/37/").res.statusCode).toBe(404);
  });
});

describe("mapsMiddleware — 보안", () => {
  it("경로 탈출(../)은 403", () => {
    for (const url of ["/maps/../../etc/passwd", "/maps/37/../../../package.json"]) {
      expect(run(MW(), url).res.statusCode, url).toBe(403);
    }
  });

  it("인코딩된 탈출도 403", () => {
    expect(run(MW(), "/maps/%2e%2e/%2e%2e/package.json").res.statusCode).toBe(403);
  });

  it("잘못된 % 인코딩은 400", () => {
    expect(run(MW(), "/maps/%ZZ.json").res.statusCode).toBe(400);
  });
});

describe("mapsMiddleware — 실제 파일 서빙", () => {
  it("존재하는 카탈로그는 JSON 헤더로 응답", () => {
    const r = run(MW(), "/maps/index.json");
    expect(r.res.statusCode).toBe(200);
    expect(String(r.headers["content-type"])).toContain("application/json");
    expect(Number(r.headers["content-length"])).toBeGreaterThan(0);
    expect(r.headers["cache-control"]).toBe("no-cache"); // 재빌드 즉시 반영
  });

  it("쿼리스트링·해시가 붙어도 같은 파일", () => {
    for (const url of ["/maps/index.json?v=2", "/maps/index.json#x"]) {
      expect(run(MW(), url).res.statusCode, url).toBe(200);
    }
  });
});

describe("mapsMiddleware — base 접두", () => {
  it("base 가 붙은 요청을 해석한다(하위 경로 배포)", () => {
    const mw = mapsMiddleware({ root: "public/maps", prefix: "maps", base: "/game/" });
    expect(run(mw, "/game/maps/index.json").res.statusCode).toBe(200);
    expect(run(mw, "/maps/index.json").nexted).toBe(true); // base 밖은 통과
  });

  it('base "./"(빌드 설정)는 루트로 취급', () => {
    const mw = mapsMiddleware({ root: "public/maps", prefix: "maps", base: "./" });
    expect(run(mw, "/maps/index.json").res.statusCode).toBe(200);
  });
});
