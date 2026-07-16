function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function timingFunction(value, fallback, isSupported) {
  const trimmed = String(value || "").trim();
  return trimmed && isSupported(trimmed) ? trimmed : fallback;
}

export function normalizeRainSettings(raw, options) {
  const { defaults, isTimingFunctionSupported = () => true } = options;

  return {
    rainStrength: clamp(finiteNumber(raw.rainStrength, 1), 0.25, 1.5),
    rainZIndex: Math.round(
      clamp(finiteNumber(raw.rainZIndex, defaults.rainZIndex), 0, 30),
    ),
    rainEnterEasing: timingFunction(
      raw.rainEnterEasing,
      defaults.rainEnterEasing,
      isTimingFunctionSupported,
    ),
    rainExitEasing: timingFunction(
      raw.rainExitEasing,
      defaults.rainExitEasing,
      isTimingFunctionSupported,
    ),
    rainEnterMs: Math.round(
      clamp(finiteNumber(raw.rainEnterMs, defaults.rainEnterMs), 0, 10000),
    ),
    rainExitMs: Math.round(
      clamp(finiteNumber(raw.rainExitMs, defaults.rainExitMs), 0, 10000),
    ),
  };
}
