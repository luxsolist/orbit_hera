export interface PointerLockTarget {
  requestPointerLock(): void | Promise<void>;
}

export async function requestPointerLockSafely(target: PointerLockTarget): Promise<boolean> {
  try {
    await target.requestPointerLock();
    return true;
  } catch {
    return false;
  }
}
