import { defineConfig } from "vitest/config";

// 순수 로직(SpatialGrid·CollisionWorld·geo) 단위 테스트. DOM/WebGL 불필요 → node 환경.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
