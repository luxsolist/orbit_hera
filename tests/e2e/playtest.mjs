// 플레이테스트 하네스(수동 도구 — CI 아님) — 모바일 합성 락(hasTouch) 경로로 헤드리스에서 게임
// 루프를 실제 구동하고, HUD DOM 을 주기 샘플링해 전투 타임라인(처치·HP·낙인·심판 파문·미션)을
// 수집한다. 유닛이 못 잡는 회귀(파문 진앙 면제, 시간 지연, 미션 로드)를 실플레이로 검증하는 용도.
//
// 사용: 서버 기동(npm run dev 또는 vite preview) 후
//   node tests/e2e/playtest.mjs http://localhost:5173/ seoul-stream WALKER 180 /tmp/run1
// 인자: <serverBase> <mapId> <droneKeyword(WALKER|FLYER)> <seconds> <outPrefix>
// 산출: <outPrefix>-summary.json(타임라인·이벤트·gameSec — 헤드리스 시간 지연 보정치) + 스크린샷.
// 주의: 헤드리스 렌더가 느려 게임 시간이 실제의 1/3~1/5 로 흐른다 — 절대 수치보다 거동 관찰용.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [BASE, MAP_ID, DRONE_KEY, SECS, OUT] = [
  process.argv[2] ?? "http://localhost:4179/",
  process.argv[3] ?? "seoul-stream",
  process.argv[4] ?? "WALKER",
  Number(process.argv[5] ?? 160),
  process.argv[6] ?? "run",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (e) => { if (e.type() === "error") errors.push(e.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(BASE, { waitUntil: "load" });
await page.locator(".zone-dot").first().waitFor({ state: "visible", timeout: 20000 });
const dot = page.locator(`.zone-dot[data-map="${MAP_ID}"]`);
if (await dot.count()) await dot.click();
else {
  await page.locator(`.zone-dot[data-cluster*="${MAP_ID}"]`).first().click();
  await page.locator(`#clusterMap .zone-dot[data-map="${MAP_ID}"]`).click();
}
await page.locator(".zonepop__drone").first().waitFor({ state: "visible", timeout: 8000 });
// 드론 선택 — displayName 에 키워드 포함되는 버튼
const drones = page.locator(".zonepop__drone");
const n = await drones.count();
let clicked = false;
for (let i = 0; i < n; i++) {
  const t = (await drones.nth(i).innerText()).toUpperCase();
  if (t.includes(DRONE_KEY.toUpperCase())) { await drones.nth(i).click(); clicked = true; break; }
}
if (!clicked) await drones.first().click();

// playing 진입 대기(오버레이 숨김)
await page.waitForFunction(() => {
  const el = document.getElementById("overlay");
  return !!el && el.classList.contains("is-hidden");
}, { timeout: 40000 });

const t0 = Date.now();
const samples = [];
const events = [];
let prev = null;
let shots = 0;
const shot = async (tag) => {
  if (shots >= 8) return;
  shots++;
  try { await page.screenshot({ path: `${OUT}-${tag}.png`, timeout: 8000 }); } catch { /* 플레이크 무시 */ }
};

await shot("start");
while (Date.now() - t0 < SECS * 1000) {
  const s = await page.evaluate(() => {
    const txt = (id) => document.getElementById(id)?.textContent ?? "";
    const w = (id) => parseFloat(document.getElementById(id)?.style.width || "0");
    const reck = document.querySelector(".hud__reckoning");
    const overlay = document.getElementById("overlay");
    return {
      kills: Number(txt("killCount") || 0),
      wave: Number(txt("waveCount") || 0),
      hp: w("hpFill"),
      freq: w("freqFill"),
      destroyed: Number(txt("destroyedCount") || 0),
      landmarks: Number(txt("landmarkLostCount") || 0),
      objective: txt("missionObjective"),
      detail: txt("missionDetail"),
      time: txt("missionTime"),
      resp: txt("missionResp"),
      reck: reck && reck.style.display !== "none" ? reck.textContent : "",
      ended: !!overlay && !overlay.classList.contains("is-hidden"),
      endTitle: overlay?.querySelector(".overlay__title")?.textContent ?? "",
      endSub: overlay?.querySelector(".overlay__subtitle")?.textContent ?? "",
    };
  });
  s.t = (Date.now() - t0) / 1000;
  samples.push(s);

  if (prev) {
    if (s.hp < prev.hp - 0.5) events.push({ t: s.t, ev: "hp-drop", from: prev.hp.toFixed(1), to: s.hp.toFixed(1), reck: s.reck });
    if (!prev.reck && s.reck) { events.push({ t: s.t, ev: "reck-on", text: s.reck }); await shot(`reck-${s.t.toFixed(0)}s`); }
    if (prev.reck && !s.reck) events.push({ t: s.t, ev: "reck-off" });
    if (prev.reck !== s.reck && prev.reck && s.reck) events.push({ t: s.t, ev: "reck-change", text: s.reck });
    if (s.kills >= prev.kills + 10) events.push({ t: s.t, ev: "kills", n: s.kills });
  }
  if (s.ended) { events.push({ t: s.t, ev: "END", title: s.endTitle, sub: s.endSub }); await shot("end"); break; }
  if (Math.floor(s.t / 40) !== Math.floor((prev?.t ?? 0) / 40)) await shot(`t${s.t.toFixed(0)}s`);
  prev = s;
  await page.waitForTimeout(250);
}

const last = samples[samples.length - 1];
// 미션 시계(m:ss, 300s 카운트다운) → 경과 게임 시간(초) — 헤드리스 시간 지연 보정용
const gameSec = (() => {
  const m = /^(\d+):(\d+)$/.exec(last?.time ?? "");
  return m ? 300 - (Number(m[1]) * 60 + Number(m[2])) : null;
})();
const summary = {
  map: MAP_ID, drone: DRONE_KEY, seconds: last?.t ?? 0, gameSec,
  kills: last?.kills, hpEnd: last?.hp, destroyed: last?.destroyed, landmarks: last?.landmarks,
  objective: last?.objective, detail: last?.detail, respLeft: last?.resp,
  ended: last?.ended ?? false, endTitle: last?.endTitle ?? "", endSub: last?.endSub ?? "",
  hpMin: Math.min(...samples.map((x) => x.hp)),
  reckSamples: samples.filter((x) => x.reck).length,
  totalSamples: samples.length,
  consoleErrors: errors.slice(0, 10),
  events,
};
writeFileSync(`${OUT}-summary.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, events: `${events.length} events (see file)` }, null, 1));
await browser.close();
