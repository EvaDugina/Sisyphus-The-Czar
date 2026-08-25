const { test, expect } = require("@playwright/test");

const ROCK = "#root > .scene-page > .world > .rock";
const SETTINGS_PANEL_SCENES = [
  { path: "/scene-1", sceneId: "cats-and-mice" },
  { path: "/scene-2", sceneId: "turnip" },
  { path: "/scene-3", sceneId: "juices" },
];

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

async function setSettingValue(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((element, nextValue) => {
    if (element.type === "checkbox") {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      ).set;
      setter.call(element, Boolean(nextValue));
    } else {
      const prototype = element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
      setter.call(element, String(nextValue));
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("панель параметров сворачивается и раскрывается на всех сценах", async ({
  page,
}) => {
  for (const { path, sceneId } of SETTINGS_PANEL_SCENES) {
    await waitForDebugScene(page, path, sceneId);
    const panel = page.locator("#settings-panel");
    const toggle = page.locator(".settings-toggle");

    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "settings-panel");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Свернуть параметры");

    await page.evaluate(() => {
      window.__settingsFoldRuntime = window.__sisyphusTestApi;
    });
    const sessionId = await page.evaluate(
      () => window.__sisyphusTestApi.collab.sessionId,
    );

    await toggle.click();
    await expect(panel).toBeHidden();
    await expect(panel).toHaveAttribute("hidden", "");
    await expect(panel).toHaveAttribute("aria-hidden", "true");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-label", "Открыть параметры");
    const compactBox = await toggle.boundingBox();
    expect(compactBox.width).toBeCloseTo(44, 0);
    expect(compactBox.height).toBeCloseTo(44, 0);

    await toggle.press("Enter");
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute("hidden", "");
    await expect(panel).toHaveAttribute("aria-hidden", "false");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveAttribute("aria-label", "Свернуть параметры");
    expect(await page.evaluate(() => ({
      runtimePreserved:
        window.__sisyphusTestApi === window.__settingsFoldRuntime,
      sessionId: window.__sisyphusTestApi.collab.sessionId,
    }))).toEqual({ runtimePreserved: true, sessionId });

    await toggle.press("Space");
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(panel).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

test("inline UI показывает только параметры текущей сцены", async ({ page }) => {
  test.setTimeout(60_000);
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
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(
    page.locator('[name="preclickPopupBackgroundDelaySeconds"]'),
  ).toHaveValue("1");
  await expect(page.locator('[name="preclickFirstHopOnClick"]')).toHaveCount(1);
  const fakeClickSound = page.locator('[name="preclickHopSoundFilename"]');
  const artworkMode = page.locator('[name="preclickPopupArtworkMode"]');
  const artworkId = page.locator('[name="preclickPopupArtworkId"]');
  await artworkMode.evaluate((element) => {
    const group = element.closest("details");
    if (group) group.open = true;
  });
  await expect(artworkMode).toHaveValue("shuffle");
  await expect(fakeClickSound).toHaveValue("Смех.mp3");
  await expect(fakeClickSound.locator("option")).toHaveCount(12);
  await expect(fakeClickSound.locator('option[value="none"]')).toHaveText(
    "Без звука",
  );
  await expect(
    fakeClickSound.locator('option[value="СимуляцияОргазма.mov"]'),
  ).toHaveText("Симуляция оргазма");
  await fakeClickSound.selectOption("none");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.params.preclickHopSoundFilename,
      ),
    )
    .toBe("none");
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
  await expect(page.locator("[data-setting-control]")).toHaveCount(39);
  await expect(page.locator('[data-shared-setting="true"]')).toHaveCount(20);
  await expect(page.locator('[data-shared-scenes="1–3"]')).toHaveCount(20);
  await expect(page.locator("[data-setting-shared-badge]")).toHaveCount(20);

  const pulseScaleRange = await page.evaluate(async () => {
    window.__sisyphusTestApi.applyTestSettings({
      rockPulseEnabled: true,
      rockPulseBpm: 240,
      rockPulseShrinkPercent: 10,
    });
    const samples = [];
    for (let index = 0; index < 12; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      samples.push(
        window.__sisyphusTestApi.getRockVisualScaleState().pulseScaleFactor,
      );
    }
    return {
      max: Math.max(...samples),
      min: Math.min(...samples),
    };
  });
  expect(pulseScaleRange.max - pulseScaleRange.min).toBeGreaterThan(0.03);

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="preclickFirstHopOnClick"]')).toHaveCount(0);
  await expect(page.locator('[name="rockEchoTrailEnabled"]')).toHaveCount(0);
  await expect(
    page.locator(".scene-page > .world > .rock-echo-trail"),
  ).toBeHidden();
  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator("[data-setting-control]")).toHaveCount(104);
  await expect(page.locator('[data-shared-setting="true"]')).toHaveCount(84);
  await expect(page.locator('[data-shared-scenes="1–3"]')).toHaveCount(20);
  await expect(page.locator('[data-shared-scenes="2–3"]')).toHaveCount(64);
  const rockClickSound = page.locator('[name="gachiClickSoundFilename"]');
  await expect(rockClickSound.locator("option")).toHaveCount(10);
  await expect(rockClickSound.locator('option[value="none"]')).toHaveText(
    "Без звука",
  );
  await setSettingValue(page, "gachiClickSoundFilename", "none");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.params.gachiClickSoundFilename,
      ),
    )
    .toBe("none");

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
  await expect(page.locator('[name="preclickFirstHopOnClick"]')).toHaveCount(0);
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
  await expect(page.locator("[data-setting-control]")).toHaveCount(106);
  await expect(page.locator('[data-shared-setting="true"]')).toHaveCount(84);
  await expect(page.locator('[data-shared-scenes="1–3"]')).toHaveCount(20);
  await expect(page.locator('[data-shared-scenes="2–3"]')).toHaveCount(64);
});

test("общие параметры мигрируют по предыдущей сцене и сохраняют последнее изменение", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("shared-scene-settings-seeded")) {
      return;
    }
    sessionStorage.setItem("shared-scene-settings-seeded", "true");
    localStorage.removeItem("sisyphus-czar-shared-scene-settings-v1");
    localStorage.setItem(
      "sisyphus-czar-settings-v56:cats-and-mice",
      JSON.stringify({
        rockMinWidthVw: 21,
        rockPulseShrinkPercent: 3.7,
        themeMode: "dark",
      }),
    );
    localStorage.setItem(
      "sisyphus-czar-settings-v56:turnip",
      JSON.stringify({
        gravity: 7,
        rockMinWidthVw: 31,
        sceneTwoOverflowYVisible: true,
        themeMode: "auto",
      }),
    );
    localStorage.setItem(
      "sisyphus-czar-settings-v56:juices",
      JSON.stringify({
        gravity: 9,
        rockMinWidthVw: 41,
        sceneTwoOverflowYVisible: false,
        themeMode: "light",
      }),
    );
  });

  await waitForDebugScene(page, "/scene-3", "juices");
  await expect(page.locator('[name="themeMode"]')).toHaveValue("dark");
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("21");
  await expect(page.locator('[name="gravity"]')).toHaveValue("7");
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "3.7",
  );
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveAttribute(
    "max",
    "10",
  );
  expect(
    await page.evaluate(
      () => window.__sisyphusTestApi.params.sceneTwoOverflowYVisible,
    ),
  ).toBe(false);

  await setSettingValue(page, "themeMode", "light");
  await setSettingValue(page, "gravity", "5.5");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        gravity: window.__sisyphusTestApi.params.gravity,
        themeMode: window.__sisyphusTestApi.params.themeMode,
      })),
    )
    .toEqual({ gravity: 5.5, themeMode: "light" });

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="themeMode"]')).toHaveValue("light");
  await expect(page.locator('[name="gravity"]')).toHaveValue("5.5");
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("21");
  expect(
    await page.evaluate(
      () => window.__sisyphusTestApi.params.sceneTwoOverflowYVisible,
    ),
  ).toBe(true);
  await setSettingValue(page, "rockPulseShrinkPercent", "4.6");

  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.locator('[name="themeMode"]')).toHaveValue("light");
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("21");
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "4.6",
  );
  await expect(page.locator('[name="gravity"]')).toHaveCount(0);

  const stored = await page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("sisyphus-czar-shared-scene-settings-v1"),
    ),
  );
  expect(stored.version).toBe(1);
  expect(stored.settings).toMatchObject({
    gravity: 5.5,
    rockMinWidthVw: 21,
    rockPulseShrinkPercent: 4.6,
    themeMode: "light",
  });
});

test("scene 1 запускает сохранённый дробный пульс без изменения UI", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sisyphus-czar-settings-v56:cats-and-mice",
      JSON.stringify({
        rockPulseBpm: 240,
        rockPulseEnabled: true,
        rockPulseShrinkPercent: 3.7,
      }),
    );
  });
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");

  const pulseShrink = page.locator('[name="rockPulseShrinkPercent"]');
  await expect(pulseShrink).toHaveAttribute("min", "0");
  await expect(pulseShrink).toHaveAttribute("max", "10");
  await expect(pulseShrink).toHaveAttribute("step", "0.1");
  await expect(pulseShrink).toHaveValue("3.7");
  await expect(
    page.locator('[data-output="rockPulseShrinkPercent"]'),
  ).toHaveText("3.7%");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.params.rockPulseShrinkPercent,
      ),
    )
    .toBe(3.7);

  const samplePulseRange = () =>
    page.evaluate(async () => {
      const samples = [];
      for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        samples.push(
          window.__sisyphusTestApi.getRockVisualScaleState().pulseScaleFactor,
        );
      }
      return Math.max(...samples) - Math.min(...samples);
    });

  expect(await samplePulseRange()).toBeGreaterThan(0.01);
  await page.getByTestId("restart-session").click();
  await expect.poll(() => page.evaluate(() => motion.phase)).toBe("play");
  expect(await samplePulseRange()).toBeGreaterThan(0.01);
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
  const magnetized = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    api.collab.enabled = false;
    api.motion.imprint = { ...imprint };
    api.motion.phase = api.SharedPhysics.PHASES.PLAY;
    api.motion.dragging = true;
    api.setPosition(imprint.x, imprint.y);
    return api.startSceneThreeMagnetPlacement();
  });
  expect(magnetized).toBe(true);
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-three-rock-locked",
    "true",
  );

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
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(page.getByTestId("summit-timer")).toBeVisible();

  const scrollBeforeRelease = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 120);
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-three-rock-locked",
    "false",
  );
  await expect.poll(() => page.evaluate(() =>
    window.__sisyphusTestApi.sceneFlow.finalFallStarted,
  )).toBe(true);
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(page.getByTestId("summit-timer")).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(scrollBeforeRelease);
  await expect.poll(() => page.evaluate(() =>
    window.__sisyphusTestApi.getSummitRainScrollState().started,
  )).toBe(true);
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

test("настройки сцены 1 мигрируют из v55 в v56 с фиксированными кликами и задержкой фокуса", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v56:cats-and-mice");
    localStorage.setItem(
      "sisyphus-czar-settings-v55:cats-and-mice",
      JSON.stringify({
        preclickHopGuardClickCount: 9,
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
  await expect(page.locator('[name="preclickHopSoundFilename"]')).toHaveValue(
    "Смех.mp3",
  );

  const migrated = await page.evaluate(() => {
    const stored = JSON.parse(
      localStorage.getItem("sisyphus-czar-settings-v56:cats-and-mice") || "{}",
    );
    return {
      hasLegacyPopupSize: Object.hasOwn(
        stored,
        "preclickPopupSizeMultiplier",
      ),
      popupWidth: stored.preclickPopupWidthViewportFraction,
      backgroundDelaySeconds: stored.preclickPopupBackgroundDelaySeconds,
      guardClickCount: stored.preclickHopGuardClickCount,
      artworkMode: stored.preclickPopupArtworkMode,
      artworkId: stored.preclickPopupArtworkId,
      soundFilename: stored.preclickHopSoundFilename,
      trailEnabled: stored.rockEchoTrailEnabled,
    };
  });
  expect(migrated).toEqual({
    hasLegacyPopupSize: false,
    popupWidth: 0.3,
    backgroundDelaySeconds: 1,
    guardClickCount: 2,
    artworkMode: "shuffle",
    artworkId: "01.png",
    soundFilename: "Смех.mp3",
    trailEnabled: true,
  });
});

test("общий визуальный параметр хранит последнее значение между сценами", async ({ page }) => {
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  const sceneOneValue = 30;
  await setSettingValue(page, "handWidthVw", sceneOneValue);
  await page.reload();
  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("30");

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("30");
  const sceneTwoValue = 20;
  await setSettingValue(page, "handWidthVw", sceneTwoValue);
  await page.reload();
  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue("20");

  await waitForDebugScene(page, "/scene-1", "cats-and-mice");
  await expect(page.locator('[name="handWidthVw"]')).toHaveValue(
    String(sceneTwoValue),
  );
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem("sisyphus-czar-shared-scene-settings-v1") || "{}",
      ).settings?.handWidthVw,
    ),
  ).toBe(sceneTwoValue);
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

test("кнопка сохраняет полный Git-снимок настроек каждой сцены", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const scenes = [
    {
      path: "/scene-1",
      sceneId: "cats-and-mice",
      settings: { handWidthVw: 13 },
    },
    {
      path: "/scene-2",
      sceneId: "turnip",
      settings: {
        trailRenderProfile: "mobile",
        glowTargetFps: 45,
        glowOptimizationMode: "manual",
        glowBufferScalePercent: 55,
        glowUpdateFps: 17,
        glowMaxPoints: 650,
        glowDecimation: 3,
      },
    },
    {
      path: "/scene-3",
      sceneId: "juices",
      settings: {
        trailRenderProfile: "high",
        glowTargetFps: 45,
        glowOptimizationMode: "manual",
        glowBufferScalePercent: 60,
        glowUpdateFps: 18,
        glowMaxPoints: 700,
        glowDecimation: 4,
      },
    },
  ];

  for (const { path, sceneId, settings } of scenes) {
    await waitForDebugScene(page, path, sceneId);
    for (const [name, value] of Object.entries(settings)) {
      await setSettingValue(page, name, value);
    }
    const versionName = `Git snapshot ${sceneId} ${Date.now()}`;
    await page.locator(".settings-version-name").fill(versionName);
    await page.locator(".settings-version-save").click();
    await expect(page.locator(".settings-production-status")).toContainText(
      "Общий шаблон сохранён",
    );
    await expect.poll(() => page.evaluate(({ name, expectedSettings }) => {
      const entry = window.__sisyphusTestApi.getSettingsVersions().find(
        (candidate) => candidate.name === name,
      );
      return entry
        ? Object.fromEntries(
            Object.keys(expectedSettings).map((key) => [key, entry.settings[key]]),
          )
        : null;
    }, { name: versionName, expectedSettings: settings })).toEqual(settings);

    await page.reload();
    await waitForDebugScene(page, path, sceneId);
    await expect.poll(() => page.evaluate((name) =>
      window.__sisyphusTestApi.getSettingsVersions().some(
        (entry) =>
          entry.name === name &&
          entry.id.startsWith(`${location.pathname.slice(1)}--`),
      ),
    versionName)).toBe(true);
  }
});

test("scene 2 пульсирует без руки и допускает повторный захват после выпадения", async ({
  page,
}) => {
  await waitForDebugScene(page, "/scene-2", "turnip");
  const rock = page.locator(ROCK);
  const wallImpactSound = page.locator('[name="wallImpactSoundFilename"]');
  const jumpSpread = page.locator('[name="rockJumpInertiaSpreadPercent"]');

  expect(
    await wallImpactSound.locator("option").evaluateAll((options) =>
      options.map((option) => [option.value, option.textContent]),
    ),
  ).toEqual([
    ["none", "Без звука"],
    ["СимуляцияОргазма.mov", "Симуляция оргазма"],
    ["Aaaaaa.mp3", "Aaaaaa"],
    ["Aaaaah.mp3", "Aaaaah"],
    ["Camen.mp3", "Camen"],
    ["Deep dark fantasies.mp3", "Deep dark fantasies"],
    ["Dungeon master.mp3", "Dungeon master"],
    ["Get your ass down for me now boy.mp3", "Get your ass down for me now boy"],
    ["Like that.mp3", "Like that"],
    ["ahhhhhhh.mp3", "ahhhhhhh"],
    ["thats-amazing.mp3", "thats-amazing"],
  ]);
  await expect(jumpSpread).toHaveAttribute("min", "0");
  await expect(jumpSpread).toHaveAttribute("max", "1");
  await expect(jumpSpread).toHaveAttribute("step", "0.01");

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      gachiClickSoundFilename: "none",
      randomDropEnabled: false,
      rockJumpEnabled: false,
      rockJumpInertiaSpreadPercent: 0.37,
      rockPulseBpm: 240,
      rockPulseEnabled: true,
      rockPulseShrinkPercent: 10,
    });
  });

  async function pulseRange() {
    return page.evaluate(async () => {
      const samples = [];
      for (let index = 0; index < 12; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        samples.push(
          window.__sisyphusTestApi.getRockVisualScaleState().pulseScaleFactor,
        );
      }
      return {
        max: Math.max(...samples),
        min: Math.min(...samples),
      };
    });
  }

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__sisyphusTestApi.getRockVisualScaleState().sceneTwoSizeState,
      ),
    )
    .toBe("ground");
  const initialPulse = await pulseRange();
  expect(initialPulse.max - initialPulse.min).toBeGreaterThan(0.03);

  const audioPlayCount = await page.evaluate(
    () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
  );
  const firstBox = await rock.boundingBox();
  expect(firstBox).not.toBeNull();
  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2,
  );
  await page.mouse.down();
  await expect(rock).toHaveAttribute("data-sticky-to-hand", "true");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        state:
          window.__sisyphusTestApi.getRockVisualScaleState().sceneTwoSizeState,
      })),
    )
    .toEqual({ dragging: true, state: "held" });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getRockVisualScaleState(),
      ),
    )
    .toMatchObject({ pressActive: true, pulseScaleFactor: 1 });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(audioPlayCount);

  await page.mouse.up();
  await expect(rock).toHaveAttribute("data-sticky-to-hand", "true");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        state:
          window.__sisyphusTestApi.getRockVisualScaleState().sceneTwoSizeState,
      })),
    )
    .toEqual({ dragging: true, state: "held" });

  await page.evaluate(() => {
    window.__sisyphusTestApi.forceReleaseRock({ neutral: true });
  });
  await expect(rock).not.toHaveAttribute("data-sticky-to-hand", "true");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        state:
          window.__sisyphusTestApi.getRockVisualScaleState().sceneTwoSizeState,
      })),
    )
    .toMatchObject({ dragging: false });
  const releasedPulse = await pulseRange();
  expect(releasedPulse.max - releasedPulse.min).toBeGreaterThan(0.03);

  const secondBox = await rock.boundingBox();
  expect(secondBox).not.toBeNull();
  await page.mouse.move(
    secondBox.x + secondBox.width / 2,
    secondBox.y + secondBox.height / 2,
  );
  await page.mouse.down();
  await expect(rock).toHaveAttribute("data-sticky-to-hand", "true");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        state:
          window.__sisyphusTestApi.getRockVisualScaleState().sceneTwoSizeState,
      })),
    )
    .toEqual({ dragging: true, state: "held" });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getRockVisualScaleState().pulseScaleFactor,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(audioPlayCount);

  await page.evaluate(() => {
    window.__sisyphusTestApi.forceReleaseRock({ neutral: true });
  });
});

test("scene 2 магнитит камень в отпечаток и доскролливает камеру наверх", async ({ page }) => {
  await waitForDebugScene(page, "/scene-2", "turnip");
  const completion = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    const offsetX = Math.min(20, imprint.toleranceX / 2);
    const offsetY = Math.min(20, imprint.toleranceY / 2);
    api.params.cameraFollowUpEnabled = false;
    api.setPosition(imprint.x + offsetX, imprint.y + offsetY);
    scrollTo(0, document.documentElement.scrollHeight);
    const scrollBefore = scrollY;
    const completed = api.maybeCompleteSceneTwo();
    return {
      completed,
      magnetizing: document.querySelector(".rock")
        .classList.contains("is-imprint-magnetizing"),
      offsetX,
      offsetY,
      repeated: api.maybeCompleteSceneTwo(),
      scrollBefore,
    };
  });
  expect(completion).toMatchObject({
    completed: true,
    magnetizing: true,
    repeated: false,
  });
  expect(completion.offsetX).toBeGreaterThan(0);
  expect(completion.offsetY).toBeGreaterThan(0);
  expect(completion.scrollBefore).toBeGreaterThan(0);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-completion-reason",
    "rock-touched-imprint",
  );
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
  await expect
    .poll(() => page.evaluate(() => scrollY), { timeout: 15_000 })
    .toBe(0);
  await expect(page.locator(ROCK)).not.toHaveClass(/is-imprint-magnetizing/);
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/scene-2$/);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  const stableFinalState = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    return {
      dx: Math.abs(api.motion.x - imprint.x),
      dy: Math.abs(api.motion.y - imprint.y),
      scrollY,
    };
  });
  expect(stableFinalState).toEqual({ dx: 0, dy: 0, scrollY: 0 });

  await page.setViewportSize({ width: 1100, height: 650 });
  await expect
    .poll(() => page.evaluate(() => {
      const api = window.__sisyphusTestApi;
      const imprint = api.activeLocalImprint();
      return {
        dx: Math.abs(api.motion.x - imprint.x),
        dy: Math.abs(api.motion.y - imprint.y),
        scrollY,
      };
    }))
    .toEqual({ dx: 0, dy: 0, scrollY: 0 });

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

test("scene 3 скрывает руку при контакте и сохраняет светлую тему после отпускания", async ({ page }) => {
  await waitForDebugScene(page, "/scene-3", "juices");
  const timer = page.getByTestId("summit-timer");
  const leaderboard = page.getByTestId("summit-leaderboard");
  const hand = page.locator(
    ".scene-page > .world > .hand-cursor:not(.is-remote)",
  );
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await expect(timer).toBeHidden();
  await expect(leaderboard).toHaveCSS("display", "grid");
  await expect(leaderboard).toHaveCSS("visibility", "visible");
  await expect(hand).toHaveClass(/is-visible/);

  const darkLeaderboardPosition = await leaderboard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });

  const placementStarted = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const imprint = api.activeLocalImprint();
    api.motion.phase = api.SharedPhysics.PHASES.PLAY;
    api.motion.dragging = true;
    api.setPosition(imprint.x, imprint.y);
    return api.startSceneThreeMagnetPlacement();
  });
  expect(placementStarted).toBe(true);
  await expect(hand).not.toHaveClass(/is-visible/);
  await page.mouse.move(0, 0);
  await page.locator(ROCK).hover();
  await expect(hand).not.toHaveClass(/is-visible/);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.collab.localPointer.visible,
      ),
    )
    .toBe(false);
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(timer).toBeVisible();

  const lightLeaderboardPosition = await leaderboard.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  expect(lightLeaderboardPosition.left).toBeCloseTo(
    darkLeaderboardPosition.left,
    1,
  );
  expect(lightLeaderboardPosition.top).toBeCloseTo(
    darkLeaderboardPosition.top,
    1,
  );

  const timerGeometry = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    const timer = document.querySelector('[data-testid="summit-timer"]');
    const measure = () => {
      const rect = timer.getBoundingClientRect();
      return {
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        width: rect.width,
      };
    };
    api.applyTestSettings({
      summitTimerFontSizeRem: 12,
      summitTimerFontWidthPercent: 100,
    });
    const compact = measure();
    api.applyTestSettings({
      summitTimerFontSizeRem: 24,
      summitTimerFontWidthPercent: 175,
    });
    return { compact, expanded: measure(), viewportCenterX: innerWidth / 2 };
  });
  expect(
    Math.abs(timerGeometry.compact.centerX - timerGeometry.viewportCenterX),
  ).toBeLessThan(1);
  expect(
    Math.abs(timerGeometry.expanded.centerX - timerGeometry.viewportCenterX),
  ).toBeLessThan(1);
  expect(
    Math.abs(timerGeometry.expanded.centerY - timerGeometry.compact.centerY),
  ).toBeLessThan(1);
  expect(timerGeometry.expanded.width).toBeGreaterThan(
    timerGeometry.compact.width * 3,
  );

  const beforeFall = await page.evaluate(() =>
    window.__sisyphusTestApi.maybeCompleteSceneThree(),
  );
  expect(beforeFall).toBe(false);

  const finalFallStarted = await page.evaluate(() =>
    window.__sisyphusTestApi.beginFinalReturnFall(),
  );
  expect(finalFallStarted).toBe(true);
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(timer).toBeVisible();
  await expect(page.getByTestId("weather-rain")).toHaveClass(/is-rain-visible/);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");

  const fallProfile = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.updateBounds();
    const scrollBefore = scrollY;
    let peak = api.getSummitRainScrollState();
    for (let step = 1; step < 20; step += 1) {
      api.setPosition(api.motion.x, api.bounds.maxY * (step / 20));
      api.applyPhysics(0);
      const sample = api.getSummitRainScrollState();
      if (sample.opacity > peak.opacity) {
        peak = sample;
      }
    }
    api.updateCameraFollow({ immediate: true });
    api.setPosition(api.motion.x, api.bounds.maxY);
    api.applyPhysics(0);
    const completed = api.maybeCompleteSceneThree();
    return {
      completed,
      peak,
      scrollBefore,
      scrollAfter: scrollY,
    };
  });
  expect(fallProfile.peak.opacity).toBeGreaterThan(0.99);
  expect(fallProfile.peak.volume).toBeCloseTo(fallProfile.peak.maxVolume, 2);
  expect(fallProfile.scrollAfter).toBe(fallProfile.scrollBefore);
  expect(fallProfile.completed).toBe(true);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-completion-reason",
    "rock-fell-rain-finished",
  );
  await expect(page.locator("body")).toHaveClass(/theme-light/);
  await expect(timer).toBeVisible();
  await expect(page).toHaveURL(/\/scene-3$/);
  await expect(page.getByTestId("weather-rain")).not.toHaveClass(/is-rain-visible/);
  await expect.poll(() => page.evaluate(() =>
    window.__sisyphusTestApi.getSummitRainScrollState().volume,
  )).toBe(0);
});
