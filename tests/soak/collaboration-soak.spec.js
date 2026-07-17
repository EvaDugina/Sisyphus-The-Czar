const { test, expect } = require("@playwright/test");

const SOAK_DURATION_MS = 10 * 60 * 1000;
const CONTROL_INTERVAL_MS = 30 * 1000;

async function setRange(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function visibleRockPoint(page) {
  return page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    for (let y = Math.max(rect.top + 16, 16); y < Math.min(rect.bottom - 16, innerHeight - 16); y += 24) {
      for (let x = Math.max(rect.left + 16, 16); x < Math.min(rect.right - 16, innerWidth - 16); x += 24) {
        const top = document.elementFromPoint(x, y);
        if (top === rock || rock.contains(top)) {
          return { x, y };
        }
      }
    }
    throw new Error("Не найдена видимая точка камня");
  });
}

async function grabVisibleRock(page) {
  const status = page.getByTestId("session-status");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const point = await visibleRockPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
      await expect(status).toContainText("камень у вас", { timeout: 1500 });
      return;
    } catch (error) {
      lastError = error;
      await page.mouse.up();
    }
  }
  throw lastError;
}

test("два браузера работают 10 минут без зависшей блокировки и роста памяти", async ({
  browser,
  request,
}) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  const healthBefore = await (await request.get("/healthz")).json();
  await first.goto("/");
  await expect(first).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await first.locator(".settings-toggle").click();
  await setRange(first, "gravity", 10);
  await setRange(first, "bounce", 0);

  await second.goto(first.url());
  await second.locator(".settings-toggle").click();
  await expect(first.getByTestId("session-status")).toContainText("2");
  await first.locator(".settings-toggle").click();
  await second.locator(".settings-toggle").click();
  await first.evaluate(() => {
    window.scrollTo(0, Math.max(1, Math.floor(window.innerHeight / 2)));
  });
  await expect(first.locator("body")).toHaveClass(/state-play/, { timeout: 20_000 });
  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 20_000 });

  const pages = [first, second];
  const startedAt = Date.now();
  let iteration = 0;
  while (Date.now() - startedAt < SOAK_DURATION_MS) {
    const actor = pages[iteration % pages.length];
    const observer = pages[(iteration + 1) % pages.length];
    await actor.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await grabVisibleRock(actor);
    await expect(actor.getByTestId("session-status")).toContainText("камень у вас");
    await expect(observer.getByTestId("session-status")).toContainText("другой участник");
    await actor.mouse.up();
    await expect(actor.getByTestId("session-status")).toContainText("камень свободен");

    const gravity = iteration % 2 === 0 ? 1.2 : 1.3;
    await setRange(actor, "gravity", gravity);
    await expect(observer.locator('[name="gravity"]')).toHaveValue(String(gravity));
    iteration += 1;
    await actor.waitForTimeout(CONTROL_INTERVAL_MS);
  }

  const healthAfter = await (await request.get("/healthz")).json();
  expect(healthAfter.sessions).toBe(1);
  expect(healthAfter.memoryRssBytes - healthBefore.memoryRssBytes).toBeLessThan(
    64 * 1024 * 1024
  );

  await firstContext.close();
  await secondContext.close();
});
