const { test, expect } = require("@playwright/test");

async function waitForFoldReady(page) {
  const layer = page.locator("[data-draft-fold-layer]");
  await expect(layer).toHaveAttribute("data-fold-ready", "true");
  await expect(layer).toHaveAttribute("data-fold-enabled", "true");
  return layer;
}

async function setSettingValue(page, name, value) {
  const control = page.locator(`[name="${name}"]`);
  if (name.startsWith("draftFold")) {
    await control.fill(String(value));
    return;
  }
  await control.evaluate((element, nextValue) => {
    if (element.type === "checkbox") {
      const checkedSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "checked",
      ).set;
      checkedSetter.call(element, Boolean(nextValue));
    } else {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set;
      valueSetter.call(element, String(nextValue));
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("draft показывает одну синхронизированную верхнюю 3D Fold-зону", async ({
  page,
}) => {
  await page.goto("/drafts/");
  const layer = await waitForFoldReady(page);

  await expect(page.locator('[data-draft-fold-zone="top"]')).toHaveCount(1);
  await expect(page.locator('[data-draft-fold-zone="bottom"]')).toHaveCount(0);
  await expect(page.locator("#root > .world")).toHaveCount(1);
  await expect(page.locator("[data-draft-fold-zone] main")).toHaveCount(0);
  await expect(page.locator("[data-draft-fold-controls]")).toHaveCount(1);
  await expect(page.locator('[name="draftFoldAngle"]')).toHaveValue("30");
  await expect(page.locator('[name="draftFoldZoneSize"]')).toHaveValue(
    "20",
  );
  await expect(
    page.locator("[data-draft-fold-blend-toggle]"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.locator("[data-draft-fold-blend-editor]"),
  ).not.toHaveAttribute("disabled", "");
  await expect(page.locator('[name="draftFoldBlendX1"]')).toHaveValue(
    "0.333",
  );
  await expect(page.locator('[name="draftFoldBlendY1"]')).toHaveValue("0");
  await expect(page.locator('[name="draftFoldBlendX2"]')).toHaveValue(
    "0.667",
  );
  await expect(page.locator('[name="draftFoldBlendY2"]')).toHaveValue("1");
  expect(
    await page
      .locator('[data-draft-fold-bezier-coordinate]')
      .evaluateAll((inputs) => inputs.map((input) => input.max)),
  ).toEqual(["2", "2", "2", "2"]);
  await expect(page.getByTestId("summit-timer")).toHaveCount(1);
  await expect(page.getByTestId("weather-rain")).toHaveCount(1);
  await expect(page.locator("[data-draft-fold-zone] [id]")).toHaveCount(0);
  await expect(
    page.locator("[data-draft-fold-zone] [data-testid]"),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-draft-fold-zone] .world[inert][aria-hidden='true']"),
  ).toHaveCount(1);
  await expect(
    page.locator("[data-draft-fold-zone] .world[role='presentation']"),
  ).toHaveCount(1);

  const presentation = await page.evaluate(() => {
    const sourceRock = document.querySelector("#root > .world .rock");
    const mirrorRocks = [...document.querySelectorAll(
      "[data-draft-fold-zone] .rock",
    )];
    const sourceTrail = document.querySelector("#root > .world .trail");
    const mirrorTrails = [...document.querySelectorAll(
      "[data-draft-fold-zone] .trail",
    )];
    const layerElement = document.querySelector("[data-draft-fold-layer]");
    const controlsElement = document.querySelector(
      "[data-draft-fold-controls]",
    );
    const settingsElement = document.querySelector(".settings-panel");
    return {
      controlsZIndex: Number(getComputedStyle(controlsElement).zIndex),
      mirrorFrame: Number(layerElement.dataset.mirrorFrame || 0),
      pointerEvents: getComputedStyle(layerElement).pointerEvents,
      rockStyles: mirrorRocks.map((rock) => rock.style.cssText),
      sourceRockStyle: sourceRock.style.cssText,
      trailSizes: mirrorTrails.map((trail) => [trail.width, trail.height]),
      sourceTrailSize: [sourceTrail.width, sourceTrail.height],
      settingsZIndex: Number(getComputedStyle(settingsElement).zIndex),
      cropWindows: [
        ...document.querySelectorAll("[data-draft-fold-source-window]"),
      ].map((cropWindow) => {
        const zone = cropWindow.closest("[data-draft-fold-zone]");
        const surface = cropWindow.closest(".draft-fold-surface");
        const track = cropWindow.querySelector(".draft-fold-track");
        const trackMatrix = new DOMMatrix(getComputedStyle(track).transform);
        return {
          cropHeight: Number.parseFloat(getComputedStyle(cropWindow).height),
          maskImage: getComputedStyle(zone).maskImage,
          overflowY: getComputedStyle(cropWindow).overflowY,
          surfaceHeight: Number.parseFloat(getComputedStyle(surface).height),
          surfaceTop: Number.parseFloat(getComputedStyle(surface).top),
          surfaceTransform: getComputedStyle(surface).transform,
          trackTranslateY: trackMatrix.m42,
          zoneHeight: zone.getBoundingClientRect().height,
        };
      }),
      scrollY: window.scrollY,
    };
  });

  expect(presentation.mirrorFrame).toBeGreaterThan(0);
  expect(presentation.pointerEvents).toBe("none");
  expect(presentation.controlsZIndex).toBeLessThan(
    presentation.settingsZIndex,
  );
  expect(presentation.rockStyles).toEqual([
    presentation.sourceRockStyle,
  ]);
  expect(presentation.trailSizes).toEqual([
    presentation.sourceTrailSize,
  ]);
  expect(presentation.cropWindows).toHaveLength(1);
  for (const cropWindow of presentation.cropWindows) {
    expect(cropWindow.cropHeight).toBeCloseTo(
      cropWindow.zoneHeight * 2,
      1,
    );
    expect(cropWindow.surfaceHeight).toBeCloseTo(
      cropWindow.zoneHeight * 2,
      1,
    );
    expect(cropWindow.surfaceTop).toBeCloseTo(
      -cropWindow.zoneHeight,
      1,
    );
    expect(cropWindow.trackTranslateY).toBeCloseTo(
      cropWindow.zoneHeight - presentation.scrollY,
      1,
    );
    expect(cropWindow.maskImage).not.toBe("none");
    expect(cropWindow.overflowY).toBe("hidden");
    expect(cropWindow.surfaceTransform).not.toBe("none");
  }
  await expect(layer).toHaveAttribute("data-fold-angle", "30");
  await expect(layer).toHaveAttribute(
    "data-fold-blend-curve",
    "cubic-bezier(0.333, 0, 0.667, 1)",
  );
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "true");
  await expect(layer).toHaveAttribute("data-fold-zone-size", "20");
});

test("draft следует за настройками зоны и не влияет на главную страницу", async ({
  page,
}) => {
  await page.goto("/drafts/");
  const layer = await waitForFoldReady(page);

  await setSettingValue(page, "draftFoldAngle", 45);
  await expect(layer).toHaveAttribute("data-fold-angle", "45");
  await expect
    .poll(() =>
      layer.evaluate((element) =>
        element.style.getPropertyValue("--draft-fold-angle"),
      ),
    )
    .toBe("45deg");

  await setSettingValue(page, "draftFoldZoneSize", 10);
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect
    .poll(() =>
      layer.evaluate((element) =>
        element.style.getPropertyValue("--draft-fold-zone-height"),
      ),
    )
    .toBe("10vh");

  await setSettingValue(page, "draftFoldBlendX1", 2);
  await setSettingValue(page, "draftFoldBlendY1", 2);
  await setSettingValue(page, "draftFoldBlendX2", 2);
  await setSettingValue(page, "draftFoldBlendY2", 2);
  await expect(layer).toHaveAttribute(
    "data-fold-blend-curve",
    "cubic-bezier(2, 2, 2, 2)",
  );

  const blendToggle = page.locator("[data-draft-fold-blend-toggle]");
  const blendEditor = page.locator("[data-draft-fold-blend-editor]");
  await blendToggle.click();
  await expect(blendToggle).toHaveAttribute("aria-pressed", "false");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "false");
  await expect(blendEditor).toHaveAttribute("disabled", "");
  await expect(page.locator('[name="draftFoldBlendX1"]')).toBeDisabled();
  await expect
    .poll(() =>
      page
        .locator('[data-draft-fold-zone="top"]')
        .evaluate((element) => getComputedStyle(element).maskImage),
    )
    .toBe("none");

  await blendToggle.click();
  await expect(blendToggle).toHaveAttribute("aria-pressed", "true");
  await expect(layer).toHaveAttribute("data-fold-blend-enabled", "true");
  await expect(layer).toHaveAttribute(
    "data-fold-blend-curve",
    "cubic-bezier(2, 2, 2, 2)",
  );
  await expect(blendEditor).not.toHaveAttribute("disabled", "");
  await expect(page.locator('[name="draftFoldBlendX1"]')).toBeEnabled();
  await expect
    .poll(() =>
      page
        .locator('[data-draft-fold-zone="top"]')
        .evaluate((element) => getComputedStyle(element).maskImage),
    )
    .not.toBe("none");

  await setSettingValue(page, "positionScrollZonePercent", 5);
  await expect(layer).toHaveAttribute("data-fold-zone-size", "10");
  await expect(page.locator('[name="draftFoldZoneSize"]')).toHaveValue(
    "10",
  );

  await setSettingValue(page, "draftFoldZoneSize", 0);
  await expect(layer).toHaveAttribute("data-fold-enabled", "false");

  await setSettingValue(page, "draftFoldZoneSize", 10);
  await expect(layer).toHaveAttribute("data-fold-enabled", "true");

  await setSettingValue(page, "positionScrollEnabled", false);
  await expect(layer).toHaveAttribute("data-fold-enabled", "false");

  await page.goto("/");
  await expect(page.locator("[data-draft-fold-layer]")).toHaveCount(0);
  await expect(page.locator("[data-draft-fold-controls]")).toHaveCount(0);
  await expect(page.locator("#root > .world")).toHaveCount(1);
});
