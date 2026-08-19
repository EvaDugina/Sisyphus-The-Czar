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
  await expect(page.locator(".settings-panel__scene-title")).toHaveText(
    "Параметры · Сцена 1. Кошки-мышки",
  );
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(1);
  await expect(page.locator('[name="handAudioEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveCount(1);
  await expect(page.locator('[name="rockActivatedWidthVw"]')).toHaveCount(1);
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveCount(1);
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(0);
  await expect(page.locator('[name="gravity"]')).toHaveCount(0);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator(".settings-scene-switcher")).toHaveCount(0);
  await expect(page.locator("[data-setting-control]")).toHaveCount(41);

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator("[data-setting-control]")).toHaveCount(103);

  await waitForDebugScene(page, "/scene-3", "juices");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="cameraFollowUpEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="rockJumpInertiaSpreadPercent"]')).toHaveCount(1);
  await expect(page.locator('[name="trailEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="glowDecimation"]')).toHaveCount(1);
  await expect(page.locator('[name="drizzleEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="finalFallEnabled"]')).toHaveCount(1);
  await expect(page.locator("[data-setting-control]")).toHaveCount(104);
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

test("одинаковый визуальный параметр хранит независимые значения сцен", async ({ page }) => {
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  const sceneOneValue = 30;
  await page.evaluate((value) => {
    localStorage.setItem(
      "sisyphus-czar-settings-v51:cats-and-mice",
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
      "sisyphus-czar-settings-v51:turnip",
      JSON.stringify({ ...window.__sisyphusTestApi.params, handWidthVw: value }),
    );
  }, sceneTwoValue);
  await page.reload();
  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("20");

  const snapshots = await page.evaluate(() => ({
    sceneOne: JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v51:cats-and-mice") || "{}",
    ).handWidthVw,
    sceneTwo: JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v51:turnip") || "{}",
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
