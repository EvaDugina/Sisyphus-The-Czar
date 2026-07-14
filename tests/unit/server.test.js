"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { WindowRateLimiter } = require("../../server");

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
