"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Physics = require("../../shared/physics");
const RoomSettings = require("../../shared/room-settings");
const ProductionPreset = require("../../shared/production-preset");
const GachiSounds = require("../../shared/gachi-sounds");
const ChainSounds = require("../../shared/chain-sounds");
const {
  SessionManager,
  DEFAULT_SESSION_ID,
  DISCONNECTED_CLIENT_TTL_MS,
  DEFAULT_EMPTY_SESSION_GRACE_MS,
  DEFAULT_AUDIO_LEAD_MS,
  SLIP_DELAY_MIN_MS,
  SLIP_DELAY_MAX_MS,
  STATIONARY_HOLD_RELEASE_MS,
} = require("../../server/session-manager");

class FakeSocket {
  constructor() {
    this.readyState = 1;
    this.messages = [];
  }

  send(raw) {
    this.messages.push(JSON.parse(raw));
  }

  close() {
    this.readyState = 3;
  }
}

function setup(options = {}) {
  const clock = { value: 0 };
  const manager = new SessionManager({
    ttlMs: options.ttlMs || 10_000,
    emptyGraceMs: options.emptyGraceMs ?? DEFAULT_EMPTY_SESSION_GRACE_MS,
    now: () => clock.value,
    random: options.random || (() => 0.5),
    identityRandom: options.identityRandom || (() => 0.5),
    soundRandom: options.soundRandom || (() => 0.5),
    slipDelayMinMs: options.slipDelayMinMs,
    slipDelayMaxMs: options.slipDelayMaxMs,
    stationaryHoldReleaseMs: options.stationaryHoldReleaseMs,
    audioLeadMs: options.audioLeadMs,
    productionPresetSelectionEnabled:
      options.productionPresetSelectionEnabled,
    getProductionPresetSelection: options.getProductionPresetSelection,
    saveProductionPresetSelection: options.saveProductionPresetSelection,
    settingsTemplatesEnabled: options.settingsTemplatesEnabled,
    getSettingsTemplatesPage: options.getSettingsTemplatesPage,
    importSettingsTemplates: options.importSettingsTemplates,
    saveSettingsTemplate: options.saveSettingsTemplate,
    deleteSettingsTemplate: options.deleteSettingsTemplate,
    createSettingsConflict: options.createSettingsConflict,
  });
  return { clock, manager };
}

function connect(manager, session, id) {
  const socket = new FakeSocket();
  const client = manager.connectClient(session, id, socket);
  return { socket, client };
}

function setRunningSummitTimer(session, runningSince = 0) {
  session.summitElapsedMs = 0;
  session.summitRunningSince = runningSince;
  session.summitWasInside = false;
}

test("реестр gachi-звуков совпадает с файлами ассетов", () => {
  const directory = path.resolve(__dirname, "../../assets/audio/gachi");
  const filenames = fs
    .readdirSync(directory)
    .filter((filename) => filename.toLowerCase().endsWith(".mp3"))
    .sort();

  assert.deepEqual(filenames, [...GachiSounds.GACHI_SOUND_FILENAMES]);
});

test("реестр звуков цепей совпадает с файлами ассетов", () => {
  const directory = path.resolve(__dirname, "../../assets/audio");
  const filenames = fs
    .readdirSync(directory)
    .filter((filename) => /^Кандалы_\d{2}\.mp3$/u.test(filename))
    .sort();

  assert.deepEqual(filenames, [...ChainSounds.CHAIN_SOUND_FILENAMES]);
});

test("все участники комнаты получают роль master", () => {
  const { manager } = setup();
  const session = manager.createSession({
    creatorClientId: "client-master-0001",
  });
  const master = connect(manager, session, "client-master-0001");
  const second = connect(manager, session, "client-second-0001");

  assert.equal(master.client.role, "master");
  assert.equal(second.client.role, "master");
  assert.equal(
    master.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.clientRole,
    "master"
  );
  assert.equal(
    second.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.clientRole,
    "master"
  );
  assert.equal(
    Object.hasOwn(manager.serializeSessions()[0], "masterClientId"),
    false,
  );
  assert.equal(Object.hasOwn(master.client, "gachiSoundFilename"), false);
  assert.equal(Object.hasOwn(second.client, "gachiSoundFilename"), false);
});

test("audio.play рассылает один звук роли всем участникам с общим playAt", () => {
  const { clock, manager } = setup({
    soundRandom: () => 0,
    audioLeadMs: DEFAULT_AUDIO_LEAD_MS,
  });
  clock.value = 1000;
  const session = manager.createSession({
    creatorClientId: "client-audio-master",
  });
  const master = connect(manager, session, "client-audio-master");
  const second = connect(manager, session, "client-audio-second1");

  manager.handleMessage(session, master.client, {
    v: 1,
    type: "audio.play",
    seq: 1,
    payload: {},
  });
  const masterEvent = master.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );
  const secondCopy = second.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );

  assert.deepEqual(secondCopy, masterEvent);
  assert.match(masterEvent.payload.eventId, /^[A-Za-z0-9_-]{16}$/);
  assert.deepEqual(masterEvent.payload, {
    eventId: masterEvent.payload.eventId,
    actorId: master.client.id,
    role: "master",
    filename: ChainSounds.CHAIN_SOUND_FILENAMES[0],
    playAt: 1000 + DEFAULT_AUDIO_LEAD_MS,
    serverTime: 1000,
  });

  clock.value = 1500;
  manager.handleMessage(session, second.client, {
    v: 1,
    type: "audio.play",
    seq: 1,
    payload: {},
  });
  const secondEventAtMaster = master.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );
  const secondEvent = second.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );

  assert.deepEqual(secondEventAtMaster, secondEvent);
  assert.deepEqual(secondEvent.payload, {
    eventId: secondEvent.payload.eventId,
    actorId: second.client.id,
    role: "master",
    filename: ChainSounds.CHAIN_SOUND_FILENAMES[0],
    playAt: 1500 + DEFAULT_AUDIO_LEAD_MS,
    serverTime: 1500,
  });

  session.state.phase = Physics.PHASES.FALLING;
  manager.handleMessage(session, second.client, {
    v: 1,
    type: "audio.play",
    seq: 2,
    payload: {},
  });
  assert.equal(
    second.socket.messages.filter((message) => message.type === "audio.play")
      .length,
    2
  );
});

test("каждое новое подключение получает роль master", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-fallback-01");
  const second = connect(manager, session, "client-fallback-02");

  assert.equal(first.client.role, "master");
  assert.equal(second.client.role, "master");
});

test("сессия без явного state стартует в нижнем play", () => {
  const { manager } = setup();
  const session = manager.createSession();

  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, Physics.WORLD_WIDTH / 2);
  assert.equal(session.state.y, Physics.WORLD_HEIGHT);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.suspended, true);
});

test("подвешенный play-старт не двигается до первого захвата", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: 1800,
      suspended: true,
    },
    physics: { gravity: 100, handForce: 200, turbulence: 0, bounce: 0 },
  });

  clock.value += 1000;
  manager.tick(clock.value);

  assert.equal(session.state.y, 1800);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.suspended, true);

  const first = connect(manager, session, "client-suspended-a1");
  const snapshot = first.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  assert.equal(
    snapshot.payload.suspended,
    true
  );

  assert.equal(
    manager.acquireControl(session, first.client, { x: 500, y: 1800 }),
    true
  );
  assert.equal(session.state.suspended, false);
  assert.equal(session.state.dragging, true);
});

test("секундомер вершины останавливается с последней рукой и продолжается при новом входе", () => {
  const { clock, manager } = setup();
  clock.value = 1000;
  const session = manager.createSession({
    sceneId: "juices",
    state: {
      phase: Physics.PHASES.PLAY,
      x: Physics.WORLD_WIDTH / 2,
      y: 300,
      suspended: true,
    },
  });
  const master = connect(manager, session, "client-timer-master");
  const second = connect(manager, session, "client-timer-second1");

  session.state.x = session.imprint.x;
  session.state.y = session.imprint.y;
  manager.tick();

  const masterStart = master.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  const secondStart = second.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  assert.equal(masterStart.payload.summitElapsedMs, 0);
  assert.equal(masterStart.payload.summitTimerRunning, true);
  assert.equal(masterStart.payload.serverTime, 1000);
  assert.deepEqual(secondStart.payload, masterStart.payload);

  clock.value = 3000;
  manager.acquireControl(session, master.client, {
    x: session.imprint.x,
    y: session.imprint.y,
  });
  const outsideY = session.imprint.y + session.imprint.toleranceY + 100;
  session.state.y = outsideY;
  assert.equal(manager.snapshot(session).summitElapsedMs, 2000);
  assert.equal(manager.snapshot(session).summitTimerRunning, true);

  clock.value = 3500;
  manager.releaseControl(session, master.client, {
    x: session.imprint.x,
    y: outsideY,
    vx: 0,
    vy: -2000,
  });
  const masterStop = master.socket.messages.findLast(
    (message) =>
      message.type === "session.snapshot" &&
      message.payload.summitTimerRunning === false
  );
  const secondStop = second.socket.messages.findLast(
    (message) =>
      message.type === "session.snapshot" &&
      message.payload.summitTimerRunning === false
  );
  assert.equal(masterStop.payload.summitElapsedMs, 2500);
  assert.equal(secondStop.payload.summitElapsedMs, 2500);
  assert.equal(session.state.dragging, false);

  clock.value = 5000;
  manager.tick();
  assert.equal(manager.snapshot(session).summitElapsedMs, 2500);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);

  clock.value = 6000;
  session.state.suspended = true;
  session.state.vx = 0;
  session.state.vy = 0;
  session.state.x = session.imprint.x;
  session.state.y = session.imprint.y;
  manager.tick();
  clock.value = 7500;
  assert.equal(manager.snapshot(session).summitElapsedMs, 4000);
  assert.equal(manager.snapshot(session).summitTimerRunning, true);

  clock.value = 8000;
  manager.restartSession(session, {
    x: Physics.WORLD_WIDTH / 2,
    y: Physics.WORLD_HEIGHT,
    suspended: true,
  });
  const restarted = manager.snapshot(session);
  assert.equal(restarted.summitElapsedMs, 4500);
  assert.equal(restarted.summitTimerRunning, true);
});

test("ники царей выбираются случайно и нумеруются отдельно для каждого имени", () => {
  const randomValues = [10 / 64, 10 / 64, 0];
  const { manager } = setup({
    identityRandom: () => randomValues.shift() ?? 0,
  });

  manager.createSession();
  manager.createSession();
  manager.createSession();

  assert.deepEqual(
    manager.serializeLeaderboard().entries.map((entry) => entry.name),
    ["Царь Константин 1", "Царь Константин 2", "Царь Иван 1"],
  );
});

test("рейтинг показывает top-10, текущего и последнее абсолютное место", () => {
  const { manager } = setup({ identityRandom: () => 0 });
  const sessions = Array.from({ length: 13 }, () => manager.createSession());

  const initial = manager.leaderboardSnapshot(sessions[0]);
  assert.equal(initial.current, null);
  assert.equal(initial.last, null);
  assert.equal(initial.total, 0);
  assert.deepEqual(initial.top, []);

  sessions.forEach((session, index) => {
    session.summitElapsedMs = (index + 1) * 1000;
    manager.commitLeaderboardResult(session, session.summitElapsedMs);
  });
  const leaderboard = manager.leaderboardSnapshot(sessions[1]);
  assert.equal(leaderboard.total, 13);
  assert.equal(leaderboard.top.length, 10);
  assert.equal(leaderboard.top[0].scoreMs, 13_000);
  assert.equal(leaderboard.top.at(-1).scoreMs, 4_000);
  assert.equal(leaderboard.current.rank, 12);
  assert.equal(leaderboard.current.name, "Царь Иван 2");
  assert.equal(leaderboard.last.rank, 13);
  assert.equal(leaderboard.last.name, "Царь Иван 1");

  const restored = setup({ identityRandom: () => 0 }).manager;
  restored.restoreLeaderboard(manager.serializeLeaderboard());
  const next = restored.createSession();
  assert.equal(next.leaderboardId, "czar-14");
  assert.equal(restored.serializeLeaderboard().entries.at(-1).name, "Царь Иван 14");
});

test("legacy-рейтинг мигрирует в новый формат и сохраняет результаты", () => {
  const { manager } = setup({ identityRandom: () => 0 });
  manager.restoreLeaderboard({
    czarSequence: 65,
    entries: [
      {
        id: "czar-65",
        sequence: 65,
        name: "ЦарьИван65",
        bestMs: 3000,
        createdAt: 65,
        updatedAt: 65,
      },
      {
        id: "czar-1",
        sequence: 1,
        name: "ЦарьИван1",
        bestMs: 1000,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "czar-11",
        sequence: 11,
        name: "Царь Константин 99",
        bestMs: 2000,
        createdAt: 11,
        updatedAt: 11,
      },
    ],
  });

  assert.deepEqual(
    manager.serializeLeaderboard().entries.map(({ name, bestMs }) => ({
      name,
      bestMs,
    })),
    [
      { name: "Царь Иван 1", bestMs: 1000 },
      { name: "Царь Константин 1", bestMs: 2000 },
      { name: "Царь Иван 2", bestMs: 3000 },
    ],
  );

  manager.createSession();
  assert.equal(manager.serializeLeaderboard().entries.at(-1).name, "Царь Иван 3");
});

test("невидимая линия запрещает захват и выбрасывает камень случайным импульсом", () => {
  const { manager } = setup({ random: () => 0.5 });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    roomSettings: {
      sceneHeightScreens: 20,
      sceneTwoBarrierEnabled: true,
      sceneTwoBarrierHeightVh: 1000,
      sceneTwoBarrierHopMissProbabilityPercent: 0,
      sceneTwoBarrierHopMaxDistancePercent: 75,
      sceneTwoBarrierHopSpeedPxPerSecond: 1200,
    },
  });
  const participant = connect(manager, session, "barrier-client-001");

  assert.equal(
    manager.acquireControl(session, participant.client, { x: 500, y: 900 }),
    false,
  );
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.suspended, false);
  assert.ok(Math.hypot(session.state.vx, session.state.vy) > 0);
  const denied = participant.socket.messages.findLast(
    (message) => message.type === "control.denied",
  );
  assert.equal(denied.payload.reason, "scene_two_barrier");
  assert.equal(
    participant.socket.messages.some((message) => message.type === "audio.play"),
    false,
  );
});

test("активный секундомер вершины сохраняется и продолжается после restore", () => {
  const firstSetup = setup();
  firstSetup.clock.value = 1000;
  const session = firstSetup.manager.createSession({
    sceneId: "juices",
    state: {
      phase: Physics.PHASES.PLAY,
      x: Physics.WORLD_WIDTH / 2,
      y: 300,
      suspended: true,
    },
  });
  session.state.x = session.imprint.x;
  session.state.y = session.imprint.y;
  firstSetup.manager.tick();

  firstSetup.clock.value = 3000;
  const record = firstSetup.manager.serializeSessions()[0];
  assert.equal(record.summitElapsedMs, 0);
  assert.equal(record.summitRunningSince, 1000);

  const restoredSetup = setup();
  restoredSetup.clock.value = 4000;
  assert.equal(restoredSetup.manager.restoreSessions([record]), 1);
  const restored = restoredSetup.manager.getSession(record.id);
  assert.equal(restoredSetup.manager.snapshot(restored).summitElapsedMs, 3000);
  assert.equal(restoredSetup.manager.snapshot(restored).summitTimerRunning, true);

  restoredSetup.clock.value = 4500;
  restored.state.y = restored.imprint.y + restored.imprint.toleranceY + 1;
  restoredSetup.manager.tick();
  assert.equal(restoredSetup.manager.snapshot(restored).summitElapsedMs, 3500);
  assert.equal(restoredSetup.manager.snapshot(restored).summitTimerRunning, true);
});

test("явный нулевой reset таймера на вершине начинает отсчёт от restore, а не от epoch", () => {
  const restoredSetup = setup();
  const imprint = Physics.createSummitImprint();
  restoredSetup.clock.value = 1_800_000_000_000;
  assert.equal(
    restoredSetup.manager.restoreSessions([
      {
        id: "SisyphusGlobalRoom0000",
        sceneId: "juices",
        state: {
          phase: Physics.PHASES.PLAY,
          x: Physics.WORLD_WIDTH / 2,
          y: imprint.y,
          suspended: true,
        },
        imprint,
        expiresAt: restoredSetup.clock.value + 10_000,
        emptyDeleteAt: null,
        summitElapsedMs: 0,
        summitRunningSince: null,
      },
    ]),
    1
  );

  const restored = restoredSetup.manager.getSession("SisyphusGlobalRoom0000");
  assert.equal(restored.summitRunningSince, restoredSetup.clock.value);
  assert.equal(restoredSetup.manager.snapshot(restored).summitElapsedMs, 0);
  assert.equal(restoredSetup.manager.snapshot(restored).summitTimerRunning, true);

  restoredSetup.clock.value += 1000;
  assert.equal(restoredSetup.manager.snapshot(restored).summitElapsedMs, 1000);
});

test("остановленный секундомер сохраняется и старая упавшая сессия замораживается при restore", () => {
  const firstSetup = setup();
  const summitY = Physics.createSummitImprint().y;
  firstSetup.clock.value = 1000;
  const stopped = firstSetup.manager.createSession({
    sceneId: "juices",
    state: {
      phase: Physics.PHASES.PLAY,
      x: Physics.WORLD_WIDTH / 2,
      y: summitY,
      suspended: true,
    },
  });

  firstSetup.clock.value = 3000;
  assert.equal(firstSetup.manager.stopSummitTimer(stopped), true);
  const stoppedRecord = firstSetup.manager.serializeSessions()[0];
  assert.equal(stoppedRecord.summitElapsedMs, 2000);
  assert.equal(stoppedRecord.summitRunningSince, null);

  const restoredSetup = setup();
  restoredSetup.clock.value = 4000;
  assert.equal(
    restoredSetup.manager.restoreSessions([
      stoppedRecord,
      {
        id: "timerfallen00000000000",
        sceneId: "juices",
        state: {
          phase: Physics.PHASES.PLAY,
          x: Physics.WORLD_WIDTH / 2,
          y: Physics.WORLD_HEIGHT,
          suspended: false,
        },
        imprint: Physics.createSummitImprint(),
        expiresAt: 10_000,
        emptyDeleteAt: null,
        summitElapsedMs: 500,
        summitRunningSince: 1000,
      },
      {
        id: "timerdragged0000000000",
        sceneId: "juices",
        state: {
          phase: Physics.PHASES.PLAY,
          x: Physics.WORLD_WIDTH / 2,
          y: summitY,
          vy: -500,
          dragging: true,
          suspended: false,
        },
        imprint: Physics.createSummitImprint(),
        expiresAt: 10_000,
        emptyDeleteAt: null,
        lastPointer: { vx: 0, vy: -1000 },
        lastPointerAt: 4000,
        summitElapsedMs: 250,
        summitRunningSince: 1000,
      },
    ]),
    3
  );

  const restoredStopped = restoredSetup.manager.getSession(stoppedRecord.id);
  const restoredFallen = restoredSetup.manager.getSession(
    "timerfallen00000000000"
  );
  const restoredDragged = restoredSetup.manager.getSession(
    "timerdragged0000000000"
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredStopped).summitElapsedMs,
    2000
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredStopped).summitTimerRunning,
    false
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredFallen).summitElapsedMs,
    3500
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredFallen).summitTimerRunning,
    false
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredDragged).summitElapsedMs,
    3250
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredDragged).summitTimerRunning,
    false
  );
  assert.ok(restoredDragged.state.vy < 0);

  restoredSetup.clock.value = 6000;
  restoredSetup.manager.tick();
  assert.equal(
    restoredSetup.manager.snapshot(restoredStopped).summitElapsedMs,
    2000
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredFallen).summitElapsedMs,
    3500
  );
  assert.equal(
    restoredSetup.manager.snapshot(restoredDragged).summitElapsedMs,
    3250
  );
});

test("старая сессия внутри вершины получает нулевой таймер на паузе", () => {
  const { clock, manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "timerlegacy00000000000",
      sceneId: "juices",
      state: {
        phase: Physics.PHASES.PLAY,
        x: Physics.WORLD_WIDTH / 2,
        y: Physics.SUMMIT_IMPRINT_Y,
        suspended: true,
      },
      imprint: Physics.createSummitImprint(),
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);
  assert.equal(restored, 1);

  const session = manager.getSession("timerlegacy00000000000");
  assert.equal(manager.snapshot(session).summitElapsedMs, 0);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);

  clock.value = 1000;
  manager.tick();
  assert.equal(manager.snapshot(session).summitTimerRunning, false);

  session.state.y = session.imprint.y + session.imprint.toleranceY + 1;
  manager.tick();
  clock.value = 2000;
  session.state.y = session.imprint.y;
  manager.tick();
  assert.equal(manager.snapshot(session).summitTimerRunning, true);
});

test("persisted session мигрирует Fold, отскок, камень и руку в room schema 36", () => {
  const { manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "legacyfold000000000000",
      state: { phase: Physics.PHASES.PLAY, suspended: true },
      roomSettingsVersion: 30,
      roomSettings: {
        draftFoldAngle: 43,
        draftFoldZoneSize: 19,
        draftFoldBlendEnabled: false,
        draftFoldBlendCurve: "cubic-bezier(0, 0, 1, 1)",
        foldAngle: 54,
        preclickParallaxActivationRadiusVw: 36,
        rockPressShrinkPercent: 17,
      },
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);

  assert.equal(restored, 1);
  const session = manager.getSession("legacyfold000000000000");
  assert.equal(session.roomSettings.foldAngle, 54);
  assert.equal(session.roomSettings.foldZoneSize, 19);
  assert.equal(session.roomSettings.foldPositionPercent, 0);
  assert.equal(session.roomSettings.foldPanelHeightVh, 19);
  assert.equal(session.roomSettings.foldBlendEnabled, false);
  assert.equal(
    session.roomSettings.foldBlendCurve,
    "cubic-bezier(0, 0, 1, 1)",
  );
  assert.equal(
    Object.keys(session.roomSettings).some((key) => key.startsWith("draftFold")),
    false,
  );
  assert.equal(session.roomSettings.preclickHopMaxDistancePercent, 45);
  assert.equal(session.roomSettings.preclickHopActivationRadiusPercent, 36);
  assert.equal(session.roomSettings.preclickHopGuardClickCount, 1);
  assert.equal(
    Object.hasOwn(session.roomSettings, "preclickParallaxActivationRadiusVw"),
    false,
  );
  assert.equal(session.roomSettings.rockImageId, "rock-03");
  assert.equal(session.roomSettings.foldRockImageId, "rock-03");
  assert.equal(session.roomSettings.rockPulseShrinkPercent, 17);
  assert.equal(
    manager.serializeSessions()[0].roomSettingsVersion,
    RoomSettings.ROOM_SETTINGS_VERSION,
  );
});

test("legacy masterClientId игнорируется, а все новые подключения получают master", () => {
  const { manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "cccccccccccccccccccccc",
      state: { phase: Physics.PHASES.PLAY },
      masterClientId: "client-master-keep",
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);
  assert.equal(restored, 1);

  const session = manager.getSession("cccccccccccccccccccccc");
  const first = connect(manager, session, "client-restore-first");
  const second = connect(manager, session, "client-master-keep");

  assert.equal(first.client.role, "master");
  assert.equal(second.client.role, "master");
  assert.equal(Object.hasOwn(session, "masterClientId"), false);

  assert.equal(
    manager.leaveClient(session, second.client.id, second.client.leaveToken),
    true
  );
  const next = connect(manager, session, "client-next-master");

  assert.equal(next.client.role, "master");
  assert.equal(Object.hasOwn(manager.serializeSessions()[0], "masterClientId"), false);
});

test("общие визуальные настройки комнаты нормализуются и попадают в snapshot", () => {
  const { manager } = setup();
  const session = manager.createSession({
    roomSettings: {
      sceneHeightScreens: 200,
      handWidthVw: 120,
      handForceDeficitEasing: "not-a-curve",
      handAudioEnabled: false,
      drizzleEnabled: false,
      trailMaxPoints: 99_999,
      lineWidth: 99,
      rainDropColor: "bad",
      rainHighlightColor: "#ABCDEF",
      rainEnterMs: 650,
      rainExitMs: 700,
      rainMaxVolume: 9,
      rainAudioEnterMs: 450,
      rainAudioExitMs: 550,
    },
  });
  const first = connect(manager, session, "client-room-settings-a1");

  assert.equal(session.roomSettings.sceneHeightScreens, 100);
  assert.equal(session.roomSettings.handWidthVw, 90);
  assert.equal(session.roomSettings.handAudioEnabled, false);
  assert.equal(session.roomSettings.drizzleEnabled, false);
  assert.equal(
    session.roomSettings.handForceDeficitEasing,
    RoomSettings.DEFAULT_ROOM_SETTINGS.handForceDeficitEasing
  );
  assert.equal(session.roomSettings.trailMaxPoints, 10_000);
  assert.equal(Object.hasOwn(session.roomSettings, "trailUnlimited"), false);
  assert.equal(session.roomSettings.lineWidth, 60);
  assert.equal(session.roomSettings.rainEnterMs, 650);
  assert.equal(session.roomSettings.rainExitMs, 700);
  assert.equal(session.roomSettings.rainMaxVolume, 3);
  assert.equal(
    RoomSettings.sanitizeRoomSettings({ sceneHeightScreens: 0 })
      .sceneHeightScreens,
    1
  );
  assert.equal(Object.hasOwn(session.roomSettings, "rainAudioEnterMs"), false);
  assert.equal(Object.hasOwn(session.roomSettings, "rainAudioExitMs"), false);
  assert.equal(
    session.roomSettings.rainDropColor,
    RoomSettings.DEFAULT_ROOM_SETTINGS.rainDropColor
  );
  assert.equal(session.roomSettings.rainHighlightColor, "#abcdef");
  assert.deepEqual(
    manager.serializeSessions()[0].roomSettings,
    session.roomSettings
  );
  assert.equal(
    manager.serializeSessions()[0].roomSettingsVersion,
    RoomSettings.ROOM_SETTINGS_VERSION
  );
  assert.deepEqual(
    first.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.roomSettings,
    session.roomSettings
  );
});

test("roomSettings.update синхронизирует размер руки и цвета дождя", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-room-settings-b1");
  const second = connect(manager, session, "client-room-settings-b2");
  session.state.vy = 20;
  const expectedRoomSettings = {
    ...RoomSettings.DEFAULT_ROOM_SETTINGS,
    sceneHeightScreens: 50,
    handWidthVw: 42.5,
    handForceDeficitEasing: "cubic-bezier(0, 0, 1, 1)",
    preclickHopGuardClickCount: 3,
    preclickHopActivationRadiusPercent: 36,
    preclickHopMaxDistancePercent: 72,
    handVisibilityMode: "hidden",
    handImageChangeDelayMs: 375,
    rockGrabRadiusVh: 4.5,
    cameraFollowUpEnabled: false,
    cameraFollowUpLerp: 0.25,
    cameraFollowDownEnabled: true,
    cameraFollowDownLerp: 0.4,
    rockAccelerationEnabled: false,
    rainMaxVolume: 2.5,
    rainDropColor: "#123456",
    rainHighlightColor: "#fedcba",
    trailReset: true,
    trailMaxPoints: 1500,
    lineWidth: 3,
    lineOpacity: 0.8,
    linePassOpacity: 0.1,
  };

  manager.handleMessage(session, first.client, {
    v: 1,
    type: "roomSettings.update",
    seq: 1,
    payload: {
      sceneHeightScreens: 50,
      handWidthVw: 42.5,
      handForceDeficitEasing: "cubic-bezier(0, 0, 1, 1)",
      preclickHopGuardClickCount: 3,
      preclickHopActivationRadiusPercent: 36,
      preclickHopMaxDistancePercent: 72,
      handVisibilityMode: "hidden",
      handImageChangeDelayMs: 375,
      rockGrabRadiusVh: 4.5,
      cameraFollowUpEnabled: false,
      cameraFollowUpLerp: 0.25,
      cameraFollowDownEnabled: true,
      cameraFollowDownLerp: 0.4,
      rockAccelerationEnabled: true,
      rainMaxVolume: 2.5,
      rainDropColor: "#123456",
      rainHighlightColor: "#fedcba",
      trailReset: true,
      trailMaxPoints: 1500,
      lineWidth: 3,
      lineOpacity: 0.8,
      linePassOpacity: 0.1,
    },
  });

  assert.equal(session.state.vy, 4);
  assert.deepEqual(session.roomSettings, expectedRoomSettings);
  assert.deepEqual(
    second.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.roomSettings,
    session.roomSettings
  );
});

test("trail writer хранит последние 10000 визуальных точек по FIFO", () => {
  const { manager } = setup();
  const hub = manager.ensureDefaultSession({
    roomSettings: { trailMaxPoints: 10_000 },
  });
  const session = manager.createSession({
    roomSettings: { trailMaxPoints: 10_000 },
  });
  const writer = connect(manager, session, "trail-writer-client-01");
  const observer = connect(manager, session, "trail-observer-client-01");

  manager.acquireControl(session, writer.client, { x: 500, y: 1000 });
  assert.equal(session.trailWriterId, writer.client.id);
  assert.equal(
    writer.socket.messages.findLast(
      (message) => message.type === "session.snapshot",
    ).payload.trailWriterId,
    writer.client.id,
  );

  const points = Array.from({ length: 10_005 }, (_, index) => [
    index % (Physics.WORLD_WIDTH + 1),
    (index * 2) % (Physics.WORLD_HEIGHT + 1),
    2,
  ]);
  let sequence = 1;
  for (let offset = 0; offset < points.length; offset += 64) {
    manager.handleMessage(session, writer.client, {
      v: 1,
      type: "trail.append",
      seq: sequence++,
      payload: { points: points.slice(offset, offset + 64) },
    });
  }

  assert.equal(session.trail.length, 10_000);
  assert.equal(hub.trail.length, 10_000);
  assert.deepEqual(session.trail[0], points[5]);
  assert.deepEqual(hub.trail[0], points[5]);
  assert.equal(session.trail.at(-1)[2], 2);

  manager.handleMessage(session, observer.client, {
    v: 1,
    type: "trail.append",
    seq: 1,
    payload: { points: [[999, 1999, 2]] },
  });
  assert.equal(session.trail.length, 10_000);

  manager.recordTrailPoint(session, 1000);
  assert.equal(session.trail.length, 10_000);

  writer.socket.close();
  manager.recordTrailPoint(session, 2000);
  assert.equal(session.trail.length, 10_000);
  assert.equal(session.trail.at(-1).length, 2);
});

test("любой участник изменяет общие параметры комнаты", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-settings-first");
  const second = connect(manager, session, "client-settings-second");

  manager.handleMessage(session, second.client, {
    v: 1,
    type: "roomSettings.update",
    seq: 1,
    payload: { lineWidth: 9 },
  });
  manager.handleMessage(session, second.client, {
    v: 1,
    type: "physics.update",
    seq: 2,
    payload: { gravity: 99, inertia: 5, horizontalInertia: 5 },
  });
  assert.equal(session.roomSettings.lineWidth, 9);
  assert.equal(session.physics.gravity, 99);
  assert.equal(session.physics.inertia, 5);
  assert.equal(session.physics.horizontalInertia, 5);
  const syncedPhysics = first.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  ).payload.physics;
  assert.equal(syncedPhysics.inertia, 5);
  assert.equal(syncedPhysics.horizontalInertia, 5);
  assert.equal(first.client.role, "master");
  assert.equal(second.client.role, "master");
});

test("старая сохранённая сессия без roomSettings получает дефолты", () => {
  const { manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "dddddddddddddddddddddd",
      state: { phase: Physics.PHASES.PLAY },
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);

  assert.equal(restored, 1);
  assert.deepEqual(
    manager.getSession("dddddddddddddddddddddd").roomSettings,
    RoomSettings.DEFAULT_ROOM_SETTINGS
  );
});

test("session.start сохраняет отпечаток и запускает первое падение один раз", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.INTRO, x: 500, y: 700 },
  });
  const { client } = connect(manager, session, "client-first-0001");

  manager.handleMessage(session, client, {
    v: 1,
    type: "session.start",
    seq: 1,
    payload: { imprint: { toleranceX: 40, toleranceY: 30 } },
  });
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.deepEqual(session.imprint, {
    x: 500,
    y: 100,
    toleranceX: 40,
    toleranceY: 30,
  });

  const revisionAfterStart = session.revision;
  manager.handleMessage(session, client, {
    v: 1,
    type: "session.start",
    seq: 2,
    payload: {},
  });
  assert.equal(session.revision, revisionAfterStart);
  assert.equal(session.state.phase, Physics.PHASES.FALLING);
});

test("session.start применяет актуальную физику до первого падения", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.INTRO, x: 500, y: 700 },
    physics: { bounce: 0, firstFallVelocity: 0 },
  });
  const { client } = connect(manager, session, "client-start-physics");

  manager.handleMessage(session, client, {
    v: 1,
    type: "session.start",
    seq: 1,
    payload: {
      physics: {
        bounce: 1,
        firstFallVelocity: -4,
      },
    },
  });

  assert.equal(session.physics.bounce, 1);
  assert.equal(session.physics.firstFallVelocity, -4);
  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.equal(
    session.state.vy,
    -4 * RoomSettings.sceneMotionMultiplier(session.roomSettings)
  );
});

test("control.acquire запрещён до достижения камнем низа", () => {
  const { manager } = setup();
  const session = manager.createSession({ state: { phase: Physics.PHASES.INTRO } });
  const { socket, client } = connect(manager, session, "client-early-0001");

  assert.equal(manager.acquireControl(session, client, { x: 500, y: 700 }), false);
  assert.equal(session.state.phase, Physics.PHASES.INTRO);
  assert.equal(session.state.dragging, false);
  assert.deepEqual(session.imprint, Physics.createSummitImprint());
  assert.equal(
    socket.messages.findLast((message) => message.type === "control.denied")
      .payload.reason,
    "phase_locked"
  );
});

test("control.release применяет финальную позицию контроллера", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 200, y: 900 },
  });
  const first = connect(manager, session, "client-release-pos1");

  manager.acquireControl(session, first.client, { x: 200, y: 900 });
  manager.moveControl(session, first.client, { x: 640, y: 780 });
  clock.value = 17;
  manager.tick();
  const positionBeforeRelease = {
    x: session.state.x,
    y: session.state.y,
  };
  manager.releaseControl(session, first.client, {
    x: 800,
    y: 700,
    vx: 0,
    vy: 0,
  });

  assert.deepEqual(
    { x: session.state.x, y: session.state.y },
    positionBeforeRelease,
  );
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
});

test("control.release над линией заменяет скорость руки случайным barrier-hop", () => {
  const { manager } = setup({ random: () => 0.25 });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 1200 },
    roomSettings: {
      sceneHeightScreens: 10,
      sceneTwoBarrierEnabled: true,
      sceneTwoBarrierHeightVh: 500,
      sceneTwoBarrierHopMaxDistancePercent: 100,
      sceneTwoBarrierHopSpeedPxPerSecond: 1200,
      sceneTwoBarrierHopSpeedEasing: "cubic-bezier(0, 0, 1, 1)",
    },
  });
  const first = connect(manager, session, "client-barrier-release1");

  manager.acquireControl(session, first.client, { x: 500, y: 1200 });
  manager.releaseControl(session, first.client, {
    barrierHop: true,
    x: 500,
    y: 900,
    vx: 4000,
    vy: 4000,
  });

  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.notEqual(session.state.vx, 0);
  assert.notEqual(session.state.vy, 0);
  assert.ok(Math.abs(session.state.vx) < 4000);
  assert.ok(Math.abs(session.state.vy) < 4000);
});

test("серверная физика не пропускает камень сквозь стеклянную полосу сцены 2", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: 490,
      vx: 0,
      vy: 1000,
      suspended: false,
    },
    physics: { gravity: 0.1, turbulence: 0 },
    roomSettings: {
      sceneHeightScreens: 20,
      sceneTwoGlassEnabled: true,
      sceneTwoGlassBounce: 0.5,
      sceneTwoGlassStrips: [
        {
          id: "server-glass",
          enabled: true,
          heightPercent: 75,
          xPercent: 20,
          widthPercent: 60,
          heightVh: 2,
        },
      ],
    },
  });

  clock.value = 20;
  manager.tick();

  assert.equal(session.state.y, 498.99);
  assert.ok(session.state.vy < 0);
});

test("сцена 3 сохраняет sceneId и игнорирует препятствия сцены 2", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    sceneId: "juices",
    state: {
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: 490,
      vx: 0,
      vy: 1000,
      suspended: false,
    },
    physics: { gravity: 0.1, turbulence: 0 },
    roomSettings: {
      sceneHeightScreens: 20,
      sceneTwoBarrierEnabled: true,
      sceneTwoBarrierHeightVh: 1500,
      sceneTwoGlassEnabled: true,
      sceneTwoGlassBounce: 0.5,
      sceneTwoGlassStrips: [
        {
          id: "foreign-glass",
          enabled: true,
          heightPercent: 75,
          xPercent: 20,
          widthPercent: 60,
          heightVh: 2,
        },
      ],
      heightGates: [
        { id: "foreign-gate", heightPercent: 75, durationSeconds: 10 },
      ],
    },
  });

  assert.equal(session.sceneId, "juices");
  assert.equal(manager.snapshot(session).sceneId, "juices");
  assert.equal(manager.serializeSessions()[0].sceneId, "juices");
  assert.equal(manager.constrainHeightGateMovement(session, 900, 300), 300);
  assert.equal(session.activeHeightGate, null);

  clock.value = 20;
  manager.tick();
  assert.ok(session.state.y > 498.99);
  assert.ok(session.state.vy > 0);

  session.state.y = 400;
  session.state.vx = 0;
  session.state.vy = 0;
  session.state.suspended = true;
  const holder = connect(manager, session, "client-scene3-scope1");
  assert.equal(
    manager.acquireControl(session, holder.client, { x: 500, y: 400 }),
    true,
  );
});

test("сохранённая сессия мигрирует со старой шкалы инерции", () => {
  const { manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "aaaaaaaaaaaaaaaaaaaaaa",
      state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
      physics: { inertia: 8 },
      physicsVersion: 7,
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);

  assert.equal(restored, 1);
  assert.equal(manager.getSession("aaaaaaaaaaaaaaaaaaaaaa").physics.inertia, 0.8);
  assert.equal(
    manager.getSession("aaaaaaaaaaaaaaaaaaaaaa").physics.horizontalInertia,
    Physics.DEFAULT_PHYSICS.horizontalInertia
  );
  assert.equal(
    manager.serializeSessions()[0].physicsVersion,
    Physics.PHYSICS_VERSION
  );
});

test("сохранённая сессия мигрирует со скольжения на трение земли", () => {
  const { manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "bbbbbbbbbbbbbbbbbbbbbb",
      state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
      physicsVersion: 2,
      physics: { sliding: 0.8 },
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);

  assert.equal(restored, 1);
  assert.equal(
    manager.getSession("bbbbbbbbbbbbbbbbbbbbbb").physics.groundFriction,
    0.8
  );
});

test("старый клиент обновляет sliding как трение земли", () => {
  const { manager } = setup();
  const session = manager.createSession();

  manager.updatePhysics(session, { sliding: 0.7 });

  assert.equal(session.physics.groundFriction, 0.7);
});

test("слабая единственная рука удерживает камень с физическим отставанием", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 1500 },
    physics: { mass: 10, gravity: 10, handForce: 90 },
    roomSettings: {
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: false,
    },
  });
  const first = connect(manager, session, "client-lock-a-001");
  const second = connect(manager, session, "client-lock-b-001");

  assert.equal(manager.acquireControl(session, first.client, {}), true);
  assert.equal(session.state.dragging, true);
  assert.equal(session.holder.clientId, first.client.id);
  assert.equal(session.state.controllerId, first.client.id);

  assert.equal(manager.acquireControl(session, second.client, {}), false);
  assert.equal(
    second.socket.messages.findLast(
      (message) => message.type === "control.denied",
    ).payload.reason,
    "already_controlled",
  );

  manager.moveControl(session, first.client, { x: 700, y: 1000 });
  clock.value = 17;
  manager.tick();
  assert.ok(session.state.x > 500 && session.state.x < 700);
  assert.ok(session.state.y > 1000 && session.state.y < 1500);
  assert.equal(session.state.controllerId, first.client.id);
});

test("слабая рука сохраняет захват и передаёт инерцию при отпускании", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: Physics.WORLD_HEIGHT },
    physics: {
      mass: 10,
      gravity: 10,
      handForce: 90,
      inertia: 1,
      horizontalInertia: 0.1,
      pointerInfluence: 10,
      turbulence: 0,
    },
  });
  const weak = connect(manager, session, "client-weak-release");

  assert.equal(manager.acquireControl(session, weak.client, { x: 500, y: 1900 }), true);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, weak.client.id);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);

  assert.equal(
    manager.releaseControl(session, weak.client, {
      x: 500,
      y: 1900,
      vx: 800,
      vy: -1200,
    }),
    true
  );
  assert.equal(session.state.dragging, false);
  assert.ok(session.state.vx > 0);
  assert.ok(session.state.vy < 0);
});

test("сильная рука передаёт инерцию при отпускании", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 1500 },
    physics: {
      mass: 1,
      gravity: 1,
      handForce: 10,
      inertia: 1,
      horizontalInertia: 0.1,
      pointerInfluence: 1,
      turbulence: 0,
    },
  });
  const strong = connect(manager, session, "client-strong-release");

  assert.equal(manager.acquireControl(session, strong.client, { x: 500, y: 1500 }), true);
  assert.equal(session.state.dragging, true);

  assert.equal(
    manager.releaseControl(session, strong.client, {
      x: 520,
      y: 1480,
      vx: 100,
      vy: -100,
    }),
    true
  );
  assert.equal(session.state.dragging, false);
  assert.ok(session.state.vx > 0);
  assert.ok(session.state.vy < 0);
});

test("указатель участника синхронизируется и исчезает при отключении", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-pointer-a1");
  const second = connect(manager, session, "client-pointer-b1");

  manager.handleMessage(session, first.client, {
    v: 1,
    type: "pointer.update",
    seq: 1,
    payload: {
      x: 420,
      y: 1750,
      rockOffsetX: -0.12,
      rockOffsetY: -0.08,
      mode: "grab",
      visible: true,
    },
  });

  const pointerMessage = second.socket.messages.findLast(
    (message) => message.type === "pointer.update"
  );
  assert.equal(
    first.socket.messages.some((message) => message.type === "pointer.update"),
    false,
  );
  assert.deepEqual(pointerMessage.payload, {
    clientId: first.client.id,
    x: 420,
    y: 1750,
    rockOffsetX: -0.12,
    rockOffsetY: -0.08,
    mode: "grab",
    visible: true,
    role: "master",
    serverTime: 0,
  });

  manager.handleMessage(session, first.client, {
    v: 1,
    type: "pointer.update",
    seq: 2,
    payload: { x: -1, y: 1750, mode: "grab", visible: true },
  });
  assert.equal(
    first.socket.messages.findLast((message) => message.type === "error").payload.code,
    "invalid_pointer"
  );

  manager.handleMessage(session, first.client, {
    v: 1,
    type: "pointer.update",
    seq: 3,
    payload: {
      x: 420,
      y: 1750,
      rockOffsetX: 5,
      rockOffsetY: 0,
      mode: "grab",
      visible: true,
    },
  });
  assert.equal(
    first.socket.messages.findLast((message) => message.type === "error").payload.code,
    "invalid_pointer"
  );

  manager.disconnectClient(session, first.client.id, first.socket);
  const presence = second.socket.messages.findLast(
    (message) => message.type === "presence.update"
  );
  assert.deepEqual(presence.payload.pointers, []);
});

test("session.restart возвращает общую комнату в игровой низ", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 700, y: 900, vx: 50, vy: -30 },
    physics: { gravity: 7 },
    trail: [
      [700, 900],
      [710, 880],
    ],
    imprint: { x: 500, y: 800 },
  });
  const first = connect(manager, session, "client-restart-a1");
  const second = connect(manager, session, "client-restart-b1");
  manager.acquireControl(session, first.client, {
    x: 700,
    y: 900,
    pointer: { x: 700, y: 900, mode: "grabbing", visible: true },
  });

  manager.handleMessage(session, second.client, {
    v: 1,
    type: "session.restart",
    seq: 1,
    payload: { x: 321, y: 654, suspended: true },
  });

  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 321);
  assert.equal(session.state.y, 654);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(session.state.suspended, true);
  assert.equal(session.physics.gravity, 7);
  assert.deepEqual(session.trail, []);
  assert.deepEqual(session.imprint, Physics.createSummitImprint());
  assert.equal(first.client.pointer.mode, "grab");

  const snapshot = first.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  assert.equal(snapshot.payload.phase, Physics.PHASES.PLAY);
  assert.equal(snapshot.payload.suspended, true);
  assert.deepEqual(snapshot.payload.trail, []);
  assert.deepEqual(snapshot.payload.imprint, Physics.createSummitImprint());
});

test("явный выход последнего участника удаляет сессию после grace-периода", () => {
  const { clock, manager } = setup({ emptyGraceMs: 1000 });
  const session = manager.createSession();
  const first = connect(manager, session, "client-leave-a001");
  const second = connect(manager, session, "client-leave-b001");

  assert.equal(manager.leaveClient(session, first.client.id, "invalid-token"), false);
  assert.equal(manager.sessions.has(session.id), true);

  assert.equal(
    manager.leaveClient(session, first.client.id, first.client.leaveToken),
    true
  );
  assert.equal(manager.sessions.has(session.id), true);
  assert.equal(manager.connectedCount(session), 1);

  assert.equal(
    manager.leaveClient(session, second.client.id, second.client.leaveToken),
    true
  );
  assert.equal(manager.sessions.has(session.id), true);
  assert.equal(session.emptyDeleteAt, 1000);

  clock.value = 999;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), true);

  clock.value = 1001;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), false);
});

test("single-client reconnect до TTL сохраняет личность, состояние и настройки", () => {
  const { clock, manager } = setup({ emptyGraceMs: 1000, ttlMs: 10_000 });
  const session = manager.createSession(
    {
      state: { phase: Physics.PHASES.PLAY, x: 420, y: 800, vx: 25, vy: -30 },
      physics: { gravity: 7 },
      roomSettings: {
        cameraFollowUpLerp: 0.25,
        cameraFollowDownLerp: 0.4,
      },
      imprint: { x: 400, y: 700 },
    },
    { singleClient: true },
  );
  const first = connect(manager, session, "client-reload-001");
  manager.disconnectClient(session, first.client.id, first.socket);

  assert.equal(manager.sessions.has(session.id), true);
  assert.equal(session.emptyDeleteAt, null);

  clock.value = 500;
  const reconnected = connect(manager, session, "client-reload-001");

  assert.equal(session.emptyDeleteAt, null);
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 420);
  assert.equal(session.physics.gravity, 7);
  assert.equal(session.roomSettings.cameraFollowUpLerp, 0.25);
  assert.equal(session.roomSettings.cameraFollowDownLerp, 0.4);
  assert.deepEqual(session.imprint, Physics.createSummitImprint({ y: 700 }));
  assert.equal(reconnected.client.id, "client-reload-001");

  clock.value = 1001;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), true);

  manager.disconnectClient(session, reconnected.client.id, reconnected.socket);
  clock.value = session.expiresAt + 1;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), false);
});

test("подключение после grace не воскрешает удалённую сессию", () => {
  const { clock, manager } = setup({ emptyGraceMs: 1000 });
  const session = manager.createSession();
  const first = connect(manager, session, "client-too-late-01");
  manager.leaveClient(session, first.client.id, first.client.leaveToken);

  clock.value = 1001;

  assert.equal(manager.getSession(session.id), null);
  assert.equal(manager.sessions.has(session.id), false);
});

test("разрыв соединения убирает держателя и останавливает таймер с последней рукой", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: Physics.WORLD_HEIGHT },
  });
  const first = connect(manager, session, "client-drop-00001");
  setRunningSummitTimer(session);
  manager.acquireControl(session, first.client, {});
  assert.equal(session.state.dragging, true);

  clock.value = 250;
  manager.disconnectClient(session, first.client.id, first.socket);

  assert.equal(session.state.dragging, false);
  assert.equal(session.holder, null);
  assert.equal(manager.snapshot(session).summitElapsedMs, 250);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);
});

test("касание земли увеличивает счётчик для клиентского сброса траектории", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: Physics.WORLD_WIDTH / 2,
      y: Physics.WORLD_HEIGHT - 1,
      vy: 500,
    },
    physics: { gravity: 10, bounce: 0, turbulence: 0 },
  });
  const { socket } = connect(manager, session, "client-ground-touch");

  clock.value = 1000;
  manager.tick();

  const snapshot = socket.messages.findLast(
    (message) => message.type === "session.snapshot",
  );
  assert.equal(session.state.y, Physics.WORLD_HEIGHT);
  assert.equal(session.groundTouchSeq, 1);
  assert.equal(snapshot.payload.groundTouchSeq, 1);
  assert.equal(Object.hasOwn(snapshot.payload, "physics"), false);
  assert.equal(Object.hasOwn(snapshot.payload, "roomSettings"), false);
  assert.equal(Object.hasOwn(snapshot.payload, "imprint"), false);
});

test("неактивная сессия удаляется по TTL", () => {
  const { clock, manager } = setup({ ttlMs: 1000 });
  const session = manager.createSession();
  clock.value = 1001;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), false);
});

test("общая root-сессия не удаляется после ухода последнего клиента", () => {
  const { clock, manager } = setup({ emptyGraceMs: 50, ttlMs: 100 });
  const session = manager.ensureDefaultSession({
    creatorClientId: "client-root-master1",
  });
  const connected = connect(manager, session, "client-root-master1");

  assert.equal(session.id, DEFAULT_SESSION_ID);
  assert.equal(manager.leaveClient(
    session,
    connected.client.id,
    connected.client.leaveToken
  ), true);
  assert.equal(session.emptyDeleteAt, null);

  clock.value = 1000;
  manager.tick();
  assert.equal(manager.sessions.has(DEFAULT_SESSION_ID), true);
  assert.equal(manager.getSession(DEFAULT_SESSION_ID), session);
});

test("пустой ensureDefaultSession сохраняет замороженный таймер упавшей root-комнаты", () => {
  const { clock, manager } = setup();
  clock.value = 4000;
  assert.equal(
    manager.restoreSessions([
      {
        id: DEFAULT_SESSION_ID,
        sceneId: "juices",
        persistent: true,
        state: {
          phase: Physics.PHASES.PLAY,
          x: Physics.WORLD_WIDTH / 2,
          y: Physics.WORLD_HEIGHT,
        },
        expiresAt: 2000,
        emptyDeleteAt: null,
        summitElapsedMs: 0,
        summitRunningSince: 1000,
      },
    ]),
    1
  );

  const session = manager.ensureDefaultSession();
  assert.equal(manager.snapshot(session).summitElapsedMs, 3000);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);
});

test("production preset обновляет root-настройки без сброса состояния и времени", () => {
  const { clock, manager } = setup();
  clock.value = 4000;
  const session = manager.ensureDefaultSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: 375,
      y: Physics.WORLD_HEIGHT,
    },
    physics: { gravity: 7 },
    roomSettings: { sceneHeightScreens: 10 },
  });
  session.summitElapsedMs = 1200;
  session.summitRunningSince = 1000;
  const revisionBefore = session.revision;

  assert.equal(
    manager.applySettingsPreset(session, ProductionPreset.settings),
    true,
  );
  assert.equal(session.physics.gravity, 9.8);
  assert.equal(session.roomSettings.sceneHeightScreens, 1);
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 375);
  assert.equal(session.state.y, Physics.WORLD_HEIGHT);
  assert.equal(session.summitElapsedMs, 1200);
  assert.equal(session.summitRunningSince, 1000);
  assert.equal(session.revision, revisionBefore + 1);

  assert.equal(
    manager.applySettingsPreset(session, ProductionPreset.settings),
    false,
  );
  assert.equal(session.revision, revisionBefore + 1);
});

test("любой debug-клиент выбирает production preset с broadcast", () => {
  const saved = [];
  const current = {
    selectedAt: "2026-07-26T10:00:00.000Z",
    source: {
      id: "version-old",
      name: "Старый",
      settingsSchemaVersion: 18,
      updatedAt: "2026-07-26T09:00:00.000Z",
    },
  };
  const { manager } = setup({
    productionPresetSelectionEnabled: true,
    settingsTemplatesEnabled: true,
    getProductionPresetSelection: () => current,
    saveProductionPresetSelection: (payload) => {
      saved.push(payload);
      return {
        selectedAt: "2026-07-26T11:00:00.000Z",
        source: {
          id: payload.id,
          name: payload.name,
          settingsSchemaVersion: payload.settingsSchemaVersion,
          updatedAt: payload.updatedAt,
        },
        settings: payload.settings,
      };
    },
  });
  const session = manager.ensureDefaultSession({
    creatorClientId: "client-master-preset",
  });
  const master = connect(manager, session, "client-master-preset");
  const second = connect(manager, session, "client-second-preset");
  const payload = {
    id: "version-next",
    name: "Для production",
    settingsSchemaVersion: 18,
    updatedAt: "2026-07-26T10:30:00.000Z",
    settings: { gravity: 7 },
  };

  assert.deepEqual(
    master.socket.messages.find(
      (message) => message.type === "productionPreset.current",
    ).payload,
    { canSelect: true, selection: current },
  );
  manager.handleMessage(session, second.client, {
    v: 1,
    seq: 1,
    type: "productionPreset.select",
    payload,
  });

  assert.deepEqual(saved, [payload]);
  assert.equal(
    master.socket.messages.findLast(
      (message) => message.type === "productionPreset.selected",
    ).payload.canSelect,
    true,
  );
  assert.deepEqual(
    second.socket.messages.findLast(
      (message) => message.type === "productionPreset.selected",
    ).payload.selection.source,
    {
      id: "version-next",
      name: "Для production",
      settingsSchemaVersion: 18,
      updatedAt: "2026-07-26T10:30:00.000Z",
    },
  );
});

test("production preset доступен в личной debug-сессии и запрещён при DEBUG=false", () => {
  let debugSaveCount = 0;
  const debugSaveProductionPresetSelection = (payload) => {
    debugSaveCount += 1;
    return {
      selectedAt: "2026-08-04T10:00:00.000Z",
      source: {
        id: payload.id,
        name: payload.name,
        settingsSchemaVersion: payload.settingsSchemaVersion,
        updatedAt: payload.updatedAt,
      },
      settings: payload.settings,
    };
  };
  const debug = setup({
    productionPresetSelectionEnabled: true,
    settingsTemplatesEnabled: true,
    saveProductionPresetSelection: debugSaveProductionPresetSelection,
  }).manager;

  const legacySession = debug.createSession({
    creatorClientId: "client-master-legacy",
  });
  const legacyMaster = connect(
    debug,
    legacySession,
    "client-master-legacy",
  );
  debug.handleMessage(legacySession, legacyMaster.client, {
    v: 1,
    seq: 1,
    type: "productionPreset.select",
    payload: {
      id: "personal-debug-preset",
      name: "Личный debug preset",
      settingsSchemaVersion: 19,
      updatedAt: "2026-08-04T09:00:00.000Z",
      settings: { gravity: 2 },
    },
  });
  assert.equal(
    legacyMaster.socket.messages.findLast(
      (message) => message.type === "productionPreset.selected",
    ).payload.canSelect,
    true,
  );
  assert.equal(debugSaveCount, 1);

  const saveProductionPresetSelection = () => {
    throw new Error("callback must not be called");
  };
  const production = setup({
    productionPresetSelectionEnabled: false,
    saveProductionPresetSelection,
  }).manager;
  const productionSession = production.createSession({
    creatorClientId: "client-master-prod",
  });
  const productionMaster = connect(
    production,
    productionSession,
    "client-master-prod",
  );
  production.handleMessage(productionSession, productionMaster.client, {
    v: 1,
    seq: 1,
    type: "productionPreset.select",
    payload: {},
  });
  assert.equal(
    productionMaster.socket.messages.findLast(
      (message) => message.type === "error",
    ).payload.code,
    "debug_only",
  );
});

test("общий debug-каталог доступен и обновляется между личными сессиями", () => {
  const initialEntry = {
    id: "settings-shared-initial",
    name: "Общий начальный",
    settingsSchemaVersion: 18,
    createdAt: "2026-07-27T18:00:00.000Z",
    updatedAt: "2026-07-27T18:00:00.000Z",
    settings: {
      ...RoomSettings.DEFAULT_ROOM_SETTINGS,
      ...Physics.DEFAULT_PHYSICS,
      gravity: 7,
    },
  };
  const savedEntry = {
    ...initialEntry,
    id: "settings-shared-saved",
    name: "Сохранён в первом браузере",
    createdAt: "2026-07-27T18:30:00.000Z",
    updatedAt: "2026-07-27T18:30:00.000Z",
    settings: {
      ...initialEntry.settings,
      gravity: 8,
    },
  };
  const { manager } = setup({
    productionPresetSelectionEnabled: true,
    settingsTemplatesEnabled: true,
    getSettingsTemplatesPage: () => ({
      revision: 1,
      offset: 0,
      nextOffset: null,
      entries: [initialEntry],
    }),
    saveSettingsTemplate: () => ({
      revision: 2,
      entry: savedEntry,
      branched: false,
    }),
    deleteSettingsTemplate: (id) => ({
      revision: 3,
      deletedId: id,
    }),
  });
  const firstSession = manager.createSession({
    creatorClientId: "debug-catalog-first",
  });
  const secondSession = manager.createSession({
    creatorClientId: "debug-catalog-second",
  });
  const first = connect(manager, firstSession, "debug-catalog-first");
  const second = connect(manager, secondSession, "debug-catalog-second");

  assert.equal(
    first.socket.messages.find(
      (message) => message.type === "productionPreset.current",
    ).payload.canSelect,
    true,
  );
  assert.equal(
    second.socket.messages.find(
      (message) => message.type === "settingsTemplates.page",
    ).payload.entries[0].id,
    initialEntry.id,
  );

  manager.handleMessage(firstSession, first.client, {
    v: 1,
    seq: 1,
    type: "settingsTemplates.save",
    payload: { entry: savedEntry },
  });

  assert.equal(
    first.socket.messages.findLast(
      (message) => message.type === "settingsTemplates.saved",
    ).payload.entry.id,
    savedEntry.id,
  );
  assert.equal(
    second.socket.messages.findLast(
      (message) => message.type === "settingsTemplates.changed",
    ).payload.entries[0].id,
    savedEntry.id,
  );
  assert.equal(
    secondSession.physics.gravity,
    Physics.DEFAULT_PHYSICS.gravity,
  );

  manager.handleMessage(secondSession, second.client, {
    v: 1,
    seq: 1,
    type: "settingsTemplates.delete",
    payload: { id: savedEntry.id },
  });

  assert.deepEqual(
    first.socket.messages.findLast(
      (message) => message.type === "settingsTemplates.changed",
    ).payload,
    {
      action: "delete",
      revision: 3,
      id: savedEntry.id,
    },
  );
});

test("debug settings.update принимает любого участника и сохраняет stale snapshot конфликтом", () => {
  const conflicts = [];
  const conflictEntry = {
    id: "settings-conflict-1",
    name: "Конфликт",
    settingsSchemaVersion: 18,
    createdAt: "2026-07-26T12:00:00.000Z",
    updatedAt: "2026-07-26T12:00:00.000Z",
    settings: {
      ...RoomSettings.DEFAULT_ROOM_SETTINGS,
      ...Physics.DEFAULT_PHYSICS,
      gravity: 6,
    },
  };
  const { manager } = setup({
    settingsTemplatesEnabled: true,
    createSettingsConflict: (settings, options) => {
      conflicts.push({ settings, options });
      return { revision: 3, entry: conflictEntry };
    },
  });
  const session = manager.ensureDefaultSession({
    creatorClientId: "client-settings-master",
  });
  const master = connect(manager, session, "client-settings-master");
  const second = connect(manager, session, "client-settings-second");

  manager.handleMessage(session, second.client, {
    v: 1,
    seq: 1,
    type: "settings.update",
    payload: {
      requestId: "request-second",
      baseRevision: 1,
      settingsSchemaVersion: 18,
      settings: {
        ...RoomSettings.DEFAULT_ROOM_SETTINGS,
        ...Physics.DEFAULT_PHYSICS,
        gravity: 8,
        preclickHopActivationRadiusPercent: 20,
      },
    },
  });

  assert.equal(session.physics.gravity, 8);
  assert.equal(session.roomSettings.preclickHopActivationRadiusPercent, 20);
  assert.equal(session.settingsRevision, 2);
  assert.equal(
    second.socket.messages.findLast(
      (message) => message.type === "settings.applied",
    ).payload.settingsRevision,
    2,
  );

  manager.handleMessage(session, master.client, {
    v: 1,
    seq: 1,
    type: "settings.update",
    payload: {
      requestId: "request-master-stale",
      baseRevision: 1,
      settingsSchemaVersion: 18,
      settings: {
        ...RoomSettings.DEFAULT_ROOM_SETTINGS,
        ...Physics.DEFAULT_PHYSICS,
        gravity: 6,
      },
    },
  });

  assert.equal(session.physics.gravity, 8);
  assert.equal(session.settingsRevision, 2);
  assert.equal(conflicts.length, 1);
  const conflict = master.socket.messages.findLast(
    (message) => message.type === "settings.conflict",
  );
  assert.equal(conflict.payload.entry.id, "settings-conflict-1");
  assert.equal(conflict.payload.settings.gravity, 8);
  assert.equal(
    second.socket.messages.findLast(
      (message) => message.type === "settingsTemplates.changed",
    ).payload.entries[0].id,
    "settings-conflict-1",
  );
  assert.equal(manager.serializeSessions()[0].settingsRevision, 2);
});

test("активная сессия продлевается при достижении TTL", () => {
  const { clock, manager } = setup({ ttlMs: 1000 });
  const session = manager.createSession();
  connect(manager, session, "client-active-0001");

  clock.value = 1001;
  manager.tick();

  assert.equal(manager.sessions.has(session.id), true);
  assert.equal(session.expiresAt, 2001);
});

test("давно отключённый клиент удаляется из комнаты", () => {
  const { clock, manager } = setup({ ttlMs: 120_000 });
  const session = manager.createSession();
  const connected = connect(manager, session, "client-stale-0001");
  connect(manager, session, "client-still-0001");
  manager.disconnectClient(session, connected.client.id, connected.socket);

  clock.value = DISCONNECTED_CLIENT_TTL_MS + 1;
  manager.tick();

  assert.equal(session.clients.has(connected.client.id), false);
  assert.equal(manager.sessions.has(session.id), true);
});

test("первый старт сохраняет отпечаток без фиксации при возвращении", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.INTRO, x: 500, y: 700 },
  });
  const first = connect(manager, session, "client-win-000001");
  manager.startSession(session, {
    imprint: { toleranceX: 40, toleranceY: 30 },
  });
  assert.deepEqual(session.imprint, {
    x: 500,
    y: 100,
    toleranceX: 40,
    toleranceY: 30,
  });
  session.state.phase = Physics.PHASES.PLAY;
  manager.acquireControl(session, first.client, { x: 541, y: 700 });
  manager.moveControl(session, first.client, { x: 541, y: 700 });
  clock.value = 17;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.dragging, true);

  manager.moveControl(session, first.client, { x: 539, y: 700 });
  clock.value = 34;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 539);
  assert.equal(session.state.y, 700);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, first.client.id);

  manager.releaseControl(session, first.client, {
    x: 539,
    y: 700,
    vx: 0,
    vy: -2000,
  });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 539);
  assert.equal(session.state.y, 700);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.ok(session.state.vy < 0);

  clock.value = 50;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.ok(session.state.y < 700);
});

test("захват получает независимые таймеры случайного выпадения и прыжка", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
  });
  const first = connect(manager, session, "client-slip-range1");

  manager.acquireControl(session, first.client, { x: 500, y: 900 });

  assert.equal(session.holder.slipAt, 1250);
  assert.equal(session.holder.jumpAt, 5000);
  assert.equal(SLIP_DELAY_MIN_MS, 500);
  assert.equal(SLIP_DELAY_MAX_MS, 2000);
  assert.equal(session.state.dragging, true);
});

test("камень выпрыгивает в настроенном симметричном секторе по таймеру", () => {
  const { clock, manager } = setup({ random: () => 1 });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    roomSettings: {
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: true,
      rockJumpIntervalSeconds: 5,
      rockJumpAngleSpreadDegrees: 180,
      rockJumpInertiaSpreadPercent: 25,
    },
  });
  const holder = connect(manager, session, "client-jump-timer01");

  manager.acquireControl(session, holder.client, { x: 500, y: 900 });
  assert.equal(session.holder.slipAt, null);
  assert.equal(session.holder.jumpAt, 5000);

  clock.value = 4999;
  manager.tick();
  assert.equal(session.holder.clientId, holder.client.id);

  clock.value = 5000;
  manager.tick();
  const jumpMessage = holder.socket.messages.findLast(
    (message) => message.type === "control.slipped",
  );
  assert.equal(session.holder, null);
  assert.equal(jumpMessage.payload.reason, "jumped");
  assert.equal(jumpMessage.payload.angleDegrees, 90);
  assert.equal(jumpMessage.payload.inertiaFactor, 1.25);
  assert.ok(session.state.vy < 0);
  assert.ok(session.state.vx > 0);
});

test("выпрыгивание имеет приоритет над случайным выпадением в один тик", () => {
  const { clock, manager } = setup({
    random: () => 0.5,
    slipDelayMinMs: 1000,
    slipDelayMaxMs: 1000,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    roomSettings: {
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: true,
      rockJumpEnabled: true,
      rockJumpIntervalSeconds: 1,
      rockJumpAngleSpreadDegrees: 0,
      rockJumpInertiaSpreadPercent: 0,
    },
  });
  const holder = connect(manager, session, "client-jump-priority1");

  manager.acquireControl(session, holder.client, { x: 500, y: 900 });
  assert.equal(session.holder.slipAt, 1000);
  assert.equal(session.holder.jumpAt, 1000);

  clock.value = 1000;
  manager.tick();
  const behaviorMessage = holder.socket.messages.findLast(
    (message) => message.type === "control.slipped",
  );
  assert.equal(behaviorMessage.payload.reason, "jumped");
  assert.equal(behaviorMessage.payload.angleDegrees, 0);
  assert.equal(behaviorMessage.payload.inertiaFactor, 1);
  assert.ok(session.state.vy < 0);
});

test("переключатели поведения запускают и останавливают независимые таймеры", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 750,
    slipDelayMaxMs: 750,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    roomSettings: {
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: false,
    },
  });
  const holder = connect(manager, session, "client-jump-toggle01");
  manager.acquireControl(session, holder.client, { x: 500, y: 900 });
  assert.equal(session.holder.slipAt, null);
  assert.equal(session.holder.jumpAt, null);

  clock.value = 100;
  manager.updateRoomSettings(session, {
    randomDropEnabled: true,
    rockJumpEnabled: true,
    rockJumpIntervalSeconds: 3,
  });
  assert.equal(session.holder.slipAt, 850);
  assert.equal(session.holder.jumpAt, 3100);

  manager.updateRoomSettings(session, {
    randomDropEnabled: false,
    rockJumpEnabled: false,
  });
  assert.equal(session.holder.slipAt, null);
  assert.equal(session.holder.jumpAt, null);
});

test("границы соскальзывания можно зафиксировать для детерминированной сессии", () => {
  const { manager } = setup({
    random: () => 0,
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
  });

  assert.equal(manager.slipDelayMs(), 10_000);
});

test("неподвижный камень в воздухе выпадает из всех рук через 200 мс", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { turbulence: 0 },
  });
  const first = connect(manager, session, "client-still-drop-01");
  setRunningSummitTimer(session);

  manager.acquireControl(session, first.client, { x: 500, y: 700 });
  assert.equal(STATIONARY_HOLD_RELEASE_MS, 200);

  clock.value = STATIONARY_HOLD_RELEASE_MS - 1;
  manager.tick();
  assert.equal(session.holder.clientId, first.client.id);

  clock.value = STATIONARY_HOLD_RELEASE_MS;
  manager.tick();
  assert.equal(session.holder, null);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(manager.snapshot(session).summitElapsedMs, 200);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);
  assert.equal(
    first.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "stationary"
  );
  clock.value += 20;
  manager.tick();
  assert.ok(session.state.y > 700);
});

test("выключенное автовыскальзывание сохраняет неподвижное удержание", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { turbulence: 0 },
    roomSettings: { stationaryAutoSlipEnabled: false },
  });
  const holder = connect(manager, session, "client-still-disabled01");

  manager.acquireControl(session, holder.client, { x: 500, y: 700 });
  clock.value = STATIONARY_HOLD_RELEASE_MS * 5;
  manager.tick();

  assert.equal(session.holder.clientId, holder.client.id);
  assert.equal(session.state.dragging, true);
  assert.equal(session.stationaryHoldSince, null);
  assert.equal(
    holder.socket.messages.some(
      (message) =>
        message.type === "control.slipped" &&
        message.payload.reason === "stationary",
    ),
    false,
  );
});

test("фактическое движение камня перезапускает таймер неподвижного удержания", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { mass: 1, gravity: 1, handForce: 100 },
  });
  const holder = connect(manager, session, "client-still-reset01");
  manager.acquireControl(session, holder.client, { x: 500, y: 700 });

  clock.value = 150;
  manager.moveControl(session, holder.client, { x: 510, y: 700 });

  clock.value = 349;
  manager.tick();
  assert.equal(session.holder.clientId, holder.client.id);

  clock.value = 350;
  manager.tick();
  assert.equal(session.holder.clientId, holder.client.id);

  clock.value = 549;
  manager.tick();
  assert.equal(session.holder.clientId, holder.client.id);

  clock.value = 550;
  manager.tick();
  assert.equal(session.holder, null);
});

test("неподвижное удержание на земле не запускает дополнительное выпадение", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: 500,
      y: Physics.WORLD_HEIGHT,
    },
  });
  const holder = connect(manager, session, "client-ground-hold01");
  manager.acquireControl(session, holder.client, {
    x: 500,
    y: Physics.WORLD_HEIGHT,
  });

  clock.value = 1000;
  manager.tick();

  assert.equal(session.holder.clientId, holder.client.id);
  assert.equal(session.stationaryHoldSince, null);
});

test("победный отпечаток не блокирует stationary-выпадение", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 500,
    slipDelayMaxMs: 500,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-imprint-hold1");
  manager.acquireControl(session, holder.client, { x: 500, y: 100 });

  clock.value = 1000;
  manager.tick();

  assert.equal(session.holder, null);
  assert.equal(session.state.dragging, false);
  assert.equal(
    holder.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "stationary"
  );
});

test("победный отпечаток не блокирует случайное выпадение", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 500,
    slipDelayMaxMs: 500,
    stationaryHoldReleaseMs: 10_000,
  });
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-imprint-slip1");
  manager.acquireControl(session, holder.client, { x: 500, y: 100 });

  clock.value = 500;
  manager.tick();

  assert.equal(session.holder, null);
  assert.equal(session.state.dragging, false);
  assert.equal(
    holder.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "slipped"
  );
});

test("метки высоты блокируют только подъём и срабатывают по одному разу", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 1500 },
    roomSettings: {
      heightGates: [
        { id: "lower", heightPercent: 30, durationSeconds: 2 },
        { id: "upper", heightPercent: 70, durationSeconds: 5 },
      ],
    },
  });
  const holder = connect(manager, session, "client-height-gates01");

  clock.value = 100;
  assert.equal(manager.constrainHeightGateMovement(session, 1500, 1100), 1400);
  assert.deepEqual(session.activeHeightGate, {
    id: "lower",
    heightPercent: 30,
    unlockAt: 2100,
  });
  assert.equal(
    holder.socket.messages.findLast(
      (message) => message.type === "heightGate.activated"
    ).payload.activeGate.id,
    "lower"
  );

  assert.equal(manager.constrainHeightGateMovement(session, 1400, 1500), 1500);
  assert.equal(manager.constrainHeightGateMovement(session, 1400, 1000), 1400);

  clock.value = 2100;
  assert.equal(manager.constrainHeightGateMovement(session, 1400, 1000), 1000);
  assert.deepEqual([...session.passedHeightGateIds], ["lower"]);
  assert.equal(session.activeHeightGate, null);

  assert.ok(
    Math.abs(manager.constrainHeightGateMovement(session, 1000, 400) - 600) <
      1e-9,
  );
  assert.deepEqual(session.activeHeightGate, {
    id: "upper",
    heightPercent: 70,
    unlockAt: 7100,
  });

  clock.value = 7100;
  assert.equal(manager.constrainHeightGateMovement(session, 600, 400), 400);
  assert.equal(manager.constrainHeightGateMovement(session, 400, 1500), 1500);
  assert.equal(manager.constrainHeightGateMovement(session, 1500, 300), 300);
  assert.deepEqual([...session.passedHeightGateIds], ["lower", "upper"]);
  assert.equal(
    holder.socket.messages.filter(
      (message) => message.type === "heightGate.activated"
    ).length,
    2
  );
});

test("прогресс меток сохраняется после restore и очищается только restart", () => {
  const firstSetup = setup();
  const session = firstSetup.manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 1500 },
    roomSettings: {
      heightGates: [
        { id: "persisted", heightPercent: 40, durationSeconds: 3 },
      ],
    },
  });
  const holder = connect(firstSetup.manager, session, "client-gate-persist1");
  firstSetup.clock.value = 100;
  session.state.y = firstSetup.manager.constrainHeightGateMovement(
    session,
    1500,
    900,
  );
  const record = firstSetup.manager.serializeSessions()[0];
  assert.deepEqual(record.heightGateProgress, {
    passedGateIds: [],
    activeGate: { id: "persisted", heightPercent: 40, unlockAt: 3100 },
  });

  const restoredSetup = setup();
  restoredSetup.clock.value = 1000;
  assert.equal(restoredSetup.manager.restoreSessions([record]), 1);
  const restored = restoredSetup.manager.getSession(record.id);
  assert.equal(restored.state.y, 1200);
  const reconnected = connect(
    restoredSetup.manager,
    restored,
    "client-gate-reconnect"
  );
  assert.deepEqual(
    reconnected.socket.messages.findLast(
      (message) => message.type === "session.snapshot"
    ).payload.heightGateState,
    {
      passedGateIds: [],
      activeGate: { id: "persisted", heightPercent: 40, unlockAt: 3100 },
    }
  );

  restoredSetup.clock.value = 3100;
  restoredSetup.manager.tick();
  assert.deepEqual([...restored.passedHeightGateIds], ["persisted"]);
  assert.equal(restored.activeHeightGate, null);
  restoredSetup.manager.restartSession(restored, {
    phase: Physics.PHASES.PLAY,
  });
  assert.deepEqual([...restored.passedHeightGateIds], []);
  assert.equal(restored.activeHeightGate, null);
});

test("финальное падение по умолчанию выключено", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    physics: { bounce: 0, gravity: 20, turbulence: 0 },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-final-fall1");

  assert.equal(
    manager.acquireControl(session, holder.client, { x: 500, y: 100 }),
    true
  );
  clock.value = 3000;
  assert.equal(
    manager.releaseControl(session, holder.client, {
      x: 500,
      y: 100,
      vx: 0,
      vy: -4000,
    }),
    true
  );

  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.ok(session.state.vy < 0);
});

test("скрытые настройки удержания не действуют в сцене 1", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 100,
    slipDelayMaxMs: 100,
    stationaryHoldReleaseMs: 50,
  });
  const session = manager.createSession({
    sceneId: "cats-and-mice",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    roomSettings: {
      stationaryAutoSlipEnabled: true,
      randomDropEnabled: true,
      rockJumpEnabled: true,
      rockJumpIntervalSeconds: 1,
    },
  });
  const holder = connect(manager, session, "client-scene1-scope1");

  assert.equal(
    manager.acquireControl(session, holder.client, { x: 500, y: 700 }),
    true,
  );
  assert.equal(session.holder.slipAt, null);
  assert.equal(session.holder.jumpAt, null);

  clock.value = 2000;
  manager.tick();
  assert.equal(session.holder.clientId, holder.client.id);
});

test("скрытые финальные настройки не действуют в сцене 2", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    sceneId: "turnip",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    roomSettings: {
      finalFallEnabled: true,
      finalFallDelaySeconds: 0,
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: false,
    },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-scene2-scope1");

  assert.equal(manager.snapshot(session).summitTimerRunning, false);
  assert.equal(
    manager.acquireControl(session, holder.client, { x: 500, y: 100 }),
    true,
  );
  clock.value = 1000;
  manager.tick();
  assert.equal(
    manager.releaseControl(session, holder.client, {
      x: 500,
      y: 100,
      vx: 0,
      vy: -1000,
    }),
    true,
  );
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(manager.snapshot(session).summitElapsedMs, 0);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);
});

test("финальное падение включается только после выдержки на вершине", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    physics: { bounce: 0, gravity: 20, turbulence: 0 },
    roomSettings: {
      finalFallEnabled: true,
      finalFallDelaySeconds: 2,
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: false,
    },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-final-fall2");

  assert.equal(
    manager.acquireControl(session, holder.client, { x: 500, y: 100 }),
    true,
  );
  clock.value = 2000;
  assert.equal(
    manager.releaseControl(session, holder.client, {
      x: 500,
      y: 100,
      vx: 0,
      vy: -4000,
    }),
    true,
  );

  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);

  clock.value = 2250;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.ok(session.state.y > 100);
  assert.equal(
    manager.acquireControl(session, holder.client, {
      x: session.state.x,
      y: session.state.y,
    }),
    false
  );
});

test("выход с вершины сбрасывает таймер финального падения", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    physics: { mass: 1, gravity: 1, handForce: 100 },
    roomSettings: {
      finalFallEnabled: true,
      finalFallDelaySeconds: 2,
      stationaryAutoSlipEnabled: false,
      randomDropEnabled: false,
      rockJumpEnabled: false,
    },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-final-reset01");

  manager.acquireControl(session, holder.client, { x: 500, y: 100 });
  clock.value = 1500;
  manager.moveControl(session, holder.client, { x: 500, y: 200 });
  manager.tick();
  assert.equal(session.finalFallEnteredAt, null);

  clock.value = 2000;
  manager.moveControl(session, holder.client, { x: 500, y: 100 });
  manager.tick();
  assert.equal(session.finalFallEnteredAt, 2000);

  clock.value = 3500;
  manager.releaseControl(session, holder.client, {
    x: 500,
    y: 100,
    vx: 0,
    vy: -4000,
  });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.ok(session.state.vy < 0);
});

test("движущийся камень сохраняет независимое случайное соскальзывание", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 500,
    slipDelayMaxMs: 500,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    sceneId: "juices",
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
  });
  const holder = connect(manager, session, "client-moving-slip01");
  setRunningSummitTimer(session);
  manager.acquireControl(session, holder.client, { x: 500, y: 700 });

  for (const [time, x] of [
    [150, 510],
    [300, 520],
    [450, 530],
    [501, 540],
  ]) {
    clock.value = time;
    manager.moveControl(session, holder.client, { x, y: 700 });
  }
  manager.tick();

  assert.equal(session.holder, null);
  assert.equal(manager.snapshot(session).summitElapsedMs, 501);
  assert.equal(manager.snapshot(session).summitTimerRunning, false);
  assert.equal(
    holder.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "slipped"
  );
});

test("в каждый момент камень может удерживать только одна рука", () => {
  const randomValues = [0, 1, 1];
  const { clock, manager } = setup({
    random: () => randomValues.shift() ?? 1,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { gravity: 0.45, turbulence: 0, bounce: 0 },
    roomSettings: { stationaryAutoSlipEnabled: false },
  });
  const first = connect(manager, session, "client-slip-catch1");
  const second = connect(manager, session, "client-slip-catch2");
  manager.acquireControl(session, first.client, { x: 500, y: 700 });
  assert.equal(
    manager.acquireControl(session, second.client, { x: 500, y: 700 }),
    false,
  );

  clock.value = SLIP_DELAY_MIN_MS + 1;
  manager.tick();

  assert.equal(session.state.dragging, false);
  assert.equal(session.holder, null);
  assert.equal(
    first.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "slipped"
  );

  assert.equal(manager.acquireControl(session, second.client, {
    x: session.state.x,
    y: session.state.y,
  }), true);
  assert.equal(session.state.dragging, true);
  assert.equal(session.holder.clientId, second.client.id);
  assert.equal(session.state.controllerId, second.client.id);
});

test("брошенный камень не останавливается при попадании в отпечаток", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    physics: { mass: 1, handForce: 100, gravity: 0.45, turbulence: 0 },
    imprint: { toleranceX: 40, toleranceY: 20 },
  });
  const first = connect(manager, session, "client-throw-win-01");
  manager.acquireControl(session, first.client, { x: 500, y: 900 });
  manager.releaseControl(session, first.client, {
    vy: -4000,
  });

  clock.value = 100;
  manager.tick();

  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.deepEqual(session.imprint, {
    x: Physics.WORLD_WIDTH / 2,
    y: 100,
    toleranceX: 40,
    toleranceY: 20,
  });
  assert.notEqual(session.state.vy, 0);
});
