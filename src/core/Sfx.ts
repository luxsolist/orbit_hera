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
