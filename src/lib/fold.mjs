import { cubicBezierYForX, parseCubicBezier } from "./rockScale.mjs";

export const DEFAULT_FOLD_SETTINGS = Object.freeze({
  foldPositionPercent: 0,
  foldPanelHeightVh: 20,
  foldAngle: 30,
  foldZoneSize: 20,
  foldBlendEnabled: true,
  foldBlendCurve: "cubic-bezier(0.333, 0, 0.667, 1)",
});

const FOLD_MASK_SAMPLE_COUNT = 32;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteSetting(value, fallback, min, max) {
  const number = Number(value);
  return clamp(Number.isFinite(number) ? number : fallback, min, max);
}

export function normalizeFoldSettings(
  settings,
  fallback = DEFAULT_FOLD_SETTINGS,
) {
  const source = settings && typeof settings === "object" ? settings : {};
  const fallbackSource =
    fallback && typeof fallback === "object"
      ? fallback
      : DEFAULT_FOLD_SETTINGS;
  const fallbackCurve =
    parseCubicBezier(fallbackSource.foldBlendCurve)
      ? fallbackSource.foldBlendCurve
      : DEFAULT_FOLD_SETTINGS.foldBlendCurve;
  const curve = String(source.foldBlendCurve || "").trim();

  return {
    foldPositionPercent: finiteSetting(
      source.foldPositionPercent,
      finiteSetting(
        fallbackSource.foldPositionPercent,
        DEFAULT_FOLD_SETTINGS.foldPositionPercent,
        0,
        100,
      ),
      0,
      100,
    ),
    foldPanelHeightVh: finiteSetting(
      source.foldPanelHeightVh,
      finiteSetting(
        fallbackSource.foldPanelHeightVh,
        DEFAULT_FOLD_SETTINGS.foldPanelHeightVh,
        1,
        100,
      ),
      1,
      100,
    ),
    foldAngle: finiteSetting(
      source.foldAngle,
      fallbackSource.foldAngle,
      0,
      180,
    ),
    foldZoneSize: finiteSetting(
      source.foldZoneSize,
      fallbackSource.foldZoneSize,
      0,
      50,
    ),
    foldBlendEnabled:
      typeof source.foldBlendEnabled === "boolean"
        ? source.foldBlendEnabled
        : Boolean(fallbackSource.foldBlendEnabled),
    foldBlendCurve: parseCubicBezier(curve) ? curve : fallbackCurve,
  };
}

export function calculateFoldDocumentLayout(
  settings,
  sceneHeightPx,
  viewportHeightPx,
) {
  const clean = normalizeFoldSettings(settings);
  const cleanViewportHeight = Math.max(0, Number(viewportHeightPx) || 0);
  const panelHeightPx =
    (cleanViewportHeight * clean.foldPanelHeightVh) / 100;
  const cleanSceneHeight = Math.max(0, Number(sceneHeightPx) || 0);
  const maxTopPx = Math.max(0, cleanSceneHeight - panelHeightPx);

  return {
    panelHeightPx,
    maxTopPx,
    topPx: (maxTopPx * clean.foldPositionPercent) / 100,
  };
}

export function buildFoldBlendMask(curve) {
  const points =
    parseCubicBezier(curve) ||
    parseCubicBezier(DEFAULT_FOLD_SETTINGS.foldBlendCurve);
  const stops = [];
  for (let index = 0; index <= FOLD_MASK_SAMPLE_COUNT; index += 1) {
    const topProgress = index / FOLD_MASK_SAMPLE_COUNT;
    const opacity = clamp(
      cubicBezierYForX(1 - topProgress, points),
      0,
      1,
    );
    stops.push(
      `rgba(0, 0, 0, ${opacity.toFixed(3)}) ${(
        topProgress * 100
      ).toFixed(3)}%`,
    );
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

export function foldEffectEnabled(settings) {
  const clean = normalizeFoldSettings(settings);
  return clean.foldZoneSize > 0;
}
