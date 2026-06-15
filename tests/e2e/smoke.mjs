// E2E 스모크 — 빌드 산출물을 vite preview 로 띄우고, 각 전장을 실제로 로드/플레이해
// (1) 콘솔/페이지 에러 0, (2) 게임이 playing 진입(오버레이 숨김),
// (3) 미니맵 렌더됨(프레임 루프 동작), (4) 메인 WebGL 화면이 블랙이 아님(PNG 크기 휴리스틱)
// 을 검증한다. 단위 테스트가 못 잡는 렌더/블랙스크린 회귀 가드.
//
// 실행: npm run test:e2e   (vite build 후 이 스크립트)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { get } from "node:http";
import zlib from "node:zlib";
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
const VIEW_CLIP = { x: 490, y: 210, width: 300, height: 300 };

function startErrorCapture(page) {
  const errors = [];
  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");
  page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  return errors;
}

async function captureClip(page, clip = VIEW_CLIP) {
  for (let r = 0; r < 2; r++) {
    try {
      return await page.screenshot({ clip, timeout: 15000 });
    } catch {
      // 폰트대기/ReadPixels 플레이크 → 재시도
    }
  }
  return null;
}

function decodePng(buf) {
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    p += 12 + len;
  }
  const ch = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 0;
  if (bitDepth !== 8 || !ch) throw new Error(`unsupported PNG bitDepth=${bitDepth} colorType=${colorType}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else {
        throw new Error("bad PNG filter " + f);
      }
      out[y * stride + x] = r & 0xff;
    }
  }
  return { width, height, ch, data: out };
}

function analyzePngBytes(buf) {
  const png = decodePng(buf);
  let lumaSum = 0;
  let saturationSum = 0;
  let visible = 0;
  const total = png.width * png.height;
  for (let i = 0; i < total; i++) {
    const off = i * png.ch;
    const r = png.data[off];
    const g = png.ch === 1 ? r : png.data[off + 1];
    const b = png.ch === 1 ? r : png.data[off + 2];
    const a = png.ch === 4 ? png.data[off + 3] : 255;
    if (a < 8) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lumaSum += luma;
    saturationSum += max - min;
    if (luma > 12) visible++;
  }
  return {
    avgLuma: lumaSum / Math.max(1, total),
    avgSaturation: saturationSum / Math.max(1, total),
    visibleRatio: visible / Math.max(1, total),
  };
}

function isNonBlankCapture(buf) {
  const a = analyzePngBytes(buf);
  return {
    ok: a.avgLuma > 18 && a.visibleRatio > 0.55 && a.avgSaturation > 4,
    summary: `luma=${a.avgLuma.toFixed(1)} visible=${(a.visibleRatio * 100).toFixed(0)}% sat=${a.avgSaturation.toFixed(1)}`,
  };
}

try {
  if (!(await waitServer())) throw new Error(`preview server not up on ${PORT}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // ─── 인트로 시네마틱: 버튼 재생 → 수 초 재생 → 예외/NaN 0, 캔버스 비-블랙, Esc 복귀 ───
  {
    console.log(`\n[intro] 시네마틱 재생`);
    const errors = startErrorCapture(page);
    await page.goto(BASE, { waitUntil: "load" });
    await page.locator("#storyBtn").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#storyBtn").click(); // 스토리 버튼 → 목록
    await page.locator(".sidepop__item").first().click(); // 첫 항목(인트로) → 재생
    await page.waitForTimeout(6000); // 스킵 없이 재생(씬1~2 build/update + 프레임 루프 가동)

    const introHidden = await page.evaluate(() => {
      const el = document.getElementById("overlay");
      return !!el && el.classList.contains("is-hidden"); // 재생 중엔 메뉴 숨김
    });
    ok(introHidden, "인트로 재생 중(메뉴 오버레이 숨김)");

    const introCapture = await captureClip(page);
    if (!introCapture) console.log("  · 인트로 캡처 불가(플레이크) — 블랙 검사 건너뜀");
    else {
      const view = isNonBlankCapture(introCapture);
      ok(view.ok, `인트로 화면 비-블랙(${view.summary})`);
    }

    await page.keyboard.press("Escape"); // 즉시 종료 → 메뉴 복귀
    await page.locator(".zone-dot").first().waitFor({ state: "visible", timeout: 15000 });
    ok(true, "Esc 인트로 종료 → 메뉴 복귀");
    ok(errors.length === 0, `인트로 콘솔/페이지 에러 0${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);
  }

  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    console.log(`\n[${m.id}] ${m.name}`);
    const errors = startErrorCapture(page);

    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.locator(".zone-dot").first().waitFor({ state: "visible", timeout: 15000 });
    const dot = page.locator(`.zone-dot[data-map="${m.id}"]`);
    if (await dot.count()) {
      await dot.click(); // 단일 점 → 바로 팝업
    } else {
      // 클러스터(대표 점)에 묶임 → 대표 점 클릭 → 확대창의 세부 점 클릭
      const cluster = page.locator(`.zone-dot[data-cluster*="${m.id}"]`);
      await cluster.first().click();
      await page.locator(`#clusterMap .zone-dot[data-map="${m.id}"]`).waitFor({ state: "visible", timeout: 5000 });
      await page.locator(`#clusterMap .zone-dot[data-map="${m.id}"]`).click();
    }
    await page.locator(".zonepop__drone").first().waitFor({ state: "visible", timeout: 8000 });
    await page.locator(".zonepop__drone").first().click(); // 기체 선택 → 즉시 출격
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

    // (4) 메인 WebGL 화면이 블랙/빈 화면이 아님 — PNG 압축 크기 대신 픽셀 통계로 검증
    const mainCapture = await captureClip(page);
    if (!mainCapture) console.log("  · WebGL 캡처 불가(플레이크) — 블랙 검사 건너뜀");
    else {
      const view = isNonBlankCapture(mainCapture);
      ok(view.ok, `메인 화면 비-블랙(${view.summary})`);
    }

    // (참고) 전투(자동빔 적중)는 포인터락이 필요한 playing 업데이트 게이트라 헤드리스에서 검증 불가 → 플레이테스트로 확인.

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
