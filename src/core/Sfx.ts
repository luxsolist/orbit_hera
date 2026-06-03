// 절차적 효과음 — Web Audio API 로 합성(외부 음원 0). 게임 전반의 무에셋 기조와 일치.
// AudioContext 는 브라우저 정책상 사용자 제스처 후에만 재생 가능 → resume() 를 클릭 시 호출.

type AudioCtor = typeof AudioContext;

/** 발사·타격 등 짧은 효과음을 즉석 합성해 재생하는 경량 오디오 버스. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private enabled = true;
  private recentBeams: number[] = []; // 최근 발사 시각들 → 동시발사 수 산출(묵직함 가중)

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
      // 어택 트랜지언트용 노이즈 버퍼(한 번만 생성)
      const len = (this.ctx.sampleRate * 0.02) | 0;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len); // 감쇠 화이트노이즈
      this.noiseBuf = buf;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  /** 음소거 토글. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  /**
   * 에너지 주파수 빔 발사음 — 스타크래프트 시즈탱크(탱크 모드) 포격 느낌:
   * 빠른 하강 스윕("뚜움") + 저역 thump + 금속 링 + 머즐 크랙. manual=수동(묵직)/false=자동(약간 높게).
   * 짧은 시간 창(BEAM_WINDOW) 안의 동시발사 수에 비례해 더 낮고 둔탁해진다.
   */
  beam(manual = true): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const now = ctx.currentTime;

    // 동시발사 가중 w(0..1) — 최근 창 안의 발사 수가 많을수록 ↑
    const BEAM_WINDOW = 0.22;
    while (this.recentBeams.length && this.recentBeams[0] < now - BEAM_WINDOW) this.recentBeams.shift();
    this.recentBeams.push(now);
    const w = Math.min(1, (this.recentBeams.length - 1) / 5); // 6발 동시쯤 포화

    const jitter = 0.95 + Math.random() * 0.1; // 발당 미세 피치 흔들림 → 기계음 방지
    const heavy = (1 - 0.18 * w) * jitter; // 동시발사 ↑ → 더 낮게
    this.shot({
      f0: (manual ? 98 : 134) * heavy, // 착지(바디) 주파수 — 더 큰 포(낮게)
      sweepFrom: manual ? 5.2 : 4.4, // 하강 스윕 시작 배수("뚜→움")
      sweepTime: manual ? 0.085 : 0.065,
      dur: (manual ? 0.26 : 0.18) + 0.05 * w, // 더 긴 잔향(큰 포)
      peak: manual ? 0.3 : 0.22,
      crackGain: 0.8, // 머즐 크랙(금속성 어택)
      ringGain: 0.26 - 0.1 * w, // 동시발사 ↑ → 금속 링 ↓(둔탁)
      subGain: 0.9 + 0.4 * w, // 깊은 저역 강조
    });
  }

  /**
   * 특수무기 일제사격음 — 더 깊고 큰 포격. beamCount(이번 살포의 빔 수)에 비례해
   * 더 낮고·두껍고·강하게 들린다.
   */
  barrage(beamCount: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== "running") return;
    const m = Math.min(1, (Math.max(1, beamCount) - 1) / 9); // 1~10발 → 0..1(MAX_BEAMS=10 포화)
    const jitter = 0.96 + Math.random() * 0.08;
    const k = (1 - 0.2 * m) * jitter; // 빔 많을수록 더 낮게
    this.shot({
      f0: 78 * k, // 기본 빔보다 낮은 대구경 포격(특수 구분)
      sweepFrom: 5.8,
      sweepTime: 0.1,
      dur: 0.32 + 0.06 * m, // 더 길고 큰 포성
      peak: 0.3 + 0.12 * m,
      crackGain: 0.85,
      ringGain: 0.3,
      subGain: 1.1 + 0.4 * m,
    });
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
