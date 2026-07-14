"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Physics = require("../../shared/physics");
const {
  SessionManager,
  DISCONNECT_GRACE_MS,
  DISCONNECTED_CLIENT_TTL_MS,
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

test("давно отключённый клиент удаляется из комнаты", () => {
  const { clock, manager } = setup({ ttlMs: 120_000 });
  const session = manager.createSession();
  const connected = connect(manager, session, "client-stale-0001");
  manager.disconnectClient(session, connected.client.id, connected.socket);

  clock.value = DISCONNECTED_CLIENT_TTL_MS + 1;
  manager.tick();

  assert.equal(session.clients.has(connected.client.id), false);
  assert.equal(manager.sessions.has(session.id), true);
});

test("победа принимается только с полными границами цели", () => {
  const { manager } = setup();
  const session = manager.createSession({
    state: { phase: Physics.PHASES.PLAY, x: 500, y: 250 },
  });
  const { client } = connect(manager, session, "client-win-000001");
  manager.acquireControl(session, client, { x: 500, y: 250 });
  manager.releaseControl(session, client, {
    target: { minX: 400, maxX: 600, minY: 200, maxY: 300 },
  });
  assert.equal(session.state.phase, Physics.PHASES.WON);
});
