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
  const firstContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await first.goto("/");
  await expect(first).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  const sharedUrl = first.url();

  const shareToggle = first.getByTestId("share-session-top");
  const controlSizes = await first.evaluate(() => {
    const share = document.querySelector(".session-share-toggle").getBoundingClientRect();
    const settings = document.querySelector(".settings-toggle").getBoundingClientRect();
    return {
      share: [share.width, share.height],
      settings: [settings.width, settings.height],
    };
  });
  expect(controlSizes.share).toEqual(controlSizes.settings);

  await shareToggle.click();
  await expect(shareToggle).toHaveClass(/is-copied/);
  await expect(shareToggle.locator('[data-share-icon="check"]')).toBeVisible();
  await expect.poll(() => first.evaluate(() => navigator.clipboard.readText())).toBe(sharedUrl);
  await first.waitForTimeout(450);
  await expect(shareToggle).not.toHaveClass(/is-copied/);

  await first.locator(".settings-toggle").click();
  const trailLength = first.locator('[name="trailMaxPoints"]');
  const trailUnlimited = first.locator('[name="trailUnlimited"]');
  await setRange(first, "trailMaxPoints", 20);
  await trailUnlimited.check();
  await expect(trailLength).toBeDisabled();
  const trailCounts = await first.evaluate(() => {
    trail.points = Array.from({ length: 25 }, (_, index) => ({
      x: index,
      y: index,
    }));
    trimTrailToLimit();
    const unlimited = trail.points.length;

    const checkbox = document.querySelector('[name="trailUnlimited"]');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    const limited = trail.points.length;

    resetTrail();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    return { unlimited, limited };
  });
  expect(trailCounts).toEqual({ unlimited: 25, limited: 20 });
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v2") || "{}"
        );
        return stored.trailUnlimited;
      })
    )
    .toBe(true);
  await setRange(first, "mass", 100);
  await setRange(first, "gravity", 2);
  await setRange(first, "bounce", 0);

  await second.goto("/");
  await expect(second).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  expect(second.url()).not.toBe(sharedUrl);
  await second.goto(sharedUrl);
  await second.locator(".settings-toggle").click();
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await expect(first.getByTestId("session-status")).toContainText("2");
  await expect(second.locator('[name="mass"]')).toHaveValue("100");

  await first.locator(".settings-toggle").click();
  const firstPoint = await visibleRockPoint(first);
  await first.mouse.move(firstPoint.x, firstPoint.y);
  const remoteCursor = second.getByTestId("remote-cursor");
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect(remoteCursor).not.toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("background-image", /cursor-grab\.png/);

  await first.mouse.down();
  await expect(remoteCursor).toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("background-image", /cursor-grabbing\.png/);
  await first.mouse.up();
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
  await second.evaluate(() => {
    const stopMaxY = sharedStopMaxY();
    const position = localToCanonical(motion.x, motion.y);
    sendShared("control.move", {
      x: position.x,
      y: Math.max(0, stopMaxY - 1),
      vx: 0,
      vy: -100,
      stopMaxY,
      pointer: collab.localPointer,
    });
  });
  await expect(first.locator("body")).toHaveClass(/state-won/);
  await expect(second.locator("body")).toHaveClass(/state-won/);
  await second.mouse.up();

  await second.evaluate(() => window.scrollTo(0, 0));
  const stoppedRock = await second.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      stopLine: window.innerHeight * 0.8,
    };
  });
  expect(stoppedRock.top).toBeGreaterThanOrEqual(-1);
  expect(stoppedRock.bottom).toBeLessThanOrEqual(stoppedRock.stopLine + 1);

  await first.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  await expect(second.getByTestId("session-status")).toContainText("В сессии: 1");
  await first.close();

  await second.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  await second.close();

  const verification = await secondContext.newPage();
  await verification.goto(sharedUrl);
  await expect(verification.getByTestId("session-status")).toContainText(
    "Сессия истекла"
  );

  await firstContext.close();
  await secondContext.close();
});
