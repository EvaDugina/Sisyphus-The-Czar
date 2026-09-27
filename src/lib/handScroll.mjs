function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
