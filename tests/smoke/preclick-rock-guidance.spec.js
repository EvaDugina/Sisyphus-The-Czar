const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";
const SOURCE_HAND = "#root > .world > .hand-cursor:not(.is-remote)";

async function visibleRockPoint(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, innerHeight);

    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const x = left + (right - left) * xRatio;
        const y = top + (bottom - top) * yRatio;
        if (document.elementFromPoint(x, y) === rock) {
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
    window.scrollTo(
      0,
      Math.max(
        0,
        window.scrollY + rect.top + rect.height / 2 - window.innerHeight * 0.45,
      ),
    );
  });
  await expect.poll(() => visibleRockPoint(page).then(() => true)).toBe(true);
}

function parallaxX(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) =>
    Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-parallax-x"),
    ),
  );
}

async function movePointerActively(page, { centerY, finalX, leftX, rightX }) {
  await page.evaluate(
    async ({ centerY: y, finalX: endX, leftX: minX, rightX: maxX }) => {
      const move = (x) => {
        window.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: x,
            clientY: y,
            isPrimary: true,
            pointerId: 1,
            pointerType: "mouse",
          }),
        );
      };
      for (let index = 0; index < 16; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 35));
        move(index % 2 === 0 ? minX : maxX);
      }
      move(endX);
    },
    { centerY, finalX, leftX, rightX },
  );
}

function handPosition(page) {
  return page.locator(SOURCE_HAND).evaluate((hand) => {
    const style = getComputedStyle(hand);
    return {
      x: Number.parseFloat(style.getPropertyValue("--cursor-x")),
      y: Number.parseFloat(style.getPropertyValue("--cursor-y")),
    };
  });
}

function rockSize(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

function rockCenter(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    const offsetX = Number.parseFloat(
      style.getPropertyValue("--rock-parallax-x"),
    ) || 0;
    const offsetY = Number.parseFloat(
      style.getPropertyValue("--rock-parallax-y"),
    ) || 0;
    return {
      x: rect.left + rect.width / 2 - offsetX,
      y: rect.top + rect.height / 2 - offsetY,
    };
  });
}

async function setSetting(page, name, value) {
  await page.locator(`[data-setting-input][name="${name}"]`).evaluate(
    (input, nextValue) => {
      input.value = String(nextValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value,
  );
}

test("штатный runtime включает parallax до первого клика и постоянную руку", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 2400, height: 1400 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator("body")).toHaveClass(
    /preclick-rock-guidance/,
  );

  const rock = page.locator(SOURCE_ROCK);
  const hand = page.locator(SOURCE_HAND);
  const initialScrollY = await page.evaluate(() => window.scrollY);
  await expect(page.locator("html")).toHaveClass(/is-manual-scroll-disabled/);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialScrollY);
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await expect(hand).toHaveClass(/is-visible/);

  await page.mouse.move(24, 24);
  await expect.poll(() => parallaxX(page)).toBe(0);
  await expect(hand).toHaveClass(/is-visible/);

  await page.mouse.down();
  await expect(hand).toHaveClass(/is-grabbing/);
  expect(
    decodeURIComponent(
      await hand.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ),
  ).toContain("cursor-grabbing");
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);
  expect(
    decodeURIComponent(
      await hand.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ),
  ).toContain("cursor-grab");
  await expect(rock).toHaveClass(/is-preclick-parallax/);

  await scrollToRock(page);
  const centerBeforeReload = await rockCenter(page);
  await page.mouse.move(centerBeforeReload.x + 600, centerBeforeReload.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(7.2, 0);

  await page.reload();
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await expect.poll(() => parallaxX(page)).toBe(0);

  await scrollToRock(page);
  const center = await rockCenter(page);
  const halfRadius = 600;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.move(center.x - halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(-7.2, 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const sizeAtLeft = await rockSize(page);

  await page.mouse.move(center.x + halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(7.2, 0);
  await expect
    .poll(async () => {
      const sizeAtRight = await rockSize(page);
      return Math.max(
        Math.abs(sizeAtRight.width - sizeAtLeft.width),
        Math.abs(sizeAtRight.height - sizeAtLeft.height),
      );
    })
    .toBeLessThan(0.01);

  await page.mouse.move(center.x + 120, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(12.96, 0);
  await page.mouse.move(center.x, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(14.4, 0);
  await page.mouse.move(center.x + halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(7.2, 0);

  const outsideX = 24;
  const outsideY = 24;
  await page.mouse.move(outsideX, outsideY);
  expect(Math.abs(await parallaxX(page))).toBeGreaterThan(0);
  await expect
    .poll(async () => Math.abs(await parallaxX(page)), { timeout: 1000 })
    .toBeLessThan(7.2);
  const handOutside = await handPosition(page);
  expect(handOutside.x).toBeCloseTo(outsideX, 3);
  expect(handOutside.y).toBeCloseTo(outsideY, 3);
  await expect.poll(async () => Math.abs(await parallaxX(page)), {
    timeout: 1000,
  }).toBeCloseTo(0, 3);

  await page.mouse.move(center.x + halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(7.2, 0);
  await page.screenshot({
    path: testInfo.outputPath("before-first-click.png"),
  });

  const point = await visibleRockPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(rock).not.toHaveClass(/is-preclick-parallax/);
  await expect(hand).toHaveClass(/is-grabbing/);
  await expect.poll(() => parallaxX(page)).toBe(0);
  const scrollAtActivation = await page.evaluate(() => window.scrollY);
  await page.mouse.move(point.x, Math.max(50, point.y - 350), { steps: 8 });
  if (scrollAtActivation > 0) {
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeLessThan(scrollAtActivation);
  } else {
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  }

  await page.mouse.up();
  await page.mouse.move(24, 24);
  await expect(hand).toHaveClass(/is-visible/);
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await expect(rock).not.toHaveClass(/is-preclick-parallax/);

  await page.mouse.down();
  await expect(hand).toHaveClass(/is-grabbing/);
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await page.screenshot({
    path: testInfo.outputPath("after-first-click.png"),
  });
});

test("активное движение меняет parallax по двум временным графикам и сбрасывается при выходе", async ({
  page,
}) => {
  let sentSettingsPayload = null;
  let rootSentSettingsPayload = null;
  let rootSnapshot = null;
  let captureRootSnapshot = false;
  let settingsSocketSessionId = "";
  let rootSocketSessionId = "";
  page.on("websocket", (socket) => {
    const socketSessionId = new URL(socket.url()).searchParams.get("session") || "";
    if (captureRootSnapshot) {
      rootSocketSessionId = socketSessionId;
    } else {
      settingsSocketSessionId = socketSessionId;
    }
    socket.on("framesent", (event) => {
      try {
        const message = JSON.parse(event.payload);
        if (message.type === "settings.update") {
          if (captureRootSnapshot) {
            rootSentSettingsPayload = message.payload;
          } else {
            sentSettingsPayload = message.payload;
          }
        }
      } catch {
        /* Бинарные и служебные кадры не относятся к настройкам. */
      }
    });
    socket.on("framereceived", (event) => {
      try {
        const message = JSON.parse(event.payload);
        if (
          captureRootSnapshot &&
          !rootSnapshot &&
          message.type === "session.snapshot"
        ) {
          rootSnapshot = message.payload;
        }
      } catch {
        /* Бинарные и служебные кадры не относятся к snapshot. */
      }
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await page.goto("/settings/");
  await expect(page.locator(".settings-panel")).toHaveAttribute(
    "aria-hidden",
    "false",
  );
  await expect(page.locator("[data-session-status]")).toContainText(
    "В сессии",
  );
  const settingsSessionId = await page.evaluate(() =>
    sessionStorage.getItem("sisyphus-room-session-id"),
  );
  expect(settingsSessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(settingsSocketSessionId).toBe(settingsSessionId);

  const maxCurve = page.locator(
    '[data-cubic-bezier-control]:has(input[name="preclickParallaxMaxOffsetEasing"])',
  );
  const delayCurve = page.locator(
    '[data-cubic-bezier-control]:has(input[name="preclickParallaxDelayEasing"])',
  );
  test.skip(
    (await maxCurve.count()) === 0,
    "Полный редактор графиков доступен только в debug UI",
  );
  await expect(maxCurve.locator(".bezier-graph-range")).toContainText(
    "0–30 s",
  );
  await expect(delayCurve.locator(".bezier-graph-range")).toContainText(
    "0–30 s",
  );

  await setSetting(page, "preclickParallaxMaxOffsetVw", 20);
  await setSetting(page, "preclickParallaxEndMaxOffsetVw", 2);
  await setSetting(page, "preclickParallaxActivationRadiusVw", 40);
  await setSetting(page, "preclickParallaxStartDelayMs", 0);
  await setSetting(page, "preclickParallaxEndDelayMs", 1000);
  await setSetting(page, "preclickParallaxTransitionDurationSeconds", 1);
  await setSetting(
    page,
    "preclickParallaxMaxOffsetEasing",
    "cubic-bezier(0, 0, 1, 1)",
  );
  await setSetting(
    page,
    "preclickParallaxDelayEasing",
    "cubic-bezier(0, 0, 1, 1)",
  );
  await setSetting(page, "preclickParallaxReturnDurationMs", 0);
  await expect(
    page.locator('[data-setting-input][name="preclickParallaxMaxOffsetVw"]'),
  ).toHaveValue("20");

  await expect(maxCurve.locator(".bezier-graph-range")).toContainText(
    "0–1 s",
  );
  await expect(delayCurve.locator(".bezier-graph-range")).toContainText(
    "0–1 s",
  );
  await page
    .getByRole("button", {
      name: "Сохранить версию и настройки комнаты",
    })
    .click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Версия и настройки комнаты сохранены",
  );
  expect(sentSettingsPayload?.settings?.preclickParallaxMaxOffsetVw).toBe(20);
  const selectedVersionId = await page.evaluate(() => {
    const stored = JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-versions-v1") || "{}",
    );
    return stored.selectedId;
  });
  expect(selectedVersionId).toBeTruthy();
  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(
    `[data-production-preset-select="${selectedVersionId}"]`,
  );
  await expect(productionButton).toBeEnabled();
  await productionButton.click();
  await expect(
    page.locator(
      `.settings-version-option.is-production [data-production-preset-select="${selectedVersionId}"]`,
    ),
  ).toBeVisible();
  captureRootSnapshot = true;
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(page.locator("[data-session-status]")).toContainText(
    "В сессии",
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("sisyphus-room-session-id"),
    ),
  ).toBe(settingsSessionId);
  expect(rootSocketSessionId).toBe(settingsSessionId);
  await expect
    .poll(() => rootSnapshot?.roomSettings?.preclickParallaxMaxOffsetVw)
    .toBe(20);
  expect(rootSentSettingsPayload).toBeNull();

  await scrollToRock(page);
  const center = await rockCenter(page);
  const sampleX = center.x + 320;
  await page.mouse.move(20, 20);
  await page.mouse.move(sampleX, center.y);
  const initialOffset = Math.abs(await parallaxX(page));
  expect(initialOffset).toBeGreaterThan(120);

  await movePointerActively(page, {
    centerY: center.y,
    finalX: sampleX,
    leftX: center.x - 250,
    rightX: center.x + 250,
  });
  const progressedOffset = Math.abs(await parallaxX(page));
  expect(progressedOffset).toBeGreaterThan(0);
  expect(progressedOffset).toBeLessThan(initialOffset * 0.8);

  await page.waitForTimeout(350);
  expect(Math.abs(await parallaxX(page))).toBeCloseTo(progressedOffset, 3);

  await page.mouse.move(20, 20);
  await expect.poll(() => parallaxX(page)).toBe(0);
  await page.mouse.move(sampleX, center.y);
  const resetOffset = Math.abs(await parallaxX(page));
  expect(resetOffset).toBeCloseTo(initialOffset, 0);
});
