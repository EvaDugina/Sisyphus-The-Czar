"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");
const {
  SessionManager,
  DISCONNECT_GRACE_MS,
  DISCONNECTED_CLIENT_TTL_MS,
  DEFAULT_EMPTY_SESSION_GRACE_MS,
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
    random: options.random || (() => 0.75),
  });
  return { clock, manager };
}

function connect(manager, session, id) {
  const socket = new FakeSocket();
  const client = manager.connectClient(session, id, socket);
  return { socket, client };
}

test("первый захват автоматически отпускается через 400 мс", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({ state: { phase: Physics.PHASES.INTRO } });
  const { client } = connect(manager, session, "client-first-0001");

  assert.equal(manager.acquireControl(session, client, { x: 500, y: 700 }), true);
  clock.value = 399;
  manager.tick();
  assert.equal(session.state.dragging, true);

  clock.value = 401;
  manager.tick();
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.phase, Physics.PHASES.FALLING);
});

test("ранний pointerup запускает первое падение раньше таймера", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({ state: { phase: Physics.PHASES.INTRO } });
  const { client } = connect(manager, session, "client-early-0001");

  manager.acquireControl(session, client, { x: 500, y: 700 });
  clock.value = 120;
  manager.releaseControl(session, client, { vx: 0, vy: 0 });

  assert.equal(session.state.phase, Physics.PHASES.FALLING);
  assert.equal(session.firstFallAt, null);
});

test("control.release применяет финальную позицию контроллера", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 200, y: 900 },
  });
  const { client } = connect(manager, session, "client-release-pos1");

  manager.acquireControl(session, client, { x: 200, y: 900 });
  manager.releaseControl(session, client, {
    x: 640,
    y: 780,
    vx: 0,
    vy: 0,
  });

  assert.equal(session.state.x, 640);
  assert.equal(session.state.y, 780);
  assert.equal(session.state.dragging, false);
});

test("одновременный захват получает только первый участник", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: Physics.WORLD_HEIGHT },
  });
  const first = connect(manager, session, "client-lock-a-001");
  const second = connect(manager, session, "client-lock-b-001");

  assert.equal(manager.acquireControl(session, first.client, {}), true);
  assert.equal(manager.acquireControl(session, second.client, {}), false);
  assert.equal(session.state.controllerId, first.client.id);

  manager.releaseControl(session, first.client, { vx: 0, vy: 0 });
  assert.equal(manager.acquireControl(session, second.client, {}), true);
  assert.equal(session.state.controllerId, second.client.id);
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

test("разрыв соединения освобождает камень после grace-периода", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, y: Physics.WORLD_HEIGHT },
  });
  const connected = connect(manager, session, "client-drop-00001");
  manager.acquireControl(session, connected.client, {});
  manager.disconnectClient(session, connected.client.id, connected.socket);

  clock.value = DISCONNECT_GRACE_MS - 1;
  manager.tick();
  assert.equal(session.state.dragging, true);

  clock.value = DISCONNECT_GRACE_MS + 1;
  manager.tick();
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
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

test("первое касание сохраняет отпечаток без фиксации при возвращении", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.INTRO, x: 500, y: 700 },
  });
  const { client } = connect(manager, session, "client-win-000001");
  manager.acquireControl(session, client, {
    x: 500,
    y: 700,
    imprint: { toleranceX: 40, toleranceY: 30 },
  });
  assert.deepEqual(session.imprint, {
    x: 500,
    y: 700,
    toleranceX: 40,
    toleranceY: 30,
  });
  manager.releaseControl(session, client, { vx: 0, vy: 0 });

  session.state.phase = Physics.PHASES.PLAY;
  manager.acquireControl(session, client, { x: 541, y: 700 });
  manager.moveControl(session, client, { x: 541, y: 700 });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.dragging, true);

  manager.moveControl(session, client, { x: 539, y: 700 });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 539);
  assert.equal(session.state.y, 700);
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, client.id);

  manager.releaseControl(session, client, { x: 539, y: 700, vx: 0, vy: -2000 });
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.equal(session.state.x, 539);
  assert.equal(session.state.y, 700);
  assert.equal(session.state.vx, 0);
  assert.equal(session.state.vy, 0);
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);

  clock.value = 50;
  manager.tick();
  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.ok(session.state.y > 700);
});

test("удержание в отпечатке отключает авто-выскальзывание из руки", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 700 },
    imprint: { x: 500, y: 700, toleranceX: 40, toleranceY: 30 },
  });
  const { client } = connect(manager, session, "client-imprint-hold");

  assert.equal(manager.acquireControl(session, client, { x: 500, y: 700 }), true);
  assert.equal(session.holdReleaseAt, null);

  clock.value = Physics.maxHoldMs(session.physics) + 1000;
  manager.tick();
  assert.equal(session.state.dragging, true);
  assert.equal(session.state.controllerId, client.id);

  manager.moveControl(session, client, { x: 545, y: 700, vx: 0, vy: 0 });
  assert.ok(session.holdReleaseAt > clock.value);
  const holdReleaseAt = session.holdReleaseAt;

  clock.value = holdReleaseAt - 1;
  manager.tick();
  assert.equal(session.state.dragging, true);

  clock.value = holdReleaseAt + 1;
  manager.tick();
  assert.equal(session.state.dragging, false);
  assert.equal(session.state.controllerId, null);
});

test("брошенный камень не останавливается при попадании в отпечаток", () => {
  const { clock, manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 900 },
    physics: { mass: 1, handForce: 10, gravity: 1, turbulence: 0 },
    imprint: { x: 500, y: 800, toleranceX: 40, toleranceY: 20 },
  });
  const { client } = connect(manager, session, "client-throw-win-01");
  manager.acquireControl(session, client, { x: 500, y: 900 });
  manager.releaseControl(session, client, {
    vy: -4000,
  });

  clock.value = 100;
  manager.tick();

  assert.equal(session.state.phase, Physics.PHASES.PLAY);
  assert.notEqual(session.state.y, session.imprint.y);
  assert.notEqual(session.state.vy, 0);
});
