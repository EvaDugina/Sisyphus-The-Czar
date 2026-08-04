const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";
const SOURCE_HAND = "#root > .world > .hand-cursor:not(.is-remote)";

async function waitForProductionRuntime(page) {
  await expect(page).toHaveURL(/\/(?:drafts\/)?$/);
  await expect(page.locator("body")).toHaveAttribute("data-client-role", "master");
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator(SOURCE_ROCK)).toBeVisible();
}

test("production /drafts/ serves the same Fold application", async ({ page }) => {
  await page.goto("/drafts/");
  await waitForProductionRuntime(page);
  await expect(page.locator("#root > .world")).toHaveCount(1);
  await expect(page.locator("[data-fold-layer]")).toHaveAttribute(
    "data-fold-ready",
    "true",
  );
  await expect(page.locator('[data-fold-zone="top"]')).toHaveCount(1);
  await expect(page.locator(".settings-panel")).toHaveCount(0);
});

async function visibleRockPoint(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
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

    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
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
  await page.locator(SOURCE_ROCK).evaluate((rock) => {
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

function sessionIdFromWebSocket(url) {
  return new URL(url).searchParams.get("session");
}

test("production build creates one personal session per user, keeps a clean URL and shows the hand only on the rock", async ({
  browser,
  page,
}) => {
  const firstSockets = [];
  page.on("websocket", (socket) => firstSockets.push(socket.url()));

  await page.goto("/");
  await waitForProductionRuntime(page);
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  await expect(page.locator(".settings-toggle")).toHaveCount(0);
  await expect(page.locator(".hint")).toHaveCount(0);
  await expect(page.getByTestId("share-session-top")).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi"))
  ).toBe(false);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  await expect.poll(() => firstSockets.length).toBeGreaterThan(0);

  const hand = page.locator(SOURCE_HAND);
  await expect(hand).not.toHaveClass(/is-visible/);
  await expect(hand).toHaveCSS("opacity", "0");

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  const secondSockets = [];
  second.on("websocket", (socket) => secondSockets.push(socket.url()));

  try {
    await second.goto("/");
    await waitForProductionRuntime(second);
    await expect(second.getByTestId("share-session-top")).toHaveCount(0);
    expect(new URL(second.url()).search).toBe("");
    await expect.poll(() => secondSockets.length).toBeGreaterThan(0);
    expect(sessionIdFromWebSocket(firstSockets.at(-1))).not.toBe(
      sessionIdFromWebSocket(secondSockets.at(-1))
    );

    await scrollToRock(page);
    await scrollToRock(second);
    const firstTopBefore = await page.locator(SOURCE_ROCK).evaluate(
      (rock) => rock.getBoundingClientRect().top
    );
    const secondPoint = await visibleRockPoint(second);
    const secondHand = second.locator(SOURCE_HAND);

    await second.mouse.move(secondPoint.x, secondPoint.y);
    await expect(secondHand).toHaveClass(/is-visible/);
    await expect(secondHand).not.toHaveClass(/is-grabbing/);
    expect(
      decodeURIComponent(
        await secondHand.evaluate(
          (element) => getComputedStyle(element).backgroundImage
        )
      )
    ).toContain("cursor-grab");

    await second.mouse.down();
    await expect(secondHand).toHaveClass(/is-grabbing/);
    expect(
      decodeURIComponent(
        await secondHand.evaluate(
          (element) => getComputedStyle(element).backgroundImage
        )
      )
    ).toContain("cursor-grabbing");
    await second.mouse.move(secondPoint.x, Math.max(24, secondPoint.y - 140), {
      steps: 12,
    });
    await expect(second.locator(SOURCE_ROCK)).toHaveClass(/is-dragging/);
    await expect(
      page.locator("#root > .world .hand-cursor.is-remote.is-visible"),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        page.locator(SOURCE_ROCK).evaluate(
          (rock) => rock.getBoundingClientRect().top
        )
      )
      .toBeCloseTo(firstTopBefore, 0);

    await second.mouse.up();
    await second.mouse.move(8, 8);
    await expect(secondHand).not.toHaveClass(/is-visible/);
  } finally {
    await second.mouse.up().catch(() => {});
    await secondContext.close();
  }
});
