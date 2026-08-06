const { test, expect } = require("@playwright/test");

async function waitForFoldReady(page) {
  const layer = page.locator("[data-fold-layer]");
  await expect(layer).toHaveAttribute("data-fold-ready", "true");
  await expect(layer).toHaveAttribute("data-fold-enabled", "true");
  return layer;
}

async function setSettingValue(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((element, nextValue) => {
    if (element.type === "checkbox") {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      ).set;
      setter.call(element, Boolean(nextValue));
    } else {
      const prototype =
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(
        prototype,
        "value",
      ).set;
      setter.call(element, String(nextValue));
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("основной и drafts маршруты используют одну Fold-сцену и одно меню", async ({
  page,
}) => {
  for (const path of ["/", "/drafts/"]) {
    await page.goto(path);
    const layer = await waitForFoldReady(page);

    await expect(page.locator('[data-fold-zone="top"]')).toHaveCount(1);
    await expect(page.locator('[data-fold-zone="bottom"]')).toHaveCount(0);
    const layerOrder = await page.evaluate(() => ({
      fold: Number.parseInt(
        getComputedStyle(document.querySelector("[data-fold-layer]")).zIndex,
        10,
      ),
      hand: Number.parseInt(
        getComputedStyle(
          document.querySelector(
            "#root > .world > .hand-cursor:not(.is-remote)",
          ),
        ).zIndex,
        10,
      ),
    }));
    expect(layerOrder.fold).toBeLessThan(layerOrder.hand);
    await expect(
      page.locator('[data-fold-zone="top"] .hand-cursor:not(.is-remote)'),
    ).toHaveCSS("display", "none");
    await expect(page.locator("#root > .world")).toHaveCount(1);
    await expect(page.locator("[data-fold-zone] main")).toHaveCount(1);
    await expect(page.locator("[data-draft-fold-controls]")).toHaveCount(0);
    await expect(page.locator('[name="draftFoldAngle"]')).toHaveValue("30");
    await expect(page.locator('[name="draftFoldZoneSize"]')).toHaveValue(
      "20",
    );
    await expect(
      page.locator('[name="draftFoldBlendEnabled"]'),
    ).toBeChecked();
    await expect(page.locator('[name="draftFoldBlendCurve"]')).toHaveValue(
      "cubic-bezier(0.333, 0, 0.667, 1)",
    );
    await expect(page.getByTestId("summit-timer")).toHaveCount(1);
    await expect(page.getByTestId("weather-rain")).toHaveCount(1);
    await expect(page.locator("[data-fold-zone] [id]")).toHaveCount(0);
    await expect(
      page.locator("[data-fold-zone] [data-testid]"),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-fold-zone] .world[inert][aria-hidden='true']"),
    ).toHaveCount(1);
    await expect(
      page.locator("[data-fold-zone] .world[role='presentation']"),
    ).toHaveCount(1);
    await expect(layer).toHaveAttribute("data-fold-angle", "30");
    await expect(layer).toHaveAttribute("data-fold-zone-size", "20");
  }
});

test("постоянная рука показывает нативный курсор над настройками", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(page.locator("body")).toHaveClass(/hand-always-visible/);

  const body = page.locator("body");
  const hand = page.locator(
    "#root > .world > .hand-cursor:not(.is-remote)",
  );
  const toggle = page.locator(".settings-toggle");
  await toggle.hover();
  await expect(toggle).toHaveCSS("cursor", "pointer");
  await expect(body).toHaveClass(/is-settings-pointer-active/);
  await expect(hand).toHaveCSS("opacity", "0");

  await toggle.click();
  const panel = page.locator(".settings-panel.is-open");
  await expect(panel).toBeVisible();
  await panel.hover({ position: { x: 24, y: 24 } });
  await expect(panel).toHaveCSS("cursor", "auto");
  await expect(body).toHaveClass(/is-settings-pointer-active/);
  await expect(hand).toHaveCSS("opacity", "0");

  await page.mouse.move(8, 8);
  await expect(body).not.toHaveClass(/is-settings-pointer-active/);

  const handGroup = page.locator(".control-group").filter({
    has: page.locator("summary", { hasText: /^Рука$/ }),
  });
  await handGroup.evaluate((element) => {
    element.open = true;
  });
  await setSettingValue(page, "handAlwaysVisible", false);
  await expect(body).not.toHaveClass(/hand-always-visible/);
  await page.locator(".settings-toggle").click();
  await page.mouse.move(8, 8);
  await expect(hand).not.toHaveClass(/is-visible/);
  await page.locator("#root > .world > .rock").hover();
  await expect(hand).toHaveClass(/is-visible/);
  await page.mouse.move(8, 8);
  await expect(hand).not.toHaveClass(/is-visible/);
});

test("настройки parallax меняют отклонение, радиус и плавность возврата", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v29");
    localStorage.setItem(
      "sisyphus-czar-settings-v26",
      JSON.stringify({ preclickParallaxActivationRadiusPx: 1000 }),
    );
  });
  await page.goto("/");
  await waitForFoldReady(page);
  await page.locator(".settings-toggle").click();
  const rockGroup = page.locator(".control-group").filter({
    has: page.locator("summary", { hasText: /^Камень$/ }),
  });
  await rockGroup.evaluate((element) => {
    element.open = true;
  });
  const cameraGroup = page.locator(".control-group").filter({
    has: page.locator("summary", { hasText: /^Камера$/ }),
  });
  await cameraGroup.evaluate((element) => {
    element.open = true;
  });

  const maxOffset = page.locator('[name="preclickParallaxMaxOffsetVw"]');
  const activationRadius = page.locator(
    '[name="preclickParallaxActivationRadiusVw"]',
  );
  const returnDuration = page.locator(
    '[name="preclickParallaxReturnDurationMs"]',
  );
  const returnEasing = page.locator(
    '[name="preclickParallaxReturnEasing"]',
  );
  const inverted = page.locator('[name="preclickParallaxInverted"]');
  const cameraFollowLerp = page.locator('[name="cameraFollowLerp"]');
  const inversionButton = page.locator(
    '[data-setting-control]:has([name="preclickParallaxInverted"]) [data-setting-toggle-button]',
  );
  await expect(maxOffset).toHaveValue("0.6");
  await expect(maxOffset).toHaveAttribute("min", "0");
  await expect(maxOffset).toHaveAttribute("max", "150");
  await expect(maxOffset).toHaveAttribute("step", "0.1");
  await expect(activationRadius).toHaveValue("50");
  await expect(activationRadius).toHaveAttribute("min", "0");
  await expect(activationRadius).toHaveAttribute("max", "200");
  await expect(returnDuration).toHaveValue("400");
  await expect(returnDuration).toHaveAttribute("min", "0");
  await expect(returnDuration).toHaveAttribute("max", "2000");
  await expect(returnEasing).toHaveValue(
    "cubic-bezier(0.22, 1, 0.36, 1)",
  );
  await expect(inverted).not.toBeChecked();
  await expect(inversionButton).toHaveAttribute("aria-pressed", "false");
  await expect(inversionButton).toHaveText("Обычное направление");
  await expect(cameraFollowLerp).toHaveValue("0.1");
  await expect(cameraFollowLerp).toHaveAttribute("min", "0.01");
  await expect(cameraFollowLerp).toHaveAttribute("max", "1");
  await expect(
    page.locator(
      '[data-cubic-bezier-control]:has([name="preclickParallaxReturnEasing"]) .bezier-graph',
    ),
  ).toHaveCount(1);

  await setSettingValue(page, "preclickParallaxMaxOffsetVw", 3.6);
  await setSettingValue(page, "preclickParallaxActivationRadiusVw", 70);
  await setSettingValue(page, "preclickParallaxReturnDurationMs", 650);
  await setSettingValue(
    page,
    "preclickParallaxReturnEasing",
    "cubic-bezier(0.25, 0.1, 0.25, 1)",
  );
  await setSettingValue(page, "cameraFollowLerp", 0.25);
  await inversionButton.click();
  await expect(inverted).toBeChecked();
  await expect(inversionButton).toHaveAttribute("aria-pressed", "true");
  await expect(inversionButton).toHaveText("Инверсия включена");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        maxOffset:
          window.__sisyphusTestApi.params.preclickParallaxMaxOffsetVw,
        activationRadius:
          window.__sisyphusTestApi.params
            .preclickParallaxActivationRadiusVw,
        returnDuration:
          window.__sisyphusTestApi.params.preclickParallaxReturnDurationMs,
        returnEasing:
          window.__sisyphusTestApi.params.preclickParallaxReturnEasing,
        inverted:
          window.__sisyphusTestApi.params.preclickParallaxInverted,
        cameraFollowLerp:
          window.__sisyphusTestApi.params.cameraFollowLerp,
      })),
    )
    .toEqual({
      maxOffset: 3.6,
      activationRadius: 70,
      returnDuration: 650,
      returnEasing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
      inverted: true,
      cameraFollowLerp: 0.25,
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          JSON.parse(
            localStorage.getItem("sisyphus-czar-settings-v29") || "{}",
          ).preclickParallaxInverted,
        ),
      ),
    )
    .toBe(true);
  await expect(
    page.locator('[data-output="preclickParallaxMaxOffsetVw"]'),
  ).toHaveText("3.6vw");
  await expect(
    page.locator('[data-output="preclickParallaxActivationRadiusVw"]'),
  ).toHaveText("70vw");
  await expect(
    page.locator('[data-output="preclickParallaxReturnDurationMs"]'),
  ).toHaveText("650мс");
});

test("препятствие Окна имеет одинаковый UI и сообщает о popup-блокировке", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  for (const path of ["/", "/drafts/"]) {
    await page.goto(path);
    await waitForFoldReady(page);
    await page.locator(".settings-toggle").click();
    await expect(page.locator("#settings-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );

    await expect(
      page.locator(".control-group > summary", { hasText: /^Рука$/ }),
    ).toHaveCount(1);
    const obstacleGroup = page.locator(".control-group").filter({
      has: page.locator("summary", { hasText: /^Препятствия$/ }),
    });
    await expect(obstacleGroup).toHaveCount(1);
    await obstacleGroup.evaluate((element) => {
      element.open = true;
    });

    const windowsGroup = obstacleGroup.locator(
      '[aria-label="Препятствия: Окна"]',
    );
    await expect(windowsGroup.getByRole("heading", { name: "Окна" })).toBeVisible();
    await expect(page.locator('[name="windowObstacleEnabled"]')).not.toBeChecked();
    await expect(page.locator('[name="windowObstacleMinHeightVh"]')).toHaveValue("1000");
    await expect(page.locator('[name="windowObstacleMaxHeightVh"]')).toHaveValue("1500");
    await expect(page.locator('[name="windowObstacleMinIntervalSeconds"]')).toHaveValue("0.5");
    await expect(page.locator('[name="windowObstacleMaxIntervalSeconds"]')).toHaveValue("1.5");
    await expect(page.locator('[name="windowObstacleMinWidthPx"]')).toHaveValue("240");
    await expect(page.locator('[name="windowObstacleMaxWidthPx"]')).toHaveValue("640");
    await expect(page.locator('[name="windowObstacleMinHeightPx"]')).toHaveValue("160");
    await expect(page.locator('[name="windowObstacleMaxHeightPx"]')).toHaveValue("480");
    await expect(page.locator('[name="windowObstacleMinHeightVh"]')).toHaveAttribute("step", "100");
    await expect(page.locator('[name="windowObstacleMinIntervalSeconds"]')).toHaveAttribute("step", "0.1");
    await expect(page.locator('[name="windowObstacleMinWidthPx"]')).toHaveAttribute("step", "10");

    await expect
      .poll(() =>
        page.evaluate(
          () => window.__sisyphusTestApi.getWindowObstacleState().heightVh,
        ),
      )
      .toBe(0);

    const status = page.locator("[data-window-obstacle-popup-status]");
    await expect(status).toHaveAttribute("data-state", "unchecked");
    await page.locator("[data-window-obstacle-popup-test]").click();
    await expect(status).toHaveAttribute("data-state", "blocked");
    await expect(status).toContainText("Заблокировано");
    await expect(page.locator("[data-window-obstacle-popup-help]")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => window.__sisyphusTestApi.getWindowObstacleState()),
      )
      .toMatchObject({
        activeWindowCount: 0,
        permission: "blocked",
        schedulePending: false,
      });
  }
});

test("Fold синхронизирует сцену и применяет общие сохраняемые настройки", async ({
  page,
}) => {
  await page.goto("/");
  const layer = await waitForFoldReady(page);

  await setSettingValue(page, "draftFoldAngle", 45);
  await setSettingValue(page, "draftFoldZoneSize", 10);
  await setSettingValue(
    page,
    "draftFoldBlendCurve",
    "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
  );
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(layer).toHaveAttribute(
    "data-fold-blend-curve",
    "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
  );
  await expect
    .poll(() =>
      layer.evaluate((element) =>
        element.style.getPropertyValue("--fold-angle"),
      ),
    )
    .toBe("45deg");

  await setSettingValue(page, "draftFoldBlendEnabled", false);
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
  await expect(page.locator('[name="draftFoldBlendCurve"]')).toBeDisabled();
  await expect
    .poll(() =>
      page
        .locator('[data-fold-zone="top"]')
        .evaluate((element) => getComputedStyle(element).maskImage),
    )
    .toBe("none");

  await setSettingValue(page, "draftFoldBlendEnabled", true);
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "true");
  await expect(page.locator('[name="draftFoldBlendCurve"]')).toBeEnabled();

  await setSettingValue(page, "draftFoldZoneSize", 0);
  await expect(layer).toHaveAttribute("data-fold-enabled", "false");
  await setSettingValue(page, "draftFoldZoneSize", 10);
  await expect(layer).toHaveAttribute("data-fold-enabled", "true");

  await page.goto("/drafts/");
  const draftLayer = await waitForFoldReady(page);
  await expect(page.locator('[name="draftFoldAngle"]')).toHaveValue("45");
  await expect(page.locator('[name="draftFoldZoneSize"]')).toHaveValue("10");
  await expect(draftLayer).toHaveAttribute("data-fold-angle", "45");
  await expect(draftLayer).toHaveAttribute("data-fold-zone-size", "10");

  const presentation = await page.evaluate(() => {
    const sourceRock = document.querySelector("#root > .world .rock");
    const mirrorRock = document.querySelector("[data-fold-zone] .rock");
    const sourceTrail = document.querySelector("#root > .world .trail");
    const mirrorTrail = document.querySelector("[data-fold-zone] .trail");
    const cropWindow = document.querySelector("[data-fold-source-window]");
    const zone = cropWindow.closest("[data-fold-zone]");
    const surface = cropWindow.closest(".fold-surface");
    const track = cropWindow.querySelector(".fold-track");
    const trackMatrix = new DOMMatrix(getComputedStyle(track).transform);
    return {
      cropHeight: Number.parseFloat(getComputedStyle(cropWindow).height),
      mirrorFrame: Number(
        document.querySelector("[data-fold-layer]").dataset.mirrorFrame || 0,
      ),
      mirrorRockStyle: mirrorRock.style.cssText,
      mirrorTrailSize: [mirrorTrail.width, mirrorTrail.height],
      pointerEvents: getComputedStyle(
        document.querySelector("[data-fold-layer]"),
      ).pointerEvents,
      sourceRockStyle: sourceRock.style.cssText,
      sourceTrailSize: [sourceTrail.width, sourceTrail.height],
      surfaceHeight: Number.parseFloat(getComputedStyle(surface).height),
      surfaceTop: Number.parseFloat(getComputedStyle(surface).top),
      trackTranslateY: trackMatrix.m42,
      zoneHeight: zone.getBoundingClientRect().height,
    };
  });

  expect(presentation.mirrorFrame).toBeGreaterThan(0);
  expect(presentation.pointerEvents).toBe("none");
  expect(presentation.mirrorRockStyle).toBe(presentation.sourceRockStyle);
  expect(presentation.mirrorTrailSize).toEqual(presentation.sourceTrailSize);
  expect(presentation.cropHeight).toBeCloseTo(
    presentation.zoneHeight * 2,
    1,
  );
  expect(presentation.surfaceHeight).toBeCloseTo(
    presentation.zoneHeight * 2,
    1,
  );
  expect(presentation.surfaceTop).toBeCloseTo(-presentation.zoneHeight, 1);
  expect(presentation.trackTranslateY).toBeCloseTo(
    presentation.zoneHeight - (await page.evaluate(() => window.scrollY)),
    1,
  );
});

test("настройки выпадения и выпрыгивания одинаковы на обоих маршрутах", async ({
  page,
}) => {
  for (const path of ["/", "/drafts/"]) {
    await page.goto(path);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    const randomDrop = page.locator('[name="randomDropEnabled"]');
    const rockJump = page.locator('[name="rockJumpEnabled"]');
    const jumpInterval = page.locator('[name="rockJumpIntervalSeconds"]');
    const jumpAngleSpread = page.locator(
      '[name="rockJumpAngleSpreadDegrees"]',
    );
    const jumpSpread = page.locator(
      '[name="rockJumpInertiaSpreadPercent"]',
    );

    await setSettingValue(page, "randomDropEnabled", true);
    await setSettingValue(page, "rockJumpEnabled", true);
    await expect(randomDrop).toBeChecked();
    await expect(rockJump).toBeChecked();
    await expect(jumpInterval).toBeEnabled();
    await expect(jumpAngleSpread).toBeEnabled();
    await expect(jumpSpread).toBeEnabled();

    await setSettingValue(page, "rockJumpAngleSpreadDegrees", 180);
    await setSettingValue(page, "rockJumpInertiaSpreadPercent", 40);
    await expect(jumpAngleSpread).toHaveValue("180");
    await expect(jumpSpread).toHaveValue("40");

    await setSettingValue(page, "rockJumpEnabled", false);
    await expect(rockJump).not.toBeChecked();
    await expect(jumpInterval).toBeDisabled();
    await expect(jumpAngleSpread).toBeDisabled();
    await expect(jumpSpread).toBeDisabled();
  }
});

test("первое падение анимирует размер камня, сохраняет контакт с полом, а темы используют свои градиенты", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  await setSettingValue(page, "darkBackgroundColor", "#112233");
  await setSettingValue(page, "darkBackgroundDeepColor", "#223344");
  await setSettingValue(page, "darkBackgroundLowColor", "#334455");
  await setSettingValue(page, "themeMode", "dark");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        background: getComputedStyle(document.querySelector("#root > .world"))
          .backgroundImage,
        surface: getComputedStyle(document.body)
          .getPropertyValue("--surface")
          .trim(),
      })),
    )
    .toEqual({
      background:
        "linear-gradient(rgb(17, 34, 51) 0%, rgb(34, 51, 68) 48%, rgb(51, 68, 85) 100%), none",
      surface: "#112233",
    });

  await setSettingValue(page, "lightBackgroundColor", "#ddeeff");
  await setSettingValue(page, "lightBackgroundDeepColor", "#ccddee");
  await setSettingValue(page, "lightBackgroundLowColor", "#bbccdd");
  await setSettingValue(page, "themeMode", "light");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--surface").trim(),
      ),
    )
    .toBe("#ddeeff");

  await setSettingValue(page, "rockActivatedWidthVw", 10);
  await setSettingValue(page, "gravity", 0.1);
  await setSettingValue(page, "pointerInfluence", 0);
  const rock = page.locator("#root > .world > .rock");
  const box = await rock.boundingBox();
  const initialWidth = box.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activated: window.__sisyphusTestApi.motion.physicsActivated,
        armed: window.__sisyphusTestApi.motion.rockActivationArmed,
      })),
    )
    .toEqual({ activated: false, armed: true });
  await expect(rock).not.toHaveClass(/is-activation-scaling/);
  expect((await rock.boundingBox()).width).toBeCloseTo(initialWidth, 0);

  await page.mouse.move(
    box.x + box.width / 2,
    Math.max(80, box.y + box.height / 2 - 180),
    { steps: 8 },
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { bounds, motion } = window.__sisyphusTestApi;
        return bounds.maxY - motion.y;
      }),
    )
    .toBeGreaterThan(20);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { bounds, collab, motion } = window.__sisyphusTestApi;
        return {
          activated: motion.physicsActivated,
          armed: motion.rockActivationArmed,
          dragging: motion.dragging,
          suspended: motion.suspended,
          vy: motion.vy,
          y: motion.y,
          maxY: bounds.maxY,
          releasePending: collab.releasePending,
        };
      }),
    )
    .toMatchObject({ activated: true });
  await page.waitForTimeout(350);
  const activated = await rock.evaluate((element) => ({
    activated: window.__sisyphusTestApi.motion.physicsActivated,
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
  }));
  expect(activated.activated).toBe(true);
  expect(
    Math.abs(activated.width - activated.viewportWidth * 0.1),
  ).toBeLessThanOrEqual(10);

  const floorContact = await page.evaluate(() => {
    const { bounds, motion, setPosition, updateBounds } =
      window.__sisyphusTestApi;
    updateBounds();
    setPosition(bounds.maxX / 2, bounds.maxY);
    const rock = document.querySelector("#root > .world > .rock");
    const visualBottom =
      motion.y + (rock.offsetHeight * (1 + motion.rockScale)) / 2;
    return {
      gap: document.querySelector("#root > .world").offsetHeight - visualBottom,
      y: motion.y,
      maxY: bounds.maxY,
    };
  });
  expect(floorContact.y).toBeCloseTo(floorContact.maxY, 5);
  expect(Math.abs(floorContact.gap)).toBeLessThanOrEqual(2);

  const directionTrigger = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.motion.physicsActivated = false;
    api.motion.rockActivationArmed = true;
    api.motion.rockActivationScaleFactor = 1;
    api.motion.dragging = false;
    api.motion.suspended = false;
    api.motion.vy = -100;
    api.setPosition(api.bounds.maxX / 2, api.bounds.maxY / 2);
    api.applyPhysics(SharedPhysics.FIXED_STEP_SECONDS);
    const whileMovingUp = api.motion.physicsActivated;
    api.motion.vy = 1;
    api.applyPhysics(SharedPhysics.FIXED_STEP_SECONDS);
    return {
      afterMovingDown: api.motion.physicsActivated,
      animationStarted: document
        .querySelector("#root > .world > .rock")
        .classList.contains("is-activation-scaling"),
      whileMovingUp,
    };
  });
  expect(directionTrigger).toEqual({
    afterMovingDown: true,
    animationStarted: true,
    whileMovingUp: false,
  });
});

test("glow-профили и зависимости select одинаковы на обоих маршрутах", async ({
  page,
}) => {
  for (const path of ["/", "/drafts/"]) {
    await page.goto(path);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");

    const mode = page.locator('[name="glowOptimizationMode"]');
    const targetFps = page.locator('[name="glowTargetFps"]');
    const manualControls = [
      "glowBufferScalePercent",
      "glowUpdateFps",
      "glowMaxPoints",
      "glowDecimation",
    ].map((name) => page.locator(`[name="${name}"]`));

    await setSettingValue(page, "glowOptimizationMode", "balanced");
    await expect(mode).toHaveValue("balanced");
    await expect(targetFps).toBeDisabled();
    for (const control of manualControls) {
      await expect(control).toBeDisabled();
    }

    await setSettingValue(page, "glowOptimizationMode", "auto");
    await expect(targetFps).toBeEnabled();
    for (const control of manualControls) {
      await expect(control).toBeDisabled();
    }

    await setSettingValue(page, "glowOptimizationMode", "manual");
    await expect(targetFps).toBeDisabled();
    for (const control of manualControls) {
      await expect(control).toBeEnabled();
    }

    await setSettingValue(page, "dashStyle", "solid");
    await expect(page.locator('[name="dashLength"]')).toBeDisabled();
    await expect(page.locator('[name="dashGap"]')).toBeDisabled();
    await setSettingValue(page, "dashStyle", "dotted");
    await expect(page.locator('[name="dashLength"]')).toBeDisabled();
    await expect(page.locator('[name="dashGap"]')).toBeEnabled();
    await setSettingValue(page, "dashStyle", "dashed");
    await expect(page.locator('[name="dashLength"]')).toBeEnabled();
    await expect(page.locator('[name="dashGap"]')).toBeEnabled();

    await setSettingValue(page, "useGradient", false);
    await expect(page.locator('[name="lineColorTail"]')).toBeDisabled();
    await setSettingValue(page, "useGradient", true);
    await expect(page.locator('[name="lineColorTail"]')).toBeEnabled();

    await setSettingValue(page, "themeMode", "dark");
    await expect(page.locator('[name="blendMode"]')).toBeDisabled();
    await expect(page.locator('[name="rainBlurPx"]')).toBeEnabled();
    await setSettingValue(page, "themeMode", "light");
    await expect(page.locator('[name="blendMode"]')).toBeEnabled();
    await expect(page.locator('[name="rainBlurPx"]')).toBeDisabled();
    await setSettingValue(page, "themeMode", "auto");
  }

  await setSettingValue(page, "glowOptimizationMode", "manual");
  await setSettingValue(page, "glowBufferScalePercent", 35);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v29") || "{}",
        );
        return [
          stored.glowOptimizationMode,
          stored.glowBufferScalePercent,
        ];
      }),
    )
    .toEqual(["manual", 35]);

  await page.reload();
  await expect(page.locator('[name="glowOptimizationMode"]')).toHaveValue(
    "manual",
  );
  await expect(page.locator('[name="glowBufferScalePercent"]')).toHaveValue(
    "35",
  );
});
