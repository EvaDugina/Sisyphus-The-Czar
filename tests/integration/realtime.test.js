"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { createService } = require("../../server");
const {
  DEFAULT_SESSION_ID,
  TRAIL_SYNC_INTERVAL_MS,
} = require("../../server/session-manager");

function connect(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let sequence = 0;

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString("utf8"));
    messages.push(message);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (
        waiter.type === message.type &&
        (!waiter.predicate || waiter.predicate(message.payload))
      ) {
        waiters.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString("utf8") });
    });
  });

  return {
    socket,
    messages,
    opened,
    closed,
    send(type, payload = {}) {
      sequence += 1;
      socket.send(JSON.stringify({ v: 1, type, seq: sequence, payload }));
    },
    waitFor(type, predicate, timeoutMs = 1500) {
      const existing = messages.find(
        (message) =>
          message.type === type &&
          (!predicate || predicate(message.payload))
      );
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const waiter = { type, predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) {
            waiters.splice(index, 1);
          }
          reject(new Error(`timeout waiting for ${type}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
  };
}

async function createSession(base, clientId) {
  const response = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      creatorClientId: clientId,
      state: {
        phase: "play",
        x: 500,
        y: 1000,
        vx: 0,
        vy: 0,
        suspended: true,
      },
    }),
  });
  assert.equal(response.status, 201);
  return response.json();
}

async function waitUntil(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error("timeout waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function startService(context, options = {}) {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: options.debug ?? false,
    sessionStorePath: "",
    productionPresetPath: options.productionPresetPath || "",
    settingsTemplateStorePath: options.settingsTemplateStorePath || "",
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  return {
    service,
    base: `http://127.0.0.1:${address.port}`,
    wsBase: `ws://127.0.0.1:${address.port}/realtime`,
  };
}

test("single-client комната переживает disconnect для reload", async (context) => {
  const { service, base, wsBase } = await startService(context);
  const firstCreated = await createSession(base, "integration-client-a001");
  const secondCreated = await createSession(base, "integration-client-b001");

  assert.match(firstCreated.sessionId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(secondCreated.sessionId, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(firstCreated.sessionId, secondCreated.sessionId);
  assert.notEqual(firstCreated.sessionId, DEFAULT_SESSION_ID);
  assert.equal(
    service.manager.getSession(firstCreated.sessionId).singleClient,
    true
  );

  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-client-a001`
  );
  await first.opened;
  await first.waitFor("session.snapshot");
  await first.waitFor("trail.history");

  const rejected = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-client-x001`
  );
  await rejected.opened;
  const occupied = await rejected.waitFor("error");
  assert.equal(occupied.payload.code, "session_occupied");
  assert.deepEqual(await rejected.closed, {
    code: 4009,
    reason: "session_occupied",
  });
  assert.equal(
    service.manager.connectedCount(
      service.manager.getSession(firstCreated.sessionId)
    ),
    1
  );

  first.socket.close();
  await first.closed;
  await waitUntil(() => {
    const session = service.manager.sessions.get(firstCreated.sessionId);
    return Boolean(
      session &&
        service.manager.connectedCount(session) === 0 &&
        session.emptyDeleteAt !== null,
    );
  });

  const reconnected = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-client-a001`,
  );
  await reconnected.opened;
  const snapshot = await reconnected.waitFor("session.snapshot");
  assert.equal(snapshot.payload.phase, "play");
  assert.equal(
    service.manager.getSession(firstCreated.sessionId).emptyDeleteAt,
    null,
  );
  reconnected.socket.close();
  await reconnected.closed;
});

test("root API подключает несколько равноправных master-участников", async (context) => {
  const { base, wsBase } = await startService(context);
  const rootResponse = await fetch(`${base}/api/sessions/root`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(rootResponse.status, 200);
  const root = await rootResponse.json();
  assert.equal(root.sessionId, DEFAULT_SESSION_ID);

  const first = connect(
    `${wsBase}?session=${root.sessionId}&client=root-master-client01`,
  );
  const second = connect(
    `${wsBase}?session=${root.sessionId}&client=root-master-client02`,
  );
  await Promise.all([first.opened, second.opened]);
  const [firstSnapshot, secondSnapshot] = await Promise.all([
    first.waitFor("session.snapshot"),
    second.waitFor("session.snapshot"),
  ]);
  assert.equal(firstSnapshot.payload.clientRole, "master");
  assert.equal(secondSnapshot.payload.clientRole, "master");
  assert.equal(
    (await first.waitFor("presence.update", (payload) => payload.participants === 2))
      .payload.participants,
    2,
  );
  assert.equal(
    (await second.waitFor("presence.update", (payload) => payload.participants === 2))
      .payload.participants,
    2,
  );

  first.socket.close();
  second.socket.close();
  await Promise.all([first.closed, second.closed]);
});

test("debug-каталог шаблонов общий для разных личных сессий", async (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-shared-templates-")
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { service, base, wsBase } = await startService(context, {
    debug: true,
    settingsTemplateStorePath: path.join(directory, "settings.json"),
  });
  const firstCreated = await createSession(base, "catalog-browser-a001");
  const secondCreated = await createSession(base, "catalog-browser-b001");
  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=catalog-browser-a001`
  );
  const second = connect(
    `${wsBase}?session=${secondCreated.sessionId}&client=catalog-browser-b001`
  );
  await Promise.all([first.opened, second.opened]);
  const [firstPage, secondPage] = await Promise.all([
    first.waitFor("settingsTemplates.page"),
    second.waitFor("settingsTemplates.page"),
  ]);
  assert.deepEqual(firstPage.payload.entries, []);
  assert.deepEqual(secondPage.payload.entries, []);

  const entry = {
    id: "shared-browser-template",
    name: "Межбраузерный шаблон",
    settingsSchemaVersion: 20,
    createdAt: "2026-07-27T19:00:00.000Z",
    updatedAt: "2026-07-27T19:00:00.000Z",
    settings: { gravity: 8.25, sceneHeightScreens: 7 },
  };
  first.send("settingsTemplates.import", { entries: [entry] });
  const [imported, changed] = await Promise.all([
    first.waitFor("settingsTemplates.imported"),
    second.waitFor(
      "settingsTemplates.changed",
      (payload) =>
        payload.action === "upsert" &&
        payload.entries?.some((item) => item.id === entry.id),
    ),
  ]);
  assert.equal(imported.payload.entries[0].id, entry.id);
  assert.equal(changed.payload.entries[0].settings.gravity, 8.25);
  assert.equal(
    service.manager.getSession(secondCreated.sessionId).physics.gravity,
    9.8,
  );

  const thirdCreated = await createSession(base, "catalog-browser-c001");
  const third = connect(
    `${wsBase}?session=${thirdCreated.sessionId}&client=catalog-browser-c001`
  );
  await third.opened;
  const thirdPage = await third.waitFor("settingsTemplates.page");
  assert.equal(thirdPage.payload.entries[0].id, entry.id);
  assert.equal(
    service.manager.getSession(thirdCreated.sessionId).physics.gravity,
    9.8,
  );
  assert.equal(
    third.messages.find(
      (message) => message.type === "productionPreset.current",
    ).payload.canSelect,
    true,
  );

  second.send("settingsTemplates.delete", { id: entry.id });
  await Promise.all([
    first.waitFor(
      "settingsTemplates.changed",
      (payload) => payload.action === "delete" && payload.id === entry.id,
    ),
    third.waitFor(
      "settingsTemplates.changed",
      (payload) => payload.action === "delete" && payload.id === entry.id,
    ),
  ]);

  first.socket.close();
  second.socket.close();
  third.socket.close();
  await Promise.all([first.closed, second.closed, third.closed]);
});

test("последнее сохранение помеченного preset применяется к новым и перезагруженным сессиям", async (context) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "sisyphus-selected-preset-")
  );
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const productionPresetPath = path.join(directory, "production-preset.json");
  const { service, base, wsBase } = await startService(context, {
    debug: true,
    productionPresetPath,
    settingsTemplateStorePath: path.join(directory, "settings.json"),
  });
  const firstCreated = await createSession(base, "preset-browser-a001");
  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=preset-browser-a001`
  );
  await first.opened;
  const current = await first.waitFor("productionPreset.current");
  assert.equal(current.payload.canSelect, true);

  const entry = {
    id: "hand-audio-disabled",
    name: "Без звука руки",
    settingsSchemaVersion: 34,
    createdAt: "2026-08-09T10:00:00.000Z",
    updatedAt: "2026-08-09T10:00:00.000Z",
    settings: {
      gravity: 7.25,
      sceneHeightScreens: 8,
      handAudioEnabled: false,
    },
  };
  first.send("settingsTemplates.save", { entry });
  const initiallySaved = await first.waitFor(
    "settingsTemplates.saved",
    (payload) => payload.entry?.id === entry.id
  );
  first.send("productionPreset.select", initiallySaved.payload.entry);
  const selected = await first.waitFor(
    "productionPreset.selected",
    (payload) => payload.selection?.source?.id === entry.id
  );
  assert.equal(selected.payload.canSelect, true);
  assert.equal(
    service.manager.getSession(firstCreated.sessionId).physics.gravity,
    9.8,
  );

  const secondCreated = await createSession(base, "preset-browser-b001");
  const secondSession = service.manager.getSession(secondCreated.sessionId);
  assert.equal(secondSession.physics.gravity, 7.25);
  assert.equal(secondSession.roomSettings.sceneHeightScreens, 8);
  assert.equal(secondSession.roomSettings.handAudioEnabled, false);

  const updatedEntry = {
    ...initiallySaved.payload.entry,
    settings: {
      ...initiallySaved.payload.entry.settings,
      gravity: 5.75,
      sceneHeightScreens: 12,
      handAudioEnabled: false,
      rainEnabled: true,
    },
  };
  first.send("settingsTemplates.save", {
    entry: updatedEntry,
    baseUpdatedAt: initiallySaved.payload.entry.updatedAt,
  });
  const updatedSaved = await first.waitFor(
    "settingsTemplates.saved",
    (payload) =>
      payload.entry?.id === entry.id &&
      payload.entry?.settings?.gravity === 5.75,
  );
  assert.equal(updatedSaved.payload.branched, false);
  assert.equal(updatedSaved.payload.entry.settings.gravity, 5.75);
  assert.equal(updatedSaved.payload.entry.settings.sceneHeightScreens, 12);
  assert.equal(updatedSaved.payload.entry.settings.handAudioEnabled, false);
  assert.equal(updatedSaved.payload.entry.settings.rainEnabled, true);

  first.send("productionPreset.select", updatedSaved.payload.entry);
  const reselected = await first.waitFor(
    "productionPreset.selected",
    (payload) =>
      payload.selection?.source?.id === entry.id &&
      payload.selection?.source?.updatedAt === updatedSaved.payload.entry.updatedAt,
  );
  assert.equal(reselected.payload.canSelect, true);
  const storedPreset = JSON.parse(fs.readFileSync(productionPresetPath, "utf8"));
  assert.equal(storedPreset.source.id, entry.id);
  assert.equal(storedPreset.source.updatedAt, updatedSaved.payload.entry.updatedAt);
  assert.equal(storedPreset.settings.gravity, 5.75);
  assert.equal(storedPreset.settings.sceneHeightScreens, 12);
  assert.equal(storedPreset.settings.handAudioEnabled, false);
  assert.equal(storedPreset.settings.rainEnabled, true);

  const thirdCreated = await createSession(base, "preset-browser-c001");
  const thirdSession = service.manager.getSession(thirdCreated.sessionId);
  assert.equal(thirdSession.physics.gravity, 5.75);
  assert.equal(thirdSession.roomSettings.sceneHeightScreens, 12);
  assert.equal(thirdSession.roomSettings.handAudioEnabled, false);
  assert.equal(thirdSession.roomSettings.rainEnabled, true);

  const reloaded = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=preset-browser-a001`
  );
  await reloaded.opened;
  const reloadedSnapshot = await reloaded.waitFor("session.snapshot");
  assert.equal(reloadedSnapshot.payload.physics.gravity, 5.75);
  assert.equal(reloadedSnapshot.payload.roomSettings.sceneHeightScreens, 12);
  assert.equal(reloadedSnapshot.payload.roomSettings.handAudioEnabled, false);
  assert.equal(reloadedSnapshot.payload.roomSettings.rainEnabled, true);
  await first.closed;

  reloaded.socket.close();
  await reloaded.closed;
});

test("между комнатами передаются только подтверждаемые trail-дельты раз в 30 секунд", async (context) => {
  const { service, base, wsBase } = await startService(context);
  assert.equal(service.manager.trailSyncIntervalMs, TRAIL_SYNC_INTERVAL_MS);

  const firstCreated = await createSession(base, "integration-trail-a001");
  const secondCreated = await createSession(base, "integration-trail-b001");
  const first = connect(
    `${wsBase}?session=${firstCreated.sessionId}&client=integration-trail-a001`
  );
  const second = connect(
    `${wsBase}?session=${secondCreated.sessionId}&client=integration-trail-b001`
  );
  await Promise.all([first.opened, second.opened]);
  await Promise.all([
    first.waitFor("session.snapshot"),
    second.waitFor("session.snapshot"),
  ]);
  const [firstHistory, secondHistory] = await Promise.all([
    first.waitFor("trail.history"),
    second.waitFor("trail.history"),
  ]);
  first.send("trail.ack", { cursor: firstHistory.payload.cursor });
  second.send("trail.ack", { cursor: secondHistory.payload.cursor });
  const secondSnapshotCountBeforeForeignBroadcast = second.messages.filter(
    (message) => message.type === "session.snapshot"
  ).length;
  assert.ok(secondSnapshotCountBeforeForeignBroadcast >= 1);

  const firstSession = service.manager.getSession(firstCreated.sessionId);
  const secondSession = service.manager.getSession(secondCreated.sessionId);
  firstSession.state.x = 111;
  firstSession.state.y = 222;
  service.manager.recordTrailPoint(firstSession, Date.now() + 1000);
  service.manager.markChanged(firstSession);
  service.manager.broadcastSnapshot(firstSession);

  assert.equal(secondSession.state.x, 500);
  assert.equal(secondSession.state.y, 1000);
  assert.equal(
    second.messages.filter((message) => message.type === "session.snapshot")
      .length,
    secondSnapshotCountBeforeForeignBroadcast
  );
  assert.equal(
    service.manager.broadcastSharedTrailBatches(
      service.manager.nextTrailSyncAt - 1
    ),
    false
  );
  assert.equal(
    second.messages.some((message) => message.type === "trail.batch"),
    false
  );

  const firstSyncAt = service.manager.nextTrailSyncAt;
  assert.equal(
    service.manager.broadcastSharedTrailBatches(firstSyncAt),
    true
  );
  const firstBatch = await second.waitFor(
    "trail.batch",
    (payload) => payload.points.length === 1
  );
  assert.deepEqual(firstBatch.payload.points, [[111, 222]]);
  second.send("trail.ack", { cursor: firstBatch.payload.cursor });
  await waitUntil(
    () =>
      secondSession.clients.get("integration-trail-b001")?.trailCursor ===
      firstBatch.payload.cursor
  );

  firstSession.state.x = 333;
  firstSession.state.y = 444;
  service.manager.recordTrailPoint(firstSession, Date.now() + 2000);
  const secondSyncAt = service.manager.nextTrailSyncAt;
  service.manager.broadcastSharedTrailBatches(secondSyncAt);
  const secondBatch = await second.waitFor(
    "trail.batch",
    (payload) =>
      payload.cursor > firstBatch.payload.cursor &&
      payload.points.some((point) => point[0] === 333)
  );
  assert.equal(secondBatch.payload.baseCursor, firstBatch.payload.cursor);
  assert.deepEqual(secondBatch.payload.points, [[333, 444]]);

  const newcomerCreated = await createSession(
    base,
    "integration-trail-new01"
  );
  const newcomer = connect(
    `${wsBase}?session=${newcomerCreated.sessionId}&client=integration-trail-new01`
  );
  await newcomer.opened;
  const newcomerHistory = await newcomer.waitFor("trail.history");
  assert.deepEqual(newcomerHistory.payload.points.slice(-2), [
    [111, 222],
    [333, 444],
  ]);

  first.socket.close();
  second.socket.close();
  newcomer.socket.close();
});

test("визуальная trail-история длиннее 1000 точек восстанавливается при reconnect", async (context) => {
  const { service, base, wsBase } = await startService(context);
  const created = await createSession(base, "integration-trail-writer01");
  const writer = connect(
    `${wsBase}?session=${created.sessionId}&client=integration-trail-writer01`,
  );
  await writer.opened;
  await writer.waitFor("session.snapshot");
  await writer.waitFor("trail.history");

  writer.send("roomSettings.update", { trailUnlimited: true });
  await writer.waitFor(
    "session.snapshot",
    (payload) => payload.roomSettings?.trailUnlimited === true,
  );
  writer.send("control.acquire", { x: 500, y: 1000 });
  const granted = await writer.waitFor("control.granted");
  assert.equal(granted.payload.trailWriterId, "integration-trail-writer01");

  const points = Array.from({ length: 1005 }, (_, index) => [
    index % 1001,
    (index * 2) % 2001,
    2,
  ]);
  for (let offset = 0; offset < points.length; offset += 64) {
    writer.send("trail.append", {
      points: points.slice(offset, offset + 64),
    });
  }

  const writerSession = service.manager.getSession(created.sessionId);
  await waitUntil(
    () =>
      writerSession.trail.length === points.length &&
      service.manager.sharedTrailHub.trail.length === points.length,
  );

  const newcomerCreated = await createSession(
    base,
    "integration-trail-reader01",
  );
  const newcomer = connect(
    `${wsBase}?session=${newcomerCreated.sessionId}&client=integration-trail-reader01`,
  );
  await newcomer.opened;
  const history = await newcomer.waitFor("trail.history");

  assert.equal(history.payload.points.length, points.length);
  assert.deepEqual(history.payload.points[0], [0, 0, 2]);
  assert.equal(history.payload.points.at(-1)[2], 2);

  writer.socket.close();
  newcomer.socket.close();
});

test("leave-token немедленно закрывает личную сессию", async (context) => {
  const { service, base, wsBase } = await startService(context);
  const created = await createSession(base, "integration-leave-a001");
  const client = connect(
    `${wsBase}?session=${created.sessionId}&client=integration-leave-a001`
  );
  await client.opened;
  const snapshot = await client.waitFor("session.snapshot");

  const invalid = await fetch(
    `${base}/api/sessions/${created.sessionId}/leave`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "integration-leave-a001",
        leaveToken: "AAAAAAAAAAAAAAAAAAAAAA",
      }),
    }
  );
  assert.equal(invalid.status, 403);
  assert.equal(service.manager.sessions.has(created.sessionId), true);

  const left = await fetch(`${base}/api/sessions/${created.sessionId}/leave`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: "integration-leave-a001",
      leaveToken: snapshot.payload.leaveToken,
    }),
  });
  assert.equal(left.status, 204);
  assert.equal(service.manager.sessions.has(created.sessionId), false);
  assert.equal((await client.closed).reason, "session_left");
});

test("общая история следов переживает штатный restart сервиса", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sisyphus-trail-"));
  const sessionStorePath = path.join(directory, "sessions.json");
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const firstService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    sessionStorePath,
    logger: () => {},
  });
  const firstAddress = await firstService.start();
  const firstBase = `http://127.0.0.1:${firstAddress.port}`;
  const firstCreated = await createSession(
    firstBase,
    "integration-persist-a01"
  );
  const firstSession = firstService.manager.getSession(firstCreated.sessionId);
  firstSession.state.x = 321;
  firstSession.state.y = 654;
  firstService.manager.recordTrailPoint(firstSession, Date.now() + 1000);
  await firstService.close();

  const secondService = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    sessionStorePath,
    logger: () => {},
  });
  const secondAddress = await secondService.start();
  context.after(async () => secondService.close());
  const secondBase = `http://127.0.0.1:${secondAddress.port}`;
  const secondCreated = await createSession(
    secondBase,
    "integration-persist-b01"
  );
  const restored = connect(
    `ws://127.0.0.1:${secondAddress.port}/realtime?session=${secondCreated.sessionId}&client=integration-persist-b01`
  );
  await restored.opened;
  const history = await restored.waitFor("trail.history");
  assert.deepEqual(history.payload.points.at(-1), [321, 654]);
  restored.socket.close();
});
