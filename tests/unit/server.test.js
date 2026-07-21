"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createService,
  securityHeaders,
  WindowRateLimiter,
} = require("../../server");

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

test("backend публикует shared-модуль gachi-звуков", async (context) => {
  const service = createService({
    port: 0,
    host: "127.0.0.1",
    debug: true,
    logger: () => {},
  });
  const address = await service.start();
  context.after(async () => service.close());

  const response = await fetch(
    `http://127.0.0.1:${address.port}/shared/gachi-sounds.js`,
  );
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.match(body, /SisyphusGachiSounds/);
});
