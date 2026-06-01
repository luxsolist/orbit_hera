import * as THREE from "three";

const LIFETIME = 0.6; // 표시 시간(초) — 짧고 강하게 튀었다 사라짐
const POP_TIME = 0.16; // 등장 팝(오버슈트) 지속 시간

/**
 * 월드 공간 기준 스프라이트의 기본 크기.
 * 스프라이트는 원근 투영으로 거리가 멀수록 화면상 작아지므로,
 * 기본 크기를 상수로 두면 "화면에 보이는 글자 크기 ∝ 1/적중거리"가 되어
 * 적중 거리에 반비례하는 표시 크기가 자연스럽게 구현된다.
 */
const BASE_SCALE = 2.4;
const CRIT_DAMAGE = 70; // 이 이상이면 강타로 강조(더 크게/붉게/세게 튐)
const GRAVITY = 7.5; // 분출 후 끌어내리는 가속도(월드 단위/초²)

interface FloatingNumber {
  sprite: THREE.Sprite;
  texture: THREE.Texture;
  material: THREE.SpriteMaterial;
  life: number;
  baseScale: number;
  aspect: number;
  velocity: THREE.Vector3; // 분출 속도(초기 버스트 → 중력으로 감속)
  baseColor: THREE.Color; // 안정 색(강타=붉은 호박, 일반=호박)
}

/**
 * 빔 적중 시 입힌 데미지를 적중 지점에 잠깐 띄우는 플로팅 숫자 FX.
 * - 등장 순간 크게 솟구쳤다 스냅되는 오버슈트 팝 + 흰색 섬광으로 '팍' 튄다.
 * - 매 타격마다 살짝 다른 방향으로 분출됐다 중력으로 떨어지며 페이드아웃.
 * - 글자 크기는 적중 거리에 반비례(가까이 맞출수록 크게 보임), 강타는 더 크고 붉다.
 */
export class DamageNumbers {
  private items: FloatingNumber[] = [];

  constructor(private scene: THREE.Scene) {}

  /**
   * 적중 지점(point)에 데미지(amount)를 띄움.
   * 표시 크기는 BASE_SCALE 상수 + 원근 투영으로 적중 거리에 반비례한다.
   */
  spawn(point: THREE.Vector3, amount: number) {
    const value = Math.max(1, Math.round(amount));
    const crit = value >= CRIT_DAMAGE;
    const { texture, aspect } = makeNumberTexture(value, crit);

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // 지형/적에 가려지지 않게 항상 표시
      depthWrite: false,
      blending: THREE.AdditiveBlending, // 등장 섬광이 강하게 터지도록 가산 합성
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(point);
    sprite.renderOrder = 999;

    const baseScale = BASE_SCALE * (crit ? 1.5 : 1);
    // 0 스케일에서 시작 → update의 오버슈트 팝으로 부풀어 오름
    sprite.scale.set(0.001, 0.001, 1);
    this.scene.add(sprite);

    // 위로 강하게 분출 + 좌우로 살짝 산개(매번 다른 방향으로 '팍' 튄다)
    const spread = crit ? 3.2 : 2.2;
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * spread,
      4.5 + Math.random() * 2.0,
      (Math.random() - 0.5) * spread
    );

    this.items.push({
      sprite,
      texture,
      material,
      life: LIFETIME,
      baseScale,
      aspect,
      velocity,
      baseColor: crit ? new THREE.Color(0xffae5a) : new THREE.Color(0xffd27a),
    });
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      const t = it.life / LIFETIME; // 1 → 0
      const age = LIFETIME - it.life;

      // 분출 → 중력 감속(위로 솟았다 떨어지는 호)
      it.velocity.y -= GRAVITY * dt;
      it.velocity.x *= 1 - Math.min(1, dt * 6); // 좌우 분출은 빠르게 감쇠
      it.velocity.z *= 1 - Math.min(1, dt * 6);
      it.sprite.position.addScaledVector(it.velocity, dt);

      // 등장 오버슈트 팝: 0 → ~1.35 솟구쳤다 1.0으로 스냅(팍 튀는 느낌)
      const pop = popScale(age);
      const scale = it.baseScale * pop;
      it.sprite.scale.set(scale * it.aspect, scale, 1);

      // 등장 순간 흰색으로 번쩍였다 안정 색으로(섬광 → 가독)
      const flash = Math.max(0, 1 - age / POP_TIME);
      it.material.color
        .copy(it.baseColor)
        .lerp(WHITE, flash)
        .multiplyScalar(1 + flash * 0.6);

      // 끝물에 빠르게 페이드(팝 동안은 또렷하게 유지)
      it.material.opacity = THREE.MathUtils.clamp(t * 1.6, 0, 1);

      if (it.life <= 0) {
        this.scene.remove(it.sprite);
        it.texture.dispose();
        it.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() {
    for (const it of this.items) {
      this.scene.remove(it.sprite);
      it.texture.dispose();
      it.material.dispose();
    }
    this.items = [];
  }
}

const WHITE = new THREE.Color(0xffffff);

/**
 * 등장 팝 스케일 커브.
 * 0~POP_TIME 동안 0에서 시작해 ~1.35까지 솟구쳤다 1.0으로 스냅(ease-out-back 형태).
 * 이후로는 1.0 유지 → '팍' 튀어나오는 타격감.
 */
function popScale(age: number): number {
  if (age >= POP_TIME) return 1;
  const p = age / POP_TIME; // 0 → 1
  const c = 2.4; // 오버슈트 강도
  const inv = p - 1;
  return 1 + c * inv * inv * inv + (c + 1) * inv * inv; // ease-out-back
}

/** 데미지 숫자를 캔버스에 그려 텍스처로 만든다. aspect = 가로/세로 비율. */
function makeNumberTexture(value: number, crit: boolean): { texture: THREE.Texture; aspect: number } {
  const text = String(value);
  const fontSize = 72;
  const font = `900 ${fontSize}px "Segoe UI", Arial, sans-serif`;
  const pad = 22;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  // 1차: 폭 측정
  ctx.font = font;
  const textW = Math.ceil(ctx.measureText(text).width);

  canvas.width = textW + pad * 2;
  canvas.height = fontSize + pad * 2;

  // 캔버스 크기를 바꾸면 컨텍스트가 초기화되므로 폰트 재설정
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  // 글자 뒤 발광 헤일로(가산 합성과 결합해 '팍' 터지는 느낌 강화)
  ctx.shadowColor = crit ? "rgba(255,120,60,0.95)" : "rgba(255,200,120,0.85)";
  ctx.shadowBlur = crit ? 26 : 18;

  // 가독성을 위한 외곽선 + 밝은 채움
  ctx.lineWidth = 9;
  ctx.strokeStyle = "rgba(10,4,2,0.9)";
  ctx.strokeText(text, cx, cy);
  ctx.shadowBlur = 0; // 채움은 또렷하게
  // 흰색에 가깝게 칠해두고 색 변조는 머티리얼 color로 처리(섬광 lerp 활용)
  ctx.fillStyle = "#fff4dc";
  ctx.fillText(text, cx, cy);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return { texture, aspect: canvas.width / canvas.height };
}
