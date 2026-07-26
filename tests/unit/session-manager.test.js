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
  REQUIRED_HOLDERS,
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
    soundRandom: options.soundRandom || (() => 0.5),
    slipDelayMinMs: options.slipDelayMinMs,
    slipDelayMaxMs: options.slipDelayMaxMs,
    stationaryHoldReleaseMs: options.stationaryHoldReleaseMs ?? 10_000,
    audioLeadMs: options.audioLeadMs,
    productionPresetSelectionEnabled:
      options.productionPresetSelectionEnabled,
    getProductionPresetSelection: options.getProductionPresetSelection,
    saveProductionPresetSelection: options.saveProductionPresetSelection,
    settingsTemplatesEnabled: options.settingsTemplatesEnabled,
    getSettingsTemplatesPage: options.getSettingsTemplatesPage,
    getLatestSettingsTemplate: options.getLatestSettingsTemplate,
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

test("создатель комнаты закрепляется как master, остальные получают slave", () => {
  const { manager } = setup();
  const session = manager.createSession({
    creatorClientId: "client-master-0001",
  });
  const master = connect(manager, session, "client-master-0001");
  const slave = connect(manager, session, "client-slave-0001");

  assert.equal(session.masterClientId, "client-master-0001");
  assert.equal(master.client.role, "master");
  assert.equal(slave.client.role, "slave");
  assert.equal(master.client.gachiSoundFilename, null);
  assert.ok(
    GachiSounds.isGachiSoundFilename(slave.client.gachiSoundFilename)
  );
  assert.equal(
    master.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.clientRole,
    "master"
  );
  assert.equal(
    slave.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.clientRole,
    "slave"
  );
  assert.equal(
    slave.socket.messages.findLast((message) => message.type === "session.snapshot")
      .payload.gachiSoundFilename,
    slave.client.gachiSoundFilename
  );
  assert.equal(manager.serializeSessions()[0].masterClientId, "client-master-0001");
  assert.equal(
    Object.hasOwn(manager.serializeSessions()[0], "slaveSoundAssignments"),
    false
  );
});

test("gachi-звук slave стабилен во всех комнатах текущего процесса", () => {
  const { manager } = setup({ soundRandom: () => 0.5 });
  const firstSession = manager.createSession({
    creatorClientId: "client-master-sound1",
  });
  const secondSession = manager.createSession({
    creatorClientId: "client-master-sound2",
  });

  const first = connect(manager, firstSession, "client-slave-sound1");
  const second = connect(manager, secondSession, "client-slave-sound1");

  assert.equal(first.client.role, "slave");
  assert.equal(second.client.role, "slave");
  assert.equal(
    first.client.gachiSoundFilename,
    second.client.gachiSoundFilename
  );
  assert.ok(
    GachiSounds.isGachiSoundFilename(first.client.gachiSoundFilename)
  );
  assert.equal(manager.slaveSoundAssignments.size, 1);
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
  const slave = connect(manager, session, "client-audio-slave1");

  manager.handleMessage(session, master.client, {
    v: 1,
    type: "audio.play",
    seq: 1,
    payload: {},
  });
  const masterEvent = master.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );
  const slaveCopy = slave.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );

  assert.deepEqual(slaveCopy, masterEvent);
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
  manager.handleMessage(session, slave.client, {
    v: 1,
    type: "audio.play",
    seq: 1,
    payload: {},
  });
  const slaveEventAtMaster = master.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );
  const slaveEvent = slave.socket.messages.findLast(
    (message) => message.type === "audio.play"
  );

  assert.deepEqual(slaveEventAtMaster, slaveEvent);
  assert.deepEqual(slaveEvent.payload, {
    eventId: slaveEvent.payload.eventId,
    actorId: slave.client.id,
    role: "slave",
    filename: slave.client.gachiSoundFilename,
    playAt: 1500 + DEFAULT_AUDIO_LEAD_MS,
    serverTime: 1500,
  });

  session.state.phase = Physics.PHASES.FALLING;
  manager.handleMessage(session, slave.client, {
    v: 1,
    type: "audio.play",
    seq: 2,
    payload: {},
  });
  assert.equal(
    slave.socket.messages.filter((message) => message.type === "audio.play")
      .length,
    2
  );
});

test("старая комната без master получает fallback по первому подключению", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-fallback-01");
  const second = connect(manager, session, "client-fallback-02");

  assert.equal(session.masterClientId, first.client.id);
  assert.equal(first.client.role, "master");
  assert.equal(second.client.role, "slave");
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

test("секундомер вершины синхронно накапливается без паузы и переживает restart", () => {
  const { clock, manager } = setup();
  clock.value = 1000;
  const session = manager.createSession({
    state: {
      phase: Physics.PHASES.PLAY,
      x: Physics.WORLD_WIDTH / 2,
      y: 300,
      suspended: true,
    },
  });
  const master = connect(manager, session, "client-timer-master");
  const slave = connect(manager, session, "client-timer-slave1");

  session.state.x = session.imprint.x;
  session.state.y = session.imprint.y;
  manager.tick();

  const masterStart = master.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  const slaveStart = slave.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  assert.equal(masterStart.payload.summitElapsedMs, 0);
  assert.equal(masterStart.payload.summitTimerRunning, true);
  assert.equal(masterStart.payload.serverTime, 1000);
  assert.deepEqual(slaveStart.payload, masterStart.payload);

  clock.value = 3000;
  session.state.y = session.imprint.y + session.imprint.toleranceY + 1;
  manager.tick();
  assert.equal(manager.snapshot(session).summitElapsedMs, 2000);
  assert.equal(manager.snapshot(session).summitTimerRunning, true);

  clock.value = 5000;
  manager.tick();
  assert.equal(manager.snapshot(session).summitElapsedMs, 4000);

  clock.value = 6000;
  session.state.y = session.imprint.y;
  manager.tick();
  clock.value = 7500;
  assert.equal(manager.snapshot(session).summitElapsedMs, 6500);
  assert.equal(manager.snapshot(session).summitTimerRunning, true);

  clock.value = 8000;
  manager.restartSession(session, {
    x: Physics.WORLD_WIDTH / 2,
    y: Physics.WORLD_HEIGHT,
    suspended: true,
  });
  const restarted = manager.snapshot(session);
  assert.equal(restarted.summitElapsedMs, 7000);
  assert.equal(restarted.summitTimerRunning, true);
});

test("активный секундомер вершины сохраняется и продолжается после restore", () => {
  const firstSetup = setup();
  firstSetup.clock.value = 1000;
  const session = firstSetup.manager.createSession({
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

test("старая сессия внутри вершины получает нулевой таймер на паузе", () => {
  const { clock, manager } = setup();
  const restored = manager.restoreSessions([
    {
      id: "timerlegacy00000000000",
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

test("master сохраняется после restore, leave и новых подключений", () => {
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
  const slave = connect(manager, session, "client-restore-slave");
  const master = connect(manager, session, "client-master-keep");

  assert.equal(slave.client.role, "slave");
  assert.equal(master.client.role, "master");
  assert.equal(session.masterClientId, "client-master-keep");

  assert.equal(
    manager.leaveClient(session, master.client.id, master.client.leaveToken),
    true
  );
  const next = connect(manager, session, "client-next-slave");

  assert.equal(session.masterClientId, "client-master-keep");
  assert.equal(next.client.role, "slave");
  assert.equal(manager.serializeSessions()[0].masterClientId, "client-master-keep");
});

test("общие визуальные настройки комнаты нормализуются и попадают в snapshot", () => {
  const { manager } = setup();
  const session = manager.createSession({
    roomSettings: {
      sceneHeightScreens: 200,
      handWidthVw: 120,
      slaveHandWidthPx: 200,
      handForceDeficitEasing: "not-a-curve",
      trailUnlimited: true,
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
  assert.equal(session.roomSettings.slaveHandWidthPx, 96);
  assert.equal(
    session.roomSettings.handForceDeficitEasing,
    RoomSettings.DEFAULT_ROOM_SETTINGS.handForceDeficitEasing
  );
  assert.equal(session.roomSettings.trailUnlimited, true);
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
    slaveHandWidthPx: 40,
    handForceDeficitEasing: "cubic-bezier(0, 0, 1, 1)",
    rainMaxVolume: 2.5,
    rainDropColor: "#123456",
    rainHighlightColor: "#fedcba",
    trailReset: true,
    trailUnlimited: true,
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
      slaveHandWidthPx: 40,
      handForceDeficitEasing: "cubic-bezier(0, 0, 1, 1)",
      rainMaxVolume: 2.5,
      rainDropColor: "#123456",
      rainHighlightColor: "#fedcba",
      trailReset: true,
      trailUnlimited: true,
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

test("только master изменяет параметры и публикует свой viewport", () => {
  const { manager } = setup();
  const session = manager.createSession({
    creatorClientId: "client-master-view-01",
    masterViewport: { width: 1905, height: 899 },
  });
  const master = connect(manager, session, "client-master-view-01");
  const slave = connect(manager, session, "client-slave-view-001");

  manager.handleMessage(session, slave.client, {
    v: 1,
    type: "roomSettings.update",
    seq: 1,
    payload: { lineWidth: 9 },
  });
  manager.handleMessage(session, slave.client, {
    v: 1,
    type: "physics.update",
    seq: 2,
    payload: { gravity: 99 },
  });
  manager.handleMessage(session, slave.client, {
    v: 1,
    type: "viewport.update",
    seq: 3,
    payload: { width: 1000, height: 500 },
  });

  assert.equal(
    session.roomSettings.lineWidth,
    RoomSettings.DEFAULT_ROOM_SETTINGS.lineWidth,
  );
  assert.equal(session.physics.gravity, Physics.DEFAULT_PHYSICS.gravity);
  assert.deepEqual(session.masterViewport, { width: 1905, height: 899 });
  assert.equal(
    slave.socket.messages.findLast((message) => message.type === "error").payload
      .code,
    "master_only",
  );

  manager.handleMessage(session, master.client, {
    v: 1,
    type: "viewport.update",
    seq: 1,
    payload: { width: 1600, height: 900 },
  });

  assert.deepEqual(session.masterViewport, { width: 1600, height: 900 });
  assert.deepEqual(
    slave.socket.messages.findLast(
      (message) => message.type === "session.snapshot",
    ).payload.masterViewport,
    { width: 1600, height: 900 },
  );
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
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 200, y: 900 },
  });
  const first = connect(manager, session, "client-release-pos1");
  const second = connect(manager, session, "client-release-pos2");

  manager.acquireControl(session, first.client, { x: 200, y: 900 });
  manager.acquireControl(session, second.client, { x: 640, y: 780 });
  manager.releaseControl(session, first.client, {
    x: 640,
    y: 780,
    vx: 0,
    vy: 0,
  });

  assert.equal(session.state.x, 640);
  assert.equal(session.state.y, 780);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, second.client.id);
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

test("камень движется когда суммарная сила рук больше тяжести", () => {
  const { manager } = setup();
  const strongSession = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: Physics.WORLD_HEIGHT },
    physics: { mass: 1, gravity: 10, handForce: 100 },
  });
  const strong = connect(manager, strongSession, "client-strong-hand");

  assert.equal(manager.acquireControl(strongSession, strong.client, {}), true);
  assert.equal(strongSession.state.dragging, true);
  assert.equal(strongSession.state.controllerId, strong.client.id);
  assert.deepEqual([...strongSession.holders.keys()], [strong.client.id]);

  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: 1500 },
    physics: { mass: 10, gravity: 10, handForce: 90 },
  });
  const first = connect(manager, session, "client-lock-a-001");
  const second = connect(manager, session, "client-lock-b-001");

  assert.equal(manager.acquireControl(session, first.client, {}), true);
  assert.equal(session.state.dragging, false);
  assert.deepEqual([...session.holders.keys()], [first.client.id]);
  assert.equal(session.state.controllerId, null);
  assert.ok(session.state.vy > 0);

  assert.equal(manager.acquireControl(session, second.client, {}), true);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.controllerId, first.client.id);
  assert.deepEqual([...session.holders.keys()], [
    first.client.id,
    second.client.id,
  ]);

  manager.moveControl(session, first.client, { x: 480, y: 1900 });
  manager.moveControl(session, second.client, { x: 520, y: 1800 });
  assert.equal(session.state.x, 500);
  assert.equal(session.state.y, 1850);

  manager.releaseControl(session, first.client, { vx: 0, vy: 0 });
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.deepEqual([...session.holders.keys()], [second.client.id]);
});

test("слабая рука не создаёт инерционный бросок при отпускании", () => {
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
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.vx, 0);
  assert.ok(session.state.vy >= 0);

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
  assert.equal(session.state.vx, 0);
  assert.ok(session.state.vy >= 0);
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

test("reconnect в grace-период сохраняет состояние и отменяет удаление", () => {
  const { clock, manager } = setup({ emptyGraceMs: 1000 });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 420, y: 800, vx: 25, vy: -30 },
    physics: { gravity: 7 },
    imprint: { x: 400, y: 700 },
  });
  const first = connect(manager, session, "client-reload-001");
  manager.leaveClient(session, first.client.id, first.client.leaveToken);

  clock.value = 500;
  const reconnected = connect(manager, session, "client-reload-001");

  assert.equal(session.emptyDeleteAt, null);
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 420);
  assert.equal(session.physics.gravity, 7);
  assert.deepEqual(session.imprint, Physics.createSummitImprint({ y: 700 }));
  assert.equal(reconnected.client.id, "client-reload-001");

  clock.value = 1001;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), true);
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

test("разрыв соединения сразу убирает участника из держателей камня", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: Physics.WORLD_HEIGHT },
  });
  const first = connect(manager, session, "client-drop-00001");
  const second = connect(manager, session, "client-drop-00002");
  manager.acquireControl(session, first.client, {});
  manager.acquireControl(session, second.client, {});
  assert.equal(session.state.dragging, true);

  manager.disconnectClient(session, first.client.id, first.socket);

  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, second.client.id);
  assert.deepEqual([...session.holders.keys()], [second.client.id]);
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
  assert.equal(Object.hasOwn(snapshot.payload, "masterViewport"), false);
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

test("пустой ensureDefaultSession не прерывает восстановленный root-секундомер", () => {
  const { clock, manager } = setup();
  clock.value = 4000;
  assert.equal(
    manager.restoreSessions([
      {
        id: DEFAULT_SESSION_ID,
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
  assert.equal(manager.snapshot(session).summitTimerRunning, true);
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

test("любой debug root-клиент выбирает production preset с broadcast", () => {
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
  const slave = connect(manager, session, "client-slave-preset");
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
  manager.handleMessage(session, slave.client, {
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
    slave.socket.messages.findLast(
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

test("production preset нельзя выбрать вне root или при DEBUG=false", () => {
  const saveProductionPresetSelection = () => {
    throw new Error("callback must not be called");
  };
  const debug = setup({
    productionPresetSelectionEnabled: true,
    settingsTemplatesEnabled: true,
    saveProductionPresetSelection,
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
    payload: {},
  });
  assert.equal(
    legacyMaster.socket.messages.findLast(
      (message) => message.type === "error",
    ).payload.code,
    "debug_only",
  );

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

test("debug settings.update принимает slave и сохраняет stale snapshot конфликтом", () => {
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
  const slave = connect(manager, session, "client-settings-slave");

  manager.handleMessage(session, slave.client, {
    v: 1,
    seq: 1,
    type: "settings.update",
    payload: {
      requestId: "request-slave",
      baseRevision: 1,
      settingsSchemaVersion: 18,
      settings: {
        ...RoomSettings.DEFAULT_ROOM_SETTINGS,
        ...Physics.DEFAULT_PHYSICS,
        gravity: 8,
      },
    },
  });

  assert.equal(session.physics.gravity, 8);
  assert.equal(session.settingsRevision, 2);
  assert.equal(
    slave.socket.messages.findLast(
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
    slave.socket.messages.findLast(
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
  const second = connect(manager, session, "client-win-000002");
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
  manager.acquireControl(session, second.client, { x: 541, y: 700 });
  manager.moveControl(session, first.client, { x: 541, y: 700 });
  manager.moveControl(session, second.client, { x: 541, y: 700 });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.dragging, true);

  manager.moveControl(session, first.client, { x: 539, y: 700 });
  manager.moveControl(session, second.client, { x: 539, y: 700 });
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
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, second.client.id);

  manager.releaseControl(session, second.client, {
    x: 539,
    y: 700,
    vx: 0,
    vy: -2000,
  });
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.ok(session.state.vy < 0);

  clock.value = 50;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.ok(session.state.y < 700);
});

test("каждый захват получает случайное окно соскальзывания 0.5–2 секунды", () => {
  const { manager } = setup({ random: () => 0.5 });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
  });
  const first = connect(manager, session, "client-slip-range1");
  const second = connect(manager, session, "client-slip-range2");

  manager.acquireControl(session, first.client, { x: 500, y: 900 });
  manager.acquireControl(session, second.client, { x: 500, y: 900 });

  const slipTimes = [...session.holders.values()].map((holder) => holder.slipAt);
  assert.deepEqual(slipTimes, [1250, 1250]);
  assert.equal(session.holdReleaseAt, 1250);
  assert.equal(REQUIRED_HOLDERS, 1);
  assert.equal(SLIP_DELAY_MIN_MS, 500);
  assert.equal(SLIP_DELAY_MAX_MS, 2000);
  assert.equal(session.state.dragging, true);
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
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { turbulence: 0 },
  });
  const first = connect(manager, session, "client-still-drop-01");
  const second = connect(manager, session, "client-still-drop-02");

  manager.acquireControl(session, first.client, { x: 500, y: 700 });
  manager.acquireControl(session, second.client, { x: 500, y: 700 });
  assert.equal(STATIONARY_HOLD_RELEASE_MS, 200);

  clock.value = STATIONARY_HOLD_RELEASE_MS - 1;
  manager.tick();
  assert.equal(session.holders.size, 2);

  clock.value = STATIONARY_HOLD_RELEASE_MS;
  manager.tick();
  assert.equal(session.holders.size, 0);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(
    first.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "stationary"
  );
  assert.equal(
    second.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "stationary"
  );

  clock.value += 20;
  manager.tick();
  assert.ok(session.state.y > 700);
});

test("фактическое движение камня перезапускает таймер неподвижного удержания", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 10_000,
    slipDelayMaxMs: 10_000,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
  });
  const holder = connect(manager, session, "client-still-reset01");
  manager.acquireControl(session, holder.client, { x: 500, y: 700 });

  clock.value = 150;
  manager.moveControl(session, holder.client, { x: 510, y: 700 });

  clock.value = 349;
  manager.tick();
  assert.equal(session.holders.size, 1);

  clock.value = 350;
  manager.tick();
  assert.equal(session.holders.size, 0);
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

  assert.equal(session.holders.size, 1);
  assert.equal(session.stationaryHoldSince, null);
});

test("победный отпечаток блокирует stationary и случайное выпадение", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 500,
    slipDelayMaxMs: 500,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 100 },
    imprint: { x: 500, y: 100, toleranceX: 40, toleranceY: 30 },
  });
  const holder = connect(manager, session, "client-imprint-hold1");
  manager.acquireControl(session, holder.client, { x: 500, y: 100 });

  clock.value = 1000;
  manager.tick();

  assert.equal(session.holders.size, 1);
  assert.equal(session.stationaryHoldSince, null);
});

test("отпускание последней руки в отпечатке запускает финальное падение", () => {
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
  assert.equal(
    manager.releaseControl(session, holder.client, {
      x: 500,
      y: 100,
      vx: 0,
      vy: -4000,
    }),
    true
  );

  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);

  clock.value = 250;
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

test("движущийся камень сохраняет независимое случайное соскальзывание", () => {
  const { clock, manager } = setup({
    slipDelayMinMs: 500,
    slipDelayMaxMs: 500,
    stationaryHoldReleaseMs: STATIONARY_HOLD_RELEASE_MS,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
  });
  const holder = connect(manager, session, "client-moving-slip01");
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

  assert.equal(session.holders.size, 0);
  assert.equal(
    holder.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "slipped"
  );
});

test("соскальзывание одной руки пересчитывает оставшуюся суммарную силу", () => {
  const randomValues = [0, 1, 1];
  const { clock, manager } = setup({
    random: () => randomValues.shift() ?? 1,
  });
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    physics: { gravity: 0.45, turbulence: 0, bounce: 0 },
  });
  const first = connect(manager, session, "client-slip-catch1");
  const second = connect(manager, session, "client-slip-catch2");
  manager.acquireControl(session, first.client, { x: 500, y: 700 });
  manager.acquireControl(session, second.client, { x: 500, y: 700 });

  clock.value = SLIP_DELAY_MIN_MS + 1;
  manager.tick();

  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, second.client.id);
  assert.deepEqual([...session.holders.keys()], [second.client.id]);
  assert.equal(
    first.socket.messages.findLast(
      (message) => message.type === "control.slipped"
    ).payload.reason,
    "slipped"
  );

  clock.value += 100;
  manager.tick();
  assert.equal(session.state.y, 700);

  manager.acquireControl(session, first.client, {
    x: session.state.x,
    y: session.state.y,
  });
  assert.equal(session.state.dragging, true);
  assert.deepEqual([...session.holders.keys()], [
    second.client.id,
    first.client.id,
  ]);
});

test("брошенный камень не останавливается при попадании в отпечаток", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    physics: { mass: 1, handForce: 100, gravity: 0.45, turbulence: 0 },
    imprint: { toleranceX: 40, toleranceY: 20 },
  });
  const first = connect(manager, session, "client-throw-win-01");
  const second = connect(manager, session, "client-throw-win-02");
  manager.acquireControl(session, first.client, { x: 500, y: 900 });
  manager.acquireControl(session, second.client, { x: 500, y: 900 });
  manager.releaseControl(session, first.client, {
    vy: -4000,
  });
  manager.releaseControl(session, second.client, {
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
