import * as THREE from "three";

/**
 * 디졸브(소멸) 셰이더 머티리얼.
 * - 노이즈 임계값(uProgress)을 넘는 프래그먼트를 잘라내(discard) 점차 사라지게 함.
 * - 잘리는 경계는 이미시브 컬러로 발광 → Bloom과 결합해 '에너지 소멸' 연출.
 * - uShrink 와 함께 적을 '쪼그라뜨리고 소멸'시키는 스펙(6장)을 표현.
 */
export interface DissolveMaterial extends THREE.ShaderMaterial {
  setProgress(v: number): void;
  setPulse(v: number): void;
  setFlash(v: number): void;
}

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uBaseColor;
  uniform vec3  uEdgeColor;
  uniform float uProgress;   // 0 = 멀쩡, 1 = 완전 소멸
  uniform float uPulse;      // 박동(0..1)
  uniform float uEdgeWidth;
  uniform float uFlash;      // 피격 순간 흰색 번쩍임(0..1)

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  // 값 노이즈 (가벼운 3D 해시 기반)
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }

  void main() {
    float n = noise(vWorldPos * 2.4);

    // 소멸 영역 컷오프
    if (n < uProgress) discard;

    // 경계 발광
    float edge = smoothstep(uProgress, uProgress + uEdgeWidth, n);
    vec3 col = mix(uEdgeColor, uBaseColor, edge);

    // 간단한 림 라이팅 + 박동
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(viewDir, vNormal), 0.0), 2.0);
    col += uEdgeColor * rim * (0.4 + 0.6 * uPulse);

    // 소멸이 진행될수록 경계가 더 강하게 타오르도록
    col += uEdgeColor * (1.0 - edge) * (0.5 + uProgress);

    // 피격 순간 표면 전체가 흰색으로 번쩍(타격감) — Bloom과 결합해 강하게 터짐
    col += vec3(2.0) * uFlash;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createDissolveMaterial(
  baseColor: THREE.ColorRepresentation,
  edgeColor: THREE.ColorRepresentation = 0xff3b4e
): DissolveMaterial {
  const mat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uBaseColor: { value: new THREE.Color(baseColor) },
      uEdgeColor: { value: new THREE.Color(edgeColor) },
      uProgress: { value: 0 },
      uPulse: { value: 0 },
      uEdgeWidth: { value: 0.08 },
      uFlash: { value: 0 },
    },
  }) as DissolveMaterial;

  mat.setProgress = (v: number) => {
    mat.uniforms.uProgress.value = THREE.MathUtils.clamp(v, 0, 1);
  };
  mat.setPulse = (v: number) => {
    mat.uniforms.uPulse.value = v;
  };
  mat.setFlash = (v: number) => {
    mat.uniforms.uFlash.value = v;
  };

  return mat;
}
