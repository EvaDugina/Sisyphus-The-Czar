import assert from "node:assert/strict";
import test from "node:test";
import {
  createCrossfadedAudioLoop,
  getCrossfadeTiming,
} from "../../src/lib/crossfadedAudioLoop.mjs";

function createAudioParam(initialValue = 0) {
  return {
    events: [],
    value: initialValue,
    setValueAtTime(value, time) {
      this.value = value;
      this.events.push({ type: "set", value, time });
    },
    linearRampToValueAtTime(value, time) {
      this.value = value;
      this.events.push({ type: "linear", value, time });
    },
  };
}

function createAudioHarness({ decodePromise = null } = {}) {
  const gains = [];
  const sources = [];
  const intervals = new Map();
  let nextIntervalId = 1;
  let fetchCount = 0;
  let closeCount = 0;

  const context = {
    currentTime: 10,
    destination: {},
    state: "running",
    close() {
      closeCount += 1;
      this.state = "closed";
      return Promise.resolve();
    },
    createBufferSource() {
      const source = {
        buffer: null,
        connectedGain: null,
        disconnected: false,
        onended: null,
        startTimes: [],
        stopTimes: [],
        connect(gain) {
          this.connectedGain = gain;
          return gain;
        },
        disconnect() {
          this.disconnected = true;
        },
        start(time) {
          this.startTimes.push(time);
        },
        stop(time) {
          this.stopTimes.push(time);
        },
      };
      sources.push(source);
      return source;
    },
    createGain() {
      const gain = {
        connectedTo: null,
        disconnected: false,
        gain: createAudioParam(),
        connect(destination) {
          this.connectedTo = destination;
          return destination;
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      gains.push(gain);
      return gain;
    },
    decodeAudioData() {
      return decodePromise || Promise.resolve({ duration: 10 });
    },
    resume() {
      this.state = "running";
      return Promise.resolve();
    },
  };

  function AudioContextConstructor() {
    return context;
  }

  const loop = createCrossfadedAudioLoop({
    src: "/audio/rain.mp3",
    AudioContextConstructor,
    AudioConstructor: null,
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      };
    },
    setIntervalImpl: (callback, delay) => {
      const id = nextIntervalId;
      nextIntervalId += 1;
      intervals.set(id, { callback, delay });
      return id;
    },
    clearIntervalImpl: (id) => intervals.delete(id),
  });

  return {
    context,
    gains,
    intervals,
    loop,
    sources,
    get closeCount() {
      return closeCount;
    },
    get fetchCount() {
      return fetchCount;
    },
  };
}

test("кроссфейд занимает 20% цикла", () => {
  assert.deepEqual(getCrossfadeTiming(10), {
    crossfadeRatio: 0.2,
    crossfadeSeconds: 2,
    nextStartOffsetSeconds: 8,
  });
});

test("лупер перекрывает соседние source и переиспользует декодированный буфер", async () => {
  const harness = createAudioHarness();
  const { context, gains, intervals, loop, sources } = harness;

  assert.equal(await loop.start(), true);
  assert.deepEqual(loop.getState(), {
    activeSourceCount: 1,
    amplificationAvailable: true,
    backend: "buffer",
    bufferReady: true,
    contextState: "running",
    crossfadeRatio: 0.2,
    decodeCount: 1,
    fallbackElementVolume: 0,
    running: true,
    schedulerActive: true,
    scheduledSourceCount: 1,
    startCount: 1,
    volume: 0,
  });
  assert.equal(intervals.size, 1);
  assert.deepEqual(sources[0].startTimes, [10.05]);
  assert.deepEqual(gains[1].gain.events, [
    { type: "set", value: 1, time: 10.05 },
    { type: "set", value: 1, time: 18.05 },
    { type: "linear", value: 0, time: 20.05 },
  ]);

  context.currentTime = 17.6;
  intervals.values().next().value.callback();
  assert.equal(sources.length, 2);
  assert.deepEqual(gains[2].gain.events, [
    { type: "set", value: 0, time: 18.05 },
    { type: "linear", value: 1, time: 20.05 },
    { type: "set", value: 1, time: 26.05 },
    { type: "linear", value: 0, time: 28.05 },
  ]);

  assert.equal(await loop.start(), true);
  assert.equal(intervals.size, 1);
  assert.equal(sources.length, 2);

  loop.setVolume(3);
  assert.equal(gains[0].gain.value, 3);
  assert.equal(loop.getState().volume, 3);

  loop.stop();
  assert.equal(intervals.size, 0);
  assert.equal(loop.getState().activeSourceCount, 0);
  assert.equal(loop.getState().running, false);
  assert.equal(sources.every((source) => source.stopTimes.length >= 2), true);

  assert.equal(await loop.start(), true);
  assert.equal(harness.fetchCount, 1);
  assert.equal(loop.getState().decodeCount, 1);
  assert.equal(loop.getState().startCount, 2);
  assert.equal(loop.getState().schedulerActive, true);

  loop.dispose();
  assert.equal(harness.closeCount, 1);
  assert.equal(loop.getState().backend, "none");
  assert.equal(loop.getState().schedulerActive, false);
});

test("остановка во время декодирования запрещает устаревший запуск", async () => {
  let resolveDecode;
  const decodePromise = new Promise((resolve) => {
    resolveDecode = resolve;
  });
  const harness = createAudioHarness({ decodePromise });
  const firstStart = harness.loop.start();

  await Promise.resolve();
  await Promise.resolve();
  harness.loop.stop();
  resolveDecode({ duration: 10 });

  assert.equal(await firstStart, false);
  assert.equal(harness.loop.getState().bufferReady, true);
  assert.equal(harness.loop.getState().schedulerActive, false);
  assert.equal(harness.sources.length, 0);

  assert.equal(await harness.loop.start(), true);
  assert.equal(harness.fetchCount, 1);
  assert.equal(harness.loop.getState().startCount, 1);
  assert.equal(harness.sources.length, 1);
});

test("media fallback сохраняет цикличность и ограничивает volume значением 1", async () => {
  const elements = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 12;
      this.loop = false;
      this.pauseCount = 0;
      this.playCount = 0;
      this.preload = "";
      this.volume = 0;
      elements.push(this);
    }

    pause() {
      this.pauseCount += 1;
    }

    play() {
      this.playCount += 1;
      return Promise.resolve();
    }
  }

  const loop = createCrossfadedAudioLoop({
    src: "/audio/rain.mp3",
    AudioContextConstructor: null,
    AudioConstructor: FakeAudio,
    fetchImpl: null,
  });
  loop.setVolume(3);

  assert.equal(await loop.start(), true);
  assert.equal(elements[0].loop, true);
  assert.equal(elements[0].playCount, 1);
  assert.equal(elements[0].volume, 1);
  assert.equal(loop.getState().backend, "media");
  assert.equal(loop.getState().running, true);

  loop.stop();
  assert.equal(elements[0].pauseCount, 1);
  assert.equal(elements[0].currentTime, 0);
  assert.equal(loop.getState().running, false);
});
