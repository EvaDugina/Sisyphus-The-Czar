export const HARD_TRAIL_LIMIT = 10_000;

export const TRAIL_RENDER_PROFILE_NAMES = Object.freeze([
  "auto",
  "low",
  "mobile",
  "desktop",
  "high",
]);

export const DEFAULT_TRAIL_RENDER_SETTINGS = Object.freeze({
  trailRenderProfile: "auto",
});

export const TRAIL_RENDER_PROFILES = Object.freeze({
  low: Object.freeze({
    name: "low",
    historyMaxPoints: 3_000,
    checkpointPoints: 128,
    dprCap: 1,
    historyMaxPixels: 3_000_000,
    sessionMaxPixels: 1_000_000,
    glowMaxPoints: 200,
    glowUpdateFps: 24,
  }),
  mobile: Object.freeze({
    name: "mobile",
    historyMaxPoints: 5_000,
    checkpointPoints: 192,
    dprCap: 1.25,
    historyMaxPixels: 6_000_000,
    sessionMaxPixels: 2_000_000,
    glowMaxPoints: 350,
    glowUpdateFps: 30,
  }),
  desktop: Object.freeze({
    name: "desktop",
    historyMaxPoints: 10_000,
    checkpointPoints: 256,
    dprCap: 1.5,
    historyMaxPixels: 12_000_000,
    sessionMaxPixels: 4_000_000,
    glowMaxPoints: 700,
    glowUpdateFps: 30,
  }),
  high: Object.freeze({
    name: "high",
    historyMaxPoints: 10_000,
    checkpointPoints: 256,
    dprCap: 2,
    historyMaxPixels: 18_000_000,
    sessionMaxPixels: 6_000_000,
    glowMaxPoints: 1_200,
    glowUpdateFps: 60,
  }),
});

export function sanitizeTrailRenderProfile(value) {
  return TRAIL_RENDER_PROFILE_NAMES.includes(value) ? value : "auto";
}

export function detectTrailRenderProfile(capabilities = {}) {
  const saveData = capabilities.saveData === true;
  const memory = Number(capabilities.deviceMemory);
  const cores = Number(capabilities.hardwareConcurrency);
  const coarsePointer = capabilities.coarsePointer === true;

  if (
    saveData ||
    (Number.isFinite(memory) && memory <= 4) ||
    (Number.isFinite(cores) && cores <= 4)
  ) {
    return "low";
  }
  if (coarsePointer) {
    return "mobile";
  }
  if (
    Number.isFinite(memory) &&
    memory >= 8 &&
    Number.isFinite(cores) &&
    cores >= 8
  ) {
    return "high";
  }
  return "desktop";
}

export function resolveTrailRenderProfile(value, capabilities = {}) {
  const selected = sanitizeTrailRenderProfile(value);
  const name = selected === "auto"
    ? detectTrailRenderProfile(capabilities)
    : selected;
  return TRAIL_RENDER_PROFILES[name];
}

export function effectiveCanvasPixelRatio({
  cssWidth,
  cssHeight,
  devicePixelRatio = 1,
  dprCap = 2,
  maxPixels = Infinity,
}) {
  const width = Math.max(1, Number(cssWidth) || 1);
  const height = Math.max(1, Number(cssHeight) || 1);
  const pixelLimitRatio = Number.isFinite(maxPixels)
    ? Math.sqrt(Math.max(1, maxPixels) / (width * height))
    : Infinity;
  return Math.max(
    0.25,
    Math.min(Number(devicePixelRatio) || 1, dprCap, pixelLimitRatio),
  );
}

export function calculateTrailHistoryWindow(
  scrollY,
  viewportHeight,
  sceneHeight,
) {
  const viewport = Math.max(1, Math.round(Number(viewportHeight) || 1));
  const scene = Math.max(viewport, Math.round(Number(sceneHeight) || viewport));
  const height = Math.min(scene, viewport * 3);
  const maxTop = Math.max(0, scene - height);
  const page = Math.floor(Math.max(0, Number(scrollY) || 0) / viewport);
  const top = Math.min(maxTop, Math.max(0, (page - 1) * viewport));
  return { top, height, viewport };
}

export function sampleTrailPoints(points, maxPoints) {
  if (!Array.isArray(points) || points.length === 0) {
    return [];
  }
  const limit = Math.max(2, Math.floor(Number(maxPoints) || 2));
  if (points.length <= limit) {
    return points.slice();
  }
  const sampled = [points[0]];
  const step = (points.length - 1) / (limit - 1);
  let previousIndex = 0;
  for (let index = 1; index < limit - 1; index += 1) {
    const sourceIndex = Math.min(
      points.length - 2,
      Math.max(previousIndex + 1, Math.round(index * step)),
    );
    sampled.push(points[sourceIndex]);
    previousIndex = sourceIndex;
  }
  sampled.push(points.at(-1));
  return sampled;
}

export function sampleTrailRuns(runs, maxPoints) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return [];
  }
  const limit = Math.max(2, Math.floor(Number(maxPoints) || 2));
  const maxRunCount = Math.max(1, Math.floor(limit / 2));
  const selectedRuns =
    runs.length > maxRunCount
      ? sampleTrailPoints(runs, maxRunCount)
      : runs;
  const total = selectedRuns.reduce((sum, run) => sum + run.length, 0);
  if (total <= limit) {
    return selectedRuns.map((run) => run.slice());
  }
  const minimumTotal = selectedRuns.reduce(
    (sum, run) => sum + Math.min(2, run.length),
    0,
  );
  const totalExtra = total - minimumTotal;
  let remaining = limit - minimumTotal;
  return selectedRuns.map((run, index) => {
    const minimum = Math.min(2, run.length);
    const extraCapacity = run.length - minimum;
    const isLast = index === selectedRuns.length - 1;
    const extra = isLast
      ? Math.min(extraCapacity, remaining)
      : Math.min(
          extraCapacity,
          Math.floor(
            (extraCapacity / Math.max(totalExtra, 1)) *
              (limit - minimumTotal),
          ),
          remaining,
        );
    const budget = minimum + extra;
    remaining -= extra;
    return sampleTrailPoints(run, budget);
  });
}
