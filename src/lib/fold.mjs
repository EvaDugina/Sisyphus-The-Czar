import { cubicBezierYForX, parseCubicBezier } from "./rockScale.mjs";

export const DEFAULT_FOLD_SETTINGS = Object.freeze({
  draftFoldAngle: 30,
  draftFoldZoneSize: 20,
  draftFoldBlendEnabled: true,
  draftFoldBlendCurve: "cubic-bezier(0.333, 0, 0.667, 1)",
  positionScrollEnabled: true,
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
    parseCubicBezier(fallbackSource.draftFoldBlendCurve)
      ? fallbackSource.draftFoldBlendCurve
      : DEFAULT_FOLD_SETTINGS.draftFoldBlendCurve;
  const curve = String(source.draftFoldBlendCurve || "").trim();

  return {
    draftFoldAngle: finiteSetting(
      source.draftFoldAngle,
      fallbackSource.draftFoldAngle,
      0,
      180,
    ),
    draftFoldZoneSize: finiteSetting(
      source.draftFoldZoneSize,
      fallbackSource.draftFoldZoneSize,
      0,
      50,
    ),
    draftFoldBlendEnabled:
      typeof source.draftFoldBlendEnabled === "boolean"
        ? source.draftFoldBlendEnabled
        : Boolean(fallbackSource.draftFoldBlendEnabled),
    draftFoldBlendCurve: parseCubicBezier(curve) ? curve : fallbackCurve,
    positionScrollEnabled:
      typeof source.positionScrollEnabled === "boolean"
        ? source.positionScrollEnabled
        : Boolean(fallbackSource.positionScrollEnabled),
  };
}

export function buildFoldBlendMask(curve) {
  const points =
    parseCubicBezier(curve) ||
    parseCubicBezier(DEFAULT_FOLD_SETTINGS.draftFoldBlendCurve);
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
  return clean.positionScrollEnabled && clean.draftFoldZoneSize > 0;
}
