function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function cursorCircleIntersectsRect({ x, y, radius, rect }) {
  const cursorX = finiteNumber(x);
  const cursorY = finiteNumber(y);
  const circleRadius = finiteNumber(radius);
  const left = finiteNumber(rect?.left);
  const right = finiteNumber(rect?.right);
  const top = finiteNumber(rect?.top);
  const bottom = finiteNumber(rect?.bottom);

  if (
    cursorX === null ||
    cursorY === null ||
    circleRadius === null ||
    left === null ||
    right === null ||
    top === null ||
    bottom === null
  ) {
    return false;
  }

  const normalizedLeft = Math.min(left, right);
  const normalizedRight = Math.max(left, right);
  const normalizedTop = Math.min(top, bottom);
  const normalizedBottom = Math.max(top, bottom);
  const nearestX = Math.min(Math.max(cursorX, normalizedLeft), normalizedRight);
  const nearestY = Math.min(Math.max(cursorY, normalizedTop), normalizedBottom);
  const deltaX = cursorX - nearestX;
  const deltaY = cursorY - nearestY;
  const normalizedRadius = Math.max(0, circleRadius);

  return deltaX * deltaX + deltaY * deltaY <= normalizedRadius * normalizedRadius;
}
