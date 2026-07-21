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

async function watchAudioPlayCalls(page, filename) {
  await page.addInitScript((targetFilenames) => {
    const targets = Array.isArray(targetFilenames)
      ? targetFilenames
      : [targetFilenames];
    window.__watchedAudioPlayCount = 0;
    window.__watchedAudioPlayCounts = Object.fromEntries(
      targets.map((target) => [target, 0])
    );
    HTMLMediaElement.prototype.play = function play() {
      let decodedSrc = this.currentSrc || this.src || "";
      try {
        decodedSrc = decodeURIComponent(decodedSrc);
      } catch {
        /* URL может быть уже декодирован. */
      }
      let matched = false;
      targets.forEach((target) => {
        if (decodedSrc.includes(target)) {
          window.__watchedAudioPlayCounts[target] += 1;
          matched = true;
        }
      });
      if (matched) {
        window.__watchedAudioPlayCount += 1;
      }
      return Promise.resolve();
    };
  }, filename);
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

async function openSettingsPanel(page) {
  const toggle = page.locator(".settings-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#settings-panel")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
}

async function closeSettingsPanel(page) {
  const toggle = page.locator(".settings-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#settings-panel")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
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
    .poll(
      async () => {
        try {
          await visibleRockPoint(page);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 3000 }
    )
    .toBe(true);
}

async function waitForRockSettledInPlay(page) {
  await expect(page.locator("body")).toHaveClass(/state-play/, {
    timeout: 45_000,
  });
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            motion.phase === "play" &&
            !motion.dragging &&
            Math.abs(motion.y - bounds.maxY) <= 0.75 &&
            Math.abs(motion.vy) <= 0.75
        ),
      { timeout: 45_000 }
    )
    .toBe(true);
}

async function grabVisibleRock(page) {
  const status = page.getByTestId("session-status");
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await scrollToRock(page);
    const point = await visibleRockPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
      await expect(status).toContainText(/держите|тяните/, {
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

async function moveSharedDragToBottom(...pages) {
  await Promise.all(pages.map((page) => page.evaluate(() => {
    const target = {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: SharedPhysics.WORLD_HEIGHT,
    };
    const local = canonicalToLocal(target.x, target.y);
    setPosition(local.x, local.y);
    motion.dragTargetX = local.x;
    motion.dragTargetY = local.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    syncReturnTheme();
    sendShared("control.move", {
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      pointer: {
        ...collab.localPointer,
        x: target.x,
        y: target.y,
        mode: "grabbing",
        visible: true,
      },
    });
  })));
}

async function expectReadyAtBottom(page) {
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        updateBounds();
        const rock = document.querySelector(".rock");
        const rect = rock.getBoundingClientRect();
        return {
          phase: motion.phase,
          y: motion.y,
          maxY: bounds.maxY,
          scrollY: window.scrollY,
          maxScroll:
            document.documentElement.scrollHeight - window.innerHeight,
          pointerEvents: getComputedStyle(rock).pointerEvents,
          imprintVisible: document
            .querySelector(".rock-imprint")
            .classList.contains("is-visible"),
          rockVisible: rect.bottom > 0 && rect.top < window.innerHeight,
        };
      })
    )
    .toMatchObject({
      phase: "play",
      pointerEvents: "auto",
      imprintVisible: false,
      rockVisible: true,
    });
  const position = await page.evaluate(() => ({
    y: motion.y,
    maxY: bounds.maxY,
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
  }));
  expect(position.y).toBeCloseTo(position.maxY, 0);
  expect(position.scrollY).toBeGreaterThanOrEqual(position.maxScroll - 2);
}

async function expectScrollDoesNotAffectPhysics(page) {
  await expectReadyAtBottom(page);
  const before = await page.evaluate(() => ({
    phase: motion.phase,
    x: motion.x,
    y: motion.y,
    vx: motion.vx,
    vy: motion.vy,
  }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    phase: motion.phase,
    x: motion.x,
    y: motion.y,
    vx: motion.vx,
    vy: motion.vy,
    firstFallTriggered: motion.firstFallTriggered,
  }));
  expect(after).toMatchObject({
    phase: before.phase,
    x: before.x,
    y: before.y,
    vx: before.vx,
    vy: before.vy,
    firstFallTriggered: false,
  });
  await scrollToRock(page);
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
  test.setTimeout(70_000);
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

  await expectScrollDoesNotAffectPhysics(page);
  await waitForRockSettledInPlay(page);
  await grabVisibleRock(page);
  await expect(page.getByTestId("session-status")).toContainText("тяните");
  await page.mouse.up();

  await context.close();
});

test("вход на корень перенаправляет в рабочую сессию", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const documentRequests = [];
  await watchAudioPlayCalls(page, ["Камень", "Кандалы"]);
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      const url = new URL(request.url());
      documentRequests.push(`${url.pathname}${url.search}`);
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page).toHaveTitle("ПУТЬ ЦАРЕЙ");
  await expect(page.locator(".title")).toHaveText("ПУТЬ ЦАРЕЙ");
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expectReadyAtBottom(page);
  const startState = await page.locator(".rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    return {
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      centerDelta: {
        x: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
        bottom: Math.abs(rect.bottom - window.innerHeight),
      },
      pointerEvents: getComputedStyle(rock).pointerEvents,
      scale: Number.parseFloat(style.getPropertyValue("--rock-scale")),
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  expect(startState.centerDelta.x).toBeLessThan(2);
  expect(startState.centerDelta.bottom).toBeLessThan(2);
  expect(startState.pointerEvents).toBe("auto");
  expect(startState.scale).toBeGreaterThan(0);
  expect(startState.scrollable).toBe(true);
  await expect.poll(() => documentRequests.length).toBeGreaterThanOrEqual(2);
  expect(documentRequests[0]).toBe("/");
  expect(documentRequests.at(-1)).toMatch(/^\/\?session=[A-Za-z0-9_-]{22}$/);

  await openSettingsPanel(page);
  await expect(page.getByTestId("share-session")).toHaveCount(0);
  await expect(
    page.locator(".settings-panel .control-group[open]")
  ).toHaveCount(0);
  await openControlGroup(page, "Физика");
  await page.locator('[name="mass"]').hover();
  await expect(page.locator(".hint .katex").first()).toBeVisible();
  await expect(page.locator(".hint__formulas code")).toHaveCount(0);
  await setRange(page, "gravity", 10);
  await setField(page, "rockScaleEasing", "cubic-bezier(0, 0, 1, 1)");
  await setField(page, "rockMinWidthVw", 10);
  await setField(page, "rockMaxWidthVw", 40);
  await expect(page.locator('[name="rockScaleEasing"]')).toHaveValue(
    "cubic-bezier(0, 0, 1, 1)"
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("10");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("40");
  await closeSettingsPanel(page);

  await expectScrollDoesNotAffectPhysics(page);
  await expect(page.getByTestId("rock-imprint")).not.toHaveClass(/is-visible/);
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
    const viewportWidth = window.innerWidth;
    const bottom = sample(bounds.maxY);
    const middle = sample(bounds.maxY / 2);
    const top = sample(0);
    setPosition(bounds.maxX / 2, bounds.maxY);
    return {
      bottom,
      middle,
      top,
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
  await expect
    .poll(() => page.evaluate(() => motion.firstFallTriggered))
    .toBe(false);
  await expect(page.locator("body")).not.toHaveClass(/state-intro/);
  await waitForRockSettledInPlay(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Камень"] || 0)
    )
    .toBe(0);
  const firstImpactSoundCount = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Камень"] || 0
  );
  await page.evaluate(() => {
    updateBounds();
    motion.phase = SharedPhysics.PHASES.PLAY;
    motion.dragging = true;
    motion.dragTargetX = motion.x;
    motion.dragTargetY = bounds.maxY;
    setPosition(motion.x, Math.max(0, bounds.maxY - 20));
    window.__sisyphusTestApi.applyDragTargetMovement(1, 0);
    motion.dragging = false;
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Камень"] || 0)
    )
    .toBe(firstImpactSoundCount);
  await scrollToRock(page);

  const trailPoint = await visibleRockPoint(page);
  await page.mouse.move(trailPoint.x, trailPoint.y);
  await page.mouse.down();
  await page.mouse.move(trailPoint.x - 24, trailPoint.y - 6);
  await page.mouse.up();
  await waitForRockSettledInPlay(page);
  await scrollToRock(page);
  await expect
    .poll(() => page.evaluate(() => trail.points.length))
    .toBeGreaterThan(0);
  await openSettingsPanel(page);
  await openControlGroup(page, "След");
  const trailEnabled = page.locator('[name="trailEnabled"]');
  await expect(trailEnabled).toBeChecked();
  await expect
    .poll(() => trailHasVisiblePixels(page))
    .toBe(true);
  await closeSettingsPanel(page);
  await scrollToRock(page);

  await expect(page.locator(".rock")).toHaveCSS("pointer-events", "auto");
  const playablePoint = await visibleRockPoint(page);
  const chainSoundCountBeforeHover = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Кандалы"] || 0
  );
  await page.mouse.move(1, 1);
  await page.mouse.move(playablePoint.x, playablePoint.y);
  await expect(page.locator(".hand-cursor")).toHaveClass(/is-visible/);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBeGreaterThan(chainSoundCountBeforeHover);
  const chainSoundCountAfterEnter = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Кандалы"] || 0
  );
  await page.locator(".rock").evaluate((rock, point) => {
    rock.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x + 3,
        clientY: point.y + 3,
        pointerId: 1,
        pointerType: "mouse",
      })
    );
  }, playablePoint);
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBe(chainSoundCountAfterEnter);
  await page.waitForTimeout(850);
  await page.locator(".rock").evaluate((rock, point) => {
    rock.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x - 3,
        clientY: point.y - 3,
        pointerId: 1,
        pointerType: "mouse",
      })
    );
  }, playablePoint);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBe(chainSoundCountAfterEnter);
  await grabVisibleRock(page);
  await expect(page.getByTestId("session-status")).toContainText("тяните");
  await page.mouse.up();

  const urlBeforeReload = page.url();
  await page.reload();
  await expect(page).toHaveURL(urlBeforeReload);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page.locator("body")).not.toHaveClass(/state-intro/);
  await expect(page.getByTestId("rock-imprint")).not.toHaveClass(/is-visible/);
  await expect(page.locator('[name="gravity"]')).toHaveValue("10");
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);

  await context.close();
});

test("падение компенсируется при изменении высоты сцены", async ({ browser }) => {
  async function profileForHeight(height) {
    const context = await browser.newContext({
      viewport: { width: 1280, height },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    const profile = await page.evaluate(() => {
      const stepCount = 90;
      const stepSeconds = SharedPhysics.FIXED_STEP_SECONDS;
      const initial = {
        phase: SharedPhysics.PHASES.PLAY,
        x: SharedPhysics.WORLD_WIDTH / 2,
        y: SharedPhysics.WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        turbTime: 0,
      };

      Object.assign(params, SharedPhysics.sanitizePhysics({
        ...params,
        firstFallVelocity: 0,
        gravity: 1,
        bounce: 0,
        turbulence: 0,
      }));
      const local = canonicalToLocal(initial.x, initial.y);
      setPosition(local.x, local.y);
      motion.phase = SharedPhysics.PHASES.PLAY;
      motion.vx = 0;
      motion.vy = 0;
      motion.turbTime = 0;

      for (let index = 0; index < stepCount; index += 1) {
        applyPhysics(stepSeconds);
      }
      updateBounds();
      return {
        elapsedSeconds: stepCount * stepSeconds,
        sceneMaxY: bounds.maxY,
        localStartY: local.y,
        localAfterY: motion.y,
        initial,
        after: currentSharedState(),
      };
    });
    await context.close();
    return profile;
  }

  const low = await profileForHeight(600);
  const high = await profileForHeight(900);
  expect(low.sceneMaxY).not.toBeCloseTo(high.sceneMaxY, 0);
  expect(low.localAfterY).not.toBeCloseTo(high.localAfterY, 0);
  expect(low.elapsedSeconds).toBeCloseTo(1.5, 6);
  expect(high.elapsedSeconds).toBeCloseTo(low.elapsedSeconds, 6);
  expect(Math.abs(low.initial.y - high.initial.y)).toBeLessThan(1);
  expect(Math.abs(low.after.y - high.after.y)).toBeLessThan(1);
  expect(low.after.vy).toBeCloseTo(high.after.vy, 6);
  expect(low.after.phase).toBe(high.after.phase);

  async function profileForSceneHeight(sceneHeightScreens) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
    await setRange(page, "sceneHeightScreens", sceneHeightScreens);
    await expect(page.locator('[data-output="sceneHeightScreens"]')).toHaveText(
      `${sceneHeightScreens * 100}vh`
    );
    const profile = await page.evaluate(() => {
      const stepCount = 90;
      const stepSeconds = SharedPhysics.FIXED_STEP_SECONDS;
      const initial = {
        phase: SharedPhysics.PHASES.PLAY,
        x: SharedPhysics.WORLD_WIDTH / 2,
        y: SharedPhysics.WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        turbTime: 0,
      };

      Object.assign(params, SharedPhysics.sanitizePhysics({
        ...params,
        firstFallVelocity: 0,
        gravity: 1,
        bounce: 0,
        turbulence: 0,
      }));
      const local = canonicalToLocal(initial.x, initial.y);
      setPosition(local.x, local.y);
      motion.phase = SharedPhysics.PHASES.PLAY;
      motion.vx = 0;
      motion.vy = 0;
      motion.turbTime = 0;

      for (let index = 0; index < stepCount; index += 1) {
        applyPhysics(stepSeconds);
      }
      updateBounds();
      return {
        sceneHeightScreens: params.sceneHeightScreens,
        sceneMaxY: bounds.maxY,
        motionScale: window.SisyphusRoomSettings.sceneMotionMultiplier(params),
        localDeltaY: motion.y - local.y,
        after: currentSharedState(),
      };
    });
    await context.close();
    return profile;
  }

  const compact = await profileForSceneHeight(10);
  const legacy = await profileForSceneHeight(100);
  expect(compact.motionScale).toBeCloseTo(10, 6);
  expect(legacy.motionScale).toBeCloseTo(1, 6);
  expect(compact.sceneMaxY).toBeLessThan(legacy.sceneMaxY);
  expect(compact.after.y).toBeGreaterThan(legacy.after.y);
  expect(compact.localDeltaY).toBeGreaterThan(0);
  expect(legacy.localDeltaY).toBeGreaterThan(0);
  expect(compact.localDeltaY / legacy.localDeltaY).toBeGreaterThan(0.9);
  expect(compact.localDeltaY / legacy.localDeltaY).toBeLessThan(1.1);
});

test("два браузера видят один камень и поднимают его вместе", async ({ browser }) => {
  test.setTimeout(120_000);
  const firstContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await watchAudioPlayCalls(first, "Дождь");
  await watchAudioPlayCalls(second, "Дождь");

  await first.goto("/");
  await expect(first).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  await expectReadyAtBottom(first);
  const sceneProjection = await first.evaluate(() => {
    updateBounds();
    const bottom = canonicalToLocal(SharedPhysics.WORLD_WIDTH / 2, SharedPhysics.WORLD_HEIGHT);
    const originalMaxY = bounds.maxY;
    const rock = document.querySelector(".rock");
    const rockRect = rock.getBoundingClientRect();
    const rockScale = Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-scale")
    );
    const bottomScale =
      (window.innerWidth * params.rockMinWidthVw) / 100 / rock.offsetWidth;
    return {
      bottomScale,
      maxY: originalMaxY,
      bottomY: bottom.y,
      visualBottomAtMaxY:
        originalMaxY + (rock.offsetHeight * (1 + bottomScale)) / 2,
      worldHeight: SharedPhysics.WORLD_HEIGHT,
      renderedHeight: document.querySelector(".world").offsetHeight,
      viewportHeight: window.innerHeight,
      rockBaseWidth: rock.offsetWidth,
      rockRenderedWidth: rockRect.width,
      rockHeight: rock.offsetHeight,
      rockScale,
    };
  });
  expect(sceneProjection.renderedHeight / sceneProjection.viewportHeight).toBeCloseTo(10, 0);
  expect(sceneProjection.rockBaseWidth).toBeCloseTo(sceneProjection.viewportHeight * 0.42, 0);
  expect(
    sceneProjection.rockRenderedWidth / sceneProjection.rockBaseWidth
  ).toBeCloseTo(sceneProjection.rockScale, 1);
  expect(sceneProjection.rockScale).toBeCloseTo(sceneProjection.bottomScale, 1);
  expect(sceneProjection.maxY).toBeCloseTo(
    sceneProjection.renderedHeight -
      (sceneProjection.rockHeight * (1 + sceneProjection.bottomScale)) / 2,
    1
  );
  expect(sceneProjection.visualBottomAtMaxY).toBeCloseTo(
    sceneProjection.renderedHeight,
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
          localStorage.getItem("sisyphus-czar-settings-v9") || "{}"
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
  await setField(first, "rainDropColor", "#336699");
  await setField(first, "rainHighlightColor", "#ffcc00");
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
          localStorage.getItem("sisyphus-czar-settings-v9") || "{}"
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
  await expect
    .poll(() =>
      first.evaluate(() => window.__watchedAudioPlayCounts["Дождь"] || 0)
    )
    .toBe(1);
  await expect(firstRain.locator(".weather-rain__blur")).toHaveCount(1);
  await expect
    .poll(() => first.evaluate(() => getLastRainRendererProfile()))
    .toMatchObject({
      fallbackColor: [51, 102, 153],
      raindropDiffuseLight: [0.2, 0.4, 0.6],
      raindropSpecularLight: [1, 0.8, 0],
    });
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
          localStorage.getItem("sisyphus-czar-settings-v9") || "{}"
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
          localStorage.getItem("sisyphus-czar-settings-v9") || "{}"
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
          localStorage.getItem("sisyphus-czar-settings-v9") || "{}"
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
  await setRange(first, "mass", 10);
  await setRange(first, "gravity", 10);
  await setRange(first, "firstFallVelocity", -4);
  await setRange(first, "handForce", 500);
  await setRange(first, "pointerInfluence", 1.8);
  await setRange(first, "bounce", 0.1);
  await setRange(first, "inertia", 8);
  await setRange(first, "groundFriction", 0.2);
  await setRange(first, "turbulence", 0.3);
  await setRange(first, "handWidthVw", 40);
  await setRange(first, "slaveHandWidthPx", 36);
  await expect(first.locator('[data-output="handWidthVw"]')).toHaveText("40.0vw");
  await expect(first.locator('[data-output="slaveHandWidthPx"]')).toHaveText("36px");
  await expect
    .poll(() =>
      first.evaluate(() => Object.keys(collab.pendingRoomSettingsChanges).length)
    )
    .toBe(0);

  await second.goto("/");
  await expect(second).toHaveURL(/\?session=[A-Za-z0-9_-]{22}/);
  expect(second.url()).not.toBe(sharedUrl);
  await second.goto(sharedUrl);
  await second.locator(".settings-toggle").click();
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await expectReadyAtBottom(second);
  await expect.poll(() => first.evaluate(() => collab.clientRole)).toBe("master");
  await expect.poll(() => second.evaluate(() => collab.clientRole)).toBe("slave");
  await openControlGroup(second, "Дождь");
  await expect(second.locator('[name="rainBlendMode"]')).toHaveValue("multiply");
  await expect(second.locator('[name="rainBlurBlendMode"]')).toHaveValue("normal");
  await expect(second.locator('[name="handWidthVw"]')).toHaveValue("40");
  await expect(second.locator('[name="slaveHandWidthPx"]')).toHaveValue("36");
  await setField(second, "rainExitMs", 700);
  await expect(second.locator('[data-output="rainExitMs"]')).toHaveText("700");
  await expect(first.getByTestId("session-status")).toContainText("2");
  const expectedPhysics = {
    mass: "10",
    gravity: "10",
    firstFallVelocity: "-4",
    handForce: "500",
    pointerInfluence: "1.8",
    bounce: "0.1",
    inertia: "8",
    groundFriction: "0.2",
    turbulence: "0.3",
  };
  for (const [name, value] of Object.entries(expectedPhysics)) {
    await expect(second.locator(`[name="${name}"]`)).toHaveValue(value);
  }
  await expect
    .poll(() => second.evaluate(() => getRoomSettings()))
    .toEqual({
      sceneHeightScreens: 10,
      handWidthVw: 40,
      slaveHandWidthPx: 36,
      rainDropColor: "#336699",
      rainHighlightColor: "#ffcc00",
    });
  await expect
    .poll(() =>
      second.evaluate(() => ({
        drop: document.querySelector('[name="rainDropColor"]').value,
        highlight: document.querySelector('[name="rainHighlightColor"]').value,
      }))
    )
    .toEqual({ drop: "#336699", highlight: "#ffcc00" });
  await expect(first.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(second.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);

  await second.evaluate(() => collab.socket.close(4100, "test_reconnect"));
  await expect(second.getByTestId("session-status")).toContainText("Переподключение");
  await setRange(second, "gravity", 8);
  await expect(first.locator('[name="gravity"]')).toHaveValue("8", {
    timeout: 5000,
  });
  await expect.poll(() => second.evaluate(() => collab.clientRole)).toBe("slave");

  await first.locator(".settings-toggle").click();
  await second.locator(".settings-toggle").click();
  const remoteCursor = second.getByTestId("remote-cursor");

  await expectScrollDoesNotAffectPhysics(first);
  await expect(second.locator("body")).toHaveClass(/state-play/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect(first.locator(".rock")).not.toHaveClass(/is-dragging/);
  await expect(second.locator(".rock")).not.toHaveClass(/is-dragging/);
  const firstImprint = first.getByTestId("rock-imprint");
  const secondImprint = second.getByTestId("rock-imprint");
  await expect(firstImprint).not.toHaveClass(/is-visible/);
  await expect(secondImprint).not.toHaveClass(/is-visible/);

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

  await expect(first.locator("body")).toHaveClass(/state-play/, { timeout: 45_000 });
  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 45_000 });
  await scrollToRock(first);
  await first.evaluate(() => {
    sendShared("pointer.update", {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: SharedPhysics.WORLD_HEIGHT / 2,
      mode: "grab",
      visible: true,
    });
  });
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect(remoteCursor).toBeVisible();
  await expect(remoteCursor).not.toHaveClass(/is-grabbing/);
  await expect(remoteCursor).not.toHaveClass(/is-slave/);
  await expect(remoteCursor).toHaveCSS("opacity", "1");
  await expect(remoteCursor).toHaveCSS(
    "background-image",
    /cursor-grab(?:-[A-Za-z0-9_-]+)?\.png/
  );
  await expect
    .poll(() =>
      remoteCursor.evaluate((cursor) => {
        const rect = cursor.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      })
    )
    .toEqual({ height: 679, width: 512 });
  await first.evaluate(() => {
    sendShared("pointer.update", {
      ...collab.localPointer,
      mode: "grab",
      visible: false,
    });
  });
  await expect(remoteCursor).toHaveCount(0);

  await scrollToRock(second);
  await expect.poll(() => trailHasVisiblePixels(second)).toBe(false);
  await second.locator(".settings-toggle").click();
  await openControlGroup(second, "След");
  await expect(second.locator('[name="trailEnabled"]')).toBeChecked();
  await second.locator(".settings-toggle").click();
  await scrollToRock(first);
  const firstGrabPoint = await visibleRockPoint(first);
  await first.mouse.move(firstGrabPoint.x, firstGrabPoint.y);
  await first.mouse.down();
  await expect.poll(() => first.evaluate(() => collab.hasControl)).toBe(true);
  await expect
    .poll(() =>
      first.locator(".rock").evaluate((rock, target) => {
        updateBounds();
        const rect = rock.getBoundingClientRect();
        const scaleX = bounds.rockWidth > 0 ? rect.width / bounds.rockWidth : 1;
        const scaleY =
          bounds.rockHeight > 0 ? rect.height / bounds.rockHeight : 1;
        const heldPoint = {
          x: rect.left + motion.grabX * scaleX,
          y: rect.top + motion.grabY * scaleY,
        };
        return Math.max(
          Math.abs(heldPoint.x - target.x),
          Math.abs(heldPoint.y - target.y)
        );
      }, firstGrabPoint)
    )
    .toBeLessThanOrEqual(3);
  const firstGrabMove = { x: -48, y: 0 };
  await first.mouse.move(
    firstGrabPoint.x + firstGrabMove.x,
    firstGrabPoint.y + firstGrabMove.y
  );
  await expect
    .poll(() =>
      first.locator(".rock").evaluate((rock, target) => {
        updateBounds();
        const rect = rock.getBoundingClientRect();
        const scaleX = bounds.rockWidth > 0 ? rect.width / bounds.rockWidth : 1;
        const scaleY =
          bounds.rockHeight > 0 ? rect.height / bounds.rockHeight : 1;
        const heldPoint = {
          x: rect.left + motion.grabX * scaleX,
          y: rect.top + motion.grabY * scaleY,
        };
        return Math.max(
          Math.abs(heldPoint.x - target.x),
          Math.abs(heldPoint.y - target.y)
        );
      }, {
        x: firstGrabPoint.x + firstGrabMove.x,
        y: firstGrabPoint.y + firstGrabMove.y,
      })
    )
    .toBeLessThanOrEqual(3);
  await expect(first.getByTestId("session-status")).toContainText("силы хватает");
  await grabVisibleRock(second);
  await moveSharedDragToBottom(first, second);
  await expect(first.getByTestId("session-status")).toContainText("силы хватает");
  await expect(second.getByTestId("session-status")).toContainText("силы хватает");
  const localGrabbingCursor = second.locator(
    ".hand-cursor:not(.is-remote).is-visible"
  );
  await expect(localGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(localGrabbingCursor).toHaveClass(/is-slave/);
  await expect(localGrabbingCursor).toHaveCSS(
    "background-image",
    /hand_close(?:-[A-Za-z0-9_-]+)?\.png/
  );
  const grabbingCursorSize = await localGrabbingCursor.evaluate((cursor) => {
    const style = getComputedStyle(cursor);
    return {
      width: Math.round(Number.parseFloat(style.width)),
      height: Math.round(Number.parseFloat(style.height)),
    };
  });
  expect(grabbingCursorSize).toEqual({ height: 36, width: 36 });
  const remoteGrabbingCursor = first.locator(
    ".hand-cursor.is-remote.is-visible"
  );
  await expect(remoteGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(remoteGrabbingCursor).toHaveClass(/is-slave/);
  await expect(remoteGrabbingCursor).toHaveCSS(
    "background-image",
    /hand_close(?:-[A-Za-z0-9_-]+)?\.png/
  );
  const remoteGrabbingCursorSize = await remoteGrabbingCursor.evaluate(
    (cursor) => {
      const style = getComputedStyle(cursor);
      return {
        width: Math.round(Number.parseFloat(style.width)),
        height: Math.round(Number.parseFloat(style.height)),
      };
    }
  );
  expect(remoteGrabbingCursorSize).toEqual({ height: 36, width: 36 });
  const secondRain = second.getByTestId("weather-rain");
  await expect(first.locator("body")).not.toHaveClass(/state-won/);
  await expect(second.locator("body")).not.toHaveClass(/state-won/);
  await expect(first.locator(".rock")).toHaveClass(/is-dragging/);
  await expect(second.locator(".rock")).toHaveClass(/is-dragging/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
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
  await second.mouse.up();
  await first.mouse.up();
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect
    .poll(() =>
      second.evaluate(() => window.__watchedAudioPlayCounts["Дождь"] || 0)
    )
    .toBe(0);
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
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
  await expect
    .poll(() =>
      first.evaluate(
        () =>
          window.scrollY >=
          document.documentElement.scrollHeight - window.innerHeight - 2
      )
    )
    .toBe(true);
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
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    trailPoints: trail.points.length,
  }));
  expect(firstRestartState.bodyState).toContain("state-play");
  expect(firstRestartState).toMatchObject({
    firstFallTriggered: false,
    imprintVisible: false,
    introFallTimerActive: false,
    pointerEvents: "auto",
    trailPoints: 0,
  });
  expect(firstRestartState.scrollY).toBeGreaterThanOrEqual(
    firstRestartState.maxScroll - 2
  );
  expect(firstRestartState.bodyState).toContain("theme-dark");
  expect(firstRestartState.htmlState).not.toContain("is-scroll-locked");
  expect(firstRestartState.rainState).not.toMatch(/is-rain-/);
  await expect(first.locator('[name="gravity"]')).toHaveValue("8");
  await expect(second.locator('[name="gravity"]')).toHaveValue("8");

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
