import * as THREE from "three";

// 작전구역(존) 경계의 반투명 에너지 벽 — 반경 radius 원통(열린 양끝).
// 안에서도 보이게 DoubleSide, depthWrite 끔(투과). 가까이 갈수록 진해지고(거리 페이드), HDR 색으로
// 블룸에 걸려 발광. 위로 흐르는 에너지 밴드 + 세로 격자선 + 프레넬(빗각에서 밝게)로 "역장" 느낌.

const VERT = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vNrm;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vNrm = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uNear; // 이 거리 이내면 완전 표시
  uniform float uFar;  // 이 거리 밖이면 사라짐(원경 호리병 방지)
  varying vec3 vWorld;
  varying vec3 vNrm;
  varying vec2 vUv;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - abs(dot(viewDir, vNrm)), 2.0);          // 빗각에서 밝게(역장 가장자리)
    float hf = smoothstep(1.0, 0.04, vUv.y);                        // 아래 진함 → 위로 흐림
    float bands = 0.5 + 0.5 * sin(vUv.y * 90.0 - uTime * 2.0);      // 위로 흐르는 에너지 밴드
    float verts = smoothstep(0.88, 1.0, abs(sin(vUv.x * 240.0)));   // 세로 격자선(원주 분할)
    float d = distance(cameraPosition, vWorld);
    float distFade = smoothstep(uFar, uNear, d);                    // 멀면 0 → 가까우면 1
    float a = (0.05 + 0.5 * fres + 0.10 * bands + 0.22 * verts) * (0.32 + 0.68 * hf) * distFade;
    vec3 col = uColor * (1.0 + fres * 1.8 + verts * 1.3);           // HDR(>1) → 블룸 발광
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;

export class EnergyWall {
  readonly mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private t = 0;

  /** (cx,cz)=중심, radius=반경(m), baseY..topY=벽의 수직 범위(월드 Y). */
  constructor(scene: THREE.Scene, cx: number, cz: number, radius: number, baseY: number, topY: number) {
    const h = Math.max(50, topY - baseY);
    const geo = new THREE.CylinderGeometry(radius, radius, h, 160, 1, true); // 열린 원통(빗면 부드럽게 160분할)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffaa33) }, // 호박색(미니맵 경계와 통일)
        uNear: { value: 800 },
        uFar: { value: 2600 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.set(cx, baseY + h / 2, cz);
    this.mesh.frustumCulled = false; // 항상 그림(거리 페이드가 가시성 제어)
    this.mesh.renderOrder = 2;
    this.mesh.name = "energyWall";
    scene.add(this.mesh);
  }

  update(dt: number): void {
    this.t += dt;
    this.mat.uniforms.uTime.value = this.t;
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
