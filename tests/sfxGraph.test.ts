import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Sfx } from "../src/core/Sfx";

// Sfx 회귀망 — 오디오는 **노이즈 때문에 샘플 비교가 불가능**하고(매 호출 Math.random) node 에는
// Web Audio 가 없다. 대신 **노드 그래프를 기록하는 스텁**으로 결정적으로 검증한다:
// 어떤 노드를 몇 개 만들고, 어떤 파라미터를 어떤 시각에 어떤 값으로 스케줄했고, 어떻게 연결했는가.
//
// 이게 사운드의 동일성을 보장하지는 않지만(같은 그래프 = 같은 소리), **리팩토링이 그래프를 바꾸지
// 않았음**은 증명한다 — 조립 코드를 헬퍼로 묶는 작업의 안전망으로는 이게 정확한 도구다.

interface Rec { kind: string; id: number; props: string[]; connects: string[] }

/** 기록형 Web Audio 스텁 — 실제 소리는 내지 않고 그래프만 남긴다. */
function installFakeAudio(): () => Rec[] {
  const log: Rec[] = [];
  let seq = 0;
  const num = (v: number) => (Math.abs(v) < 1e-9 ? "0" : v.toPrecision(6));

  const mkParam = (rec: Rec, name: string) => {
    const p = {
      _v: 0,
      get value() { return this._v; },
      set value(v: number) { this._v = v; rec.props.push(`${name}=${num(v)}`); },
      setValueAtTime: (v: number, t: number) => { rec.props.push(`${name}.set@${num(t)}=${num(v)}`); return p; },
      linearRampToValueAtTime: (v: number, t: number) => { rec.props.push(`${name}.lin@${num(t)}=${num(v)}`); return p; },
      exponentialRampToValueAtTime: (v: number, t: number) => { rec.props.push(`${name}.exp@${num(t)}=${num(v)}`); return p; },
    };
    return p;
  };

  const mkNode = (kind: string, extra: string[] = []) => {
    const rec: Rec = { kind, id: seq++, props: [], connects: [] };
    log.push(rec);
    const node: Record<string, unknown> = {
      __rec: rec,
      connect: (dst: { __rec?: Rec; __name?: string }) => {
        rec.connects.push(dst.__rec ? `${dst.__rec.kind}#${dst.__rec.id}` : (dst.__name ?? "?"));
        return dst;
      },
      disconnect: () => {},
      start: (t: number) => rec.props.push(`start@${num(t)}`),
      stop: (t: number) => rec.props.push(`stop@${num(t)}`),
    };
    for (const p of extra) node[p] = mkParam(rec, p);
    // 스칼라 속성(type/buffer/curve/oversample)은 설정 시점에 기록
    for (const s of ["type", "buffer", "curve", "oversample"]) {
      Object.defineProperty(node, s, {
        set(v: unknown) { rec.props.push(`${s}=${typeof v === "object" && v ? "<buf>" : String(v)}`); },
        get() { return undefined; },
      });
    }
    return node;
  };

  class FakeCtx {
    currentTime = 0;
    sampleRate = 48000;
    state = "running";
    destination = { __name: "dest" };
    resume() { return Promise.resolve(); }
    createGain() { return mkNode("Gain", ["gain"]); }
    createOscillator() { return mkNode("Osc", ["frequency", "detune"]); }
    createBiquadFilter() { return mkNode("Biquad", ["frequency", "Q", "gain"]); }
    createBufferSource() { return mkNode("BufSrc", ["playbackRate", "detune"]); }
    createWaveShaper() { return mkNode("Shaper", []); }
    createDynamicsCompressor() { return mkNode("Comp", ["threshold", "knee", "ratio", "attack", "release"]); }
    createBuffer(_c: number, len: number, sr: number) {
      return { length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) };
    }
  }
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeCtx };
  return () => log;
}

/** 그래프를 안정 문자열로 — 노드 생성 순서 + 파라미터 + 연결. */
const digest = (log: Rec[]) =>
  log.map((r) => `${r.kind}#${r.id}[${r.props.join(",")}]->(${r.connects.join("|")})`).join("\n");

/** 사운드 1종의 그래프(초기화분 제외). Math.random 고정 — 노이즈 버퍼는 그래프에 영향 없지만 안전하게. */
function graphOf(play: (s: Sfx) => void): string {
  const getLog = installFakeAudio();
  const orig = Math.random;
  let n = 0;
  Math.random = () => ((n = (n * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  try {
    const sfx = new Sfx(0.5);
    sfx.resume();
    const base = getLog().length; // 초기화(master/comp/버퍼)까지는 공통
    play(sfx);
    return digest(getLog().slice(base));
  } finally {
    Math.random = orig;
  }
}

const SOUNDS: [string, (s: Sfx) => void][] = [
  ["beam", (s) => s.beam()],
  ["sizzle", (s) => s.sizzle()],
  ["barrage", (s) => s.barrage(6)],
  ["overdrive", (s) => s.overdrive()],
  ["reckoning(hit)", (s) => s.reckoning(true)],
  ["reckoning(miss)", (s) => s.reckoning(false)],
  ["kill(0)", (s) => s.kill(0)],
  ["kill(0.5)", (s) => s.kill(0.5)],
  ["kill(1)", (s) => s.kill(1)],
];

describe("Sfx — 오디오 그래프 회귀", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => { restore = null; });
  afterEach(() => { restore?.(); delete (globalThis as { window?: unknown }).window; });

  it("모든 사운드가 노드를 생성한다 — 무음 회귀 가드", () => {
    for (const [name, play] of SOUNDS) {
      const g = graphOf(play);
      expect(g.length, `${name} 가 아무 노드도 만들지 않았다`).toBeGreaterThan(0);
    }
  });

  it("같은 입력이면 그래프가 결정적이다 — 스냅샷 비교의 전제", () => {
    for (const [name, play] of SOUNDS) {
      expect(graphOf(play), name).toBe(graphOf(play));
    }
  });

  it("강함(strength)이 처치음 그래프를 실제로 바꾼다", () => {
    const weak = graphOf((s) => s.kill(0));
    const strong = graphOf((s) => s.kill(1));
    expect(weak).not.toBe(strong);
  });

  it("빔 수가 살포음 그래프를 바꾼다", () => {
    expect(graphOf((s) => s.barrage(1))).not.toBe(graphOf((s) => s.barrage(10)));
  });

  it("음소거는 마스터 게인을 0 으로 — 그래프는 그대로 조립된다", () => {
    // 구현 확인(2026-08-26): setEnabled(false) 는 조기 반환이 아니라 master.gain = 0 이다.
    // 즉 음소거 중에도 노드는 매번 만들어진다(무해하지만 낭비 — 개선 여지로 남겨둔다).
    const muted = graphOf((s) => { s.setEnabled(false); s.beam(); });
    expect(muted.length).toBeGreaterThan(0);
    expect(graphOf((s) => { s.setEnabled(false); s.beam(); }))
      .toBe(graphOf((s) => { s.setEnabled(false); s.beam(); })); // 결정적
  });

  // ── 스냅샷: 리팩토링이 그래프를 바꾸지 않았음을 고정 ──────────────────────
  it("그래프 스냅샷", () => {
    const snap = Object.fromEntries(SOUNDS.map(([n, p]) => [n, graphOf(p)]));
    expect(snap).toMatchSnapshot();
  });
});
