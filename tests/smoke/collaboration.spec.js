const { test, expect } = require("@playwright/test");

async function setRange(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setField(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setCheckbox(page, name, checked) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.checked = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, checked);
}

async function openControlGroup(page, summaryText) {
  const opened = await page.evaluate((text) => {
    const summary = Array.from(
      document.querySelectorAll(".settings-panel .control-group > summary")
    ).find((element) => element.textContent.trim() === text);
    if (!summary) {
      return false;
    }
    const group = summary.closest(".control-group");
    group.open = true;
    return group.open;
  }, summaryText);
  expect(opened).toBe(true);
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

async function scrollToRock(page) {
  await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const targetY = window.scrollY + rect.top - window.innerHeight * 0.45;
    window.scrollTo(0, Math.max(0, targetY));
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
      await expect(status).toContainText(/держите|тащите вместе/, {
        timeout: 1500,
      });
      return point;
    } catch (error) {
      lastError = error;
      await page.mouse.up();
    }
  }
  throw lastError;
}

async function waitForAutomaticFirstFall(page) {
  await expect(page.locator("body")).toHaveClass(
    /state-(fallingToBottom|play)/,
    { timeout: 3000 },
  );
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
}

async function trailHasVisiblePixels(page) {
  return page.locator(".trail").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return data.some((channel, index) => index % 4 === 3 && channel > 0);
  });
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

  await waitForAutomaticFirstFall(page);
  await expect(page.locator("body")).toHaveClass(/state-play/, {
    timeout: 20_000,
  });
  await scrollToRock(page);
  await grabVisibleRock(page);
  await expect(page.getByTestId("session-status")).toContainText("держите");
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
  await expect(page).toHaveTitle("ЦАРИ ДОЖДЯ");
  await expect(page.locator(".title")).toHaveText("ЦАРИ ДОЖДЯ");
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  const introState = await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    return {
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      centerDelta: {
        x: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
        y: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
      },
      pointerEvents: getComputedStyle(rock).pointerEvents,
      scale: Number.parseFloat(style.getPropertyValue("--rock-scale")),
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  expect(introState.centerDelta.x).toBeLessThan(2);
  expect(introState.centerDelta.y).toBeLessThan(2);
  expect(introState.pointerEvents).toBe("none");
  expect(introState.scale).toBeGreaterThan(1);
  expect(introState.scrollable).toBe(true);
  await page.mouse.move(introState.point.x, introState.point.y);
  await expect(page.locator(".hand-cursor")).not.toHaveClass(/is-visible/);
  await page.locator(".rock").evaluate((rock) => {
    rock.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: "mouse",
      })
    );
  });
  await expect(page.locator(".rock")).not.toHaveClass(/is-dragging/);
  await expect.poll(() => documentRequests.length).toBeGreaterThanOrEqual(2);
  expect(documentRequests[0]).toBe("/");
  expect(documentRequests.at(-1)).toMatch(/^\/\?session=[A-Za-z0-9_-]{22}$/);

  await page.locator(".settings-toggle").click();
  await expect(page.getByTestId("share-session")).toHaveCount(0);
  await expect(
    page.locator(".settings-panel .control-group[open]")
  ).toHaveCount(0);
  await openControlGroup(page, "Физика");
  await setRange(page, "gravity", 10);
  await setField(page, "rockScaleEasing", "cubic-bezier(0, 0, 1, 1)");
  await setField(page, "rockMinWidthVw", 10);
  await setField(page, "rockMaxWidthVw", 40);
  await expect(page.locator('[name="rockScaleEasing"]')).toHaveValue(
    "cubic-bezier(0, 0, 1, 1)"
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("10");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("40");
  await page.locator(".settings-toggle").click();

  await waitForAutomaticFirstFall(page);
  await expect(page.getByTestId("rock-imprint")).toHaveClass(/is-visible/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect(page.locator(".rock")).not.toHaveClass(/is-dragging/);
  const scaleSamples = await page.evaluate(() => {
    const rock = document.querySelector(".rock");
    const sample = (y) => {
      setPosition(bounds.maxX / 2, y);
      const rect = rock.getBoundingClientRect();
      return {
        scale: Number.parseFloat(
          getComputedStyle(rock).getPropertyValue("--rock-scale")
        ),
        width: rect.width,
      };
    };
    const imprint = document.querySelector(".rock-imprint");
    const imprintY = Number.parseFloat(
      getComputedStyle(imprint).getPropertyValue("--imprint-y")
    );
    const imprintScale = Number.parseFloat(
      getComputedStyle(imprint).getPropertyValue("--imprint-scale")
    );
    setPosition(bounds.maxX / 2, imprintY);
    const rockScaleAtImprint = Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-scale")
    );
    const viewportWidth = window.innerWidth;
    const imprintRect = imprint.getBoundingClientRect();
    const imprintBaseWidth = imprint.offsetWidth;
    setPosition(bounds.maxX / 2, 0);
    return {
      bottom: sample(bounds.maxY),
      imprintBaseWidth,
      imprintRenderedWidth: imprintRect.width,
      imprintScale,
      middle: sample(bounds.maxY / 2),
      rockScaleAtImprint,
      top: sample(0),
      viewportWidth,
    };
  });
  expect(Math.abs(scaleSamples.top.width - scaleSamples.viewportWidth * 0.4))
    .toBeLessThan(1);
  expect(
    Math.abs(scaleSamples.middle.width - scaleSamples.viewportWidth * 0.25)
  ).toBeLessThan(1);
  expect(
    Math.abs(scaleSamples.bottom.width - scaleSamples.viewportWidth * 0.1)
  ).toBeLessThan(1);
  expect(scaleSamples.imprintScale).toBeCloseTo(
    scaleSamples.rockScaleAtImprint,
    2
  );
  expect(
    scaleSamples.imprintRenderedWidth / scaleSamples.imprintBaseWidth
  ).toBeCloseTo(scaleSamples.imprintScale, 1);
  await expect
    .poll(() => page.evaluate(() => motion.firstFallTriggered))
    .toBe(true);
  await expect(page.locator("body")).not.toHaveClass(/state-intro/);
  await expect(page.locator("body")).toHaveClass(/state-play/, {
    timeout: 20_000,
  });
  await scrollToRock(page);

  await expect
    .poll(() => page.evaluate(() => trail.points.length))
    .toBeGreaterThan(0);
  await expect.poll(() => trailHasVisiblePixels(page)).toBe(false);
  await page.locator(".settings-toggle").click();
  await openControlGroup(page, "След");
  const trailEnabled = page.locator('[name="trailEnabled"]');
  await expect(trailEnabled).not.toBeChecked();
  await trailEnabled.check();
  await expect
    .poll(() => trailHasVisiblePixels(page))
    .toBe(true);
  await page.locator(".settings-toggle").click();

  await expect(page.locator(".rock")).toHaveCSS("pointer-events", "auto");
  const playablePoint = await visibleRockPoint(page);
  await page.mouse.move(playablePoint.x, playablePoint.y);
  await expect(page.locator(".hand-cursor")).toHaveClass(/is-visible/);
  await page.mouse.down();
  await expect(page.getByTestId("session-status")).toContainText("держите");
  await page.mouse.up();

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

test("каноническое падение не зависит от высоты viewport", async ({ browser }) => {
  async function profileForHeight(height) {
    const context = await browser.newContext({
      viewport: { width: 1280, height },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    const profile = await page.evaluate(() => {
      const initial = initialSharedState();
      const state = SharedPhysics.sanitizeState(initial);
      const physics = SharedPhysics.sanitizePhysics({
        gravity: 1,
        bounce: 0,
        turbulence: 0,
      });
      SharedPhysics.beginFirstFall(state, physics, 280, 120);
      for (let index = 0; index < 90; index += 1) {
        SharedPhysics.stepState(state, physics, SharedPhysics.FIXED_STEP_SECONDS);
      }
      updateBounds();
      return {
        sceneMaxY: bounds.maxY,
        initial,
        after: {
          phase: state.phase,
          x: state.x,
          y: state.y,
          vx: state.vx,
          vy: state.vy,
        },
      };
    });
    await context.close();
    return profile;
  }

  const low = await profileForHeight(600);
  const high = await profileForHeight(900);
  expect(low.sceneMaxY).not.toBeCloseTo(high.sceneMaxY, 0);
  expect(low.initial.y).toBeCloseTo(high.initial.y, 6);
  expect(low.after.y).toBeCloseTo(high.after.y, 6);
  expect(low.after.vy).toBeCloseTo(high.after.vy, 6);
  expect(low.after.phase).toBe(high.after.phase);
});

test("два браузера видят один камень и поднимают его вместе", async ({ browser }) => {
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
  const sceneProjection = await first.evaluate(() => {
    updateBounds();
    const bottom = canonicalToLocal(SharedPhysics.WORLD_WIDTH / 2, SharedPhysics.WORLD_HEIGHT);
    const originalMaxY = bounds.maxY;
    const rock = document.querySelector(".rock");
    const rockRect = rock.getBoundingClientRect();
    const rockScale = Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-scale")
    );
    return {
      maxY: originalMaxY,
      bottomY: bottom.y,
      worldHeight: SharedPhysics.WORLD_HEIGHT,
      renderedHeight: document.querySelector(".world").offsetHeight,
      viewportHeight: window.innerHeight,
      rockBaseWidth: rock.offsetWidth,
      rockRenderedWidth: rockRect.width,
      rockHeight: rock.offsetHeight,
      rockScale,
    };
  });
  expect(sceneProjection.renderedHeight / sceneProjection.viewportHeight).toBeCloseTo(100, 0);
  expect(sceneProjection.rockBaseWidth).toBeCloseTo(sceneProjection.viewportHeight * 0.42, 0);
  expect(
    sceneProjection.rockRenderedWidth / sceneProjection.rockBaseWidth
  ).toBeCloseTo(sceneProjection.rockScale, 1);
  expect(sceneProjection.rockScale).toBeGreaterThan(1);
  expect(sceneProjection.maxY).toBeCloseTo(
    sceneProjection.viewportHeight * 100 - sceneProjection.rockHeight,
    1
  );
  expect(sceneProjection.bottomY).toBeCloseTo(sceneProjection.maxY, 1);
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
  await expect(
    first.locator(".settings-panel .control-group[open]")
  ).toHaveCount(0);
  await openControlGroup(first, "След");
  const trailEnabled = first.locator('[name="trailEnabled"]');
  const trailLength = first.locator('[name="trailMaxPoints"]');
  const trailUnlimited = first.locator('[name="trailUnlimited"]');
  await expect(trailEnabled).not.toBeChecked();
  await setCheckbox(first, "trailEnabled", true);
  await expect(trailEnabled).toBeChecked();
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
          localStorage.getItem("sisyphus-czar-settings-v5") || "{}"
        );
        return stored.trailUnlimited;
      })
    )
    .toBe(true);
  await openControlGroup(first, "Дождь");
  const firstRain = first.getByTestId("weather-rain");
  await setRange(first, "rainStrength", 1.25);
  await setField(first, "rainBlendMode", "screen");
  await setField(first, "rainBlurBlendMode", "overlay");
  await setRange(first, "rainBlurPx", 18);
  await setRange(first, "rainBlurOpacity", 0.3);
  await setRange(first, "rainBlurSaturation", 1.25);
  await setField(first, "rainEnterEasing", "cubic-bezier(0.12, 0.8, 0.2, 1)");
  await setField(first, "rainExitEasing", "cubic-bezier(0.7, 0, 0.3, 1)");
  await setField(first, "rainEnterMs", 650);
  await setField(first, "rainExitMs", 700);
  await setField(first, "rainZIndex", 9);
  await expect(first.locator('[data-output="rainStrength"]')).toHaveText("125%");
  await expect(first.locator('[data-output="rainBackgroundBlurSteps"]')).toHaveText("3");
  await expect(first.locator('[data-output="rainBlurPx"]')).toHaveText("18 px");
  await expect(first.locator('[data-output="rainBlurOpacity"]')).toHaveText("30%");
  await expect(first.locator('[data-output="rainBlurSaturation"]')).toHaveText("125%");
  await expect(first.locator('[data-output="rainEnterMs"]')).toHaveText("650");
  await expect(first.locator('[data-output="rainExitMs"]')).toHaveText("700");
  await expect(first.locator('[data-output="rainZIndex"]')).toHaveText("9");
  await expect(first.locator('[name="rainBlendMode"]')).toHaveValue("screen");
  await expect(first.locator('[name="rainBlurBlendMode"]')).toHaveValue("overlay");
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v5") || "{}"
        );
        return {
          rainEnterEasing: stored.rainEnterEasing,
          rainEnterMs: stored.rainEnterMs,
          rainExitEasing: stored.rainExitEasing,
          rainExitMs: stored.rainExitMs,
          rainBlendMode: stored.rainBlendMode,
          rainBackgroundBlurSteps: stored.rainBackgroundBlurSteps,
          rainBlurBlendMode: stored.rainBlurBlendMode,
          rainBlurOpacity: stored.rainBlurOpacity,
          rainBlurPx: stored.rainBlurPx,
          rainBlurSaturation: stored.rainBlurSaturation,
          rainStrength: stored.rainStrength,
          rainZIndex: stored.rainZIndex,
        };
      })
    )
    .toEqual({
      rainEnterEasing: "cubic-bezier(0.12, 0.8, 0.2, 1)",
      rainEnterMs: 650,
      rainExitEasing: "cubic-bezier(0.7, 0, 0.3, 1)",
      rainExitMs: 700,
      rainBlendMode: "screen",
      rainBackgroundBlurSteps: 3,
      rainBlurBlendMode: "overlay",
      rainBlurOpacity: 0.3,
      rainBlurPx: 18,
      rainBlurSaturation: 1.25,
      rainStrength: 1.25,
      rainZIndex: 9,
    });
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const layerStyle = getComputedStyle(layer);
        const canvas = layer.querySelector(".weather-rain__canvas");
        const fallbackCanvas = layer.querySelector(".weather-rain__canvas--fallback");
        const blurStyle = getComputedStyle(
          layer.querySelector(".weather-rain__blur")
        );
        const canvasStyle = getComputedStyle(canvas);
        const fallbackStyle = getComputedStyle(fallbackCanvas);
        return {
          enterDuration: layerStyle
            .getPropertyValue("--rain-enter-duration")
            .trim(),
          enterEasing: layerStyle
            .getPropertyValue("--rain-enter-easing")
            .trim(),
          exitDuration: layerStyle
            .getPropertyValue("--rain-exit-duration")
            .trim(),
          exitEasing: layerStyle
            .getPropertyValue("--rain-exit-easing")
            .trim(),
          hasBlurLayer: Boolean(layer.querySelector(".weather-rain__blur")),
          blurDisplay: getComputedStyle(
            layer.querySelector(".weather-rain__blur")
          ).display,
          blurBlendMode: blurStyle.mixBlendMode,
          layerBlendMode: layerStyle.mixBlendMode,
          canvasBlendMode: canvasStyle.mixBlendMode,
          fallbackOpacity: fallbackStyle.opacity,
          layerZIndex: layerStyle.zIndex,
          canvasZIndex: canvasStyle.zIndex,
        };
      })
    )
    .toEqual({
      enterDuration: "650ms",
      enterEasing: "cubic-bezier(0.12, 0.8, 0.2, 1)",
      exitDuration: "700ms",
      exitEasing: "cubic-bezier(0.7, 0, 0.3, 1)",
      hasBlurLayer: true,
      blurDisplay: "block",
      blurBlendMode: "overlay",
      layerBlendMode: "normal",
      canvasBlendMode: "screen",
      fallbackOpacity: "0",
      layerZIndex: "9",
      canvasZIndex: "10",
    });
  await expect(first.locator('[name="rainEnabled"]')).not.toBeChecked();
  await setCheckbox(first, "rainEnabled", true);
  await expect(firstRain).toHaveClass(/is-rain-visible/);
  await expect(firstRain.locator(".weather-rain__blur")).toHaveCount(1);
  const rainRenderToken = await first.evaluate(() => getRainRenderToken());
  await setRange(first, "rainBackgroundBlurSteps", 4);
  await expect(first.locator('[data-output="rainBackgroundBlurSteps"]')).toHaveText("4");
  await expect
    .poll(() => first.evaluate(() => getRainRenderToken()))
    .toBeGreaterThan(rainRenderToken);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v5") || "{}"
        );
        return stored.rainBackgroundBlurSteps;
      })
    )
    .toBe(4);
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const canvas = layer.querySelector(".weather-rain__canvas");
        const fallbackCanvas = layer.querySelector(".weather-rain__canvas--fallback");
        return {
          canvasZIndex: getComputedStyle(canvas).zIndex,
          fallbackOpacity: getComputedStyle(fallbackCanvas).opacity,
        };
      })
    )
    .toEqual({ canvasZIndex: "10", fallbackOpacity: "0" });
  await expect
    .poll(() =>
      firstRain.locator("canvas").evaluateAll((canvases) =>
        Math.max(
          ...canvases.map((canvas) =>
            Number.parseFloat(
              canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
            )
          )
        )
      )
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v5") || "{}"
        );
        return stored.rainEnabled;
      })
    )
    .toBe(true);
  await setCheckbox(first, "rainEnabled", false);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v5") || "{}"
        );
        return stored.rainEnabled;
      })
    )
    .toBe(false);
  await expect(firstRain).not.toHaveClass(/is-rain-/, { timeout: 2000 });
  await expect
    .poll(() =>
      firstRain.locator("canvas").evaluateAll((canvases) =>
        canvases.map((canvas) =>
          Number.parseFloat(
            canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
          )
        )
      )
    )
    .toEqual([0, 0]);
  await openControlGroup(first, "Физика");
  await setRange(first, "mass", 100);
  await setRange(first, "gravity", 10);
  await setRange(first, "handForce", 9);
  await setRange(first, "pointerInfluence", 1.8);
  await setRange(first, "bounce", 0.1);
  await setRange(first, "inertia", 80);
  await setRange(first, "groundFriction", 0.2);
  await setRange(first, "turbulence", 0.3);

  await second.goto("/");
  await expect(second).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  expect(second.url()).not.toBe(sharedUrl);
  await second.goto(sharedUrl);
  await second.locator(".settings-toggle").click();
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await openControlGroup(second, "Дождь");
  await expect(second.locator('[name="rainBlendMode"]')).toHaveValue("multiply");
  await expect(second.locator('[name="rainBlurBlendMode"]')).toHaveValue("normal");
  await setField(second, "rainExitMs", 700);
  await expect(second.locator('[data-output="rainExitMs"]')).toHaveText("700");
  await expect(first.getByTestId("session-status")).toContainText("2");
  const expectedPhysics = {
    mass: "100",
    gravity: "10",
    handForce: "9",
    pointerInfluence: "1.8",
    bounce: "0.1",
    inertia: "80",
    groundFriction: "0.2",
    turbulence: "0.3",
  };
  for (const [name, value] of Object.entries(expectedPhysics)) {
    await expect(second.locator(`[name="${name}"]`)).toHaveValue(value);
  }
  await expect(first.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(second.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);

  await second.evaluate(() => collab.socket.close(4100, "test_reconnect"));
  await expect(second.getByTestId("session-status")).toContainText("Переподключение");
  await setRange(second, "gravity", 9);
  await expect(first.locator('[name="gravity"]')).toHaveValue("9", {
    timeout: 5000,
  });

  await first.locator(".settings-toggle").click();
  await second.locator(".settings-toggle").click();
  const remoteCursor = second.getByTestId("remote-cursor");
  const introRock = await first.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    return {
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      pointerEvents: style.pointerEvents,
    };
  });
  if (introRock.pointerEvents === "none") {
    await first.mouse.move(introRock.point.x, introRock.point.y);
    await expect(first.locator(".hand-cursor")).not.toHaveClass(/is-visible/);
    await expect(second.locator(".hand-cursor.is-remote.is-visible")).toHaveCount(
      0
    );
  }

  await waitForAutomaticFirstFall(first);
  await expect(second.locator("body")).toHaveClass(
    /state-(fallingToBottom|play)/
  );
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect(first.locator(".rock")).not.toHaveClass(/is-dragging/);
  await expect(second.locator(".rock")).not.toHaveClass(/is-dragging/);
  const firstImprint = first.getByTestId("rock-imprint");
  const secondImprint = second.getByTestId("rock-imprint");
  await expect(firstImprint).toHaveClass(/is-visible/);
  await expect(secondImprint).toHaveClass(/is-visible/);
  const initialAlignment = await first.evaluate(() => ({
    expectedX:
      (window.innerWidth - document.querySelector(".rock").offsetWidth) / 2,
    expectedY:
      (window.innerHeight - document.querySelector(".rock").offsetHeight) / 2,
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
  expect(initialAlignment.imprintX).toBeCloseTo(initialAlignment.expectedX, 0);
  expect(initialAlignment.imprintY).toBeCloseTo(initialAlignment.expectedY, 0);

  const trailBuffer = await first.locator(".trail").evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    maxWidth: Math.ceil(window.innerWidth * 2),
    maxHeight: Math.ceil(window.innerHeight * 2),
    zIndex: getComputedStyle(canvas).zIndex,
  }));
  expect(trailBuffer.width).toBeLessThanOrEqual(trailBuffer.maxWidth);
  expect(trailBuffer.height).toBeLessThanOrEqual(trailBuffer.maxHeight);
  expect(trailBuffer.zIndex).toBe("0");

  await expect(first.locator("body")).toHaveClass(/state-play/, { timeout: 20_000 });
  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 20_000 });
  await scrollToRock(first);
  const enabledFirstPoint = await visibleRockPoint(first);
  await first.mouse.move(enabledFirstPoint.x, enabledFirstPoint.y);
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect(remoteCursor).not.toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("opacity", "1");
  await expect(remoteCursor).toHaveCSS(
    "background-image",
    /cursor-grab(?:-[A-Za-z0-9_-]+)?\.(?:png|webp)/
  );
  const cursorSize = await remoteCursor.evaluate((cursor) => {
    const rect = cursor.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  expect(cursorSize.width).toBeCloseTo(184, 1);
  expect(cursorSize.height).toBeCloseTo(244, 1);
  await first.mouse.move(0, 0);
  await expect(remoteCursor).toHaveCount(0);

  await scrollToRock(second);
  await expect.poll(() => trailHasVisiblePixels(second)).toBe(false);
  await second.locator(".settings-toggle").click();
  await openControlGroup(second, "След");
  await expect(second.locator('[name="trailEnabled"]')).not.toBeChecked();
  await setCheckbox(second, "trailEnabled", true);
  await expect
    .poll(() => trailHasVisiblePixels(second))
    .toBe(true);
  await second.locator(".settings-toggle").click();
  await scrollToRock(first);
  const firstHoldPoint = await grabVisibleRock(first);
  await expect(first.getByTestId("session-status")).toContainText("держите 1/2");
  const point = await grabVisibleRock(second);
  await expect(first.getByTestId("session-status")).toContainText("тащите вместе");
  await expect(second.getByTestId("session-status")).toContainText("тащите вместе");
  const localGrabbingCursor = second.locator(
    ".hand-cursor:not(.is-remote).is-visible"
  );
  await expect(localGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(localGrabbingCursor).toHaveCSS(
    "background-image",
    /cursor-partner-grabbing(?:-[A-Za-z0-9_-]+)?\.(?:png|webp)/
  );
  const grabbingCursorSize = await localGrabbingCursor.evaluate((cursor) => {
    const style = getComputedStyle(cursor);
    return { width: style.width, height: style.height };
  });
  expect(grabbingCursorSize).toEqual({ width: "184px", height: "244px" });
  await second.mouse.move(point.x, point.y - 40, {
    steps: 4,
  });
  await first.mouse.move(firstHoldPoint.x, firstHoldPoint.y - 40, {
    steps: 4,
  });
  await expect(first.getByTestId("session-status")).toContainText("тащите вместе");
  const remoteGrabbingCursor = first.locator(
    ".hand-cursor.is-remote.is-visible"
  );
  await expect(remoteGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(remoteGrabbingCursor).toHaveCSS(
    "background-image",
    /cursor-partner-grabbing(?:-[A-Za-z0-9_-]+)?\.(?:png|webp)/
  );
  await Promise.all([first, second].map((page) => page.evaluate(() => {
    const imprint = collab.imprint;
    if (!imprint) {
      throw new Error("Сервер не прислал отпечаток камня");
    }
    const local = canonicalToLocal(imprint.x, imprint.y);
    setPosition(local.x, local.y);
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    syncReturnTheme();
    sendShared("control.move", {
      x: imprint.x,
      y: imprint.y,
      vx: 0,
      vy: 0,
      pointer: {
        ...collab.localPointer,
        x: imprint.x,
        y: imprint.y,
        mode: "grabbing",
        visible: true,
      },
    });
  })));
  await expect(first.locator("body")).toHaveClass(/theme-light/);
  await expect(second.locator("body")).toHaveClass(/theme-light/);
  const secondRain = second.getByTestId("weather-rain");
  await expect(firstRain).toHaveClass(/is-rain-visible/);
  await expect(secondRain).toHaveClass(/is-rain-visible/);
  await expect
    .poll(() => second.evaluate(() => getLastRainRendererProfile()))
    .toEqual({
      theme: "light",
      raindropDiffuseLight: [0.42, 0.42, 0.44],
      raindropSpecularLight: [0.78, 0.78, 0.8],
    });
  const lightThemeRainRenderToken = await second.evaluate(() =>
    getRainRenderToken()
  );
  const rainLayering = await second.evaluate(() => {
    const rainLayer = document.querySelector(".weather-rain");
    const summit = document.querySelector(".summit");
    const title = document.querySelector(".title");
    const title2 = document.querySelector(".title2");
    return {
      followsSummit: Boolean(
        summit.compareDocumentPosition(rainLayer) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
      rainZIndex: Number.parseInt(getComputedStyle(rainLayer).zIndex, 10),
      titleZIndexes: [
        Number.parseInt(getComputedStyle(title).zIndex, 10),
        Number.parseInt(getComputedStyle(title2).zIndex, 10),
      ],
    };
  });
  expect(rainLayering.followsSummit).toBe(true);
  expect(rainLayering.titleZIndexes.every(
    (titleZIndex) => rainLayering.rainZIndex > titleZIndex
  )).toBe(true);
  await expect
    .poll(() =>
      secondRain.locator("canvas").evaluateAll((canvases) =>
        Math.max(
          ...canvases.map((canvas) =>
            Number.parseFloat(
              canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
            )
          )
        )
      )
    )
    .toBeGreaterThan(0);
  await expect(first.locator("body")).not.toHaveClass(/state-won/);
  await expect(second.locator("body")).not.toHaveClass(/state-won/);
  await expect(first.locator(".rock")).toHaveClass(/is-dragging/);
  await expect(second.locator(".rock")).toHaveClass(/is-dragging/);
  await expect(first.locator("body")).toHaveClass(/theme-light/);
  await expect(second.locator("body")).toHaveClass(/theme-light/);
  await expect(firstRain).toHaveClass(/is-rain-visible/);
  await expect(secondRain).toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas")).mixBlendMode
      )
    )
    .toBe("normal");
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await Promise.all([first, second].map((page) => page.evaluate(() => {
    const imprint = collab.imprint;
    const outsideYCandidate = imprint.y + imprint.toleranceY + 10;
    const outsideY =
      outsideYCandidate <= SharedPhysics.WORLD_HEIGHT
        ? outsideYCandidate
        : imprint.y - imprint.toleranceY - 10;
    const local = canonicalToLocal(imprint.x, outsideY);
    setPosition(local.x, local.y);
    motion.dragTargetX = local.x;
    motion.dragTargetY = local.y;
    syncReturnTheme();
    sendShared("control.move", {
      x: imprint.x,
      y: outsideY,
      vx: 0,
      vy: 0,
      pointer: {
        ...collab.localPointer,
        x: imprint.x,
        y: outsideY,
        mode: "grabbing",
        visible: true,
      },
    });
  })));
  await expect(firstRain).toHaveClass(/is-rain-hiding/);
  await expect(secondRain).toHaveClass(/is-rain-hiding/);
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const blur = layer.querySelector(".weather-rain__blur");
        const blurStyle = getComputedStyle(blur);
        const layerStyle = getComputedStyle(layer);
        return {
          hasBlurFilter: blurStyle.backdropFilter.includes("blur(18px)"),
          hasSaturationFilter:
            blurStyle.backdropFilter.includes("saturate(1.25)"),
          hasLinearGradient:
            blurStyle.backgroundImage.includes("linear-gradient"),
          hasRadialGradient:
            blurStyle.backgroundImage.includes("radial-gradient"),
          blurBlendMode: blurStyle.mixBlendMode,
          display: blurStyle.display,
          opacity: blurStyle.opacity,
          radius: layerStyle.getPropertyValue("--rain-blur-radius").trim(),
          saturation: layerStyle
            .getPropertyValue("--rain-blur-saturation")
            .trim(),
        };
      })
    )
    .toEqual({
      hasBlurFilter: true,
      hasSaturationFilter: true,
      hasLinearGradient: true,
      hasRadialGradient: false,
      blurBlendMode: "overlay",
      display: "block",
      opacity: "0.3",
      radius: "18px",
      saturation: "1.25",
    });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas")).mixBlendMode
      )
    )
    .toBe("multiply");
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await second.mouse.up();
  await first.mouse.up();
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect
    .poll(() => second.evaluate(() => getRainRenderToken()))
    .toBeGreaterThan(lightThemeRainRenderToken);
  await expect
    .poll(() => second.evaluate(() => getLastRainRendererProfile()))
    .toEqual({
      theme: "dark",
      raindropDiffuseLight: [0.55, 0.55, 0.55],
      raindropSpecularLight: [1, 1, 1],
    });
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas")).mixBlendMode
      )
    )
    .toBe("multiply");
  await expect
    .poll(() =>
      firstRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas")).mixBlendMode
      )
    )
    .toBe("screen");
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await expect(first.locator("body")).toHaveClass(/state-play/);
  await expect(second.locator("body")).toHaveClass(/state-play/);
  const releaseState = await first.locator(".rock").evaluate((rock) => ({
    maxY: bounds.maxY,
    y: Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y")),
  }));
  if (releaseState.y >= releaseState.maxY - 1) {
    expect(releaseState.y).toBeGreaterThanOrEqual(releaseState.maxY - 1);
  } else {
    await expect
      .poll(() =>
        first.locator(".rock").evaluate((rock) =>
          Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
        )
      )
      .toBeGreaterThan(releaseState.y);
  }
  await expect(firstRain).not.toHaveClass(/is-rain-hiding/, { timeout: 1800 });
  await expect(secondRain).not.toHaveClass(/is-rain-hiding/, { timeout: 3500 });
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      secondRain.locator("canvas").evaluateAll((canvases) =>
        canvases.map((canvas) =>
          Number.parseFloat(
            canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
          )
        )
      )
    )
    .toEqual([0, 0]);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) => {
        const style = getComputedStyle(layer);
        return {
          opacity: style.opacity,
          visibility: style.visibility,
        };
      })
    )
    .toEqual({ opacity: "0", visibility: "hidden" });
  await setCheckbox(second, "rainEnabled", true);
  await expect(secondRain).toHaveClass(/is-rain-visible/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) => {
        const canvas = layer.querySelector(".weather-rain__canvas--fx");
        return {
          canvasBlendMode: getComputedStyle(canvas).mixBlendMode,
          layerBlendMode: getComputedStyle(layer).mixBlendMode,
        };
      })
    )
    .toEqual({
      canvasBlendMode: "multiply",
      layerBlendMode: "normal",
    });
  await second.evaluate(() => {
    const style = document.createElement("style");
    style.dataset.testRainBlendOverride = "true";
    style.textContent = ".weather-rain__canvas--fx { mix-blend-mode: screen; }";
    document.head.append(style);
  });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(
          layer.querySelector(".weather-rain__canvas--fx")
        ).mixBlendMode
      )
    )
    .toBe("screen");
  await second.evaluate(() => {
    document.querySelector("[data-test-rain-blend-override]")?.remove();
  });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(
          layer.querySelector(".weather-rain__canvas--fx")
        ).mixBlendMode
      )
    )
    .toBe("multiply");
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await expect
    .poll(() =>
      secondRain.locator(".weather-rain__canvas--fx").evaluate((canvas) =>
        Number.parseFloat(
          canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
        )
      )
    )
    .toBeGreaterThan(0);
  await setCheckbox(second, "rainEnabled", false);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/, { timeout: 2000 });

  await first.locator(".settings-toggle").click();
  await first.getByTestId("restart-session").click();
  const firstRestartState = await first.evaluate(() => ({
    bodyState: document.body.className,
    firstFallTriggered: motion.firstFallTriggered,
    htmlState: document.documentElement.className,
    imprintVisible: document
      .querySelector(".rock-imprint")
      .classList.contains("is-visible"),
    introFallTimerActive: motion.introFallTimerId !== null,
    pointerEvents: getComputedStyle(document.querySelector(".rock"))
      .pointerEvents,
    rainState: document.querySelector(".weather-rain").className,
    scrollY: window.scrollY,
    trailPoints: trail.points.length,
  }));
  expect(firstRestartState.bodyState).toContain("state-intro");
  expect(firstRestartState).toMatchObject({
    firstFallTriggered: false,
    imprintVisible: false,
    introFallTimerActive: true,
    pointerEvents: "none",
    scrollY: 0,
    trailPoints: 0,
  });
  expect(firstRestartState.bodyState).toContain("theme-dark");
  expect(firstRestartState.htmlState).not.toContain("is-scroll-locked");
  expect(firstRestartState.rainState).not.toMatch(/is-rain-/);
  await expect(first.locator('[name="gravity"]')).toHaveValue("9");
  await expect(second.locator('[name="gravity"]')).toHaveValue("9");

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
