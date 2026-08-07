function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function pulseEnvelope(progress, start, peak, end) {
  if (progress <= start || progress >= end) {
    return 0;
  }
  if (progress <= peak) {
    return (progress - start) / Math.max(peak - start, Number.EPSILON);
  }
  return (end - progress) / Math.max(end - peak, Number.EPSILON);
}

export function rockPulseScaleFactor(progress, shrinkPercent) {
  const normalizedProgress = ((Number(progress) % 1) + 1) % 1;
  const firstBeat = pulseEnvelope(normalizedProgress, 0.02, 0.1, 0.28);
  const secondBeat = pulseEnvelope(normalizedProgress, 0.32, 0.39, 0.54);
  const strength = Math.max(firstBeat, secondBeat * 0.72);
  const shrink = clamp(Number(shrinkPercent) || 0, 0, 100) / 100;
  return 1 - shrink * strength;
}

export function rockPulseProgress(now, startedAt, bpm) {
  const frequency = Number(bpm);
  if (!Number.isFinite(frequency) || frequency <= 0) {
    return 0;
  }
  const periodMs = 60_000 / frequency;
  return ((Number(now) - Number(startedAt)) / periodMs) % 1;
}

