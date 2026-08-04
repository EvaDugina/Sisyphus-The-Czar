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
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
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
    const jumpSpread = page.locator(
      '[name="rockJumpInertiaSpreadPercent"]',
    );

    await setSettingValue(page, "randomDropEnabled", true);
    await setSettingValue(page, "rockJumpEnabled", true);
    await expect(randomDrop).toBeChecked();
    await expect(rockJump).toBeChecked();
    await expect(jumpInterval).toBeEnabled();
    await expect(jumpSpread).toBeEnabled();

    await setSettingValue(page, "rockJumpEnabled", false);
    await expect(rockJump).not.toBeChecked();
    await expect(jumpInterval).toBeDisabled();
    await expect(jumpSpread).toBeDisabled();
  }
});
