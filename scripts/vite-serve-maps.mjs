// 개발 서버에서 맵 청크(public/maps)를 **디스크에서 직접** 서빙하는 미들웨어.
//
// 왜 필요한가: Vite 는 public/ 파일 목록을 서버 시작 시 색인하고 **파일 워처로 갱신**한다.
// vite.config 의 `server.watch.ignored: ["**/public/maps/**"]`(맵 청크 수만 개를 watch 하지 않기 위한 설정)
// 때문에 **새로 구운 셀이 색인에 영영 들어오지 않고** SPA 폴백(index.html, HTTP 200)으로 떨어진다.
// 증상은 "타일 월드 로드 실패 — 타일 매니페스트 없음"이고, 서버를 재시작해야만 고쳐졌다.
// 100개 도시 규모에서는 도시를 구울 때마다 재시작해야 하고, 실패가 404 가 아니라 200+HTML 이라
// 조용히 묻힌다. 그래서 맵 경로만 워처/색인을 우회해 직접 읽어 준다.
//
// 프로덕션 빌드는 public/ 을 dist/ 로 복사하므로 이 플러그인이 필요 없다(apply: "serve").

import { createReadStream, statSync } from "node:fs";
import { resolve, sep, extname } from "node:path";

const MIME = {
  ".json": "application/json; charset=utf-8",
  ".bin": "application/octet-stream",
  ".png": "image/png",
};

/**
 * connect 미들웨어 생성 — `<base>maps/**` 요청을 root 아래 파일로 해석해 스트리밍한다. 순수 팩토리(테스트 가능).
 *
 * 없는 파일은 **404 로 끝낸다**(next() 로 넘기지 않는다) — 넘기면 SPA 폴백이 index.html 을 200 으로
 * 돌려주고, 런타임은 JSON 파싱 실패를 "데이터 없음"으로만 보게 되어 원인이 묻힌다.
 */
export function mapsMiddleware({ root, prefix = "maps", base = "/" } = {}) {
  const rootAbs = resolve(root);
  // base 정규화 — "./"(빌드용 상대 base)는 개발 서버에서 루트. 항상 "/" 로 시작·끝나게 맞춘다.
  let basePath = base && base.startsWith("/") ? base : "/";
  if (!basePath.endsWith("/")) basePath += "/";
  return function serveMaps(req, res, next) {
    const url = (req.url || "").split("?")[0].split("#")[0];
    // base 밖 요청은 우리 소관이 아니다(하위 경로 배포 시 base 없는 /maps/ 를 서빙하면 안 된다).
    if (!url.startsWith(basePath)) return next();
    const rest = url.slice(basePath.length);
    if (!rest.startsWith(`${prefix}/`)) return next();

    let rel;
    try { rel = decodeURIComponent(rest.slice(prefix.length + 1)); }
    catch { res.statusCode = 400; return res.end("bad path"); } // 잘못된 % 인코딩

    const file = resolve(rootAbs, rel);
    if (file !== rootAbs && !file.startsWith(rootAbs + sep)) { // 경로 탈출(../) 차단
      res.statusCode = 403;
      return res.end("forbidden");
    }

    let st = null;
    try { st = statSync(file); } catch { /* 없음 */ }
    if (!st || !st.isFile()) {
      res.statusCode = 404;
      return res.end("not found");
    }

    res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
    res.setHeader("Content-Length", st.size);
    res.setHeader("Cache-Control", "no-cache"); // 재빌드가 즉시 반영되도록
    createReadStream(file).pipe(res);
  };
}

/** Vite 플러그인 — 개발 서버에만 적용. 내부 미들웨어(SPA 폴백)보다 **먼저** 등록해 맵 경로를 선점한다. */
export function serveMapsFromDisk({ dir = "public/maps", prefix = "maps" } = {}) {
  return {
    name: "serve-maps-from-disk",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(mapsMiddleware({ root: dir, prefix, base: server.config.base }));
    },
  };
}
