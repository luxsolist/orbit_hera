import { describe, expect, it } from "vitest";
import { requestPointerLockSafely } from "../src/core/pointerLock";

describe("requestPointerLockSafely", () => {
  it("returns true when pointer lock request succeeds", async () => {
    const target = { requestPointerLock: async () => undefined };

    await expect(requestPointerLockSafely(target)).resolves.toBe(true);
  });

  it("returns false when pointer lock request rejects", async () => {
    const target = { requestPointerLock: async () => { throw new Error("denied"); } };

    await expect(requestPointerLockSafely(target)).resolves.toBe(false);
  });

  it("returns false when pointer lock request throws synchronously", async () => {
    const target = { requestPointerLock: () => { throw new Error("invalid document"); } };

    await expect(requestPointerLockSafely(target)).resolves.toBe(false);
  });
});
