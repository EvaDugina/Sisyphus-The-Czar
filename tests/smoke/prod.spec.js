const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";
const SOURCE_HAND = "#root > .world > .hand-cursor:not(.is-remote)";

async function waitForProductionRuntime(page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-client-role", "master");
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator(SOURCE_ROCK)).toBeVisible();
}

test("production / serves the Fold application", async ({ page }) => {
  await page.goto("/");
  await waitForProductionRuntime(page);
  await expect(page.locator("#root > .world")).toHaveCount(1);
  await expect(page.locator("[data-fold-layer]")).toHaveAttribute(
    "data-fold-ready",
    "true",
  );
  await expect(page.locator('[data-fold-zone="top"]')).toHaveCount(1);
  const zeroAngleFold = await page.evaluate(() => {
    const layer = document.querySelector("[data-fold-layer]");
    const surface = layer.querySelector(".fold-surface");
    const zone = layer.querySelector(".fold-zone");
    const previousAngle = layer.dataset.foldAngle;
    const previousAngleStyle = layer.style.getPropertyValue("--fold-angle");
    layer.dataset.foldAngle = "0";
    layer.style.setProperty("--fold-angle", "0deg");
    const transform = new DOMMatrix(getComputedStyle(surface).transform);
    const result = {
      angle: layer.dataset.foldAngle,
      mirrorCount: layer.querySelectorAll(".fold-track > .world").length,
      mirrorFrame: Number(layer.dataset.mirrorFrame || 0),
      scaleY: transform.m22,
      zoneBackground: getComputedStyle(zone).backgroundColor,
    };
    layer.dataset.foldAngle = previousAngle;
    layer.style.setProperty("--fold-angle", previousAngleStyle);
    return result;
  });
  expect(zeroAngleFold).toEqual({
    angle: "0",
    mirrorCount: 1,
    mirrorFrame: expect.any(Number),
    scaleY: 0,
    zoneBackground: "rgba(0, 0, 0, 0)",
  });
  expect(zeroAngleFold.mirrorFrame).toBeGreaterThan(0);
  await expect(page.locator(SOURCE_ROCK)).toHaveClass(/is-preclick-hop/);
  await expect(page.locator(".settings-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Начать сначала" })).toBeVisible();
});

test("production legacy drafts маршруты возвращают 404", async ({ request }) => {
  for (const path of ["/drafts", "/drafts/", "/drafts/assets/missing.js"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
  }
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

async function moveToVisibleRock(page) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let point;
    try {
      point = await visibleRockPoint(page);
    } catch {
      await scrollToRock(page);
      continue;
    }
    await page.mouse.move(point.x, point.y);
    const hitsRock = await page.locator(SOURCE_ROCK).evaluate(
      (rock, target) =>
        new Promise((resolve) => {
          requestAnimationFrame(() => {
            const hit = document.elementFromPoint(target.x, target.y);
            resolve(hit === rock || rock.contains(hit));
          });
        }),
      point,
    );
    if (hitsRock) {
      return point;
    }
  }
  throw new Error("Камень смещается быстрее, чем стабилизируется точка захвата");
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

test("production кнопка Начать сначала возвращает preclick", async ({ page }) => {
  await page.goto("/");
  await waitForProductionRuntime(page);

  const restartButton = page.getByRole("button", { name: "Начать сначала" });
  await expect(restartButton).toBeVisible();
  await expect(restartButton).toBeEnabled();
  await restartButton.focus();
  await expect(restartButton).toBeFocused();

  await page.evaluate(() => {
    document.body.classList.remove(
      "preclick-rock-guidance",
      "is-manual-scroll-disabled",
    );
    document.documentElement.classList.remove("is-manual-scroll-disabled");
    document.querySelector("#root > .world > .rock")
      ?.classList.remove("is-preclick-hop");
  });
  await expect(page.locator("body")).not.toHaveClass(/preclick-rock-guidance/);

  await restartButton.press("Enter");
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(page.locator("body")).toHaveClass(/is-manual-scroll-disabled/);
  await expect(page.locator(SOURCE_ROCK)).toHaveClass(/is-preclick-hop/);
});

test("production build creates one personal session per user, keeps a clean URL and keeps the hand visible", async ({
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
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(hand).toHaveClass(/is-visible/);
  await expect(hand).toHaveCSS("opacity", "1");

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  const secondSockets = [];
  const secondSocketMessages = [];
  second.on("websocket", (socket) => {
    secondSockets.push(socket.url());
    socket.on("framereceived", ({ payload }) => {
      try {
        secondSocketMessages.push(JSON.parse(String(payload)));
      } catch {
        // Двоичные и служебные кадры не участвуют в проверке handshake.
      }
    });
  });

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
    await expect(page.locator(SOURCE_ROCK)).toHaveAttribute(
      "src",
      /rock-03(?:-[A-Za-z0-9_-]+)?\.png/,
    );
    await expect(second.locator(SOURCE_ROCK)).toHaveAttribute(
      "src",
      /rock-03(?:-[A-Za-z0-9_-]+)?\.png/,
    );
    const firstTopBefore = await page.locator(SOURCE_ROCK).evaluate(
      (rock) => rock.getBoundingClientRect().top
    );
    const secondHand = second.locator(SOURCE_HAND);

    await expect(secondHand).toHaveClass(/is-visible/);
    await expect(secondHand).not.toHaveClass(/is-grabbing/);
    await expect(secondHand).toHaveCSS(
      "background-image",
      /cursor-grab-02(?:-[A-Za-z0-9_-]+)?\.png/,
    );

    const guardPoint = await moveToVisibleRock(second);
    await second.mouse.click(guardPoint.x, guardPoint.y);
    await expect(second.locator("body")).toHaveClass(/preclick-rock-guidance/);
    await expect(second.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);
    expect(
      secondSocketMessages.some(({ type }) => type === "control.granted"),
    ).toBe(false);

    const secondPoint = await moveToVisibleRock(second);
    await second.mouse.down();
    await expect(secondHand).toHaveClass(/is-grabbing/);
    await expect(secondHand).toHaveCSS(
      "background-image",
      /cursor-grabbing-02(?:-[A-Za-z0-9_-]+)?\.png/,
    );
    await expect
      .poll(() =>
        secondSocketMessages.some(({ type }) => type === "control.granted"),
      )
      .toBe(true);
    await expect(second.locator(SOURCE_ROCK)).toHaveClass(/is-dragging/);
    await second.mouse.move(secondPoint.x, Math.max(24, secondPoint.y - 140), {
      steps: 12,
    });
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
    await expect(secondHand).toHaveClass(/is-visible/);
  } finally {
    await second.mouse.up().catch(() => {});
    await secondContext.close();
  }
});
