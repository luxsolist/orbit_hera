# E2E Input Render Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make e2e smoke tests stable by standardizing pointer-lock failure handling and replacing fragile screenshot-size checks.

**Architecture:** Add a small testable pointer-lock helper used by `Input`. Refactor the e2e script around local helper functions and pixel-based screenshot analysis while keeping the smoke flow the same.

**Tech Stack:** TypeScript, Vitest, Playwright, Vite.

---

### Task 1: Pointer Lock Helper

**Files:**
- Create: `src/core/pointerLock.ts`
- Modify: `src/core/Input.ts`
- Test: `tests/pointerLock.test.ts`

**Step 1: Write failing tests**

Test that a successful request returns `true`, an asynchronously rejected request returns `false`, and a synchronously thrown request returns `false`.

**Step 2: Run red test**

Run: `npm test -- tests/pointerLock.test.ts`

Expected: FAIL because `src/core/pointerLock.ts` does not exist.

**Step 3: Implement helper and wire Input**

Create `requestPointerLockSafely(target)` and have `Input.requestLock()` return its promise.

**Step 4: Run green test**

Run: `npm test -- tests/pointerLock.test.ts`

Expected: PASS.

### Task 2: E2E Screenshot Analysis Helper

**Files:**
- Modify: `tests/e2e/smoke.mjs`

**Step 1: Add local helpers**

Add `collectErrors`, `captureClip`, `analyzePngBytes`, and `isNonBlankCapture`.

**Step 2: Replace PNG byte threshold**

Use pixel luminance/color variance and non-dark pixel counts instead of `buf.length > 3000`.

**Step 3: Keep the smoke assertions readable**

Preserve the current intro and map flows, but remove duplicated listener setup and screenshot loops.

### Task 3: Verification

**Files:**
- `package.json`
- `tests/e2e/smoke.mjs`

**Step 1: Run targeted tests**

Run: `npm test -- tests/pointerLock.test.ts`

Expected: PASS.

**Step 2: Run unit tests**

Run: `npm test`

Expected: PASS.

**Step 3: Run e2e smoke**

Run: `npm run test:e2e`

Expected: PASS, with any Vite sourcemap/chunk warnings remaining as non-fatal warnings.
