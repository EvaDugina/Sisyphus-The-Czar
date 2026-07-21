"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");
const {
  SessionManager,
  DISCONNECTED_CLIENT_TTL_MS,
  DEFAULT_EMPTY_SESSION_GRACE_MS,
  REQUIRED_HOLDERS,
  SLIP_DELAY_MIN_MS,
  SLIP_DELAY_MAX_MS,
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
  });
  return { clock, manager };
}

function connect(manager, session, id) {
  const socket = new FakeSocket();
  const client = manager.connectClient(session, id, socket);
  return { socket, client };
}

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
  assert.equal(manager.serializeSessions()[0].masterClientId, "client-master-0001");
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
    y: 700,
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
  assert.equal(session.state.vy, -4);
});

test("control.acquire запрещён до достижения камнем низа", () => {
  const { manager } = setup();
  const session = manager.createSession({ state: { phase: Physics.PHASES.INTRO } });
  const { socket, client } = connect(manager, session, "client-early-0001");

  assert.equal(manager.acquireControl(session, client, { x: 500, y: 700 }), false);
  assert.equal(session.state.phase, Physics.PHASES.INTRO);
  assert.equal(session.state.dragging, false);
  assert.equal(session.imprint, null);
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
      physics: { inertia: 0.8 },
      expiresAt: 5000,
      emptyDeleteAt: null,
    },
  ]);

  assert.equal(restored, 1);
  assert.equal(manager.getSession("aaaaaaaaaaaaaaaaaaaaaa").physics.inertia, 80);
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

test("указатель участника синхронизируется и исчезает при отключении", () => {
  const { manager } = setup();
  const session = manager.createSession();
  const first = connect(manager, session, "client-pointer-a1");
  const second = connect(manager, session, "client-pointer-b1");

  manager.handleMessage(session, first.client, {
    v: 1,
    type: "pointer.update",
    seq: 1,
    payload: { x: 420, y: 1750, mode: "grab", visible: true },
  });

  const pointerMessage = second.socket.messages.findLast(
    (message) => message.type === "pointer.update"
  );
  assert.deepEqual(pointerMessage.payload, {
    clientId: first.client.id,
    x: 420,
    y: 1750,
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

  manager.disconnectClient(session, first.client.id, first.socket);
  const presence = second.socket.messages.findLast(
    (message) => message.type === "presence.update"
  );
  assert.deepEqual(presence.payload.pointers, []);
});

test("session.restart возвращает общую комнату в начало", () => {
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
    payload: { x: 321, y: 654 },
  });

  assert.equal(session.state.phase, Physics.PHASES.INTRO);
  assert.equal(session.state.x, 321);
  assert.equal(session.state.y, 654);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
  assert.equal(session.physics.gravity, 7);
  assert.deepEqual(session.trail, []);
  assert.equal(session.imprint, null);
  assert.equal(first.client.pointer.mode, "grab");

  const snapshot = first.socket.messages.findLast(
    (message) => message.type === "session.snapshot"
  );
  assert.equal(snapshot.payload.phase, Physics.PHASES.INTRO);
  assert.deepEqual(snapshot.payload.trail, []);
  assert.equal(snapshot.payload.imprint, null);
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
  assert.equal(session.imprint.x, 400);
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

test("неактивная сессия удаляется по TTL", () => {
  const { clock, manager } = setup({ ttlMs: 1000 });
  const session = manager.createSession();
  clock.value = 1001;
  manager.tick();
  assert.equal(manager.sessions.has(session.id), false);
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
    y: 700,
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
    imprint: { x: 500, y: 800, toleranceX: 40, toleranceY: 20 },
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
  assert.notEqual(session.state.y, session.imprint.y);
  assert.notEqual(session.state.vy, 0);
});
