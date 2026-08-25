// 절차적 효과음 — Web Audio API 로 합성(외부 음원 0). 게임 전반의 무에셋 기조와 일치.
// AudioContext 는 브라우저 정책상 사용자 제스처 후에만 재생 가능 → resume() 를 클릭 시 호출.

type AudioCtor = typeof AudioContext;

/**
 * 기본 빔 = 특수(barrage)의 **단발 기준** 파라미터(단일 출처). beam()은 여기에 f0 지터만,
 * barrage()는 빔 수(m)에 비례한 저음·길이·강도 가산을 얹는다. 둘이 손으로 따로 적히면 드리프트하므로 공유.
 */
const BEAM_BASE = {
  f0: 52,
  sweepFrom: 6.4,
  sweepTime: 0.12,
  dur: 0.4,
  peak: 0.34,
  crackGain: 0.85,
  ringGain: 0.26,
  subGain: 1.8,
} as const;

/** 발사·타격 등 짧은 효과음을 즉석 합성해 재생하는 경량 오디오 버스. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null; // 짧은 감쇠 노이즈(어택 클릭)
  private noiseBufLong: AudioBuffer | null = null; // 긴 평탄 노이즈(폭발 본체 — 엔벨로프/필터로 성형)
  private crushCurve: Float32Array<ArrayBuffer> | null = null; // 비트크러시 웨이브셰이퍼 커브(처치음 그레인 — 1회 생성)
  private enabled = true;

  constructor(private volume = 0.5) {}

  /** 사용자 제스처(클릭/포인터락) 시 호출 — AudioContext 지연 생성 + 재개. */
  resume(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC: AudioCtor | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
      if (!AC) return; // 오디오 미지원 → 무음
      this.ctx = new AC();
      const master = this.ctx.createGain();
      master.gain.value = this.volume;
      // 연사 중첩 시 클리핑 방지용 소프트 컴프레서
      const comp = this.ctx.createDynamicsCompressor();
      master.connect(comp).connect(this.ctx.destination);
      this.master = master;
      const sr = this.ctx.sampleRate;
      // 어택 트랜지언트용 짧은 감쇠 노이즈 버퍼(한 번만 생성)
      const len = (sr * 0.02) | 0;
      const buf = this.ctx.createBuffer(1, len, sr);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len); // 감쇠 화이트노이즈
      this.noiseBuf = buf;
      // 폭발 본체용 긴 평탄 노이즈(엔벨로프·필터로 성형) — 광대역 현실감의 핵심
      const len2 = (sr * 0.3) | 0;
      const buf2 = this.ctx.createBuffer(1, len2, sr);
      const ch2 = buf2.getChannelData(0);
      for (let i = 0; i < len2; i++) ch2[i] = Math.random() * 2 - 1; // 평탄 화이트노이즈
      this.noiseBufLong = buf2;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** 음소거 토글. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  /**
   * 기본 무기(주파수 빔) 발사음 — 모든 드론(워커/플라이어) 공통. 워커 특수(barrage)와 **동일한** 캐논 포격음
   * (BEAM_BASE = barrage 의 단발 기준). 특수(barrage)는 동일 음을 빔 수에 비례해 더 낮고·크게 키운 것.
   */
  beam(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const jitter = 0.96 + Math.random() * 0.08;
    this.shot({ ...BEAM_BASE, f0: BEAM_BASE.f0 * jitter });
  }

  /**
   * 플라즈모이드 접촉 피해음 — 달군 철판에 물이 닿아 기화하는 "치익" 스팀 버스트.
   * (1) 어택 "츳"(광대역) (2) 증기 히스(밴드패스 하강 스윕) (3) 케틀 휘슬 힌트(고Q 하강). 노이즈 주도·짧음.
   */
  sizzle(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const master = this.master;
    const peak = 0.28;

    // (0) 저역 퀜치 바디 — 차가운 물이 닿는 순간의 깊은 "쿰"(깊이감). 피치-드롭 사인.
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(96, now);
    body.frequency.exponentialRampToValueAtTime(52, now + 0.06);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, now);
    bg.gain.exponentialRampToValueAtTime(peak * 0.75, now + 0.006);
    bg.gain.exponentialRampToValueAtTime(0.0004, now + 0.2);
    body.connect(bg).connect(master);
    body.start(now);
    body.stop(now + 0.22);

    // (1) 어택 "츳" — 짧은 광대역 노이즈(물이 닿는 순간)
    if (this.noiseBuf) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, now);
      g.gain.exponentialRampToValueAtTime(0.0004, now + 0.05);
      n.connect(hp).connect(g).connect(master);
      n.start(now);
      n.stop(now + 0.06);
    }

    // (2) 증기 히스 본체 — 밴드패스가 5.2k→1.2k 로 하강하며 "치이익"(김 빠짐)
    if (this.noiseBufLong) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBufLong;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 1.1;
      bp.frequency.setValueAtTime(5200, now);
      bp.frequency.exponentialRampToValueAtTime(820, now + 0.32); // 더 낮게 내려가 두툼한 증기(깊이감)
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak * 0.9, now + 0.012); // 빠른 어택
      g.gain.exponentialRampToValueAtTime(0.0004, now + 0.34); // 증기 빠지듯 감쇠(조금 더 길게)
      n.loop = true; // 0.3s 버퍼를 넘겨 증기 꼬리가 끊기지 않게
      n.connect(bp).connect(g).connect(master);
      n.start(now);
      n.stop(now + 0.36);
    }

    // (3) 케틀 휘슬 힌트 — 고Q 밴드패스 하강(증기 휘파람), 낮게 깔아 "기화" 색채
    if (this.noiseBufLong) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBufLong;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 9;
      bp.frequency.setValueAtTime(4200, now);
      bp.frequency.exponentialRampToValueAtTime(2100, now + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak * 0.3, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0004, now + 0.24);
      n.connect(bp).connect(g).connect(master);
      n.start(now);
      n.stop(now + 0.25);
    }
  }

  /**
   * 특수무기 일제사격음 — 기본 빔(beam)보다 **더 낮고 묵직한 대구경 저음 포격**. 같은 shot() 코어.
   * beamCount(이번 살포의 빔 수)에 비례해 더 낮고·두껍고·강하게 들린다.
   */
  barrage(beamCount: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const m = Math.min(1, (Math.max(1, beamCount) - 1) / 9); // 1~10발 → 0..1(MAX_BEAMS=10 포화)
    const jitter = 0.96 + Math.random() * 0.08;
    const k = (1 - 0.2 * m) * jitter; // 빔 많을수록 더 낮게
    this.shot({
      ...BEAM_BASE,
      f0: BEAM_BASE.f0 * k, // 기본 빔과 동일 기준(m↑ → 더 낮은 묵직한 저음 포격)
      dur: BEAM_BASE.dur + 0.08 * m, // 더 길고 큰 포성
      peak: BEAM_BASE.peak + 0.12 * m,
      subGain: BEAM_BASE.subGain + 0.6 * m, // 서브 저음 대폭 강화 → 더 묵직
    });
  }

  /**
   * 오버드라이브(플라이어 특수) 연사음 — 기본 빔보다 낮고 묵직하되 **짧게**.
   * 0.09s 간격 연사에 포성 꼬리가 누적돼 뭉개지지 않도록 dur·금속 링을 줄여 타이트한 "둥둥둥" 저음.
   */
  overdrive(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const jitter = 0.94 + Math.random() * 0.12; // 발당 미세 변주(기계음 방지)
    this.shot({
      f0: 46 * jitter, // 기본 빔(52)보다 더 낮은 묵직한 저음
      sweepFrom: 5.5,
      sweepTime: 0.06,
      dur: 0.14, // 짧게 — 0.09s 연사 겹침 최소
      peak: 0.3,
      crackGain: 0.6,
      ringGain: 0.1, // 금속 링 최소(꼬리 누적 방지)
      subGain: 1.9, // 기본 빔(BEAM_BASE.subGain 1.8) 이상 — 더 깊은 저역, 단 짧아서 뭉개지지 않음
    });
  }

  /**
   * 심판 파문 통과음 — 초저역 "쿠웅"(피치 드롭) + 저역 럼블 스웰. 30초 주기 전장 이벤트가
   * 몸에 닿게 하는 임팩트. hit=true(낙인 피해 발생)면 더 크고 길게 + 소각 링 한 점.
   */
  reckoning(hit: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const master = this.master;
    const peak = hit ? 0.5 : 0.3;

    // (1) 초저역 "쿠웅" — 64→30Hz 피치 드롭 사인(파면이 지나가는 몸통 진동)
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(64, now);
    body.frequency.exponentialRampToValueAtTime(30, now + 0.25);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, now);
    bg.gain.exponentialRampToValueAtTime(peak, now + 0.02);
    bg.gain.exponentialRampToValueAtTime(0.0004, now + (hit ? 0.9 : 0.6));
    body.connect(bg).connect(master);
    body.start(now);
    body.stop(now + 1.0);

    // (2) 저역 럼블 — 로우패스 노이즈 스웰(파면의 부피감)
    if (this.noiseBufLong) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBufLong;
      n.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(340, now);
      lp.frequency.exponentialRampToValueAtTime(120, now + 0.6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak * 0.55, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0004, now + 0.7);
      n.connect(lp).connect(g).connect(master);
      n.start(now);
      n.stop(now + 0.75);
    }

    // (3) hit 시 낙인 소각 링 — 높은 삼각파 한 점이 빠르게 감쇠(대가를 치렀다는 종)
    if (hit) {
      const r = ctx.createOscillator();
      r.type = "triangle";
      r.frequency.value = 560;
      const re = ctx.createGain();
      re.gain.setValueAtTime(0.0001, now + 0.03);
      re.gain.exponentialRampToValueAtTime(peak * 0.28, now + 0.05);
      re.gain.exponentialRampToValueAtTime(0.0003, now + 0.4);
      r.connect(re).connect(master);
      r.start(now + 0.03);
      r.stop(now + 0.45);
    }
  }

  /**
   * 처치음(타격감 ①) — "결맞음 붕괴"(§1.6): 발사음(포격 계열)과 성격이 다른, 유일한 **붕괴** 사운드.
   * (1) 상승 차지 → 급격한 피치 다운(결맞음이 끊기는 순간) (2) 하이패스 디지털 노이즈 버스트("정보
   * 상실"의 질감 — 유기적 타격음과 갈라야 함) (3) 비화음 벨 링 2부분음(수정이 깨지는 여운).
   * strength(0..1)에 비례해 더 낮고·길고·크게 — barrage 의 "강할수록 묵직" 문법을 그대로 따른다.
   * 강체(strength≥0.35, §2.1과 동일 문턱)만 서브 저음 바디를 더해 보스급 무게감을 얹는다.
   */
  kill(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const master = this.master;
    const s = Math.max(0, Math.min(1, strength));
    // 기본음이 낮아야 무게가 생긴다 — 초기 구현 560~900Hz(가느다란 "삑") → 420~240Hz → 지금 300~170Hz.
    // 고역 바이트는 크랙·크런치 노이즈가 담당하므로 톤 자체는 계속 낮춰도 명료도가 죽지 않는다.
    const f0 = 300 - 130 * s; // 170Hz(강체) ~ 300Hz(약체)
    const peak = 0.26 + 0.18 * s;
    const dur = 0.18 + 0.16 * s; // 무게 = 지속 — 짧으면 아무리 저역이어도 "톡" 하고 만다

    // (1) 임팩트 크랙 — **맨 앞 18ms** 광대역 클릭. 총성의 "탕"에 해당하는 즉각 타격감으로,
    //     구 버전에 없던(노이즈가 50ms 뒤에야 들어와 물렁했던) 부분.
    if (this.noiseBuf) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 900 + 300 * (1 - s); // 낮출수록 "탁"(경쾌) → "퍽"(둔중). 무게 요청 반영.
      bp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.value = peak * 1.25;
      n.connect(bp).connect(g).connect(master);
      n.start(now);
      n.stop(now + 0.018);
    }

    // (2) 붕괴 코어 — **링 변조**(캐리어 × 비화성 모듈레이터)로 "삐—"가 아니라 지지직대는 에너지 톤.
    //     피치는 상승 차지 없이 **즉시 14ms 스냅 하강**: 결어긋남은 미끄러지는 게 아니라 끊기는 사건이다
    //     (구 버전의 "차지 후 긴 글리산도"가 만화적 "왱" 소리의 정체였다).
    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(f0 * 1.25, now);
    carrier.frequency.exponentialRampToValueAtTime(f0 * 0.34, now + 0.014); // 스냅 드롭
    carrier.frequency.exponentialRampToValueAtTime(f0 * 0.2, now + dur); // 이후 완만한 소멸
    // 링 변조: 게인의 gain 파라미터를 오디오 레이트로 흔들어 합/차 주파수(비화성 금속 질감) 생성.
    const ring = ctx.createGain();
    ring.gain.value = 0; // 모듈레이터만 게인을 구동(순수 링 변조)
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.setValueAtTime(f0 * 0.73, now); // 비화성 비율 — 정수배면 그냥 화음이 된다
    mod.frequency.exponentialRampToValueAtTime(f0 * 0.29, now + dur * 0.8); // 함께 무너져 내림
    const modDepth = ctx.createGain();
    modDepth.gain.value = 1;
    mod.connect(modDepth).connect(ring.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.004); // 즉발 어택
    env.gain.exponentialRampToValueAtTime(0.0004, now + dur);
    carrier.connect(ring).connect(env).connect(master);
    carrier.start(now);
    mod.start(now);
    carrier.stop(now + dur + 0.03);
    mod.stop(now + dur + 0.03);

    // (3) 서브 저음 — **전 개체 공통**(구 버전은 s≥0.35 강체 전용이라 잡몹 처치가 몸통 없이 텅 비었다.
    //     잡몹을 훨씬 많이 죽으므로 체감상 거의 모든 처치가 가벼웠던 주원인). 세기만 강함에 비례.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(f0 * 0.45, now);
    sub.frequency.exponentialRampToValueAtTime(f0 * 0.13, now + dur * 1.25); // 22~39Hz 까지 내려가 몸으로 느껴지는 대역
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, now);
    sg.gain.exponentialRampToValueAtTime(peak * (1.0 + 1.1 * s), now + 0.014); // 대폭 증량(구 0.55+0.75s)
    sg.gain.exponentialRampToValueAtTime(0.0004, now + dur * 1.5);
    sub.connect(sg).connect(master);
    sub.start(now);
    sub.stop(now + dur * 1.5 + 0.03);

    // (3b) 저역 붐 — 로우패스 노이즈 스웰. 사인 서브가 "음정"이라면 이건 **공기가 밀리는 부피감**이다.
    //      둘을 겹쳐야 "낮은 삐" 가 아니라 "묵직한 퍼억"이 된다(reckoning 의 럼블과 같은 원리, 더 짧게).
    if (this.noiseBufLong) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBufLong;
      n.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(220, now);
      lp.frequency.exponentialRampToValueAtTime(70, now + dur); // 대역이 가라앉으며 바닥으로
      lp.Q.value = 0.9;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, now);
      bg.gain.exponentialRampToValueAtTime(peak * (0.7 + 0.6 * s), now + 0.018);
      bg.gain.exponentialRampToValueAtTime(0.0004, now + dur * 1.1);
      n.connect(lp).connect(bg).connect(master);
      n.start(now);
      n.stop(now + dur * 1.15);
    }

    // (4) 크런치 디지털 노이즈 — 비트크러시(계단 양자화) 웨이브셰이퍼를 통과시켜 매끈한 화이트노이즈가
    //     아니라 **깨진 그레인**으로. "정보가 소실된다"는 질감(물리편 §3.2 디테일 상실)의 청각 대응.
    if (this.noiseBufLong) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBufLong;
      n.playbackRate.value = 0.7 + Math.random() * 0.5; // 매번 미세 변주(기계적 반복 방지)
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.getCrushCurve();
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.setValueAtTime(1200 - 400 * s, now); // 히스를 줄여 저역이 묻히지 않게(무게 요청)
      hp.frequency.exponentialRampToValueAtTime(420, now + dur); // 대역이 내려앉으며 뭉개짐
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, now + 0.008);
      ng.gain.exponentialRampToValueAtTime(peak * 0.5, now + 0.02); // 구 0.75 — 그레인은 질감만 담당
      ng.gain.exponentialRampToValueAtTime(0.0004, now + dur * 0.8);
      n.connect(shaper).connect(hp).connect(ng).connect(master);
      n.start(now + 0.008);
      n.stop(now + dur + 0.02);
    }

    // (5) 비화성 파열 링 — 구 버전(3.16×/5.9× 순정 사인, 긴 감쇠)은 "댕" 하는 종소리라 장식으로 들렸다.
    //     배음비를 벌리고 삼각파 + 짧은 감쇠로 바꿔 "파직"에 가까운 파열 여운으로.
    // 배음이 세면 소리가 위로 뜬다 — 무게 요청에 따라 게인을 낮추고(0.3→0.18) 여운도 더 짧게.
    for (const [mult, g] of [[4.1, 1], [6.7, 0.55]] as const) {
      const r = ctx.createOscillator();
      r.type = "triangle";
      r.frequency.value = f0 * mult;
      const re = ctx.createGain();
      re.gain.setValueAtTime(0.0001, now + 0.006);
      re.gain.exponentialRampToValueAtTime(peak * 0.18 * g, now + 0.014);
      re.gain.exponentialRampToValueAtTime(0.0003, now + 0.06); // 짧게 — 여운이 길면 다시 "종"이 된다
      r.connect(re).connect(master);
      r.start(now + 0.006);
      r.stop(now + 0.075);
    }
  }

  /**
   * 비트크러시 웨이브셰이퍼 커브(계단 양자화) — 입력을 N단계로 뭉개 디지털 그레인을 만든다.
   * 처치음(kill)의 "정보 소실" 질감 전용. 커브는 상태가 없어 1회 생성 후 공유.
   */
  private getCrushCurve(): Float32Array<ArrayBuffer> {
    if (this.crushCurve) return this.crushCurve;
    const n = 1024;
    const steps = 7; // 낮을수록 거칠다 — 7단계면 노이즈가 확연히 "깨져" 들린다
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1; // -1..1
      curve[i] = Math.round(x * steps) / steps; // 계단 양자화
    }
    this.crushCurve = curve;
    return curve;
  }

  /**
   * 공통 포격 합성 코어(시즈탱크 탱크모드 느낌):
   *  (1) 하강 스윕 톱니 + 추종 로우패스 → "뚜움" 머즐 톤
   *  (2) 저역 thump(피치-드롭 사인) + 서브 옥타브 → 묵직한 바닥
   *  (3) 비조화 금속 링 2부분음(빠른 감쇠) → 기계/포신 울림
   *  (4) 밴드패스 노이즈 크랙 → 발포 어택
   */
  private shot(o: {
    f0: number; // 착지 주파수(낮을수록 큰 포)
    sweepFrom: number; // 하강 스윕 시작 배수(>1)
    sweepTime: number; // 스윕 시간
    dur: number; // 전체 감쇠
    peak: number; // 본체 피크 게인
    crackGain: number; // 머즐 크랙 세기
    ringGain: number; // 금속 링 세기
    subGain: number; // 서브 옥타브 세기
  }): void {
    const ctx = this.ctx!;
    const master = this.master!;
    const now = ctx.currentTime;

    // 볼륨 엔벨로프(빠른 어택 → 짧고 드라이한 지수 감쇠)
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(o.peak, now + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0006, now + o.dur);
    amp.connect(master);

    // (1) 하강 스윕(톱니) + 추종 로우패스 → "뚜움" 머즐 톤
    const sweep = ctx.createOscillator();
    sweep.type = "sawtooth";
    sweep.frequency.setValueAtTime(o.f0 * o.sweepFrom, now);
    sweep.frequency.exponentialRampToValueAtTime(o.f0, now + o.sweepTime);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 1;
    lp.frequency.setValueAtTime(o.f0 * o.sweepFrom * 2.6, now);
    lp.frequency.exponentialRampToValueAtTime(o.f0 * 2.6, now + o.sweepTime);
    const swG = ctx.createGain();
    swG.gain.value = 0.6;
    sweep.connect(lp).connect(swG).connect(amp);
    sweep.start(now);
    sweep.stop(now + o.dur + 0.03);

    // (2) 저역 thump(피치-드롭 사인) + 서브 옥타브
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(o.f0 * 1.5, now);
    body.frequency.exponentialRampToValueAtTime(o.f0, now + 0.035);
    const bg = ctx.createGain();
    bg.gain.value = 0.85; // 묵직한 바닥 thump
    body.connect(bg).connect(amp);
    body.start(now);
    body.stop(now + o.dur + 0.03);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(o.f0 * 0.5, now);
    const sg = ctx.createGain();
    sg.gain.value = o.subGain;
    sub.connect(sg).connect(amp);
    sub.start(now);
    sub.stop(now + o.dur + 0.03);

    // (3) 비조화 금속 링 2부분음 — 빠른 자체 감쇠로 포신 울림
    const ringDur = Math.min(0.1, o.dur * 0.55);
    for (const [mult, g] of [[8.4, 1], [12.9, 0.6]] as const) {
      const r = ctx.createOscillator();
      r.type = "triangle";
      r.frequency.value = o.f0 * mult;
      const re = ctx.createGain();
      re.gain.setValueAtTime(0.0001, now);
      re.gain.exponentialRampToValueAtTime(o.peak * o.ringGain * g, now + 0.002);
      re.gain.exponentialRampToValueAtTime(0.0003, now + ringDur);
      r.connect(re).connect(master);
      r.start(now);
      r.stop(now + ringDur + 0.02);
    }

    // (4) 머즐 크랙 — 밴드패스 노이즈(발포 어택)
    if (this.noiseBuf) {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      const bpN = ctx.createBiquadFilter();
      bpN.type = "bandpass";
      bpN.frequency.value = 1500;
      bpN.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.value = o.peak * o.crackGain;
      n.connect(bpN).connect(ng).connect(master);
      n.start(now);
      n.stop(now + 0.016);
    }
  }
}
