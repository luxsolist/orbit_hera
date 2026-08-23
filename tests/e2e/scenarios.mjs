// 시나리오 플레이테스트(수동 도구 — CI 아님) — P0~P3 적용분의 **화면 표출·인식·흐름**을 실플레이로
// 검증한다. playtest.mjs 의 확장: 미션 강제(라우트 가로채기) + 캠페인/진행 시드(localStorage) +
// **평균 사용자 조작 시뮬레이션**(조준 스윕·이동 홀드·수동사격 버스트·특수 탭 — 초인적 정밀도 없음).
//
// 사용: node tests/e2e/scenarios.mjs <serverBase> <scenario> [outPrefix] [seconds]
// 시나리오: menu | severance | retro | experiment | phase | director | siege | aggro | offtarget
// 주의: 헤드리스 시간 지연(게임시간 ≈ 실제/3~5) — 절대 수치보다 거동·표출 관찰용.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

const BASE = process.argv[2] ?? "http://localhost:5173/";
const SCENARIO = process.argv[3] ?? "menu";
const OUT = process.argv[4] ?? `e2e-${SCENARIO}`;
const SECS = Number(process.argv[5] ?? 150);

// ─────────────────────────── 시드/미션 헬퍼 ───────────────────────────

const env = (data) => JSON.stringify({ v: 1, updatedAt: Date.now(), data });

/** 캠페인 시드 프리셋 — 시나리오별 장/증거/도시/벡터. */
const CAMPAIGN_SEEDS = {
  // 3장 수사판 — 표류 벡터 4건(교점 수렴 표시), 부산 함락, 서울 방어됨
  ch3: {
    chapter: 3,
    evidence: { heatmap: 100, pulse: 100, drift: 44, immortal: 12 },
    cities: {
      "seoul-stream": { state: "defended", defenses: 3, falls: 0 },
      "busan-stream": { state: "fallen", defenses: 1, falls: 2 },
    },
    driftVectors: [
      { cityId: "seoul-stream", x: 126.98, z: 37.58, dx: 0.83, dz: 0.55 },
      { cityId: "busan-stream", x: 129.07, z: 35.16, dx: 0.88, dz: 0.47 },
      { cityId: "seoul-stream", x: 126.98, z: 37.58, dx: 0.79, dz: 0.61 },
      { cityId: "everest-stream", x: 86.93, z: 27.99, dx: 0.96, dz: 0.28 },
    ],
    pairs: { "seoul-stream": { linked: "busan-stream", bond: 2 } },
    lastSortie: { cityId: "busan-stream", kills: 55 },
  },
  // 5장 — 증거 만충(실험 앵커 해금 상태)
  ch5: {
    chapter: 5,
    evidence: { heatmap: 100, pulse: 100, drift: 100, immortal: 100 },
    cities: { "seoul-stream": { state: "defended", defenses: 5, falls: 0 } },
    driftVectors: [], pairs: {},
  },
};

const PROGRESS_SEED = {
  drones: { walker: { xp: 1500 }, flyer: { xp: 0 } }, // 워커 L6 (+30HP, ×1.10, 2.5/s 재생)
  stats: { kills: 200, battlefieldsCleared: 6, landmarks: [], achievements: [] },
};

/** 미션 풀 강제 — 해당 id 만 서빙(선택기 결정성). patch 로 스펙 필드 오버라이드 가능(테스트 축소). */
async function forceMission(ctx, id, patch = null) {
  const res = await fetch(new URL("missions/index.json", BASE));
  const pool = await res.json();
  const m = pool.find((x) => x.id === id);
  if (!m) throw new Error(`mission ${id} not in pool`);
  const spec = patch ? { ...m, ...patch, goal: { ...m.goal, ...(patch.goal ?? {}) } } : m;
  await ctx.route("**/missions/index.json", (route) => route.fulfill({ json: [spec] }));
  return spec;
}

// ─────────────────────────── 브라우저/입력 ───────────────────────────

async function launch({ campaign, progress, query = "" }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  // 터치 시뮬레이션이 유발하는 브라우저 개입 경고(cancelable=false)는 게임 오류가 아님 — 필터
  page.on("console", (e) => {
    if (e.type() === "error" && !/Ignored attempt to cancel a touch/.test(e.text())) errors.push(e.text());
  });
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
  if (campaign || progress) {
    await page.addInitScript(([c, p]) => {
      if (c) localStorage.setItem("core.campaign", c);
      if (p) localStorage.setItem("core.progress", p);
    }, [campaign ? env(campaign) : null, progress ? env(progress) : null]);
  }
  await page.goto(BASE + query, { waitUntil: "load" });
  return { browser, ctx, page, errors };
}

async function openSeoulPopup(page) {
  await page.locator(".zone-dot").first().waitFor({ state: "visible", timeout: 20000 });
  const dot = page.locator('.zone-dot[data-map="seoul-stream"]');
  if (await dot.count()) await dot.click();
  else {
    await page.locator('.zone-dot[data-cluster*="seoul-stream"]').first().click();
    await page.locator('#clusterMap .zone-dot[data-map="seoul-stream"]').click();
  }
  await page.locator(".zonepop__drone").first().waitFor({ state: "visible", timeout: 8000 });
}

async function deploy(page, droneKey = "WALKER") {
  await openSeoulPopup(page);
  const drones = page.locator(".zonepop__drone");
  const n = await drones.count();
  for (let i = 0; i < n; i++) {
    if ((await drones.nth(i).innerText()).toUpperCase().includes(droneKey)) { await drones.nth(i).click(); break; }
  }
  await page.waitForFunction(() => {
    const el = document.getElementById("overlay");
    return !!el && el.classList.contains("is-hidden");
  }, { timeout: 60000 });
}

/**
 * 평균 사용자 조작 루프 — 초인적이지 않은 리듬:
 * 조준 스윕(0.5~0.9s 간격, 작은 델타) · 전진/스트레이프 홀드(4~7s 마다 1.5s) ·
 * 수동사격 버스트(2s 마다 3연타, 240ms 간격) · 특수 12s 마다 1탭. stop() 호출까지 반복.
 */
function humanInput(page, cdp) {
  let running = true;
  const W = 1280, H = 720;
  const touch = async (type, x, y, id) =>
    cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id }],
    }).catch(() => {});
  const drag = async (x0, y0, x1, y1, steps, stepMs, id) => {
    await touch("touchStart", x0, y0, id);
    for (let i = 1; i <= steps && running; i++) {
      await touch("touchMove", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, id);
      await page.waitForTimeout(stepMs);
    }
    await touch("touchEnd", 0, 0, id);
  };
  const loop = (fn, baseMs, jitterMs) => (async () => {
    while (running) {
      try { await fn(); } catch { /* 플레이크 무시 */ }
      await page.waitForTimeout(baseMs + Math.random() * jitterMs);
    }
  })();
  const tasks = [
    // 조준 스윕(우측 절반) — 사람 손목 속도의 짧은 드래그
    loop(async () => {
      const x = W * 0.7, y = H * 0.45;
      await drag(x, y, x + (Math.random() * 160 - 80), y + (Math.random() * 60 - 30), 5, 30, 9);
    }, 500, 400),
    // 이동 홀드(좌측 절반 위쪽으로) — 전진 + 좌우 지그재그
    loop(async () => {
      const x = W * 0.22, y = H * 0.68;
      await drag(x, y, x + (Math.random() * 120 - 60), y - 90, 10, 150, 7);
    }, 4000, 3000),
    // 수동사격 버스트 — FIRE 3연타
    loop(async () => {
      for (let i = 0; i < 3 && running; i++) {
        await page.locator(".tc__btn--fire").tap({ timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(240);
      }
    }, 2000, 800),
    // 특수 — 12s 주기 1탭(준비 안 됐으면 무시됨)
    loop(async () => {
      await page.locator(".tc__btn--special").tap({ timeout: 1500 }).catch(() => {});
    }, 12000, 3000),
  ];
  return { stop: async () => { running = false; await Promise.allSettled(tasks); } };
}

// ─────────────────────────── 샘플링 ───────────────────────────

const sampleHud = (page) => page.evaluate(() => {
  const txt = (id) => document.getElementById(id)?.textContent ?? "";
  const w = (id) => parseFloat(document.getElementById(id)?.style.width || "0");
  const q = (sel) => document.querySelector(sel);
  const cast = q(".hud__cast");
  const fore = q(".hud__foresight");
  const reck = q(".hud__reckoning");
  const overlay = document.getElementById("overlay");
  return {
    kills: Number(txt("killCount") || 0), hp: w("hpFill"),
    destroyed: Number(txt("destroyedCount") || 0), landmarks: Number(txt("landmarkLostCount") || 0),
    objective: txt("missionObjective"), detail: txt("missionDetail"), time: txt("missionTime"),
    resp: txt("missionResp"), unit: txt("unitName"),
    cast: cast?.classList.contains("hud__cast--show") ? cast.textContent : "",
    fore: fore && fore.style.display !== "none" ? fore.textContent : "",
    reck: reck && reck.style.display !== "none" ? reck.textContent : "",
    ended: !!overlay && !overlay.classList.contains("is-hidden"),
    endTitle: overlay?.querySelector(".overlay__title")?.textContent ?? "",
    endSub: overlay?.querySelector(".overlay__subtitle")?.textContent ?? "",
  };
});

async function runPlay(page, secs, out, opts = {}) {
  const cdp = await page.context().newCDPSession(page);
  const input = opts.noInput ? null : humanInput(page, cdp);
  const t0 = Date.now();
  const samples = [];
  const events = [];
  let prev = null, shots = 0;
  const shot = async (tag) => {
    if (shots >= 10) return;
    shots++;
    try { await page.screenshot({ path: `${out}-${tag}.png`, timeout: 8000 }); } catch { /* 무시 */ }
  };
  await shot("start");
  let failStreak = 0;
  while (Date.now() - t0 < secs * 1000) {
    const s = await sampleHud(page).catch(() => null);
    if (!s) {
      // 입력 시뮬레이션과의 일시적 경합(evaluate 실패) — 연속 8회까지 재시도 후 포기
      if (++failStreak > 8) break;
      await page.waitForTimeout(400);
      continue;
    }
    failStreak = 0;
    s.t = (Date.now() - t0) / 1000;
    samples.push(s);
    if (prev) {
      if (s.kills > prev.kills && !events.some((e) => e.ev === "first-kill")) events.push({ t: s.t, ev: "first-kill" });
      if (s.kills < prev.kills) { events.push({ t: s.t, ev: "REWOUND", from: prev.kills, to: s.kills }); await shot(`rewound-${s.t.toFixed(0)}s`); }
      if (s.hp < prev.hp - 0.5) events.push({ t: s.t, ev: "hp-drop", to: s.hp.toFixed(1) });
      if (!prev.fore && s.fore) { events.push({ t: s.t, ev: "FORESIGHT", text: s.fore }); await shot(`fore-${s.t.toFixed(0)}s`); }
      if (!prev.cast && s.cast) { events.push({ t: s.t, ev: "CAST", text: s.cast }); }
      if (!prev.reck && s.reck) { events.push({ t: s.t, ev: "reck-on", text: s.reck }); await shot(`reck-${s.t.toFixed(0)}s`); }
      if (s.landmarks > prev.landmarks) { events.push({ t: s.t, ev: "LANDMARK-LOST", n: s.landmarks }); await shot(`lmk-${s.t.toFixed(0)}s`); }
    } else if (s.cast) events.push({ t: s.t, ev: "CAST", text: s.cast });
    if (s.ended) { events.push({ t: s.t, ev: "END", title: s.endTitle, sub: s.endSub }); await shot("end"); break; }
    if (Math.floor(s.t / 35) !== Math.floor((prev?.t ?? 0) / 35)) await shot(`t${s.t.toFixed(0)}s`);
    prev = s;
    await page.waitForTimeout(250);
  }
  if (input) await input.stop();
  return { samples, events };
}

const gameSecOf = (last, total) => {
  const m = /^(\d+):(\d+)$/.exec(last?.time ?? "");
  return m ? total - (Number(m[1]) * 60 + Number(m[2])) : null;
};

const finish = async (page, browser, errors, data) => {
  const store = await page.evaluate(() => ({
    campaign: localStorage.getItem("core.campaign"),
    progress: localStorage.getItem("core.progress"),
  })).catch(() => ({}));
  const summary = { scenario: SCENARIO, ...data, consoleErrors: errors.slice(0, 10), store };
  writeFileSync(`${OUT}-summary.json`, JSON.stringify(summary, null, 1));
  const { store: _s, ...brief } = summary;
  console.log(JSON.stringify({ ...brief, events: data.events?.length ?? 0 }, null, 1));
  await browser.close();
};

// ─────────────────────────── 시나리오 ───────────────────────────

if (SCENARIO === "menu") {
  // P0 수사판 — 사건 파일·표류 오버레이·교점·도시 상태 점·팝업 상태/얽힘쌍·드론 Lv
  const { browser, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  await page.locator(".zone-dot").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() => ({
    caseFile: document.getElementById("caseFile")?.innerText ?? "",
    overlayLines: document.querySelectorAll(".drift-overlay line").length,
    origin: !!document.querySelector(".drift-origin"),
    fallenDots: document.querySelectorAll(".zone-dot--fallen").length,
    invadedDots: document.querySelectorAll(".zone-dot--invaded").length,
  }));
  await page.screenshot({ path: `${OUT}-worldmap.png` });
  await openSeoulPopup(page);
  const popup = await page.evaluate(() => ({
    meta: document.getElementById("zonePopMeta")?.textContent ?? "",
    drones: [...document.querySelectorAll(".zonepop__drone")].map((b) => b.textContent),
  }));
  await page.screenshot({ path: `${OUT}-popup.png` });
  await finish(page, browser, errors, { menu, popup });
} else if (SCENARIO === "severance") {
  // P3 커터 납치 + 브리핑 방송 + 진행 XP 적립 흐름
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  const spec = await forceMission(ctx, "severance");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  await finish(page, browser, errors, {
    mission: spec.id, seconds: last?.t, gameSec: gameSecOf(last, 240),
    kills: last?.kills, hp: last?.hp, destroyed: last?.destroyed, landmarks: last?.landmarks,
    unit: samples[0]?.unit, firstCast: events.find((e) => e.ev === "CAST")?.text ?? "",
    objective: last?.objective, detail: last?.detail, events,
  });
} else if (SCENARIO === "retro") {
  // P3 역행체 — 예지 카운트다운·처치 되감김·역행 방송
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  await forceMission(ctx, "retro-hunt");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  await finish(page, browser, errors, {
    mission: "retro-hunt", seconds: last?.t, gameSec: gameSecOf(last, 420),
    kills: last?.kills, hp: last?.hp, objective: last?.objective, detail: last?.detail,
    foresightSamples: samples.filter((s) => s.fore).length,
    foresightTexts: [...new Set(samples.filter((s) => s.fore).map((s) => s.fore))].slice(0, 3),
    castTexts: [...new Set(samples.filter((s) => s.cast).map((s) => s.cast))].slice(0, 4),
    rewoundEvents: events.filter((e) => e.ev === "REWOUND"),
    events,
  });
} else if (SCENARIO === "experiment") {
  // P1 계시 — 동시 조사 실험(테스트 축소: 2기/2s) → 성공 시 계시 패널 + 6장 전환
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch5, progress: PROGRESS_SEED });
  await forceMission(ctx, "experiment-strike", { goal: { targets: 2, hold: 2 } });
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  const chapterAfter = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("core.campaign")).data.chapter; } catch { return null; }
  });
  await finish(page, browser, errors, {
    mission: "experiment-strike(2기/2s 축소)", seconds: last?.t,
    objective: samples[0]?.objective, detailSamples: [...new Set(samples.map((s) => s.detail))].slice(0, 8),
    ended: last?.ended, endTitle: last?.endTitle, endSub: (last?.endSub ?? "").slice(0, 200),
    chapterAfter, events,
  });
} else if (SCENARIO === "phase") {
  // P2 위상 이탈 가시성 — 정예 로스터전(옅은 장). 스크린샷 판독용 + 흐름 지표
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  await forceMission(ctx, "thin-field");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  await finish(page, browser, errors, {
    mission: "thin-field", seconds: last?.t, gameSec: gameSecOf(last, 300),
    kills: last?.kills, hp: last?.hp, hpMin: Math.min(...samples.map((s) => s.hp)),
    objective: last?.objective, detail: last?.detail, events,
  });
} else if (SCENARIO === "director") {
  // P2 LLM 감독 파일럿 — 목업 API: brief + 파문 가속 변조. 45게임초 후 HUD 통신 라인 표출 확인
  const decisions = [];
  const mock = createServer((req, res) => {
    // CORS — 브라우저(5173 오리진)에서의 POST + JSON 프리플라이트 허용
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { decisions.push(JSON.parse(body)); } catch { decisions.push({ raw: body.slice(0, 200) }); }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        actions: [
          { type: "brief", text: "얽힘이 요동친다 — 파문 주기가 빨라진다. 낙인을 조심하라." },
          { type: "set-modifiers", modifiers: { sweepPeriodMul: 0.7 } },
          { type: "brief", text: "대상 영역 삭제를 재시도한다" }, // 금지 어휘 — 게이트에 거부돼야 함
        ],
      }));
    });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const port = mock.address().port;
  const { browser, ctx, page, errors } = await launch({
    campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED,
    query: `?director=${encodeURIComponent(`http://127.0.0.1:${port}/decide`)}`,
  });
  await forceMission(ctx, "grand-purge");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  mock.close();
  await finish(page, browser, errors, {
    mission: "grand-purge", seconds: last?.t, gameSec: gameSecOf(last, 300),
    kills: last?.kills, decideCalls: decisions.length,
    snapshotShape: decisions[0] ? Object.keys(decisions[0].snapshot ?? {}) : [],
    castTexts: [...new Set(samples.filter((s) => s.cast).map((s) => s.cast))].slice(0, 5),
    events,
  });
} else if (SCENARIO === "aggro") {
  // 체감 분화 보정(2026-08-23) 검증 — "목표가 달라도 전부 사냥으로 느껴진다"의 원인 ①②.
  // **같은 빌드에서 변조 유무만 바꿔** 두 판을 돌린다: 변조 없음(구 동작) vs aggro=landmark(신).
  // 관찰 지표 = 랜드마크/건물 상실. 구 동작은 적이 플레이어만 쫓으므로 표적이 거의 안 깎인다.
  const runOne = async (label, patch) => {
    const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
    await forceMission(ctx, "guard-landmark", patch);
    await deploy(page, "WALKER");
    const { samples } = await runPlay(page, SECS, `${OUT}-${label}`);
    const last = samples[samples.length - 1];
    await browser.close();
    return { label, kills: last?.kills, destroyed: last?.destroyed, landmarks: last?.landmarks,
             objective: last?.objective, detail: last?.detail, errors: errors.slice(0, 3) };
  };
  const before = await runOne("before", { modifiers: undefined });      // 구 데이터 = 어그로 변조 없음
  const after = await runOne("after", null);                            // 현 데이터 = aggro:landmark
  console.log("\n=== 어그로 변조 전후 비교(guard-landmark) ===");
  for (const r of [before, after]) {
    console.log(`  [${r.label.padEnd(6)}] 처치 ${r.kills} · 건물상실 ${r.destroyed} · 랜드마크상실 ${r.landmarks}`);
    console.log(`            ${r.objective} | ${r.detail}`);
    if (r.errors.length) console.log(`            에러: ${r.errors.join(" | ")}`);
  }
  writeFileSync(`${OUT}-summary.json`, JSON.stringify({ scenario: "aggro", before, after }, null, 1));
  process.exit(0);
} else if (SCENARIO === "offtarget") {
  // 원인 ③ 검증 — purge-role 비표적 처치 비용이 HUD 에 표출되고 시간을 깎는가.
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  const spec = await forceMission(ctx, "brand-hunt");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  const withCost = samples.filter((x) => (x.detail ?? "").includes("비표적")).length;
  await finish(page, browser, errors, {
    mission: spec.id, offTargetPenalty: spec.modifiers?.offTargetPenalty,
    seconds: last?.t, gameSec: gameSecOf(last, 300), kills: last?.kills,
    objective: last?.objective, detail: last?.detail,
    samplesShowingCost: withCost, totalSamples: samples.length, events,
  });
} else if (SCENARIO === "siege") {
  // P3 공성 낙인(buildingBrands) — 마커가 랜드마크에 낙인탄 → 파문이 건물 피해로 전환
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  const spec = await forceMission(ctx, "siege-brand");
  await deploy(page, "WALKER");
  const { samples, events } = await runPlay(page, SECS, OUT);
  const last = samples[samples.length - 1];
  await finish(page, browser, errors, {
    mission: spec.id, seconds: last?.t, gameSec: gameSecOf(last, 260),
    kills: last?.kills, hp: last?.hp, landmarks: last?.landmarks,
    firstCast: events.find((e) => e.ev === "CAST")?.text ?? "",
    objective: last?.objective, detail: last?.detail, events,
  });
} else if (SCENARIO === "linkrewind") {
  // P3 링크 리와인드(§2.8.3, 자가 시전) — KeyR 로 위치·HP + 반경 내 최근 파괴 건물을 되돌린다.
  // 반응형: destroyed/landmarks 카운터가 증가한 직후에만 KeyR(무언가 있어야 되돌릴 게 있다).
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  await forceMission(ctx, "grand-purge"); // aggro:building — 마커/거머리가 일반 건물도 공격(파괴 발생이 빠름)
  await deploy(page, "WALKER");
  const t0 = Date.now();
  const events = [];
  let prev = null;
  const cdp = await page.context().newCDPSession(page);
  const input = humanInput(page, cdp); // 이동/사격은 계속 시뮬레이션(평균 조작 유지)
  let presses = 0;
  while (Date.now() - t0 < SECS * 1000) {
    const s = await sampleHud(page).catch(() => null);
    if (s) {
      s.t = (Date.now() - t0) / 1000;
      if (prev) {
        if (!prev.cast && s.cast) events.push({ t: s.t, ev: "CAST", text: s.cast });
        if (s.destroyed > prev.destroyed) events.push({ t: s.t, ev: "DESTROYED", n: s.destroyed });
        if (s.landmarks < prev.landmarks) events.push({ t: s.t, ev: "LANDMARK-RESTORED" });
        if (s.destroyed < prev.destroyed) events.push({ t: s.t, ev: "BUILDING-RESTORED", from: prev.destroyed, to: s.destroyed });
      }
      // 파괴 직후 곧바로 시전(반응형) — 되돌릴 대상이 있을 때만
      if (prev && s.destroyed > prev.destroyed) {
        await page.keyboard.press("KeyR").catch(() => {});
        presses++;
      }
      prev = s;
    }
    await page.waitForTimeout(250);
  }
  await input.stop();
  const last = prev;
  await finish(page, browser, errors, {
    mission: "grand-purge", seconds: last?.t, keyRPresses: presses,
    landmarks: last?.landmarks, destroyed: last?.destroyed,
    destroyEvents: events.filter((e) => e.ev === "DESTROYED").length,
    restoreEvents: events.filter((e) => e.ev.includes("RESTORED")),
    castTexts: [...new Set(events.filter((e) => e.ev === "CAST").map((e) => e.text))],
    events,
  });
} else if (SCENARIO === "lensvisual") {
  // P3 중력 렌즈 왜곡(§2.7.1) — 위상 이탈 개체 배경 일렁임 시각 확인(정예 로스터전 — 옅은 장)
  const { browser, ctx, page, errors } = await launch({ campaign: CAMPAIGN_SEEDS.ch3, progress: PROGRESS_SEED });
  await forceMission(ctx, "thin-field");
  await deploy(page, "WALKER");
  const t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < SECS * 1000 && shots < 6) {
    await page.waitForTimeout(5000);
    try { await page.screenshot({ path: `${OUT}-t${((Date.now() - t0) / 1000).toFixed(0)}s.png` }); shots++; } catch { /* 무시 */ }
  }
  await finish(page, browser, errors, { mission: "thin-field", shots });
} else {
  console.error("unknown scenario", SCENARIO);
  process.exit(1);
}
