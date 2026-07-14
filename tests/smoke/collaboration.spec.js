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

async function grabVisibleRock(page) {
  const status = page.getByTestId("session-status");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const point = await visibleRockPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
      await expect(status).toContainText("камень у вас", { timeout: 1500 });
      return point;
    } catch (error) {
      lastError = error;
      await page.mouse.up();
    }
  }
  throw lastError;
}

test("потерянная сессия заменяется рабочей и ссылка копируется", async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  const missingSessionId = "AAAAAAAAAAAAAAAAAAAAAA";

  await page.goto(`/?session=${missingSessionId}`);
  await expect.poll(() => page.url()).not.toContain(missingSessionId);
  await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  const currentUrl = page.url();
  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  const shareToggle = page.getByTestId("share-session-top");
  await expect(shareToggle).toBeEnabled();
  await shareToggle.click();
  await expect(shareToggle).toHaveClass(/is-copied/);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    currentUrl
  );

  const point = await visibleRockPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByTestId("session-status")).toContainText("камень у вас");
  await page.mouse.up();

  await context.close();
});

test("вход на корень перенаправляет в рабочую сессию", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const documentRequests = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      const url = new URL(request.url());
      documentRequests.push(`${url.pathname}${url.search}`);
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page.locator("html")).toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => documentRequests.length).toBeGreaterThanOrEqual(2);
  expect(documentRequests[0]).toBe("/");
  expect(documentRequests.at(-1)).toMatch(/^\/\?session=[A-Za-z0-9_-]{22}$/);

  await page.locator(".settings-toggle").click();
  await expect(page.getByTestId("share-session")).toHaveCount(0);
  await setRange(page, "gravity", 10);
  await page.locator(".settings-toggle").click();

  const sizeBeforeTouch = await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  const point = await visibleRockPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(page.getByTestId("session-status")).toContainText("камень у вас");
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.getByTestId("rock-imprint")).toHaveClass(/is-visible/);
  await page.mouse.up();
  await expect(page.locator("body")).toHaveClass(/state-fallingToBottom/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect(page.locator(".rock")).not.toHaveClass(/is-dragging/);
  const sizeAfterRelease = await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(sizeAfterRelease.width).toBeCloseTo(sizeBeforeTouch.width, 1);
  expect(sizeAfterRelease.height).toBeCloseTo(sizeBeforeTouch.height, 1);

  await expect
    .poll(() =>
      page.locator(".trail").evaluate((canvas) => {
        const context = canvas.getContext("2d");
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return data.some((channel, index) => index % 4 === 3 && channel > 0);
      })
    )
    .toBe(true);

  const urlBeforeReload = page.url();
  await page.reload();
  await expect(page).toHaveURL(urlBeforeReload);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page.locator("body")).not.toHaveClass(/state-intro/);
  await expect(page.getByTestId("rock-imprint")).toHaveClass(/is-visible/);
  await expect(page.locator('[name="gravity"]')).toHaveValue("10");
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);

  await context.close();
});

test("два браузера видят один камень и по очереди управляют им", async ({ browser }) => {
  test.setTimeout(45_000);
  const firstContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await first.goto("/");
  await expect(first).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  const sceneHeightInViewports = await first.locator(".world").evaluate(
    (world) => world.offsetHeight / window.innerHeight
  );
  expect(sceneHeightInViewports).toBeCloseTo(100, 1);
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
  await expect(first.getByTestId("share-session")).toHaveCount(0);
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
  await setRange(first, "gravity", 10);
  await setRange(first, "handForce", 9);
  await setRange(first, "pointerInfluence", 1.8);
  await setRange(first, "bounce", 0.1);
  await setRange(first, "inertia", 0.8);
  await setRange(first, "sliding", 0.2);
  await setRange(first, "turbulence", 0.3);

  await second.goto("/");
  await expect(second).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  expect(second.url()).not.toBe(sharedUrl);
  await second.goto(sharedUrl);
  await second.locator(".settings-toggle").click();
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await expect(first.getByTestId("session-status")).toContainText("2");
  const expectedPhysics = {
    mass: "100",
    gravity: "10",
    handForce: "9",
    pointerInfluence: "1.8",
    bounce: "0.1",
    inertia: "0.8",
    sliding: "0.2",
    turbulence: "0.3",
  };
  for (const [name, value] of Object.entries(expectedPhysics)) {
    await expect(second.locator(`[name="${name}"]`)).toHaveValue(value);
  }
  await expect(first.locator("html")).toHaveClass(/is-scroll-locked/);
  await expect(second.locator("html")).toHaveClass(/is-scroll-locked/);
  await expect(first.locator("body")).toHaveClass(/theme-light/);
  await expect(second.locator("body")).toHaveClass(/theme-light/);

  await second.evaluate(() => collab.socket.close(4100, "test_reconnect"));
  await expect(second.getByTestId("session-status")).toContainText("Переподключение");
  await setRange(second, "gravity", 9);
  await expect(first.locator('[name="gravity"]')).toHaveValue("9", {
    timeout: 5000,
  });

  await first.locator(".settings-toggle").click();
  await second.locator(".settings-toggle").click();
  const firstPoint = await visibleRockPoint(first);
  await first.mouse.move(firstPoint.x, firstPoint.y);
  const remoteCursor = second.getByTestId("remote-cursor");
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect(remoteCursor).not.toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("background-image", /cursor-grab\.png/);
  const positionBeforeFirstTouch = await first.evaluate(() => ({
    x: Number.parseFloat(
      getComputedStyle(document.querySelector(".rock")).getPropertyValue("--rock-x")
    ),
    y: Number.parseFloat(
      getComputedStyle(document.querySelector(".rock")).getPropertyValue("--rock-y")
    ),
  }));

  await first.mouse.down();
  await expect(first.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(second.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(remoteCursor).toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("background-image", /cursor-grabbing\.png/);
  const firstImprint = first.getByTestId("rock-imprint");
  const secondImprint = second.getByTestId("rock-imprint");
  await expect(firstImprint).toHaveClass(/is-visible/);
  await expect(secondImprint).toHaveClass(/is-visible/);
  const initialAlignment = await first.evaluate(() => ({
    imprintX: Number.parseFloat(
      getComputedStyle(document.querySelector(".rock-imprint")).getPropertyValue(
        "--imprint-x"
      )
    ),
    imprintY: Number.parseFloat(
      getComputedStyle(document.querySelector(".rock-imprint")).getPropertyValue(
        "--imprint-y"
      )
    ),
  }));
  expect(initialAlignment.imprintX).toBeCloseTo(positionBeforeFirstTouch.x, 0);
  expect(initialAlignment.imprintY).toBeCloseTo(positionBeforeFirstTouch.y, 0);
  await first.mouse.up();
  await expect(first.locator("body")).toHaveClass(/state-fallingToBottom/);
  await expect(second.locator("body")).toHaveClass(/state-fallingToBottom/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);

  const trailBuffer = await first.locator(".trail").evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    maxWidth: Math.ceil(window.innerWidth * 2),
    maxHeight: Math.ceil(window.innerHeight * 2),
  }));
  expect(trailBuffer.width).toBeLessThanOrEqual(trailBuffer.maxWidth);
  expect(trailBuffer.height).toBeLessThanOrEqual(trailBuffer.maxHeight);

  const firstY = await first.locator(".rock").evaluate((rock) =>
    Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
  );
  await first.waitForTimeout(350);
  const secondY = await second.locator(".rock").evaluate((rock) =>
    Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
  );
  expect(secondY).toBeGreaterThan(firstY);

  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 20_000 });
  await second.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() =>
      second.locator(".trail").evaluate((canvas) => {
        const context = canvas.getContext("2d");
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        return data.some((channel, index) => index % 4 === 3 && channel > 0);
      })
    )
    .toBe(true);
  const point = await grabVisibleRock(second);
  await second.mouse.move(point.x, point.y - 40, {
    steps: 4,
  });
  await expect(first.getByTestId("session-status")).toContainText("другой участник");
  await second.evaluate(() => {
    const imprint = collab.imprint;
    if (!imprint) {
      throw new Error("Сервер не прислал отпечаток камня");
    }
    sendShared("control.move", {
      x: imprint.x,
      y: imprint.y,
      vx: 0,
      vy: -100,
      pointer: collab.localPointer,
    });
  });
  await expect(first.locator("body")).toHaveClass(/state-won/);
  await expect(second.locator("body")).toHaveClass(/state-won/);
  await second.mouse.up();

  await second.evaluate(() => window.scrollTo(0, 0));
  const stoppedAlignment = await second.evaluate(() => {
    const rockRect = document.querySelector(".rock").getBoundingClientRect();
    const imprintRect = document
      .querySelector(".rock-imprint")
      .getBoundingClientRect();
    return {
      left: Math.abs(rockRect.left - imprintRect.left),
      top: Math.abs(rockRect.top - imprintRect.top),
      right: Math.abs(rockRect.right - imprintRect.right),
      bottom: Math.abs(rockRect.bottom - imprintRect.bottom),
    };
  });
  Object.values(stoppedAlignment).forEach((difference) => {
    expect(difference).toBeLessThanOrEqual(1);
  });

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
  await verification.waitForTimeout(2200);
  await verification.goto(sharedUrl);
  await expect.poll(() => verification.url()).not.toBe(sharedUrl);
  await expect(verification.getByTestId("session-status")).toContainText("В сессии");

  await firstContext.close();
  await secondContext.close();
});
