const { test, expect } = require("@playwright/test");

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

test("два браузера видят один камень и по очереди управляют им", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await first.goto("/");
  await first.locator(".settings-toggle").click();
  await setRange(first, "gravity", 2);
  await setRange(first, "bounce", 0);
  await first.getByTestId("share-session").click();
  await expect(first).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  const sharedUrl = first.url();
  await expect(first.getByTestId("session-status")).toContainText("В сессии");

  await second.goto(sharedUrl);
  await second.locator(".settings-toggle").click();
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await expect(first.getByTestId("session-status")).toContainText("2");

  await first.locator(".settings-toggle").click();
  await first.locator(".rock").click({ position: { x: 100, y: 100 } });
  await expect(first.locator("body")).toHaveClass(/state-fallingToBottom/);
  await expect(second.locator("body")).toHaveClass(/state-fallingToBottom/);

  const firstY = await first.locator(".rock").evaluate((rock) =>
    Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
  );
  await first.waitForTimeout(350);
  const secondY = await second.locator(".rock").evaluate((rock) =>
    Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
  );
  expect(secondY).toBeGreaterThan(firstY);

  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 7000 });
  await second.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const point = await visibleRockPoint(second);
  await second.mouse.move(point.x, point.y);
  await second.mouse.down();
  await expect(second.getByTestId("session-status")).toContainText("камень у вас");
  await second.mouse.move(point.x, point.y - 40, {
    steps: 4,
  });
  await expect(first.getByTestId("session-status")).toContainText("другой участник");
  await second.mouse.up();

  await firstContext.close();
  await secondContext.close();
});
