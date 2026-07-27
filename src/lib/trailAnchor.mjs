function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function trailAnchorPoint(options = {}) {
  const x = finiteNumber(options.x, 0);
  const y = finiteNumber(options.y, 0);
  const width = Math.max(0, finiteNumber(options.width, 0));
  const height = Math.max(0, finiteNumber(options.height, 0));
  const scale = Math.max(0, finiteNumber(options.scale, 1));
  const heightProgress =
    clamp(finiteNumber(options.heightPercent, 100), 0, 100) / 100;
  const visualTop = y + (height * (1 - scale)) / 2;

  return {
    x: x + width / 2,
    y: visualTop + height * scale * heightProgress,
  };
}
