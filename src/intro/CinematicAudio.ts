// 인트로 시네마틱 전용 절차적 배경음악 — Web Audio API 로 합성(외부 음원 0).
// 게임 전반의 무에셋 기조(core/Sfx.ts)와 동일하게 코드로 즉석 합성한다. 효과음 없이
// 앰비언트 패드(드론)만으로 분위기를 깔며, CinematicPlayer 가 장면 진입/종료를 알려주면
// (enterScene/stop/dispose) 그에 맞춰 패드의 음정·음색을 부드럽게 모핑한다.
//
// 스토리(spec/overview.md §3·§4)에 맞춘 8장 무드(루트음/음색):
//  1 oumuamua  — 차가운 공허, 깊고 낮은 우주 드론(A1)
//  2 dispersal — 살짝 밝게, 신비로운 흩어짐(C2)
//  3 fall      — 지구로의 낙하, 밝아지는 긴장(D2)
//  4 splash    — 바다 입수, 잠깐 밝게(G2)
//  5 sink      — 심해 침강, 먹먹한 저역(G1)
//  6 core      — 코어 성장, 부풀어 오르는 무게(F1)
//  7 rise      — 플라즈모이드 상승, 가장 어둡고 불길한 트라이톤 불협(E1)
//  8 house     — 해변 집, 다시 낮게 가라앉음(A1)

type AudioCtor = typeof AudioContext;

const MASTER_VOL = 0.92;
const FADE_IN = 0.8; // CinematicPlayer 의 시각 페이드인과 동일
const PAD_LEVEL = 0.32; // 배경음악(앰비언트 패드/서브) 전역 음량 배수
const WET = 0.4; // 리버브 send 량(공간감)
const DREAD_RATIO = Math.SQRT2; // 트라이톤(증4도) — 불길함(rise 전용)

// 패드(앰비언트 드론) 보이스 — 옥타브를 아우르는 디튠 톱니 군집. 루트 대비 비율 × 미세 디튠.
const PAD_VOICES: ReadonlyArray<{ ratio: number; detune: number }> = [
  { ratio: 0.5, detune: 1 }, // 옥타브 아래(무게)
  { ratio: 1, detune: 1 },
  { ratio: 1, detune: 1.006 },
  { ratio: 1.5, detune: 1 },
  { ratio: 1.5, detune: 0.994 },
  { ratio: 2, detune: 1.005 },
];

/** 인트로 컷씬에 맞춘 절차적 배경음악 버스. 사용자 제스처(인트로 버튼 클릭) 안에서 생성된다. */
export class CinematicAudio {
  private ctx: AudioContext;
  private master: GainNode;
  private padBus: GainNode;
  private padFilter: BiquadFilterNode;
  private padOscs: OscillatorNode[] = [];
  private sub: OscillatorNode; // 항시 깔리는 서브 저역(무게)
  private subGain: GainNode;
  private dread: OscillatorNode; // 트라이톤 불협(rise 에서만 게인 상승)
  private dreadGain: GainNode;
  private lfo: OscillatorNode; // 패드 필터를 느리게 흔들어 생동감
  private disposed = false;

  constructor() {
    const AC: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!AC) throw new Error("no AudioContext");
    this.ctx = new AC();
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 마스터 → 글루 컴프레서 → 출력. 시작 시 0→볼륨 페이드인.
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0.0001, now);
    this.master.gain.linearRampToValueAtTime(MASTER_VOL, now + FADE_IN);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // 패드 → master(드라이) + 컨볼버 리버브(웻)로 공간감을 입힘.
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.0001;
    this.padBus.connect(this.master);
    const wet = ctx.createGain();
    wet.gain.value = WET;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeImpulse(3.4, 2.8);
    this.padBus.connect(wet).connect(conv).connect(this.master);

    // 패드: 옥타브를 아우르는 디튠 톱니 군집 → 로우패스 → 패드버스(따뜻하고 거대한 드론).
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.Q.value = 0.8;
    this.padFilter.frequency.value = 600;
    this.padFilter.connect(this.padBus);
    for (const v of PAD_VOICES) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = 55 * v.ratio * v.detune;
      const g = ctx.createGain();
      g.gain.value = 0.18;
      o.connect(g).connect(this.padFilter);
      o.start(now);
      this.padOscs.push(o);
    }
    // 불협(트라이톤) 보이스 — 평소 무음, rise 에서만 올림.
    this.dread = ctx.createOscillator();
    this.dread.type = "sawtooth";
    this.dread.frequency.value = 55 * DREAD_RATIO;
    this.dreadGain = ctx.createGain();
    this.dreadGain.gain.value = 0.0001;
    this.dread.connect(this.dreadGain).connect(this.padFilter);
    this.dread.start(now);

    // 항시 서브 저역(바닥 무게) — master 직결.
    this.sub = ctx.createOscillator();
    this.sub.type = "sine";
    this.sub.frequency.value = 55 * 0.5;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.0001;
    this.sub.connect(this.subGain).connect(this.master);
    this.sub.start(now);

    // 느린 필터 LFO(±) — 패드에 호흡감.
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    this.lfo.connect(lfoDepth).connect(this.padFilter.frequency);
    this.lfo.start(now);

    if (ctx.state === "suspended") void ctx.resume();
  }

  /** 장면 진입 — 패드의 음정/음색을 그 장면 무드로 부드럽게 모핑. */
  enterScene(name: string): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case "oumuamua": // 차가운 공허 — 깊고 낮은 우주 드론
        this.retune(55); // A1
        this.mood(800, 0.13, 0.7);
        break;
      case "dispersal": // 살짝 밝게 — 신비로운 흩어짐
        this.retune(65.41); // C2
        this.mood(1400, 0.12, 0.55);
        break;
      case "fall": // 낙하 — 밝아지는 긴장
        this.retune(73.42); // D2
        this.mood(1700, 0.16, 0.8);
        break;
      case "splash": // 바다 입수 — 잠깐 밝게
        this.retune(98); // G2
        this.mood(2200, 0.1, 0.4);
        break;
      case "sink": // 심해 침강 — 먹먹한 저역
        this.retune(49); // G1
        this.mood(420, 0.16, 0.85);
        break;
      case "core": // 코어 성장 — 부풀어 오르는 무게
        this.retune(43.65); // F1
        this.mood(1700, 0.2, 0.95);
        break;
      case "rise": // 플라즈모이드 상승 — 가장 어둡고 불길한 트라이톤 불협
        this.retune(41.2); // E1
        this.mood(1100, 0.22, 1.0);
        this.dreadGain.gain.setTargetAtTime(0.14 * PAD_LEVEL, t, 1.2);
        break;
      case "house": // 해변 집 — 다시 낮게 가라앉음
        this.retune(55); // A1
        this.mood(1100, 0.12, 0.6);
        this.dreadGain.gain.setTargetAtTime(0.0001, t, 0.6);
        break;
    }
  }

  /** 종료/스킵 — 마스터를 fade 초에 걸쳐 0 으로(시각 페이드아웃과 동조). */
  stop(fade: number): void {
    if (this.disposed) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), t);
    this.master.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, fade));
  }

  /** 멱등 — 컨텍스트를 닫아 모든 노드를 일괄 해제. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      void this.ctx.close();
    } catch { /* 무시 */ }
  }

  /** 패드/서브/불협 보이스를 새 루트로 부드럽게 글라이드(장면 전환). */
  private retune(root: number, glide = 0.8): void {
    const t = this.ctx.currentTime;
    const tc = glide / 3;
    for (let i = 0; i < this.padOscs.length; i++) {
      const v = PAD_VOICES[i];
      this.padOscs[i].frequency.setTargetAtTime(root * v.ratio * v.detune, t, tc);
    }
    this.dread.frequency.setTargetAtTime(root * DREAD_RATIO, t, tc);
    this.sub.frequency.setTargetAtTime(root * 0.5, t, tc);
  }

  /** 패드 필터 컷오프 / 패드 게인 / 서브 게인 목표로 램프(무드). 배경 음량 배수(PAD_LEVEL) 적용. */
  private mood(cutoff: number, padG: number, subG: number): void {
    const t = this.ctx.currentTime;
    const span = 1.3;
    rampTo(this.padFilter.frequency, cutoff, t, span);
    rampTo(this.padBus.gain, padG * PAD_LEVEL, t, span);
    rampTo(this.subGain.gain, subG * PAD_LEVEL, t, span);
  }

  /** 절차적 스테레오 임펄스 응답(지수 감쇠 노이즈) — 큰 홀의 잔향. */
  private makeImpulse(dur: number, decay: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = (sr * dur) | 0;
    const ir = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return ir;
  }
}

/** AudioParam 을 현재값에서 목표로 선형 램프(취소 후 재예약 — 무드 전환 중첩 안전). */
function rampTo(p: AudioParam, target: number, t: number, span: number): void {
  p.cancelScheduledValues(t);
  p.setValueAtTime(Math.max(0.0001, p.value), t);
  p.linearRampToValueAtTime(Math.max(0.0001, target), t + span);
}
