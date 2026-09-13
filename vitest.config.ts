import { defineConfig } from "vitest/config";

// Keep one list for the extended suite so fast + extended always cover every test.
const extended = [
  "tests/leapManager.test.ts", // Long deterministic combat simulations.
  "tests/worldValidate.test.ts", // Map validation fixtures and generated-data audits.
  "tests/seoulLandmarkAppearance.test.ts", // Full Seoul landmark footprint coverage.
  "tests/cityMemory.test.ts", // Geometry budgets using actual palace tiles.
];

export default defineConfig({
  test: {
    projects: [
      { test: { name: "fast", environment: "node", include: ["tests/**/*.test.ts"], exclude: extended } },
      { test: { name: "extended", environment: "node", include: extended } },
    ],
  },
});
