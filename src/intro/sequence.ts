/** Each caption explains the visible action; no campaign knowledge is assumed. */
export const INTRO_DURATION = 75;
export const INTRO_CUES = [
  { start: 0, end: 4.5, source: "서울 · 평범했던 하루", line: "이곳은 사람들이 살던 평범한 동네였습니다." },
  { start: 4.5, end: 9, source: "서울 · 낯선 빛의 등장", line: "어느 날, 낯선 빛들이 나타났습니다." },
  { start: 9, end: 13.5, source: "빛이 지나간 자리", line: "빛들은 건물에서 에너지를 빨아들였습니다." },
  { start: 13.5, end: 18, source: "빛이 지나간 자리", line: "단단하던 벽이 약해지고, 무너졌습니다." },
  { start: 18, end: 23, source: "다른 도시에서도", line: "같은 일이 다른 도시에서도 벌어졌습니다." },
  { start: 23, end: 28, source: "사람들이 떠난 항구", line: "사람들은 집을 떠나 피해야 했습니다." },
  { start: 28, end: 32, source: "사람이 들어갈 수 없는 거리", line: "가까이 가면, 몸도 제대로 움직일 수 없었습니다." },
  { start: 32, end: 36, source: "사람 대신 로봇을", line: "그래서 사람 대신 로봇을 보내기로 했습니다." },
  { start: 36, end: 41, source: "당신이 있는 곳 · 조종실", line: "당신은 안전한 곳에서 이 로봇을 조종합니다." },
  { start: 41, end: 46, source: "로봇과 연결하는 중", line: "이제 로봇의 눈으로 현장을 보게 됩니다." },
  { start: 46, end: 49.2, source: "로봇이 보는 화면 · 첫 임무", line: "안내  /  빛을 향해 빔을 쏘세요." },
  { start: 49.2, end: 52, source: "빔을 맞추면 멈춥니다", line: "안내  /  좋아요. 움직임이 멈췄습니다." },
  { start: 52, end: 55, source: "빗나가면 다시 움직입니다", line: "안내  /  빗나갔어요. 다시 겨누세요." },
  { start: 55, end: 58, source: "빔을 계속 맞추세요", line: "안내  /  그대로 맞추고 계세요." },
  { start: 58, end: 62, source: "첫 번째 성공", line: "안내  /  해냈어요. 하나를 막았습니다." },
  { start: 62, end: 66.5, source: "당신의 임무 · 동네를 지키세요", line: "안내  /  아직 저 빛들이 도시에 남아 있습니다." },
  { start: 66.5, end: 71, source: "당신의 임무 · 동네를 지키세요", line: "안내  /  로봇을 움직여, 남은 동네를 지켜 주세요." },
  { start: 71, end: 75, source: "", line: "" },
] as const;

export function introCueAt(time: number) {
  return INTRO_CUES.find(c => time >= c.start && time < c.end)
    ?? (time < 0 ? INTRO_CUES[0] : INTRO_CUES[INTRO_CUES.length - 1]);
}
export const sharedPulse = (time: number) => 1 + 0.065 * Math.sin(time * Math.PI * 1.6);
export function observationState(t: number) {
  return {
    firing: (t >= 2 && t < 6) || (t >= 7 && t < 12),
    frozen: (t >= 3.2 && t < 6) || (t >= 8.2 && t < 12),
    dissolved: t >= 12,
    recoil: t >= 12 && t < 12.35,
  };
}
