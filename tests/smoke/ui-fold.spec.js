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

test("legacy drafts маршруты возвращают 404", async ({ request }) => {
  for (const path of ["/drafts", "/drafts/", "/drafts/assets/missing.js"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
  }
});

test("Fold-настройки мигрируют из localStorage v32 в v36", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v36");
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
  await expect(layer).toHaveAttribute("data-fold-angle", "30");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "20");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v36") || "{}",
        );
        return {
          foldAngle: stored.foldAngle,
          foldZoneSize: stored.foldZoneSize,
          foldBlendEnabled: stored.foldBlendEnabled,
          foldBlendCurve: stored.foldBlendCurve,
          preclickHopMaxDistanceVw: stored.preclickHopMaxDistanceVw,
          hasLegacy: Object.keys(stored).some((key) => key.startsWith("draftFold")),
        };
      }),
    )
    .toEqual({
      foldAngle: 47,
      foldZoneSize: 13,
      foldBlendEnabled: false,
      foldBlendCurve: "cubic-bezier(0.2, 0.1, 0.8, 0.9)",
      preclickHopMaxDistanceVw: 62.5,
      hasLegacy: false,
    });
  await page.reload();
  await waitForFoldReady(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v36") || "{}",
        );
        return [stored.foldAngle, stored.foldZoneSize];
      }),
    )
    .toEqual([47, 13]);
});

test("hop-настройки мигрируют из localStorage v35 в v36 без legacy-полей", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v36");
    localStorage.setItem(
      "sisyphus-czar-settings-v35",
      JSON.stringify({
        preclickParallaxActivationRadiusVw: 12,
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
          localStorage.getItem("sisyphus-czar-settings-v36") || "{}",
        );
        return {
          radius: stored.preclickHopActivationRadiusVw,
          distance: stored.preclickHopMaxDistanceVw,
          cameraFollowLerp: stored.cameraFollowLerp,
          hasLegacy: Object.keys(stored).some((key) =>
            key.startsWith("preclickParallax"),
          ),
        };
      }),
    )
    .toEqual({
      radius: 12,
      distance: 184.3,
      cameraFollowLerp: 0.25,
      hasLegacy: false,
    });
});

test("визуальные настройки камня мигрируют из localStorage v34 в v36", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v36");
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
          localStorage.getItem("sisyphus-czar-settings-v36") || "{}",
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

test("группа Камень показывает только два hop-контрола", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v36");
  });

  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);

  const radius = page.locator('[name="preclickHopActivationRadiusVw"]');
  const distance = page.locator('[name="preclickHopMaxDistanceVw"]');
  const distanceOutput = page.locator(
    '[data-output="preclickHopMaxDistanceVw"]',
  );
  await expect(radius).toHaveValue("50");
  await expect(radius).toHaveAttribute("min", "0");
  await expect(radius).toHaveAttribute("max", "200");
  await expect(radius).toHaveAttribute("step", "1");
  await expect(distance).toHaveValue("62.5");
  await expect(distance).toHaveAttribute("min", "0");
  await expect(distance).toHaveAttribute("max", "200");
  await expect(distance).toHaveAttribute("step", "0.1");
  await expect(page.locator('[name^="preclickParallax"]')).toHaveCount(0);

  await setSettingValue(page, "preclickHopMaxDistanceVw", 184.3);

  await expect(distance).toHaveValue("184.3");
  await expect(distanceOutput).toHaveText("184.3vw");
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

test("session toolbar показывает нативный курсор вместо фото-руки", async ({
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

  await page.mouse.move(8, 8);
  await expect(body).not.toHaveClass(/is-settings-pointer-active/);
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
  await expect(page.locator(".settings-production-status")).toContainText(
    "Версия и настройки комнаты сохранены",
  );
  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(".settings-version-production").first();
  await expect(productionButton).toBeEnabled();
  await productionButton.click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production:",
  );
  await page.locator(".settings-page__back").click();
  await waitForFoldReady(page);
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
    window.__sisyphusTestApi.params.preclickHopActivationRadiusVw = 0;
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

test("препятствие Окна сообщает о popup-блокировке", async ({
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
    await expect(windowsGroup.locator(":scope > summary")).toHaveText("Окна");
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
});

test("Fold синхронизирует сцену и применяет общие сохраняемые настройки", async ({
  page,
}) => {
  await page.goto("/");
  await waitForFoldReady(page);
  await navigateToSettings(page);
  await expect(page.locator('[name="foldAngle"]')).toHaveValue("30");
  await setSettingValue(page, "foldAngle", 45);
  await setSettingValue(page, "foldZoneSize", 10);
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
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
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
      page
        .locator('[data-fold-zone="top"]')
        .evaluate((element) => getComputedStyle(element).maskImage),
    )
    .toBe("none");

  await page.reload();
  layer = await waitForFoldReady(page);
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
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

test("первое падение анимирует размер камня, сохраняет контакт с полом, а темы используют свои градиенты", async ({
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
      preclickHopActivationRadiusVw: 0,
      rockActivatedWidthVw: 10,
      rockMaxWidthVw: 10,
      rockMinWidthVw: 10,
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
