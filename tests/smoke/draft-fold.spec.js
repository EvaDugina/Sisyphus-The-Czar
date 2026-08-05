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
  await setSettingValue(page, "positionScrollEnabled", false);
  await expect(layer).toHaveAttribute("data-fold-enabled", "false");
  await setSettingValue(page, "positionScrollEnabled", true);

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

test("первый клик анимирует размер камня, а темы используют свои градиенты", async ({
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
  const rock = page.locator("#root > .world > .rock");
  const box = await rock.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(rock).toHaveClass(/is-activation-scaling/);
  await page.waitForTimeout(350);
  const activated = await rock.evaluate((element) => ({
    activated: window.__sisyphusTestApi.motion.physicsActivated,
    width: element.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
  }));
  expect(activated.activated).toBe(true);
  expect(activated.width).toBeCloseTo(activated.viewportWidth * 0.1, 0);
  await page.mouse.up();
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
          localStorage.getItem("sisyphus-czar-settings-v22") || "{}",
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
