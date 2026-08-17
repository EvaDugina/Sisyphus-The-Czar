const { test, expect } = require("@playwright/test");

async function waitForFoldReady(page) {
  const layer = page.locator("[data-fold-layer]");
  await expect(layer).toHaveAttribute("data-fold-ready", "true");
  await expect(layer).toHaveAttribute("data-fold-enabled", "true");
  return layer;
}

async function navigateToSettings(page) {
  const href = await page.locator(".settings-toggle").getAttribute("href");
  expect(href).toMatch(/^\/settings\//);
  await page.goto(href);
  await expect(page).toHaveURL(/\/settings\//);
  await expect(page.locator("#settings-panel")).toHaveAttribute(
    "aria-hidden",
    "false",
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

async function visibleRockPoint(page) {
  return page.locator("#root > .world > .rock").evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, innerHeight);
    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const x = left + (right - left) * xRatio;
        const y = top + (bottom - top) * yRatio;
        const hit = document.elementFromPoint(x, y);
        if (hit === rock || rock.contains(hit)) {
          return { x, y };
        }
      }
    }
    throw new Error("Не найдена видимая точка камня");
  });
}

test("legacy drafts маршруты возвращают 404", async ({ request }) => {
  for (const path of ["/drafts", "/drafts/", "/drafts/assets/missing.js"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
  }
});

test("Fold-настройки мигрируют из localStorage v32 в v49", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v32",
      JSON.stringify({
        draftFoldAngle: 47,
        draftFoldZoneSize: 13,
        draftFoldBlendEnabled: false,
        draftFoldBlendCurve: "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
      }),
    );
  });
  await page.goto("/");
  const layer = await waitForFoldReady(page);
  await expect(layer).toHaveAttribute("data-fold-angle", "47");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "13");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          foldAngle: stored.foldAngle,
          foldZoneSize: stored.foldZoneSize,
          foldBlendEnabled: stored.foldBlendEnabled,
          foldBlendCurve: stored.foldBlendCurve,
          preclickHopMaxDistancePercent: stored.preclickHopMaxDistancePercent,
          hasLegacy: Object.keys(stored).some((key) => key.startsWith("draftFold")),
        };
      }),
    )
    .toEqual({
      foldAngle: 47,
      foldZoneSize: 13,
      foldBlendEnabled: false,
      foldBlendCurve: "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
      preclickHopMaxDistancePercent: 62.5,
      hasLegacy: false,
    });
  await page.reload();
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return [stored.foldAngle, stored.foldZoneSize];
      }),
    )
    .toEqual([47, 13]);
});

test("настройки popup и берёз мигрируют из localStorage v47 в v49", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v47",
      JSON.stringify({ preclickPopupDelayMs: 345 }),
    );
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          delay: stored.preclickPopupDelayMs,
          popupSize: stored.preclickPopupSizeMultiplier,
          birchesEnabled: stored.birchBackgroundEnabled,
          birchScale: stored.birchScalePercent,
        };
      }),
    )
    .toEqual({
      delay: 345,
      popupSize: 2,
      birchesEnabled: false,
      birchScale: 100,
    });
});

test("hop-настройки мигрируют из localStorage v39 в v49 без legacy-полей", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v39",
      JSON.stringify({
        preclickHopActivationRadiusVw: 12,
        preclickHopMaxDistanceVw: 184.3,
        preclickParallaxMaxOffsetVw: 8,
        preclickParallaxStartDelayMs: 320,
        preclickParallaxInverted: true,
        cameraFollowLerp: 0.25,
      }),
    );
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          guardClicks: stored.preclickHopGuardClickCount,
          radius: stored.preclickHopActivationRadiusPercent,
          distance: stored.preclickHopMaxDistancePercent,
          cameraFollowUpLerp: stored.cameraFollowUpLerp,
          cameraFollowDownLerp: stored.cameraFollowDownLerp,
          hasLegacyCamera: Object.hasOwn(stored, "cameraFollowLerp"),
          hasLegacy: Object.keys(stored).some((key) =>
            key.startsWith("preclickParallax") ||
            key === "preclickHopActivationRadiusVw" ||
            key === "preclickHopMaxDistanceVw",
          ),
        };
      }),
    )
    .toEqual({
      guardClicks: 1,
      radius: 12,
      distance: 150,
      cameraFollowUpLerp: 0.25,
      cameraFollowDownLerp: 0.25,
      hasLegacyCamera: false,
      hasLegacy: false,
    });
});

test("визуальные настройки камня мигрируют из localStorage v34 в v49", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v34",
      JSON.stringify({ rockPressShrinkPercent: 17 }),
    );
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          rockImageId: stored.rockImageId,
          foldRockImageId: stored.foldRockImageId,
          rockPressShrinkPercent: stored.rockPressShrinkPercent,
          rockPulseShrinkPercent: stored.rockPulseShrinkPercent,
        };
      }),
    )
    .toEqual({
      rockImageId: "rock-03",
      foldRockImageId: "rock-03",
      rockPressShrinkPercent: 17,
      rockPulseShrinkPercent: 17,
    });
});

test("настройки руки мигрируют из localStorage v36 в v49", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v36",
      JSON.stringify({ handAlwaysVisible: false }),
    );
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          handVisibilityMode: stored.handVisibilityMode,
          handImageChangeDelayMs: stored.handImageChangeDelayMs,
          hasLegacy: Object.hasOwn(stored, "handAlwaysVisible"),
        };
      }),
    )
    .toEqual({
      handVisibilityMode: "hover",
      handImageChangeDelayMs: 0,
      hasLegacy: false,
    });
});

test("раскладка Fold мигрирует из localStorage v37 в v49", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
    localStorage.setItem(
      "sisyphus-czar-settings-v37",
      JSON.stringify({ foldZoneSize: 14 }),
    );
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          foldPanelHeightVh: stored.foldPanelHeightVh,
          foldPositionPercent: stored.foldPositionPercent,
        };
      }),
    )
    .toEqual({ foldPanelHeightVh: 14, foldPositionPercent: 0 });
});

test("группа Камень показывает десять контролов сцены 1", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v49");
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);

  const guardClicks = page.locator('[name="preclickHopGuardClickCount"]');
  const popupDelay = page.locator('[name="preclickPopupDelayMs"]');
  const popupSize = page.locator('[name="preclickPopupSizeMultiplier"]');
  const birchesEnabled = page.locator('[name="birchBackgroundEnabled"]');
  const birchScale = page.locator('[name="birchScalePercent"]');
  const birchScaleOutput = page.locator('[data-output="birchScalePercent"]');
  const radius = page.locator('[name="preclickHopActivationRadiusPercent"]');
  const distance = page.locator('[name="preclickHopMaxDistancePercent"]');
  const distanceOutput = page.locator(
    '[data-output="preclickHopMaxDistancePercent"]',
  );
  await expect(guardClicks).toHaveValue("1");
  await expect(guardClicks).toHaveAttribute("min", "0");
  await expect(guardClicks).toHaveAttribute("max", "10");
  await expect(guardClicks).toHaveAttribute("step", "1");
  await expect(
    guardClicks.locator("xpath=ancestor::*[@data-setting-control]")
  ).toContainText("Количество фейковых кликов");
  await expect(popupDelay).toHaveValue("200");
  await expect(popupDelay).toHaveAttribute("min", "0");
  await expect(popupDelay).toHaveAttribute("max", "1000");
  await expect(popupDelay).toHaveAttribute("step", "1");
  await expect(
    popupDelay.locator("xpath=ancestor::*[@data-setting-control]")
  ).toContainText("Задержка всплывающего окна, мс");
  await expect(popupSize).toHaveValue("2");
  await expect(popupSize).toHaveAttribute("min", "1");
  await expect(popupSize).toHaveAttribute("max", "4");
  await expect(popupSize).toHaveAttribute("step", "1");
  await expect(birchesEnabled).not.toBeChecked();
  await expect(birchScale).toHaveValue("100");
  await expect(birchScale).toHaveAttribute("min", "100");
  await expect(birchScale).toHaveAttribute("max", "400");
  await expect(birchScale).toHaveAttribute("step", "10");
  await expect(birchScale).toBeDisabled();
  await setSettingValue(page, "birchBackgroundEnabled", true);
  await expect(birchScale).toBeEnabled();
  await setSettingValue(page, "birchScalePercent", 400);
  await expect(birchScaleOutput).toHaveText("400%");
  await expect(radius).toHaveValue("50");
  await expect(radius).toHaveAttribute("min", "0");
  await expect(radius).toHaveAttribute("max", "300");
  await expect(radius).toHaveAttribute("step", "1");
  await expect(distance).toHaveValue("62.5");
  await expect(distance).toHaveAttribute("min", "0");
  await expect(distance).toHaveAttribute("max", "150");
  await expect(distance).toHaveAttribute("step", "0.1");
  await expect(page.locator('[name^="preclickParallax"]')).toHaveCount(0);

  await setSettingValue(page, "preclickHopMaxDistancePercent", 149.3);

  await expect(distance).toHaveValue("149.3");
  await expect(distanceOutput).toHaveText("149.3%");
});

test("панель показывает параметры и разделы выбранной сцены", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);

  const sceneOne = page.getByRole("button", {
    name: "Сцена 1. Кошки-мышки",
  });
  const sceneTwo = page.getByRole("button", { name: "Сцена 2. Репка" });
  const fakeClicks = page.locator('[name="preclickHopGuardClickCount"]');
  const gravity = page.locator('[name="gravity"]');
  const theme = page.locator('[name="themeMode"]');
  const cameraFollowUp = page.locator('[name="cameraFollowUpEnabled"]');
  const cameraFollowUpLerp = page.locator('[name="cameraFollowUpLerp"]');
  const cameraFollowDown = page.locator('[name="cameraFollowDownEnabled"]');
  const cameraFollowDownLerp = page.locator('[name="cameraFollowDownLerp"]');
  const rockAcceleration = page.locator('[name="rockAccelerationEnabled"]');
  const sceneTwoOverflowY = page.locator(
    '[name="sceneTwoOverflowYVisible"]',
  );
  const gachiClickSound = page.locator('[name="gachiClickSoundFilename"]');
  const fakeClicksControl = fakeClicks.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const gravityControl = gravity.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const themeControl = theme.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const cameraFollowUpControl = cameraFollowUp.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const cameraFollowDownControl = cameraFollowDown.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const rockAccelerationControl = rockAcceleration.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const sceneTwoOverflowYControl = sceneTwoOverflowY.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const gachiClickSoundControl = gachiClickSound.locator(
    "xpath=ancestor::*[@data-setting-control]",
  );
  const trailEnabled = page.locator('[name="trailEnabled"]');
  const trailGroup = trailEnabled.locator(
    "xpath=ancestor::details[contains(@class, 'control-group')]",
  );
  const trailStyleGroup = page
    .locator('[name="lineColor"]')
    .locator("xpath=ancestor::details[contains(@class, 'control-subgroup')]");
  const trailLineWidth = page.locator('[name="lineWidth"]');
  const clearTrail = page.getByRole("button", {
    name: "Очистить траекторию",
  });
  const obstacleGroup = page
    .locator('[name="sceneTwoBarrierEnabled"]')
    .locator("xpath=ancestor::details[contains(@class, 'control-group')]");

  await expect(sceneOne).toHaveAttribute("aria-pressed", "true");
  await expect(sceneTwo).toHaveAttribute("aria-pressed", "false");
  await expect(fakeClicksControl).not.toHaveAttribute("hidden", "");
  await expect(gravityControl).toHaveAttribute("hidden", "");
  await expect(cameraFollowUpControl).toHaveAttribute("hidden", "");
  await expect(cameraFollowDownControl).toHaveAttribute("hidden", "");
  await expect(rockAccelerationControl).toHaveAttribute("hidden", "");
  await expect(sceneTwoOverflowYControl).toHaveAttribute("hidden", "");
  await expect(gachiClickSoundControl).toHaveAttribute("hidden", "");
  await expect(obstacleGroup).toHaveAttribute("hidden", "");
  await expect(themeControl).not.toHaveAttribute("hidden", "");
  await expect(trailGroup).not.toHaveAttribute("hidden", "");
  await expect(trailStyleGroup).not.toHaveAttribute("hidden", "");
  await trailGroup.locator(":scope > summary").click();
  await expect(clearTrail).toBeVisible();
  await setSettingValue(page, "themeMode", "dark");
  await setSettingValue(page, "lineWidth", 27);

  await sceneTwo.click();
  await expect(sceneOne).toHaveAttribute("aria-pressed", "false");
  await expect(sceneTwo).toHaveAttribute("aria-pressed", "true");
  await expect(fakeClicksControl).toHaveAttribute("hidden", "");
  await expect(gravityControl).not.toHaveAttribute("hidden", "");
  await expect(cameraFollowUpControl).not.toHaveAttribute("hidden", "");
  await expect(cameraFollowDownControl).not.toHaveAttribute("hidden", "");
  await expect(rockAccelerationControl).not.toHaveAttribute("hidden", "");
  await expect(sceneTwoOverflowYControl).not.toHaveAttribute("hidden", "");
  await expect(gachiClickSoundControl).not.toHaveAttribute("hidden", "");
  await expect(cameraFollowUp).toBeChecked();
  await expect(cameraFollowUpLerp).toHaveValue("0.1");
  await expect(cameraFollowUpLerp).toBeEnabled();
  await expect(cameraFollowDown).toBeChecked();
  await expect(cameraFollowDownLerp).toHaveValue("0.1");
  await expect(cameraFollowDownLerp).toBeEnabled();
  await expect(rockAcceleration).not.toBeChecked();
  await expect(rockAcceleration).toBeDisabled();
  await expect(rockAccelerationControl).toHaveAttribute(
    "data-setting-static-disabled",
    "true",
  );
  await expect(
    rockAccelerationControl.locator("[data-setting-toggle-button]"),
  ).toHaveAttribute("aria-disabled", "true");
  await expect(sceneTwoOverflowY).not.toBeChecked();
  await expect(gachiClickSound).toHaveValue("Camen.mp3");
  await expect(obstacleGroup).not.toHaveAttribute("hidden", "");
  await expect(themeControl).not.toHaveAttribute("hidden", "");
  await expect(trailGroup).not.toHaveAttribute("hidden", "");
  await expect(trailStyleGroup).not.toHaveAttribute("hidden", "");
  await expect(clearTrail).toBeVisible();
  await expect(theme).toHaveValue("dark");
  await expect(trailLineWidth).toHaveValue("27");
  await setSettingValue(page, "cameraFollowUpEnabled", false);
  await expect(cameraFollowUpLerp).toBeDisabled();
  await expect(cameraFollowDownLerp).toBeEnabled();
  await setSettingValue(page, "cameraFollowDownEnabled", false);
  await expect(cameraFollowDownLerp).toBeDisabled();
  await setSettingValue(page, "sceneTwoOverflowYVisible", true);
  await setSettingValue(page, "gachiClickSoundFilename", "Like that.mp3");
  await expect(cameraFollowUp).not.toBeChecked();
  await expect(cameraFollowDown).not.toBeChecked();
  await expect(rockAcceleration).not.toBeChecked();
  await expect(sceneTwoOverflowY).toBeChecked();
  await expect(gachiClickSound).toHaveValue("Like that.mp3");

  await sceneOne.click();
  await expect(fakeClicksControl).not.toHaveAttribute("hidden", "");
  await expect(gravityControl).toHaveAttribute("hidden", "");
  await expect(theme).toHaveValue("dark");
  await expect(trailGroup).not.toHaveAttribute("hidden", "");
  await expect(trailLineWidth).toHaveValue("27");
  await expect(cameraFollowUpControl).toHaveAttribute("hidden", "");
  await expect(cameraFollowDownControl).toHaveAttribute("hidden", "");
  await expect(rockAccelerationControl).toHaveAttribute("hidden", "");
  await expect(sceneTwoOverflowYControl).toHaveAttribute("hidden", "");
  await expect(gachiClickSoundControl).toHaveAttribute("hidden", "");

  await sceneTwo.click();
  await expect(cameraFollowUp).not.toBeChecked();
  await expect(cameraFollowDown).not.toBeChecked();
  await expect(rockAcceleration).not.toBeChecked();
  await expect(sceneTwoOverflowY).toBeChecked();
  await expect(gachiClickSound).toHaveValue("Like that.mp3");
});

test("overflow-y сцены 2 переключается без блокировки программного скролла", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      sceneHeightScreens: 4,
      sceneTwoOverflowYVisible: false,
    }, { broadcastChanges: true });
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overflowY))
    .toBe("hidden");

  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      sceneTwoOverflowYVisible: true,
    }, { broadcastChanges: true });
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.overflowY))
    .toBe("auto");
});

test("изображения камня и сжатие пульса настраиваются независимо", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.evaluate(() => {
    applySharedRoomSettings({
      foldRockImageId: "rock",
      rockImageId: "rock2",
      rockPressShrinkPercent: 7,
      rockPulseEnabled: true,
      rockPulseShrinkPercent: 30,
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        foldRockImageId: params.foldRockImageId,
        rockImageId: params.rockImageId,
        rockPressShrinkPercent: params.rockPressShrinkPercent,
        rockPulseShrinkPercent: params.rockPulseShrinkPercent,
      })),
    )
    .toEqual({
      foldRockImageId: "rock",
      rockImageId: "rock2",
      rockPressShrinkPercent: 7,
      rockPulseShrinkPercent: 30,
    });
  await expect(page.locator("#root > .world > .rock")).toHaveAttribute(
    "data-rock-image-id",
    "rock2",
  );
  await expect(page.getByTestId("rock-imprint")).toHaveAttribute(
    "data-rock-image-id",
    "rock2",
  );
  await expect(page.locator("[data-fold-zone] .rock")).toHaveAttribute(
    "data-rock-image-id",
    "rock",
  );
  await expect(page.locator("#root > .world > .rock")).toHaveAttribute(
    "src",
    /rock2\.png/,
  );
  await expect(page.getByTestId("rock-imprint")).toHaveAttribute(
    "src",
    /rock2\.png/,
  );
  await expect(page.locator("[data-fold-zone] .rock")).toHaveAttribute(
    "src",
    /rock\.webp/,
  );

  const scalePriority = await page.evaluate(() => {
    motion.rockPulseScaleFactor = 0.7;
    motion.rockPressActive = false;
    const pulse = getRockVisualScaleState().visualShrinkScaleFactor;
    motion.rockPressActive = true;
    const press = getRockVisualScaleState().visualShrinkScaleFactor;
    motion.rockPressActive = false;
    return { press, pulse };
  });
  expect(scalePriority.pulse).toBeCloseTo(0.7, 5);
  expect(scalePriority.press).toBeCloseTo(0.93, 5);

  await navigateToSettings(page);
  const pulseEnabled = page.locator('[name="rockPulseEnabled"]');
  const pulseShrink = page.locator('[name="rockPulseShrinkPercent"]');
  await setSettingValue(page, "rockImageId", "rock2");
  await setSettingValue(page, "foldRockImageId", "rock");
  await setSettingValue(page, "rockPressShrinkPercent", 7);
  await setSettingValue(page, "rockPulseEnabled", true);
  await setSettingValue(page, "rockPulseShrinkPercent", 30);
  await expect(page.locator('[name="rockImageId"]')).toHaveValue("rock2");
  await expect(page.locator('[name="foldRockImageId"]')).toHaveValue("rock");
  await expect(pulseEnabled).toBeChecked();
  await expect(pulseShrink).toHaveValue("30");
  await expect(
    page.locator('[data-output="rockPulseShrinkPercent"]'),
  ).toHaveText("30%");
  await setSettingValue(page, "rockPulseEnabled", false);
  await expect(pulseShrink).toBeDisabled();
  await setSettingValue(page, "rockPulseEnabled", true);
  await expect(pulseShrink).toBeEnabled();
});

test("основной маршрут использует Fold-сцену и общее меню", async ({
  page,
}) => {
  await page.goto("/");
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
    await navigateToSettings(page);
    await expect(page.locator('[name="foldAngle"]')).toHaveValue("30");
    await expect(page.locator('[name="foldZoneSize"]')).toHaveValue(
      "20",
    );
    await expect(
      page.locator('[name="foldBlendEnabled"]'),
    ).toBeChecked();
    await expect(page.locator('[name="foldBlendCurve"]')).toHaveValue(
      "cubic-bezier(0.333, 0, 0.667, 1)",
    );
});

test("постоянная рука показывает нативный курсор над настройками", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({ handVisibilityMode: "always" });
  });
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

  await page.mouse.move(8, 8);
  await expect(body).not.toHaveClass(/is-settings-pointer-active/);
});

test("UI переключает три режима руки и задерживает смену изображения", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const handSelector = "#root > .world > .hand-cursor:not(.is-remote)";

  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);
  await setSettingValue(page, "handVisibilityMode", "hover");
  await setSettingValue(page, "handImageChangeDelayMs", 300);
  await expect(
    page.locator('[data-output="handImageChangeDelayMs"]'),
  ).toHaveText("300мс");
  await page
    .getByRole("button", {
      name: "Сохранить версию и настройки комнаты",
    })
    .click();
  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(".settings-version-production").first();
  await expect(productionButton).toBeEnabled();
  await productionButton.click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production:",
  );
  await page.locator(".settings-page__back").click();
  await waitForFoldReady(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 0,
      preclickHopActivationRadiusPercent: 0,
      preclickHopMaxDistancePercent: 0,
      rockJumpEnabled: false,
    });
  });

  const hand = page.locator(handSelector);
  const rock = page.locator("#root > .world > .rock");
  await page.mouse.move(4, 4);
  await expect(hand).not.toHaveClass(/is-visible/);
  await rock.hover();
  await expect(hand).toHaveClass(/is-visible/);

  const rockPoint = await visibleRockPoint(page);
  await page.mouse.move(rockPoint.x, rockPoint.y);
  await page.mouse.down();
  await expect(rock).toHaveClass(/is-dragging/);
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await page.mouse.up();

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      handVisibilityMode: "always",
      handImageChangeDelayMs: 300,
    });
  });
  await expect(page.locator("body")).toHaveClass(/hand-always-visible/);
  await expect(hand).toHaveClass(/is-visible/);
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await page.waitForTimeout(150);
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await expect(hand).toHaveClass(/is-grabbing/, { timeout: 500 });
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      handVisibilityMode: "hidden",
    });
  });
  await expect(page.locator("body")).toHaveClass(/hand-hidden/);
  await rock.hover();
  await expect(hand).toHaveCSS("display", "none");

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({ handVisibilityMode: "always" });
  });
  await expect(page.locator("body")).toHaveClass(/hand-always-visible/);
  await expect(hand).toHaveClass(/is-visible/);
});

test("session toolbar показывает нативный курсор вместо фото-руки", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({ handVisibilityMode: "always" });
  });
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect(page.locator("body")).toHaveClass(/hand-always-visible/);

  const body = page.locator("body");
  const hand = page.locator(
    "#root > .world > .hand-cursor:not(.is-remote)",
  );
  const sessionPanel = page.locator(".session-panel--toolbar");
  await sessionPanel.hover({ position: { x: 16, y: 16 } });
  await expect(sessionPanel).toHaveCSS("cursor", "auto");
  await expect(body).toHaveClass(/is-settings-pointer-active/);
  await expect(hand).toHaveCSS("opacity", "0");

  const restart = sessionPanel.getByTestId("restart-session");
  await restart.hover();
  await expect(restart).toHaveCSS("cursor", "pointer");
  await expect(body).toHaveClass(/is-settings-pointer-active/);
  await expect(hand).toHaveCSS("opacity", "0");

  const scenePoint = await visibleRockPoint(page);
  await page.mouse.move(scenePoint.x, scenePoint.y);
  await expect(body).not.toHaveClass(/is-settings-pointer-active/);
  await expect(body).toHaveClass(/hand-always-visible/);
  await expect(hand).toHaveCSS("opacity", "1");
});

test("общая настройка показывает SVG-курсор и меняет его размер", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);

  const body = page.locator("body");
  const hand = page.locator(
    "#root > .world > .hand-cursor:not(.is-remote)",
  );
  const settingsToggle = page.locator(".settings-toggle");
  await settingsToggle.click();
  await expect(page).toHaveURL(/\/settings\//);
  const size = page.locator('[name="customCursorSizePx"]');

  await expect(size).toBeDisabled();

  await setSettingValue(page, "customCursorEnabled", true);
  await expect(size).toBeEnabled();
  await setSettingValue(page, "customCursorSizePx", 64);
  await page
    .getByRole("button", {
      name: "Сохранить версию и настройки комнаты",
    })
    .click();
  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(".settings-version-production").first();
  await expect(productionButton).toBeEnabled();
  await productionButton.click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production:",
  );
  await page.locator(".settings-page__back").click();
  await waitForFoldReady(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      handImageChangeDelayMs: 0,
      handVisibilityMode: "always",
      preclickHopGuardClickCount: 0,
    });
  });
  await expect(body).toHaveClass(/custom-cursor-enabled/);

  const openCursor = await hand.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return {
      backgroundImage: style.backgroundImage,
      display: style.display,
      height: style.height,
      width: style.width,
    };
  });
  expect(openCursor).toEqual({
    backgroundImage: expect.stringMatching(
      /(?:handopen(?:-[A-Za-z0-9_-]+)?\.svg|data:image\/svg\+xml)/,
    ),
    display: "block",
    height: "64px",
    width: "64px",
  });

  await page.evaluate(() => {
    window.__sisyphusTestApi.receiveRemotePointer({
      clientId: "00000000-0000-4000-8000-000000000099",
      mode: "grab",
      visible: true,
      x: 500,
      y: 500,
    });
  });
  const remoteCursor = page.getByTestId("remote-cursor");
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect
    .poll(() =>
      remoteCursor.evaluate((cursor) => {
        const style = getComputedStyle(cursor, "::after");
        return {
          backgroundImage: style.backgroundImage,
          display: style.display,
          width: style.width,
        };
      }),
    )
    .toEqual({
      backgroundImage: expect.stringMatching(
        /(?:handopen(?:-[A-Za-z0-9_-]+)?\.svg|data:image\/svg\+xml)/,
      ),
      display: "block",
      width: "64px",
    });
  await page.evaluate(() => {
    window.__sisyphusTestApi.receiveRemotePointer({
      clientId: "00000000-0000-4000-8000-000000000099",
      mode: "grabbing",
      visible: true,
      x: 500,
      y: 500,
    });
  });
  await expect(remoteCursor).toHaveClass(/is-grabbing/);
  await expect
    .poll(() =>
      remoteCursor.evaluate(
        (cursor) => getComputedStyle(cursor, "::after").backgroundImage,
      ),
    )
    .toContain("handgrabbing");

  await page.mouse.move(80, 80);
  await page.mouse.down();
  await expect(hand).toHaveClass(/is-grabbing/);
  await expect
    .poll(() =>
      hand.evaluate(
        (element) => getComputedStyle(element, "::after").backgroundImage,
      ),
    )
    .toContain("handgrabbing.svg");
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);

  await page.locator(".settings-toggle").click();
  await expect(page).toHaveURL(/\/settings\//);
  await setSettingValue(page, "customCursorEnabled", false);
  await expect(size).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Сохранить версию и настройки комнаты",
    })
    .click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production:",
  );
  await page.locator(".settings-page__back").click();
  await waitForFoldReady(page);
  await expect(body).not.toHaveClass(/custom-cursor-enabled/);
  await expect
    .poll(() =>
      hand.evaluate((element) => getComputedStyle(element, "::after").display),
    )
    .toBe("none");
});

test("mouse захватывает камень внутри расширенного vh-радиуса", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.evaluate(() => {
    window.__sisyphusTestApi.params.preclickHopGuardClickCount = 0;
    window.__sisyphusTestApi.params.preclickHopActivationRadiusPercent = 0;
    window.__sisyphusTestApi.params.rockGrabRadiusVh = 4;
  });

  const rock = page.locator("#root > .world > .rock");
  const farPoint = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const radius = innerHeight * 0.04;
    const useLeft = rect.left - radius - 12 >= 0;
    const edge = useLeft ? rect.left : rect.right;
    const direction = useLeft ? -1 : 1;
    return {
      x: edge + direction * (radius + 8),
      y: rect.top + rect.height / 2,
    };
  });

  await page.mouse.move(farPoint.x, farPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        physicsActivated: window.__sisyphusTestApi.motion.physicsActivated,
      })),
    )
    .toEqual({ dragging: false, physicsActivated: false });

  const nearPoint = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const radius = innerHeight * 0.04;
    const useLeft = rect.left - radius - 12 >= 0;
    const edge = useLeft ? rect.left : rect.right;
    const direction = useLeft ? -1 : 1;
    return {
      x: edge + direction * (radius / 2),
      y: rect.top + rect.height / 2,
    };
  });
  expect(
    await page.evaluate(({ x, y }) => {
      const rockElement = document.querySelector("#root > .world > .rock");
      const target = document.elementFromPoint(x, y);
      return target === rockElement || rockElement.contains(target);
    }, nearPoint),
  ).toBe(false);
  await page.mouse.move(nearPoint.x, nearPoint.y);
  await page.mouse.down();
  await expect(page.locator("body")).not.toHaveClass(/preclick-rock-guidance/);
  await expect(rock).toHaveClass(/is-dragging/);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        dragging: window.__sisyphusTestApi.motion.dragging,
        suspended: window.__sisyphusTestApi.motion.suspended,
      })),
    )
    .toEqual({ dragging: true, suspended: false });
  await page.mouse.up();
});

test("невидимая линия заменяет popup-препятствие сцены 2", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.open = () => null;
  });

  await page.goto("/");
    await waitForFoldReady(page);
    await page.locator(".settings-toggle").click();
    await expect(page.locator("#settings-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    const sceneTwo = page.getByRole("button", { name: "Сцена 2. Репка" });
    await sceneTwo.click();
    await expect(sceneTwo).toHaveAttribute("aria-pressed", "true");

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

    const barrierGroup = obstacleGroup.locator(
      '[aria-label="Препятствия: Невидимая линия"]',
    );
    await expect(barrierGroup.locator(":scope > summary")).toHaveText("Невидимая линия");
    await expect(page.locator('[name="sceneTwoBarrierEnabled"]')).not.toBeChecked();
    await expect(page.locator('[name="sceneTwoBarrierHeightVh"]')).toHaveValue("1250");
    await expect(page.locator('[name="sceneTwoBarrierHopActivationRadiusPercent"]')).toHaveValue("50");
    await expect(page.locator('[name="sceneTwoBarrierHopMaxDistancePercent"]')).toHaveValue("62.5");
    await expect(page.locator('[name="sceneTwoBarrierHopMissProbabilityPercent"]')).toHaveValue("10");
    await expect(page.locator('[name="sceneTwoBarrierHopSpeedPxPerSecond"]')).toHaveValue("1200");
    await expect(page.locator('[name="sceneTwoBarrierHopSpeedEasing"]')).toHaveValue(
      "cubic-bezier(0.22, 1, 0.36, 1)",
    );
    await expect(page.locator('[name="sceneTwoBarrierHeightVh"]')).toHaveAttribute("step", "100");
    await expect(page.locator('[name="sceneTwoBarrierHopMaxDistancePercent"]')).toHaveAttribute("step", "0.1");
    await expect(page.locator('[name="sceneTwoBarrierHopSpeedPxPerSecond"]')).toHaveAttribute("step", "50");
    await expect(page.locator("[data-window-obstacle-popup-status]")).toHaveCount(0);
});

test("Fold синхронизирует сцену и применяет общие сохраняемые настройки", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);
  await expect(page.locator('[name="foldPositionPercent"]')).toHaveValue("0");
  await expect(page.locator('[name="foldPanelHeightVh"]')).toHaveValue("20");
  await expect(page.locator('[name="foldAngle"]')).toHaveValue("30");
  await expect(page.locator('[name="rockWallPenetrationPercent"]')).toHaveValue(
    "20",
  );
  await setSettingValue(page, "foldPositionPercent", 60);
  await setSettingValue(page, "foldPanelHeightVh", 35);
  await setSettingValue(page, "foldAngle", 45);
  await setSettingValue(page, "foldZoneSize", 10);
  await setSettingValue(page, "rockWallPenetrationPercent", 35);
  await setSettingValue(page, "mass", 2.5);
  await setSettingValue(page, "glowOptimizationMode", "balanced");
  await setSettingValue(
    page,
    "foldBlendCurve",
    "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
  );
  await setSettingValue(page, "foldBlendEnabled", false);
  await expect(page.locator('[name="foldBlendCurve"]')).toBeDisabled();
  await page
    .getByRole("button", {
      name: "Сохранить версию и настройки комнаты",
    })
    .click();
  const selectedVersionId = await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-versions-v1") || "{}",
        );
        return stored.selectedId || null;
      }),
    )
    .not.toBeNull()
    .then(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-versions-v1") || "{}",
        );
        return stored.selectedId;
      }),
    );
  expect(selectedVersionId).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v49") || "{}",
        );
        return {
          glowOptimizationMode: stored.glowOptimizationMode,
          mass: stored.mass,
          rockWallPenetrationPercent: stored.rockWallPenetrationPercent,
        };
      }),
    )
    .toEqual({
      glowOptimizationMode: "balanced",
      mass: 2.5,
      rockWallPenetrationPercent: 35,
    });
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
  await page.evaluate(() => {
    sessionStorage.removeItem("sisyphus-room-session-id");
  });
  await page.goto("/");

  let layer = await waitForFoldReady(page);
  await expect(layer).toHaveAttribute("data-fold-position-percent", "60");
  await expect(layer).toHaveAttribute("data-fold-panel-height-vh", "35");
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        glowOptimizationMode: params.glowOptimizationMode,
        mass: params.mass,
        rockWallPenetrationPercent: params.rockWallPenetrationPercent,
      })),
    )
    .toEqual({
      glowOptimizationMode: "balanced",
      mass: 2.5,
      rockWallPenetrationPercent: 35,
    });
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
  await expect
    .poll(() =>
      layer.evaluate((element) =>
        element.style.getPropertyValue("--fold-panel-height"),
      ),
    )
    .toBe("35vh");
  await expect
    .poll(() =>
      page
        .locator('[data-fold-zone="top"]')
        .evaluate((element) => getComputedStyle(element).maskImage),
    )
    .toBe("none");

  await page.evaluate(() => window.scrollTo(0, 0));
  const documentLayoutBeforeScroll = await page.evaluate(() => {
    const foldLayer = document.querySelector("[data-fold-layer]");
    const world = document.querySelector("#root > .world");
    const rect = foldLayer.getBoundingClientRect();
    return {
      dataTop: Number(foldLayer.dataset.foldDocumentTopPx),
      documentTop: rect.top + window.scrollY,
      expectedTop: (world.offsetHeight - window.innerHeight * 0.35) * 0.6,
      height: rect.height,
      position: getComputedStyle(foldLayer).position,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    };
  });
  expect(documentLayoutBeforeScroll.position).toBe("absolute");
  expect(documentLayoutBeforeScroll.height).toBeCloseTo(
    documentLayoutBeforeScroll.viewportHeight * 0.35,
    1,
  );
  expect(documentLayoutBeforeScroll.dataTop).toBeCloseTo(
    documentLayoutBeforeScroll.expectedTop,
    1,
  );
  expect(documentLayoutBeforeScroll.documentTop).toBeCloseTo(
    documentLayoutBeforeScroll.expectedTop,
    1,
  );

  await page.evaluate(() => window.scrollTo(0, 600));
  const documentLayoutAfterScroll = await page.evaluate(() => {
    const foldLayer = document.querySelector("[data-fold-layer]");
    const rect = foldLayer.getBoundingClientRect();
    return {
      documentTop: rect.top + window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      scrollY: window.scrollY,
      viewportTop: rect.top,
    };
  });
  expect(documentLayoutAfterScroll.documentTop).toBeCloseTo(
    documentLayoutBeforeScroll.documentTop,
    1,
  );
  expect(documentLayoutAfterScroll.viewportTop).toBeCloseTo(
    documentLayoutBeforeScroll.documentTop - documentLayoutAfterScroll.scrollY,
    1,
  );
  expect(documentLayoutAfterScroll.scrollHeight).toBe(
    documentLayoutBeforeScroll.scrollHeight,
  );

  await page.reload();
  layer = await waitForFoldReady(page);
  await expect(layer).toHaveAttribute("data-fold-position-percent", "60");
  await expect(layer).toHaveAttribute("data-fold-panel-height-vh", "35");
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        glowOptimizationMode: params.glowOptimizationMode,
        mass: params.mass,
        rockWallPenetrationPercent: params.rockWallPenetrationPercent,
      })),
    )
    .toEqual({
      glowOptimizationMode: "balanced",
      mass: 2.5,
      rockWallPenetrationPercent: 35,
    });
  await expect(layer).toHaveAttribute(
    "data-fold-blend-curve",
    "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
  );

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
      documentTop: Number(
        document.querySelector("[data-fold-layer]").dataset.foldDocumentTopPx,
      ),
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
      viewportHeight: window.innerHeight,
      zoneHeight: zone.getBoundingClientRect().height,
    };
  });

  expect(presentation.mirrorFrame).toBeGreaterThan(0);
  expect(presentation.pointerEvents).toBe("none");
  expect(presentation.mirrorRockStyle).toBe(presentation.sourceRockStyle);
  expect(presentation.mirrorTrailSize).toEqual(presentation.sourceTrailSize);
  expect(presentation.cropHeight).toBeCloseTo(
    presentation.surfaceHeight,
    1,
  );
  expect(presentation.surfaceHeight).toBeCloseTo(
    presentation.zoneHeight + presentation.viewportHeight * 0.1,
    1,
  );
  expect(presentation.surfaceTop).toBeCloseTo(
    -presentation.viewportHeight * 0.1,
    1,
  );
  expect(presentation.trackTranslateY).toBeCloseTo(
    presentation.viewportHeight * 0.1 - presentation.documentTop,
    1,
  );
});

test("настройки выпадения и выпрыгивания доступны на странице настроек", async ({
  page,
}) => {
  await page.goto("/");
    await waitForFoldReady(page);
    await navigateToSettings(page);
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
});

test("state-machine сцены 2 меняет размер камня и сохраняет контакт с полом", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      darkBackgroundColor: "#112233",
      darkBackgroundDeepColor: "#223344",
      darkBackgroundLowColor: "#334455",
      themeMode: "dark",
    });
  });
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

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      lightBackgroundColor: "#ddeeff",
      lightBackgroundDeepColor: "#ccddee",
      lightBackgroundLowColor: "#bbccdd",
      themeMode: "light",
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.body).getPropertyValue("--surface").trim(),
      ),
    )
    .toBe("#ddeeff");

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      gravity: 0.1,
      pointerInfluence: 0,
      preclickHopGuardClickCount: 0,
      preclickHopActivationRadiusPercent: 0,
      rockMaxWidthVw: 10,
      rockMinWidthVw: 5,
      rockPressShrinkPercent: 0,
      rockPulseEnabled: false,
    });
  });
  const rock = page.locator("#root > .world > .rock");
  const box = await rock.boundingBox();
  const initialWidth = box.width;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        armed: window.__sisyphusTestApi.motion.sceneTwoSizeCycleArmed,
        state: window.__sisyphusTestApi.motion.sceneTwoSizeState,
      })),
    )
    .toEqual({ armed: true, state: "held" });
  await page.waitForTimeout(350);
  const held = await rock.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
  }));
  expect(held.width).toBeGreaterThan(initialWidth);
  expect(Math.abs(held.width - held.viewportWidth * 0.1)).toBeLessThanOrEqual(10);

  await page.mouse.up();
  await page.evaluate(() => {
    window.__sisyphusTestApi.beginSceneTwoAirborneScale();
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.motion.sceneTwoSizeState,
      ),
    )
    .toBe("airborne");
  await page.waitForTimeout(350);
  const airborne = await rock.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
  }));
  expect(
    Math.abs(airborne.width - airborne.viewportWidth * 0.1),
  ).toBeLessThanOrEqual(10);

  await page.evaluate(() => {
    window.__sisyphusTestApi.settleSceneTwoRockScaleOnGround();
  });
  await page.waitForTimeout(350);
  const floorContact = await page.evaluate(() => {
    const { bounds, motion, setPosition, updateBounds } =
      window.__sisyphusTestApi;
    updateBounds();
    setPosition(bounds.maxX, bounds.maxY);
    const rock = document.querySelector("#root > .world > .rock");
    const rockRect = rock.getBoundingClientRect();
    const visualHeight = rock.offsetHeight * motion.rockScale;
    const penetrationPercent =
      window.__sisyphusTestApi.params.rockWallPenetrationPercent;
    const visualBottom =
      motion.y + (rock.offsetHeight * (1 + motion.rockScale)) / 2;
    return {
      gap: document.querySelector("#root > .world").offsetHeight - visualBottom,
      expectedPenetration: (visualHeight * penetrationPercent) / 100,
      sizeState: motion.sceneTwoSizeState,
      width: rockRect.width,
      y: motion.y,
      maxY: bounds.maxY,
    };
  });
  expect(floorContact.y).toBeCloseTo(floorContact.maxY, 5);
  expect(floorContact.sizeState).toBe("ground");
  expect(floorContact.width).toBeLessThan(airborne.width);
  expect(
    Math.abs(floorContact.gap + floorContact.expectedPenetration),
  ).toBeLessThanOrEqual(2);
});

test("рейтинг отображает текущего царя, а дождь ждёт пользовательский scroll", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  const leaderboard = page.getByTestId("summit-leaderboard");
  const current = leaderboard.locator(".summit-leaderboard__row.is-current");
  await expect(current).toHaveCount(1);
  await expect(current.locator(".summit-leaderboard__rank")).toHaveText("—");
  await expect(current.locator(".summit-leaderboard__name")).toHaveText(
    /^Царь[^\s\d]+\d+$/,
  );
  await expect(current.locator(".summit-leaderboard__score")).toHaveText(
    "00:00:00",
  );

  await page.evaluate(() => {
    window.scrollTo(0, 0);
    window.__sisyphusTestApi.completePreclickRockGuidance();
    window.__sisyphusTestApi.applyTestSettings({
      rainEnabled: true,
      sceneHeightScreens: 10,
    });
    window.__sisyphusTestApi.armSummitRainScroll();
  });
  await expect
    .poll(() => page.evaluate(() => ({
      overflowY: document.documentElement.style.overflowY,
      rain: window.__sisyphusTestApi.getSummitRainScrollState(),
    })))
    .toMatchObject({
      overflowY: "auto",
      rain: { armed: true, started: false, visible: false, volume: 0 },
    });

  await page.evaluate(() => window.scrollTo(0, 50));
  await expect
    .poll(() => page.evaluate(() =>
      window.__sisyphusTestApi.getSummitRainScrollState().started,
    ))
    .toBe(false);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press("PageDown");
  await expect
    .poll(() => page.evaluate(() =>
      window.__sisyphusTestApi.getSummitRainScrollState().started,
    ))
    .toBe(true);

  await page.evaluate(() => {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo(0, maxScroll / 2);
  });
  await expect
    .poll(() => page.evaluate(() =>
      window.__sisyphusTestApi.getSummitRainScrollState(),
    ))
    .toMatchObject({ opacity: 1, started: true, visible: true });
  const plateauRain = await page.evaluate(() =>
    window.__sisyphusTestApi.getSummitRainScrollState(),
  );
  expect(plateauRain.volume).toBeCloseTo(plateauRain.maxVolume, 5);

  await page.evaluate(() => window.scrollTo(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  ));
  await expect
    .poll(() => page.evaluate(() =>
      window.__sisyphusTestApi.getSummitRainScrollState(),
    ))
    .toMatchObject({ completed: true, started: false, visible: false, volume: 0 });
});

test("удар камня о боковую стену включает симуляцию оргазма", async ({ page }) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.completePreclickRockGuidance();
    api.setPosition(api.bounds.maxX / 2, api.bounds.maxY / 2);
  });
  const before = await page.evaluate(() =>
    window.__sisyphusTestApi.getWallImpactAudioState().playCount,
  );
  await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.setPosition(0, api.bounds.maxY / 2);
  });
  await expect
    .poll(() => page.evaluate(() =>
      window.__sisyphusTestApi.getWallImpactAudioState(),
    ))
    .toMatchObject({
      lastFilename: "СимуляцияОргазма.mov",
      playCount: before + 1,
    });
});

test("glow-профили и зависимости select работают на странице настроек", async ({
  page,
}) => {
  await page.goto("/");
    await waitForFoldReady(page);
    await navigateToSettings(page);

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

});
