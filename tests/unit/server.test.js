"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const {
  createService,
  securityHeaders,
  WindowRateLimiter,
} = require("../../server");

function emptySessionStore() {
  return {
    enabled: false,
    load: () => [],
    save: () => false,
  };
}

test("rate limiter очищает истёкшие ключи при достижении лимита памяти", () => {
  let now = 1000;
  const limiter = new WindowRateLimiter(1, 60_000, () => now);
  for (let index = 0; index < 10_000; index += 1) {
    limiter.entries.set(`expired-${index}`, { count: 1, resetAt: 999 });
  }

  assert.equal(limiter.consume("fresh"), true);
  assert.equal(limiter.entries.size, 1);
});

test("rate limiter не принимает новый ключ при 10 000 активных окнах", () => {
  const limiter = new WindowRateLimiter(1, 60_000, () => 1000);
  for (let index = 0; index < 10_000; index += 1) {
    limiter.entries.set(`active-${index}`, { count: 1, resetAt: 61_000 });
  }

  assert.equal(limiter.consume("extra"), false);
  assert.equal(limiter.entries.size, 10_000);
});

test("production CSP разрешает только внешние скрипты своего origin", () => {
  const headers = {};
  securityHeaders(false)(
    {},
    {
      setHeader(name, value) {
        headers[name] = value;
      },
    },
    () => {},
  );

  assert.match(headers["Content-Security-Policy"], /script-src 'self'/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /script-src[^;]*unsafe-inline/);
});

test("production не запускается без обязательного пароля доступа", () => {
  assert.throws(
    () =>
      createService({
        debug: false,
        accessPassword: "",
      }),
    /ACCESS_PASSWORD is required/,
  );
});

test("production пароль закрывает страницы, API и WebSocket", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    accessPassword: "unit-access-password",
    sessionStore: emptySessionStore(),
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  const baseUrl = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  const blockedPage = await fetch(`${baseUrl}/scene-2?source=test`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(blockedPage.status, 303);
  assert.equal(
    blockedPage.headers.get("location"),
    "/access?returnTo=%2Fscene-2%3Fsource%3Dtest",
  );

  const blockedApi = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(blockedApi.status, 401);
  assert.deepEqual(await blockedApi.json(), { error: "access_required" });

  const blockedSocket = new WebSocket(
    `ws://127.0.0.1:${address.port}/realtime?session=AAAAAAAAAAAAAAAAAAAAAA&client=blocked-client-0001`,
  );
  await new Promise((resolve, reject) => {
    blockedSocket.once("unexpected-response", (_request, response) => {
      assert.equal(response.statusCode, 401);
      response.resume();
      resolve();
    });
    blockedSocket.once("open", () => reject(new Error("WebSocket открылся без пароля")));
    blockedSocket.once("error", reject);
  });

  const loginPage = await fetch(`${baseUrl}/access?returnTo=%2Fscene-2`);
  const loginHtml = await loginPage.text();
  assert.equal(loginPage.status, 200);
  assert.match(loginHtml, /Закрытый показ/);
  assert.doesNotMatch(loginHtml, /unit-access-password/);

  const wrongPassword = await fetch(`${baseUrl}/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    body: "password=wrong&returnTo=%2Fscene-2",
    redirect: "manual",
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.headers.get("set-cookie"), null);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const repeatedWrongPassword = await fetch(`${baseUrl}/access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: baseUrl,
      },
      body: "password=still-wrong&returnTo=%2Fscene-2",
      redirect: "manual",
    });
    assert.equal(repeatedWrongPassword.status, 401);
  }
  const limitedWrongPassword = await fetch(`${baseUrl}/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    body: "password=still-wrong&returnTo=%2Fscene-2",
    redirect: "manual",
  });
  assert.equal(limitedWrongPassword.status, 429);

  const login = await fetch(`${baseUrl}/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    body: "password=unit-access-password&returnTo=%2Fscene-2",
    redirect: "manual",
  });
  const setCookie = login.headers.get("set-cookie");
  const cookie = setCookie.split(";", 1)[0];
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/scene-2");
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);

  const authorizedPage = await fetch(`${baseUrl}/scene-2`, {
    headers: { Cookie: cookie },
  });
  assert.equal(authorizedPage.status, 200);
  const created = await fetch(`${baseUrl}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: "{}",
  });
  assert.equal(created.status, 201);
  const { sessionId } = await created.json();

  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/realtime?session=${sessionId}&client=auth-client-0000001`,
    { headers: { Cookie: cookie } },
  );
  context.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
});

test("debug UI остаётся закрытым паролем под заданным base path", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    basePath: "/daemon/",
    accessPassword: "debug-access-password",
    sessionStore: emptySessionStore(),
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  const baseUrl = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/scene-1`)).status, 404);

  const baseRedirect = await fetch(`${baseUrl}/daemon`, { redirect: "manual" });
  assert.equal(baseRedirect.status, 308);
  assert.equal(baseRedirect.headers.get("location"), "/daemon/");

  const blocked = await fetch(`${baseUrl}/daemon/scene-3?source=test`, {
    headers: { Accept: "text/html" },
    redirect: "manual",
  });
  assert.equal(blocked.status, 303);
  assert.equal(
    blocked.headers.get("location"),
    "/daemon/access?returnTo=%2Fdaemon%2Fscene-3%3Fsource%3Dtest",
  );

  const accessPageResponse = await fetch(
    `${baseUrl}${blocked.headers.get("location")}`,
    {
    headers: { Host: `127.0.0.1:${address.port}` },
    },
  );
  const accessHtml = await accessPageResponse.text();
  assert.equal(accessPageResponse.status, 200);
  assert.match(accessHtml, /action="\/daemon\/access"/);

  const login = await fetch(`${baseUrl}/daemon/access`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: baseUrl,
    },
    body: "password=debug-access-password&returnTo=%2Fdaemon%2Fscene-3",
    redirect: "manual",
  });
  const setCookie = login.headers.get("set-cookie");
  const cookie = setCookie.split(";", 1)[0];
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/daemon/scene-3");
  assert.match(setCookie, /Path=\/daemon/i);

  const authorized = await fetch(`${baseUrl}/daemon/scene-3`, {
    headers: { Cookie: cookie },
  });
  assert.equal(authorized.status, 200);
  const created = await fetch(`${baseUrl}/daemon/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: "{}",
  });
  assert.equal(created.status, 201);
});

test("backend публикует shared-модули клиента", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStore: emptySessionStore(),
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());

  const modules = [
    ["gachi-sounds.js", /SisyphusGachiSounds/],
    ["chain-sounds.js", /SisyphusChainSounds/],
    ["production-preset.js", /SisyphusProductionPreset/],
  ];
  for (const [filename, exportName] of modules) {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/shared/${filename}`,
    );
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /javascript/);
    assert.match(body, exportName);
  }
});

test("backend обслуживает три scene route, канонизирует slash и удаляет settings", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStore: emptySessionStore(),
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());
  const baseUrl = `http://${address.address}:${address.port}`;

  const settingsWithSlash = await fetch(`${baseUrl}/settings/?source=test`, {
    redirect: "manual",
  });
  assert.equal(settingsWithSlash.status, 308);
  assert.equal(settingsWithSlash.headers.get("location"), "/scene-1?source=test");
  const settings = await fetch(`${baseUrl}/settings`, { redirect: "manual" });
  assert.equal(settings.status, 308);
  assert.equal(settings.headers.get("location"), "/scene-1");
  for (const scenePath of ["/scene-1", "/scene-2", "/scene-3"]) {
    assert.equal((await fetch(`${baseUrl}${scenePath}`)).status, 200);
    const withSlash = await fetch(`${baseUrl}${scenePath}/?source=test`, {
      redirect: "manual",
    });
    assert.equal(withSlash.status, 308);
    assert.equal(withSlash.headers.get("location"), `${scenePath}?source=test`);
  }
  assert.equal((await fetch(`${baseUrl}/drafts`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/drafts/`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/drafts/assets/missing.js`)).status, 404);
});

test("production startup применяет preset из отдельного store", async (context) => {
  const productionPresetStore = {
    load: () => ({
      settings: {
        gravity: 6.5,
        sceneHeightScreens: 14,
      },
    }),
    metadata: () => null,
    save: () => null,
  };
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: false,
    accessProtectionEnabled: false,
    sessionStore: emptySessionStore(),
    productionPresetStore,
    logger: () => {},
  });
  await service.start();
  context.after(async () => service.close());

  const root = service.manager.ensureDefaultSession();
  assert.equal(root.physics.gravity, 6.5);
  assert.equal(root.roomSettings.sceneHeightScreens, 14);
});

test("debug startup применяет помеченный preset вместо последнего шаблона", async (context) => {
  const productionPresetStore = {
    load: () => ({
      settings: {
        gravity: 6.25,
        sceneHeightScreens: 13,
        handAudioEnabled: false,
      },
    }),
    metadata: () => ({
      selectedAt: "2026-08-09T10:00:00.000Z",
      source: {
        id: "flagged-debug",
        name: "Помеченный шаблон",
        settingsSchemaVersion: 37,
        updatedAt: "2026-08-09T09:59:00.000Z",
      },
    }),
    save: () => null,
  };
  const settingsTemplateStore = {
    load: () => [],
    latest: () => ({
      id: "latest-debug",
      settings: {
        gravity: 5.5,
        sceneHeightScreens: 17,
      },
    }),
    page: () => ({ revision: 1, offset: 0, nextOffset: null, entries: [] }),
    importEntries: () => ({ revision: 1, entries: [] }),
    saveEntry: () => ({ revision: 1, entry: null, branched: false }),
    deleteEntry: () => ({ revision: 1, deletedId: null }),
    createConflict: () => ({ revision: 1, entry: null }),
  };
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStore: emptySessionStore(),
    productionPresetStore,
    settingsTemplateStore,
    logger: () => {},
  });
  await service.start();
  context.after(async () => service.close());

  const root = service.manager.ensureDefaultSession();
  assert.equal(root.physics.gravity, 6.25);
  assert.equal(root.roomSettings.sceneHeightScreens, 13);
  assert.equal(root.roomSettings.handAudioEnabled, false);
  assert.equal(root.settingsRevision, 2);
});

test("debug-сессия применяет production preset поверх стартового browser payload", async (context) => {
  const productionPresetStore = {
    load: () => ({
      settings: { gravity: 5.5, foldAngle: 30, foldZoneSize: 20 },
    }),
    metadata: () => null,
    save: () => null,
  };
  const settingsTemplateStore = {
    load: () => [],
    latest: () => ({ settings: { gravity: 5.5, foldAngle: 30 } }),
    page: () => ({ revision: 1, offset: 0, nextOffset: null, entries: [] }),
    importEntries: () => ({ revision: 1, entries: [] }),
    saveEntry: () => ({ revision: 1, entry: null, branched: false }),
    deleteEntry: () => ({ revision: 1, deletedId: null }),
    createConflict: () => ({ revision: 1, entry: null }),
  };
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStore: emptySessionStore(),
    productionPresetStore,
    settingsTemplateStore,
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());

  const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      physics: { gravity: 8.5 },
      roomSettings: {
        foldAngle: 45,
        foldZoneSize: 10,
        foldBlendEnabled: true,
        foldBlendCurve: "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
      },
    }),
  });
  const payload = await response.json();
  const session = service.manager.getSession(payload.sessionId);

  assert.equal(response.status, 201);
  assert.equal(session.physics.gravity, 5.5);
  assert.equal(session.roomSettings.foldAngle, 30);
  assert.equal(session.roomSettings.foldZoneSize, 20);
});

test("reconnect личной сессии не применяет production preset повторно", async (context) => {
  const productionPresetStore = {
    load: () => ({ settings: { sceneHeightScreens: 1 } }),
    metadata: () => null,
    save: () => null,
  };
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    sessionStore: emptySessionStore(),
    productionPresetStore,
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());

  const response = await fetch(`http://127.0.0.1:${address.port}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const payload = await response.json();
  const session = service.manager.getSession(payload.sessionId);
  service.manager.updateRoomSettings(session, { sceneHeightScreens: 8 });

  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/realtime?session=${payload.sessionId}&client=reconnect-client-0001`,
  );
  context.after(() => socket.close());
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });

  assert.equal(session.roomSettings.sceneHeightScreens, 8);
});
