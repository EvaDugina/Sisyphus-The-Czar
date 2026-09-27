function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export const DEFAULT_HAND_SCROLL_IDLE_GRACE_MS = 50;
export const DEFAULT_HAND_SCROLL_DECELERATION_MS = 250;

export function handScrollSpeedFactor({
  elapsedSinceMoveMs,
  idleGraceMs = DEFAULT_HAND_SCROLL_IDLE_GRACE_MS,
  decelerationMs = DEFAULT_HAND_SCROLL_DECELERATION_MS,
}) {
  const elapsed = Math.max(0, finiteNumber(elapsedSinceMoveMs, 0));
  const grace = Math.max(0, finiteNumber(idleGraceMs, 0));
  const duration = Math.max(0, finiteNumber(decelerationMs, 0));
  if (elapsed <= grace) {
    return 1;
  }
  if (duration === 0 || elapsed >= grace + duration) {
    return 0;
  }

  const progress = (elapsed - grace) / duration;
  const smoothStep = progress * progress * (3 - 2 * progress);
  return 1 - smoothStep;
}

export function handScrollDeltaPx({
  speedVhPerSecond,
  viewportHeight,
  elapsedMs,
}) {
  const speed = Math.max(0, finiteNumber(speedVhPerSecond, 0));
  const height = Math.max(0, finiteNumber(viewportHeight, 0));
  const seconds = Math.max(0, finiteNumber(elapsedMs, 0)) / 1000;
  return speed * (height / 100) * seconds;
}

export function handScrollUpY({
  currentScrollY,
  speedVhPerSecond,
  viewportHeight,
  elapsedMs,
}) {
  const current = Math.max(0, finiteNumber(currentScrollY, 0));
  return Math.max(
    0,
    current -
      handScrollDeltaPx({
        speedVhPerSecond,
        viewportHeight,
        elapsedMs,
      }),
  );
}
