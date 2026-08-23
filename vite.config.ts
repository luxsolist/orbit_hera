import { defineConfig } from "vite";
import obfuscator from "vite-plugin-javascript-obfuscator";
// @ts-expect-error — JS 빌드 헬퍼(타입 선언 없음)
import { serveMapsFromDisk } from "./scripts/vite-serve-maps.mjs";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    open: true,
    // 맵 청크 수만 개(public/maps)는 정적이라 HMR 불필요 — watch 제외로 dev 서버 안정화
    // (대량 파일 watch 시 일부 셀이 정적 서빙 안 되던 문제 회피).
    // ⚠ 단, Vite 는 public/ 파일 색인을 **워처로 갱신**하므로 watch 를 빼면 새로 구운 셀이
    // 색인에 안 들어와 SPA 폴백(200 + index.html)으로 샌다. serveMapsFromDisk 플러그인이
    // 맵 경로를 디스크에서 직접 읽어 그 구멍을 막는다 — 둘은 한 쌍이니 같이 두어야 한다.
    watch: { ignored: ["**/public/maps/**"] },
    fs: { strict: false },
  },
  build: {
    target: "es2020",
    // 소스맵은 생성하되 번들에 참조를 두지 않음 → 배포 안 하면 원본 비공개, 내부 에러추적엔 사용 가능.
    sourcemap: "hidden",
  },
  plugins: [
    // 맵 청크는 워처/색인을 우회해 디스크에서 직접 서빙(위 watch.ignored 와 한 쌍). 개발 서버 전용.
    serveMapsFromDisk(),
    // 프로덕션 빌드에서만 우리 소스(src/*)를 난독화. node_modules(three 등)와 생성 데이터는 제외.
    // 보수적 옵션(문자열 배열/식별자 리네임)만 — control-flow flattening·selfDefending 등 위험/무거운 옵션 비활성.
    obfuscator({
      apply: "build",
      exclude: [/node_modules/, /\.nuxt/, /worldLand/],
      options: {
        compact: true,
        identifierNamesGenerator: "hexadecimal",
        simplify: true,
        stringArray: true,
        stringArrayThreshold: 0.75,
        stringArrayEncoding: ["base64"],
        controlFlowFlattening: false,
        deadCodeInjection: false,
        debugProtection: false,
        selfDefending: false,
        splitStrings: false,
        numbersToExpressions: false,
        transformObjectKeys: false,
        unicodeEscapeSequence: false,
        disableConsoleOutput: false,
      },
    }),
  ],
});
