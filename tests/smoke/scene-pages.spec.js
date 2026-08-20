const { test, expect } = require("@playwright/test");

const ROCK = "#root > .scene-page > .world > .rock";

async function waitForDebugScene(page, path, sceneId) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene",
    path.slice(1),
  );
  await expect(page.locator(ROCK)).toBeVisible();
  await expect.poll(
    () => page.evaluate(() => Boolean(window.__sisyphusTestApi)),
  ).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    return Boolean(api?.collab?.sessionId && api.collab.imprint);
  })).toBe(true);
  await expect(page.locator(".settings-panel")).toHaveAttribute(
    "data-settings-scene",
    sceneId,
  );
}

test("inline UI показывает только параметры текущей сцены", async ({ page }) => {
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.getByRole("heading", {
    name: "miniature",
    exact: true,
  })).toBeVisible();
  await expect(page.getByRole("heading", {
    name: "The Path of Tzarey",
    exact: true,
  })).toBeVisible();
  const world = page.locator(".scene-page > .world");
  await expect(world.locator(":scope > .summit-timer")).toBeHidden();
  await expect(world.locator(":scope > .summit-leaderboard")).toBeHidden();
  await expect(world.locator(":scope > .rock-imprint")).toBeHidden();
  await expect(world.locator(":scope > .trail")).toBeHidden();
  await expect(world.locator(":scope > .rock-echo-trail")).toBeVisible();
  await expect(page.locator(".settings-panel__scene-title")).toHaveText(
    "Параметры · Сцена 1. Кошки-мышки",
  );
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(1);
  const artworkMode = page.locator('[name="preclickPopupArtworkMode"]');
  const artworkId = page.locator('[name="preclickPopupArtworkId"]');
  await artworkMode.evaluate((element) => {
    const group = element.closest("details");
    if (group) group.open = true;
  });
  await expect(artworkMode).toHaveValue("shuffle");
  await expect(artworkId).toBeDisabled();
  await expect(artworkId.locator("option")).toHaveCount(3);
  await artworkMode.selectOption("single");
  await expect(artworkId).toBeEnabled();
  await artworkId.selectOption("03.png");
  await expect.poll(() => page.evaluate(() => ({
    id: window.__sisyphusTestApi.params.preclickPopupArtworkId,
    mode: window.__sisyphusTestApi.params.preclickPopupArtworkMode,
  }))).toEqual({ id: "03.png", mode: "single" });
  await expect(page.locator('[name="handAudioEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveCount(1);
  await expect(page.locator('[name="sceneHeightScreens"]')).toHaveCount(0);
  await expect(page.locator('[name="foldRockImageId"]')).toHaveCount(0);
  await expect(page.locator('[name="rockWallPenetrationPercent"]')).toHaveCount(0);
  await expect(page.locator('[name="rockActivatedWidthVw"]')).toHaveCount(0);
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveCount(0);
  await expect(page.getByText("3D Fold", { exact: true })).toHaveCount(0);
  await expect(page.locator('[name="rockEchoTrailEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(0);
  await expect(page.locator('[name="gravity"]')).toHaveCount(0);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator(".settings-scene-switcher")).toHaveCount(0);
  await expect(page.locator("[data-setting-control]")).toHaveCount(37);

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="rockEchoTrailEnabled"]')).toHaveCount(0);
  await expect(
    page.locator(".scene-page > .world > .rock-echo-trail"),
  ).toBeHidden();
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator("[data-setting-control]")).toHaveCount(103);

  await waitForDebugScene(page, "/scene-3", "juices");
  const cursorAssets = await page.locator(
    ".scene-page > .world > .hand-cursor:not(.is-remote)",
  ).evaluate(
    (cursor) => {
      const originalClassName = cursor.className;
      cursor.classList.remove("is-alternate", "is-grabbing");
      const open = getComputedStyle(cursor);
      const result = {
        open: open.backgroundImage,
        width: open.width,
      };
      cursor.classList.add("is-grabbing");
      result.grabbing = getComputedStyle(cursor).backgroundImage;
      cursor.className = originalClassName;
      return result;
    },
  );
  expect(cursorAssets.width).toBe("32px");
  expect(cursorAssets.open).toContain("data:image/svg+xml");
  expect(cursorAssets.grabbing).toContain("handgrabbing");
  expect(cursorAssets.grabbing).not.toBe(cursorAssets.open);
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="rockEchoTrailEnabled"]')).toHaveCount(0);
  await expect(
    page.locator(".scene-page > .world > .rock-echo-trail"),
  ).toBeHidden();
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="cameraFollowUpEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="rockJumpInertiaSpreadPercent"]')).toHaveCount(1);
  await expect(page.locator('[name="trailEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="glowDecimation"]')).toHaveCount(1);
  await expect(page.locator('[name="drizzleEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="finalFallEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="rockLensConfig"]')).toHaveCount(1);
  await expect(page.locator("[data-setting-control]")).toHaveCount(105);
});

test("scene 3 показывает пять WebGL-линз и восстанавливает Brandon Mercer flowmap", async ({ page }) => {
  await waitForDebugScene(page, "/scene-3", "juices");
  const canvas = page.getByTestId("rock-lens-canvas");
  await expect(canvas).toHaveClass(/is-ready/);
  await expect(canvas).toHaveAttribute("data-lens-effect", "brandon-mercer");

  const defaultState = await page.evaluate(() =>
    window.__sisyphusTestApi.getRockLensState(),
  );
  expect(defaultState).toMatchObject({
    available: true,
    flowmapSize: 512,
    imageReady: true,
    config: {
      effect: "brandon-mercer",
      radius: 0.3,
      strength: 0.49,
      softness: 1,
      trail: 0.15,
      dissipation: 0.96,
      activation: "hover",
    },
  });

  const effect = page.getByLabel("Эффект линзы");
  await expect(effect.locator("option")).toHaveCount(5);
  await effect.evaluate((element) => {
    const group = element.closest("details");
    if (group) group.open = true;
  });
  await expect(effect).toBeVisible();
  await effect.selectOption("vortex-lens");
  await expect(canvas).toHaveAttribute("data-lens-effect", "vortex-lens");
  const vortexConfig = await page.locator('[name="rockLensConfig"]').inputValue();
  expect(JSON.parse(vortexConfig)).toMatchObject({
    effect: "vortex-lens",
    radius: 0.44,
    twistDegrees: 165,
  });

  const rockBox = await page.locator(ROCK).boundingBox();
  await page.mouse.move(
    rockBox.x + rockBox.width * 0.25,
    rockBox.y + rockBox.height * 0.5,
  );
  await page.mouse.move(
    rockBox.x + rockBox.width * 0.75,
    rockBox.y + rockBox.height * 0.5,
    { steps: 8 },
  );
  await expect.poll(() => page.evaluate(() =>
    window.__sisyphusTestApi.getRockLensState().flowEnergy,
  )).toBeGreaterThan(0);
  await page.mouse.move(1, 1);
  await expect.poll(() => page.evaluate(() => {
    const state = window.__sisyphusTestApi.getRockLensState();
    return Math.max(state.amount, state.flowEnergy);
  }), { timeout: 7000 }).toBe(0);

  await page.getByTestId("rock-lens-reset").click();
  await expect(effect).toHaveValue("vortex-lens");
});

test("scene 3 магнитит камень и отпускает его только от настоящего scroll вниз", async ({ page }) => {
  await waitForDebugScene(page, "/scene-3", "juices");
  const target = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    const rock = document.querySelector(".rock");
    const rect = rock.getBoundingClientRect();
    return {
      rockCenterX: rect.left + rect.width / 2,
      rockCenterY: rect.top + rect.height / 2,
      targetX: imprint.x + rect.width / 2,
      targetY: imprint.y + rect.height / 2,
    };
  });
  await page.mouse.move(target.rockCenterX, target.rockCenterY);
  await page.mouse.down();
  await page.mouse.move(target.targetX, target.targetY, { steps: 16 });
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-three-rock-locked",
    "true",
  );
  await page.mouse.up();

  const centered = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    return {
      dx: Math.abs(api.motion.x - imprint.x),
      dy: Math.abs(api.motion.y - imprint.y),
    };
  });
  expect(centered.dx).toBeLessThan(0.5);
  expect(centered.dy).toBeLessThan(0.5);

  await page.evaluate(() => scrollTo(0, 20));
  await page.waitForTimeout(150);
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-three-rock-locked",
    "true",
  );

  await page.mouse.wheel(0, 120);
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-three-rock-locked",
    "false",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__sisyphusTestApi.motion.phase,
  )).toBe("fallingToBottom");
});

test("боковая панель растягивается, прокручивается отдельно и не обрезает значения", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  const panel = page.locator(".settings-panel");
  const panelScroll = panel.locator(".settings-panel__scroll");
  const resizeHandle = page.getByRole("separator", {
    name: "Изменить ширину панели параметров",
  });
  await expect(panel).toHaveClass(/is-open/);
  await expect(resizeHandle).toBeVisible();

  await panel.evaluate((element) => {
    element.querySelectorAll("details").forEach((details) => {
      details.open = true;
    });
  });
  await panelScroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  const desktopLayout = await panelScroll.evaluate((element) => {
    return {
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      width: element.closest(".settings-panel").getBoundingClientRect().width,
    };
  });
  expect(desktopLayout.scrollHeight).toBeGreaterThan(desktopLayout.clientHeight);

  const panelBox = await panel.boundingBox();
  const windowScrollBefore = await page.evaluate(() => scrollY);
  await page.mouse.move(
    panelBox.x + panelBox.width / 2,
    panelBox.y + panelBox.height / 2,
  );
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => panelScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(windowScrollBefore);

  const handleBox = await resizeHandle.boundingBox();
  const handleHitTarget = await page.evaluate(({ x, y }) =>
    document.elementFromPoint(x, y)?.className || "",
  {
    x: handleBox.x + handleBox.width / 2,
    y: handleBox.y + handleBox.height / 2,
  });
  expect(handleHitTarget).toContain("settings-panel__resize-handle");
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handleBox.x - 180, handleBox.y + handleBox.height / 2);
  await page.mouse.up();
  const resizedBox = await panel.boundingBox();
  expect(resizedBox.width).toBeGreaterThan(desktopLayout.width);
  expect(resizedBox.x + resizedBox.width).toBeLessThanOrEqual(1280 - 15);

  const pulseControl = page.locator('[name="rockPulseShrinkPercent"]')
    .locator("xpath=ancestor::*[@data-setting-control]");
  await pulseControl.scrollIntoViewIfNeeded();
  const clipping = await pulseControl.evaluate((control) => {
    const panelElement = control.closest(".settings-panel");
    const output = control.querySelector(".control-value");
    const label = control.querySelector(".control-label");
    const outputRect = output.getBoundingClientRect();
    const panelRect = panelElement.getBoundingClientRect();
    return {
      labelFits: label.scrollWidth <= label.clientWidth,
      outputFits: output.scrollWidth <= output.clientWidth,
      outputInsidePanel: outputRect.right <= panelRect.right,
      text: output.textContent,
    };
  });
  expect(clipping).toEqual({
    labelFits: true,
    outputFits: true,
    outputInsidePanel: true,
    text: "5%",
  });

  await page.setViewportSize({ width: 360, height: 640 });
  const narrowLayout = await panelScroll.evaluate((element) => {
    const panelElement = element.closest(".settings-panel");
    const rect = panelElement.getBoundingClientRect();
    return {
      horizontalOverflow: element.scrollWidth > element.clientWidth,
      right: rect.right,
      width: rect.width,
    };
  });
  await expect(resizeHandle).toBeHidden();
  expect(narrowLayout.horizontalOverflow).toBe(false);
  expect(narrowLayout.width).toBeLessThanOrEqual(328);
  expect(narrowLayout.right).toBeLessThanOrEqual(344.5);
});

test("скрытые настройки не оказывают клиентского влияния на чужую сцену", async ({ page }) => {
  await waitForDebugScene(page, "/scene-3", "juices");
  const sceneThreeScope = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.applyTestSettings({
      birchBackgroundEnabled: true,
      sceneTwoGlassEnabled: true,
      sceneTwoOverflowYVisible: true,
      sceneTwoGlassStrips: [
        {
          id: "foreign-glass",
          enabled: true,
          heightPercent: 50,
          xPercent: 20,
          widthPercent: 60,
          heightVh: 2,
        },
      ],
    });
    api.renderSceneTwoGlassStrips();
    return {
      birchesEnabled: document.body.classList.contains("birch-background-enabled"),
      glassHidden: document.querySelector(".scene-two-glass-strips").hidden,
      obstacles: api.getSceneTwoGlassObstacles(),
    };
  });
  expect(sceneThreeScope).toEqual({
    birchesEnabled: false,
    glassHidden: true,
    obstacles: [],
  });

  await waitForDebugScene(page, "/scene-2", "turnip");
  const sceneTwoScope = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.applyTestSettings({ rainEnabled: true });
    return {
      rainVisible: document
        .querySelector('[data-testid="weather-rain"]')
        .classList.contains("is-rain-visible"),
      summitRainArmed: api.armSummitRainScroll(),
    };
  });
  expect(sceneTwoScope).toEqual({
    rainVisible: false,
    summitRainArmed: false,
  });
});

test("настройки сцены 1 мигрируют из v53 в v54 с режимом выбора картин", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v54:cats-and-mice");
    localStorage.setItem(
      "sisyphus-czar-settings-v53:cats-and-mice",
      JSON.stringify({
        preclickPopupWidthViewportFraction: 0.3,
      }),
    );
  });

  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(
    page.locator('[name="preclickPopupWidthViewportFraction"]'),
  ).toHaveValue("0.3");
  await expect(page.locator('[name="rockEchoTrailEnabled"]')).toBeChecked();
  await expect(page.locator('[name="preclickPopupArtworkMode"]')).toHaveValue(
    "shuffle",
  );
  await expect(page.locator('[name="preclickPopupArtworkId"]')).toHaveValue(
    "01.png",
  );

  const migrated = await page.evaluate(() => {
    const stored = JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v54:cats-and-mice") || "{}",
    );
    return {
      hasLegacyPopupSize: Object.hasOwn(
        stored,
        "preclickPopupSizeMultiplier",
      ),
      popupWidth: stored.preclickPopupWidthViewportFraction,
      artworkMode: stored.preclickPopupArtworkMode,
      artworkId: stored.preclickPopupArtworkId,
      trailEnabled: stored.rockEchoTrailEnabled,
    };
  });
  expect(migrated).toEqual({
    hasLegacyPopupSize: false,
    popupWidth: 0.3,
    artworkMode: "shuffle",
    artworkId: "01.png",
    trailEnabled: true,
  });
});

test("одинаковый визуальный параметр хранит независимые значения сцен", async ({ page }) => {
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  const sceneOneValue = 30;
  await page.evaluate((value) => {
    localStorage.setItem(
      "sisyphus-czar-settings-v54:cats-and-mice",
      JSON.stringify({ ...window.__sisyphusTestApi.params, handWidthVw: value }),
    );
  }, sceneOneValue);
  await page.reload();
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("30");

  await waitForDebugScene(page, "/scene-2", "turnip");
  const sceneTwoDefault = Number(
    await page.locator('[name="handWidthVw"]').inputValue(),
  );
  expect(sceneTwoDefault).not.toBe(sceneOneValue);
  const sceneTwoValue = 20;
  await page.evaluate((value) => {
    localStorage.setItem(
      "sisyphus-czar-settings-v54:turnip",
      JSON.stringify({ ...window.__sisyphusTestApi.params, handWidthVw: value }),
    );
  }, sceneTwoValue);
  await page.reload();
  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("20");

  const snapshots = await page.evaluate(() => ({
    sceneOne: JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v54:cats-and-mice") || "{}",
    ).handWidthVw,
    sceneTwo: JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v54:turnip") || "{}",
    ).handWidthVw,
  }));
  expect(snapshots).toEqual({ sceneOne: sceneOneValue, sceneTwo: sceneTwoValue });

  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue(
    String(sceneOneValue),
  );
});

test("именованные версии фильтруются по scene namespace", async ({ page }) => {
  const versionName = `Только сцена 1 ${Date.now()}`;
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await page.waitForTimeout(300);
  await page.locator(".settings-version-name").fill(versionName);
  await page.locator(".settings-version-save").click();
  await expect.poll(() => page.evaluate((name) =>
    window.__sisyphusTestApi.getSettingsVersions().some(
      (entry) => entry.name === name && entry.id.startsWith("scene-1--"),
    ),
  versionName)).toBe(true);

  await waitForDebugScene(page, "/scene-2", "turnip");
  await page.waitForTimeout(300);
  expect(await page.evaluate((name) =>
    window.__sisyphusTestApi.getSettingsVersions().some(
      (entry) => entry.name === name,
    ),
  versionName)).toBe(false);
});

test("scene 2 завершается при первом контакте с отпечатком и остаётся там", async ({ page }) => {
  await waitForDebugScene(page, "/scene-2", "turnip");
  const completed = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    api.setPosition(imprint.x, imprint.y);
    return api.maybeCompleteSceneTwo();
  });
  expect(completed).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-completion-reason",
    "rock-touched-imprint",
  );
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/scene-2$/);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");

  await page.getByRole("button", { name: "Начать сначала" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");
  const centerOffset = await page.locator(ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      x: Math.abs(rect.left + rect.width / 2 - innerWidth / 2),
      y: Math.abs(rect.top + rect.height / 2 - innerHeight / 2),
    };
  });
  expect(centerOffset.x).toBeLessThan(2);
  expect(centerOffset.y).toBeLessThan(2);
});

test("scene 3 завершается только после падения, спуска камеры и запуска дождя", async ({ page }) => {
  await waitForDebugScene(page, "/scene-3", "juices");
  const beforeFall = await page.evaluate(() =>
    window.__sisyphusTestApi.maybeCompleteSceneThree(),
  );
  expect(beforeFall).toBe(false);

  const finalFallStarted = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    api.params.finalFallEnabled = true;
    api.params.finalFallDelaySeconds = 0;
    api.motion.phase = api.SharedPhysics.PHASES.PLAY;
    api.motion.dragging = true;
    api.setPosition(imprint.x, imprint.y);
    api.syncFinalFallGate();
    return api.beginFinalReturnFall();
  });
  expect(finalFallStarted).toBe(true);
  await expect(page.getByTestId("weather-rain")).toHaveClass(/is-rain-visible/);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");

  const completed = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.updateBounds();
    api.setPosition(api.motion.x, api.bounds.maxY);
    scrollTo(0, document.documentElement.scrollHeight);
    return api.maybeCompleteSceneThree();
  });
  expect(completed).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-completion-reason",
    "rock-fell-camera-followed-rain-started",
  );
  await expect(page).toHaveURL(/\/scene-3$/);
  await expect.poll(() => page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return Math.abs(scrollY - max);
  })).toBeLessThan(2);
  await expect(page.getByTestId("weather-rain")).toHaveClass(/is-rain-visible/);
});
