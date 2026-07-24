const { test, expect } = require("@playwright/test");

function trackAudioRequests(page, bucket) {
  page.on("request", (request) => {
    const url = request.url();
    if (/\.mp3(?:[?#]|$)/i.test(url)) {
      bucket.push(decodeURIComponent(url));
    }
  });
}

async function waitForProductionRuntime(page, role) {
  await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}$/);
  await expect(page.locator("body")).toHaveAttribute("data-client-role", role);
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator(".rock")).toBeVisible();
}

async function visibleRockPoint(page) {
  return page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, innerHeight);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
      throw new Error("Не найдена видимая точка камня");
    }

    const xRatios = [0.5, 0.35, 0.65, 0.2, 0.8];
    const yRatios = [0.5, 0.35, 0.65, 0.2, 0.8];
    for (const yRatio of yRatios) {
      for (const xRatio of xRatios) {
        const x = left + width * xRatio;
        const y = top + height * yRatio;
        const hit = document.elementFromPoint(x, y);
        if (hit === rock || rock.contains(hit)) {
          return { x, y };
        }
      }
    }
    throw new Error("Не найдена видимая точка камня");
  });
}

async function scrollToRock(page) {
  await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const targetY =
      window.scrollY + rect.top + rect.height / 2 - window.innerHeight * 0.45;
    window.scrollTo(0, Math.max(0, targetY));
  });
  await expect
    .poll(async () => {
      try {
        await visibleRockPoint(page);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(true);
}

test("production build keeps slim UI and multiplayer behavior", async ({
  browser,
  page,
}) => {
  const firstAudioRequests = [];
  trackAudioRequests(page, firstAudioRequests);

  await page.goto("/");
  await waitForProductionRuntime(page, "master");
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  await expect(page.locator(".settings-toggle")).toHaveCount(0);
  await expect(page.locator(".hint")).toHaveCount(0);
  await expect(page.getByTestId("share-session-top")).toBeVisible();
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi")),
  ).toBe(false);
  expect(firstAudioRequests).toEqual([]);

  const masterCursorImage = await page.locator(".hand-cursor").evaluate(
    (element) => getComputedStyle(element).backgroundImage,
  );
  expect(decodeURIComponent(masterCursorImage)).toContain("cursor-grab");

  const roomUrl = page.url();
  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  const secondAudioRequests = [];
  trackAudioRequests(second, secondAudioRequests);

  try {
    await second.goto(roomUrl);
    await waitForProductionRuntime(second, "slave");
    await expect(second.locator(".settings-panel")).toHaveCount(0);
    expect(
      await second.evaluate(() =>
        Object.hasOwn(window, "__sisyphusTestApi"),
      ),
    ).toBe(false);

    const slaveCursorImage = await second.locator(".hand-cursor").evaluate(
      (element) => getComputedStyle(element).backgroundImage,
    );
    expect(decodeURIComponent(slaveCursorImage)).toContain("hand_open");

    await scrollToRock(page);
    await scrollToRock(second);
    const masterTopBefore = await page.locator(".rock").evaluate(
      (rock) => rock.getBoundingClientRect().top,
    );
    const slavePoint = await visibleRockPoint(second);
    await second.mouse.move(slavePoint.x, slavePoint.y);
    await second.mouse.down();
    await expect(second.locator(".rock")).toHaveClass(/is-dragging/);
    await expect(
      page.locator(".hand-cursor.is-remote.is-visible"),
    ).toHaveCount(1);

    await second.mouse.move(
      slavePoint.x,
      Math.max(24, slavePoint.y - 140),
      { steps: 12 },
    );
    await expect
      .poll(() =>
        page.locator(".rock").evaluate(
          (rock) => rock.getBoundingClientRect().top,
        ),
      )
      .toBeLessThan(masterTopBefore - 20);
    await second.mouse.up();

    const allAudioRequests = [...firstAudioRequests, ...secondAudioRequests];
    expect(
      allAudioRequests.some((url) => url.includes("Дождь")),
    ).toBe(false);
    expect(
      allAudioRequests.filter((url) => url.includes("Кандалы")).length,
    ).toBeLessThanOrEqual(1);
  } finally {
    await second.mouse.up().catch(() => {});
    await secondContext.close();
  }
});
