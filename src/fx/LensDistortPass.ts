// 중력 렌즈 왜곡 셰이더 패스(물리편 §2.7.1) — projectLensPoints 가 계산한 화면공간 점들 주위로
// UV 를 안쪽으로 당겨(렌즈처럼) 배경을 일렁이게 한다. LENS_MAX_POINTS 개까지 동시 처리(고정 유니폼
// 배열 — 매크로 상수라 셰이더 컴파일 1회로 끝, 프레임마다 재컴파일 없음).
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { LENS_MAX_POINTS, type LensPoint } from "./lensDistort";

const VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = `
uniform sampler2D tDiffuse;
uniform vec2 uPoints[${LENS_MAX_POINTS}];
uniform float uRadii[${LENS_MAX_POINTS}];
uniform float uStrengths[${LENS_MAX_POINTS}];
uniform int uCount;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  for (int i = 0; i < ${LENS_MAX_POINTS}; i++) {
    if (i >= uCount) break;
    vec2 d = (uv - uPoints[i]) * vec2(uAspect, 1.0);
    float dist = length(d);
    float r = uRadii[i];
    if (dist < r && dist > 0.0005) {
      float falloff = 1.0 - dist / r;
      float bend = uStrengths[i] * falloff * falloff * 0.06;
      uv -= (d / dist) * bend * vec2(1.0 / uAspect, 1.0);
    }
  }
  gl_FragColor = texture2D(tDiffuse, uv);
}
`;

/** ShaderPass 확장 — setPoints() 로 매 프레임 왜곡 점을 갱신. 점이 없으면 사실상 원본 그대로 통과. */
export class LensDistortPass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        uPoints: { value: Array.from({ length: LENS_MAX_POINTS }, () => new THREE.Vector2()) },
        uRadii: { value: new Float32Array(LENS_MAX_POINTS) },
        uStrengths: { value: new Float32Array(LENS_MAX_POINTS) },
        uCount: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
  }

  setAspect(aspect: number): void {
    this.uniforms.uAspect.value = aspect;
  }

  setPoints(points: readonly LensPoint[]): void {
    const pts = this.uniforms.uPoints.value as THREE.Vector2[];
    const radii = this.uniforms.uRadii.value as Float32Array;
    const strengths = this.uniforms.uStrengths.value as Float32Array;
    const n = Math.min(points.length, LENS_MAX_POINTS);
    for (let i = 0; i < n; i++) {
      pts[i].set(points[i].x, points[i].y);
      radii[i] = points[i].radius;
      strengths[i] = points[i].strength;
    }
    this.uniforms.uCount.value = n;
  }
}
