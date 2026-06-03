import { defineConfig } from "vite";
import obfuscator from "vite-plugin-javascript-obfuscator";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    open: true,
  },
  build: {
    target: "es2020",
    // 소스맵은 생성하되 번들에 참조를 두지 않음 → 배포 안 하면 원본 비공개, 내부 에러추적엔 사용 가능.
    sourcemap: "hidden",
  },
  plugins: [
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
