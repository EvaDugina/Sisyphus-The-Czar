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
  await expect(page.locator('[name="gravity"]')).toHaveCount(0);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);
  await expect(page.locator(".settings-scene-switcher")).toHaveCount(0);

  await waitForDebugScene(page, "/scene-2", "turnip");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(0);

  await waitForDebugScene(page, "/scene-3", "juices");
  await expect(page.locator('[name="preclickHopGuardClickCount"]')).toHaveCount(0);
  await expect(page.locator('[name="gravity"]')).toHaveCount(1);
  await expect(page.locator('[name="rainEnabled"]')).toHaveCount(1);
  await expect(page.locator('[name="finalFallEnabled"]')).toHaveCount(1);
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
