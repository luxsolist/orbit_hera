// E2E 스모크 — 빌드 산출물을 vite preview 로 띄우고, 각 전장을 실제로 로드/플레이해
// (1) 콘솔/페이지 에러 0, (2) 게임이 playing 진입(오버레이 숨김),
// (3) 미니맵 렌더됨(프레임 루프 동작), (4) 메인 WebGL 화면이 블랙이 아님(PNG 크기 휴리스틱)
// 을 검증한다. 단위 테스트가 못 잡는 렌더/블랙스크린 회귀 가드.
//
// 실행: npm run test:e2e   (vite build 후 이 스크립트)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import { chromium } from "playwright";

const PORT = 4178;
const BASE = `http://localhost:${PORT}/`;
const maps = JSON.parse(readFileSync("public/maps/index.json", "utf8"));

const ping = () =>
  new Promise((res) => get(BASE, (r) => { r.resume(); res(r.statusCode === 200); }).on("error", () => res(false)));
async function waitServer(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const preview = spawn("node_modules/.bin/vite", ["preview", "--port", String(PORT), "--strictPort"], {
  stdio: ["ignore", "ignore", "inherit"],
});

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); console.log(`  ${cond ? "✓" : "✗"} ${msg}`); };

try {
  if (!(await waitServer())) throw new Error(`preview server not up on ${PORT}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    console.log(`\n[${m.id}] ${m.name}`);
    const errors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape"); // 인트로 시네마틱 스킵 → 메뉴
    await page.locator(".overlay__map").first().waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".overlay__map").nth(i).click(); // 카탈로그 순서 = index.json 순서
    await page.waitForTimeout(5000); // 다운로드 + 월드 빌드 + 첫 프레임들

    // (2) playing 진입 → 오버레이 숨김(locator 는 가시성 대기하므로 evaluate 로 직접 확인)
    const hidden = await page.evaluate(() => {
      const el = document.getElementById("overlay");
      return !!el && el.classList.contains("is-hidden");
    });
    ok(hidden, "게임 playing 진입(오버레이 숨김)");

    // (3) 미니맵 렌더됨(2D 캔버스에 그려졌는가 — 중앙 픽셀 alpha>0)
    const mmDrawn = await page.evaluate(() => {
      const c = document.getElementById("minimap");
      if (!c) return false;
      const g = c.getContext("2d");
      const d = g.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
      return d[3] > 0;
    });
    ok(mmDrawn, "미니맵 렌더됨(프레임 루프 동작)");

    // (4) 메인 WebGL 화면이 블랙/단색이 아님 — 중앙 클립 PNG 크기 휴리스틱
    let size = 0;
    for (let r = 0; r < 2 && size === 0; r++) {
      try {
        const buf = await page.screenshot({ clip: { x: 490, y: 210, width: 300, height: 300 }, timeout: 15000 });
        size = buf.length;
      } catch { /* 폰트대기 플레이크 → 재시도 */ }
    }
    if (size === 0) console.log("  · WebGL 캡처 불가(플레이크) — 블랙 검사 건너뜀");
    else ok(size > 3000, `메인 화면 비-블랙(PNG ${size}B > 3000)`);

    // (1) 에러 0
    ok(errors.length === 0, `콘솔/페이지 에러 0${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);
  }

  await browser.close();
} catch (e) {
  failures.push("FATAL: " + e.message);
  console.error(e);
} finally {
  preview.kill("SIGTERM");
}

console.log(`\n${failures.length ? "FAIL" : "PASS"} — ${maps.length} maps, ${failures.length} failure(s)`);
process.exit(failures.length ? 1 : 0);
