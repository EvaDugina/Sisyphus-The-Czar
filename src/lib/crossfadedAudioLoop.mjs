export const DEFAULT_CROSSFADE_RATIO = 0.2;
export const DEFAULT_LOOKAHEAD_SECONDS = 0.5;
export const DEFAULT_SCHEDULER_INTERVAL_MS = 250;

const SOURCE_STOP_PADDING_SECONDS = 0.05;
const FIRST_SOURCE_DELAY_SECONDS = 0.05;
const MAX_SCHEDULES_PER_TICK = 16;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizedVolume(value) {
  return clamp(Number(value) || 0, 0, 3);
}

export function getCrossfadeTiming(
  durationSeconds,
  crossfadeRatio = DEFAULT_CROSSFADE_RATIO
) {
  const duration = Math.max(0, Number(durationSeconds) || 0);
  const ratio = clamp(
    Number(crossfadeRatio) || DEFAULT_CROSSFADE_RATIO,
    0.001,
    0.49
  );
  const crossfadeSeconds = duration * ratio;
  return {
    crossfadeRatio: ratio,
    crossfadeSeconds,
    nextStartOffsetSeconds: duration - crossfadeSeconds,
  };
}

export function createCrossfadedAudioLoop({
  src,
  crossfadeRatio = DEFAULT_CROSSFADE_RATIO,
  lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
  schedulerIntervalMs = DEFAULT_SCHEDULER_INTERVAL_MS,
  AudioContextConstructor = globalThis.AudioContext ||
    globalThis.webkitAudioContext,
  AudioConstructor = globalThis.Audio,
  fetchImpl = typeof globalThis.fetch === "function"
    ? globalThis.fetch.bind(globalThis)
    : null,
  setIntervalImpl = typeof globalThis.setInterval === "function"
    ? globalThis.setInterval.bind(globalThis)
    : null,
  clearIntervalImpl = typeof globalThis.clearInterval === "function"
    ? globalThis.clearInterval.bind(globalThis)
    : null,
} = {}) {
  const timingRatio = getCrossfadeTiming(1, crossfadeRatio).crossfadeRatio;
  const safeLookaheadSeconds = Math.max(0.01, Number(lookaheadSeconds) || 0);
  const safeSchedulerIntervalMs = Math.max(
    16,
    Math.round(Number(schedulerIntervalMs) || 0)
  );

  let context = null;
  let masterGain = null;
  let audioBuffer = null;
  let bufferPromise = null;
  let fallbackElement = null;
  let backend = "none";
  let schedulerId = null;
  let nextStartTime = 0;
  let activeSources = [];
  let running = false;
  let startPromise = null;
  let startPromiseGeneration = 0;
  let requestGeneration = 0;
  let scheduledSourceCount = 0;
  let startCount = 0;
  let decodeCount = 0;
  let volume = 0;
  let disposed = false;

  function resumeContext() {
    if (!context || context.state !== "suspended") {
      return;
    }
    const promise = context.resume();
    if (promise && typeof promise.catch === "function") {
      promise.catch(() => {});
    }
  }

  function disconnectNode(node) {
    try {
      node?.disconnect();
    } catch {
      /* Узел уже отключён. */
    }
  }

  function removeSource(entry) {
    activeSources = activeSources.filter((candidate) => candidate !== entry);
    disconnectNode(entry.source);
    disconnectNode(entry.gain);
  }

  function stopActiveSources() {
    const sources = activeSources;
    activeSources = [];
    sources.forEach((entry) => {
      entry.source.onended = null;
      try {
        entry.source.stop();
      } catch {
        /* Source уже остановлен. */
      }
      disconnectNode(entry.source);
      disconnectNode(entry.gain);
    });
  }

  function clearScheduler() {
    if (schedulerId !== null && clearIntervalImpl) {
      clearIntervalImpl(schedulerId);
    }
    schedulerId = null;
  }

  function createFallbackElement() {
    if (fallbackElement) {
      return true;
    }
    if (typeof AudioConstructor !== "function") {
      backend = "none";
      return false;
    }
    const audio = new AudioConstructor(src);
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = clamp(volume, 0, 1);
    fallbackElement = audio;
    backend = "media";
    return true;
  }

  function closeBufferBackend() {
    disconnectNode(masterGain);
    masterGain = null;
    if (context) {
      const promise = context.close();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => {});
      }
    }
    context = null;
    audioBuffer = null;
  }

  async function prepare() {
    if (disposed) {
      return false;
    }
    if (backend === "media") {
      return true;
    }
    if (audioBuffer && context && masterGain) {
      resumeContext();
      return true;
    }
    if (bufferPromise) {
      resumeContext();
      return bufferPromise;
    }
    if (
      typeof AudioContextConstructor !== "function" ||
      typeof fetchImpl !== "function"
    ) {
      return createFallbackElement();
    }

    try {
      context = new AudioContextConstructor();
      masterGain = context.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(context.destination);
      backend = "buffer";
      resumeContext();
    } catch {
      closeBufferBackend();
      return createFallbackElement();
    }

    bufferPromise = (async () => {
      try {
        const response = await fetchImpl(src);
        if (response && "ok" in response && !response.ok) {
          throw new Error(`Audio request failed with status ${response.status}`);
        }
        const encodedAudio = await response.arrayBuffer();
        const decodedAudio = await context.decodeAudioData(encodedAudio);
        if (disposed) {
          return false;
        }
        audioBuffer = decodedAudio;
        decodeCount += 1;
        return true;
      } catch {
        if (disposed) {
          return false;
        }
        closeBufferBackend();
        return createFallbackElement();
      } finally {
        bufferPromise = null;
      }
    })();
    return bufferPromise;
  }

  function scheduleOneSource(startAt, isFirstSource) {
    const source = context.createBufferSource();
    source.buffer = audioBuffer;

    const gain = context.createGain();
    const { crossfadeSeconds, nextStartOffsetSeconds } = getCrossfadeTiming(
      audioBuffer.duration,
      timingRatio
    );
    const endAt = startAt + audioBuffer.duration;
    const fadeOutAt = endAt - crossfadeSeconds;

    gain.gain.setValueAtTime(isFirstSource ? 1 : 0, startAt);
    if (!isFirstSource) {
      gain.gain.linearRampToValueAtTime(1, startAt + crossfadeSeconds);
    }
    gain.gain.setValueAtTime(
      1,
      Math.max(startAt + crossfadeSeconds, fadeOutAt)
    );
    gain.gain.linearRampToValueAtTime(0, endAt);

    source.connect(gain);
    gain.connect(masterGain);
    const entry = { source, gain };
    activeSources.push(entry);
    source.onended = () => removeSource(entry);
    source.start(startAt);
    source.stop(endAt + SOURCE_STOP_PADDING_SECONDS);

    scheduledSourceCount += 1;
    nextStartTime = startAt + nextStartOffsetSeconds;
  }

  function scheduleAhead() {
    if (!running || backend !== "buffer" || !context || !audioBuffer) {
      return;
    }

    const deadline = context.currentTime + safeLookaheadSeconds;
    let schedules = 0;
    while (
      running &&
      nextStartTime <= deadline &&
      schedules < MAX_SCHEDULES_PER_TICK
    ) {
      const startAt = Math.max(nextStartTime, context.currentTime);
      scheduleOneSource(startAt, scheduledSourceCount === 0);
      schedules += 1;
    }
  }

  function startFallback() {
    if (!fallbackElement) {
      return false;
    }
    try {
      fallbackElement.currentTime = 0;
    } catch {
      /* currentTime может быть недоступен до загрузки metadata. */
    }
    fallbackElement.volume = clamp(volume, 0, 1);
    const promise = fallbackElement.play();
    if (promise && typeof promise.catch === "function") {
      return promise.then(() => true).catch(() => false);
    }
    return true;
  }

  function start() {
    if (disposed) {
      return Promise.resolve(false);
    }
    if (running) {
      return Promise.resolve(true);
    }
    if (startPromise && startPromiseGeneration === requestGeneration) {
      return startPromise;
    }

    const generation = ++requestGeneration;
    startPromiseGeneration = generation;
    const pendingStart = (async () => {
      const ready = await prepare();
      if (!ready || disposed || generation !== requestGeneration) {
        return false;
      }
      if (backend === "media") {
        const started = await startFallback();
        if (!started || disposed || generation !== requestGeneration) {
          return false;
        }
        running = true;
        startCount += 1;
        return true;
      }
      if (!context || !audioBuffer || !masterGain || !setIntervalImpl) {
        return false;
      }

      resumeContext();
      running = true;
      scheduledSourceCount = 0;
      nextStartTime = context.currentTime + FIRST_SOURCE_DELAY_SECONDS;
      scheduleAhead();
      schedulerId = setIntervalImpl(scheduleAhead, safeSchedulerIntervalMs);
      startCount += 1;
      return true;
    })().finally(() => {
      if (startPromiseGeneration === generation) {
        startPromise = null;
      }
    });
    startPromise = pendingStart;
    return startPromise;
  }

  function stop() {
    requestGeneration += 1;
    running = false;
    clearScheduler();
    stopActiveSources();
    scheduledSourceCount = 0;
    nextStartTime = 0;
    if (fallbackElement) {
      fallbackElement.pause();
      try {
        fallbackElement.currentTime = 0;
      } catch {
        /* currentTime может быть недоступен до загрузки metadata. */
      }
    }
  }

  function setVolume(nextVolume) {
    volume = normalizedVolume(nextVolume);
    if (masterGain) {
      masterGain.gain.value = volume;
    }
    if (fallbackElement) {
      fallbackElement.volume = clamp(volume, 0, 1);
    }
  }

  function getState() {
    return {
      activeSourceCount: activeSources.length,
      amplificationAvailable: masterGain !== null,
      backend,
      bufferReady: audioBuffer !== null,
      contextState: context?.state || null,
      crossfadeRatio: timingRatio,
      decodeCount,
      fallbackElementVolume: fallbackElement?.volume ?? 0,
      running,
      schedulerActive: schedulerId !== null,
      scheduledSourceCount,
      startCount,
      volume,
    };
  }

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    stop();
    if (fallbackElement) {
      fallbackElement.src = "";
      fallbackElement.load?.();
      fallbackElement = null;
    }
    closeBufferBackend();
    backend = "none";
  }

  return {
    dispose,
    getState,
    prepare,
    setVolume,
    start,
    stop,
  };
}
