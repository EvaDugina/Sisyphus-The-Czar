const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";
const SOURCE_TRAIL = "#root > .world > .trail";
const SOURCE_HAND = "#root > .world > .hand-cursor:not(.is-remote)";
const MASTER_CLIENT_ID = "00000000-0000-4000-8000-000000000001";
let clientSequence = 1;

async function pinClientId(context, clientId = MASTER_CLIENT_ID) {
  await context.addInitScript((value) => {
    sessionStorage.setItem("sisyphus-client-id", value);
  }, clientId);
}

async function createBrowserContext(browser, options = {}, clientId) {
  const context = await browser.newContext(options);
  const resolvedClientId =
    clientId ||
    `00000000-0000-4000-8000-${String(++clientSequence).padStart(12, "0")}`;
  await pinClientId(context, resolvedClientId);
  return context;
}

test.beforeEach(async ({ context }) => {
  await pinClientId(
    context,
    `00000000-0000-4000-8000-${String(++clientSequence).padStart(12, "0")}`,
  );
});

async function setRange(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.value = String(next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setField(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function setCheckbox(page, name, checked) {
  await page.locator(`[name="${name}"]`).evaluate((input, next) => {
    input.checked = next;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, checked);
}

async function saveRoomSettings(page) {
  await expect(page.locator(".settings-room-save")).toHaveCount(0);
  const saveButton = page.getByRole("button", {
    name: "Сохранить версию и настройки комнаты",
  });
  await expect(saveButton).toHaveClass(/settings-version-save/);
  await saveButton.click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Версия и настройки комнаты сохранены",
  );
}

async function clearHeightGates(page) {
  const removeButtons = page.getByTestId("height-gate-remove");
  while ((await removeButtons.count()) > 0) {
    await removeButtons.first().click();
  }
  await expect
    .poll(() => page.locator('[name="heightGates"]').inputValue())
    .toBe("[]");
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.params.heightGates),
    )
    .toEqual([]);
}

async function setSingleHeightGate(page, heightPercent, durationSeconds) {
  await clearHeightGates(page);
  await page.getByTestId("height-gate-add").click();
  await page.getByLabel("Высота метки 1").fill(String(heightPercent));
  await page
    .getByLabel("Длительность метки 1")
    .fill(String(durationSeconds));
  await expect
    .poll(() =>
      page.evaluate(() => ({
        gates: window.__sisyphusTestApi.params.heightGates,
        inFlight: Boolean(collab.settingsUpdateInFlight),
        pendingKeys: Object.keys(collab.pendingRoomSettingsChanges),
        queued: collab.settingsUpdateQueued,
      })),
    )
    .toMatchObject({
      gates: [{ heightPercent, durationSeconds }],
      inFlight: false,
      pendingKeys: [],
      queued: false,
    });
}

async function watchAudioPlayCalls(page, filename) {
  await page.addInitScript((targetFilenames) => {
    const targets = Array.isArray(targetFilenames)
      ? targetFilenames
      : [targetFilenames];
    window.__watchedAudioPlayCount = 0;
    window.__watchedAudioPlayCounts = Object.fromEntries(
      targets.map((target) => [target, 0])
    );
    HTMLMediaElement.prototype.play = function play() {
      let decodedSrc = this.currentSrc || this.src || "";
      try {
        decodedSrc = decodeURIComponent(decodedSrc);
      } catch {
        /* URL может быть уже декодирован. */
      }
      let matched = false;
      targets.forEach((target) => {
        if (decodedSrc.includes(target)) {
          window.__watchedAudioPlayCounts[target] += 1;
          matched = true;
        }
      });
      if (matched) {
        window.__watchedAudioPlayCount += 1;
      }
      return Promise.resolve();
    };
  }, filename);
}

async function openControlGroup(page, summaryText) {
  const opened = await page.evaluate((text) => {
    const summary = Array.from(
      document.querySelectorAll(".settings-panel .control-group > summary")
    ).find((element) => element.textContent.trim() === text);
    if (!summary) {
      return false;
    }
    const group = summary.closest(".control-group");
    group.open = true;
    return group.open;
  }, summaryText);
  expect(opened).toBe(true);
}

async function openSettingsPanel(page) {
  if (/\/settings\/?$/.test(new URL(page.url()).pathname)) {
    await expect(page.locator("#settings-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    return;
  }
  const toggle = page.locator(".settings-toggle");
  if ((await toggle.getAttribute("href")) !== null) {
    await toggle.click();
    await expect(page).toHaveURL(/\/settings\//);
    await expect(page.locator("#settings-panel")).toHaveAttribute(
      "aria-hidden",
      "false",
    );
    return;
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#settings-panel")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
}

async function closeSettingsPanel(page) {
  if (/\/settings\/?$/.test(new URL(page.url()).pathname)) {
    await page.locator(".settings-page__back").click();
    await expect(page).not.toHaveURL(/\/settings\//);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    await expect
      .poll(() =>
        page.evaluate(() => Boolean(window.__sisyphusTestApi)),
      )
      .toBe(true);
    return;
  }
  const toggle = page.locator(".settings-toggle");
  if ((await toggle.getAttribute("aria-expanded")) === "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#settings-panel")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
}

test("dev UI сохраняет последний параметр после серии изменений", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeAddEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function addEventListener(
      type,
      listener,
      options,
    ) {
      if (type !== "message") {
        return nativeAddEventListener.call(this, type, listener, options);
      }
      return nativeAddEventListener.call(
        this,
        type,
        function delayedSettingsApplied(event) {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            listener.call(this, event);
            return;
          }
          if (message.type === "settings.applied") {
            setTimeout(() => listener.call(this, event), 600);
            return;
          }
          listener.call(this, event);
        },
        options,
      );
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  const sessionId = await page.evaluate(() =>
    sessionStorage.getItem("sisyphus-room-session-id"),
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getCollaborationDebugState(),
      ),
    )
    .toMatchObject({
      lastRoomSettingsSnapshotHeight: 1,
      pendingPhysicsKeys: [],
      pendingRoomSettingKeys: [],
      roomSettingsHeight: 1,
      settingsUpdateInFlight: false,
      settingsUpdateQueued: false,
      settingsUpdateTimerActive: false,
    });
  await openSettingsPanel(page);
  await setRange(page, "sceneHeightScreens", 7);
  await setRange(page, "gravity", 8.5);
  await setRange(page, "wallBounce", 0.42);
  await expect(page.locator('[name="sceneHeightScreens"]')).toHaveValue("7");
  await expect(page.locator('[name="gravity"]')).toHaveValue("8.5");
  await expect(page.locator('[name="wallBounce"]')).toHaveValue("0.42");

  await page.waitForTimeout(200);
  await setRange(page, "sceneHeightScreens", 8);
  await setRange(page, "gravity", 9.5);
  await setRange(page, "wallBounce", 0.73);
  await page.waitForTimeout(700);
  await expect(page.locator('[name="sceneHeightScreens"]')).toHaveValue("8");
  await expect(page.locator('[name="gravity"]')).toHaveValue("9.5");
  await expect(page.locator('[name="wallBounce"]')).toHaveValue("0.73");
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("sisyphus-room-session-id"),
      ),
    )
    .toBe(sessionId);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        cssHeight: getComputedStyle(document.documentElement)
          .getPropertyValue("--scene-height-vh")
          .trim(),
        debug: window.__sisyphusTestApi.getCollaborationDebugState(),
      })),
    )
    .toMatchObject({
      cssHeight: "800vh",
      debug: {
        lastRoomSettingsSnapshotHeight: 8,
        pendingRoomSettingKeys: [],
        roomSettingsHeight: 8,
        sessionId,
      },
    });
  await expect
    .poll(() => page.evaluate(() => window.__sisyphusTestApi.params.gravity))
    .toBe(9.5);
  await expect
    .poll(() => page.evaluate(() => window.__sisyphusTestApi.params.wallBounce))
    .toBe(0.73);
});

test("camera UI и новые настройки сохраняются вместе", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Вид");
  await openControlGroup(page, "Камера");
  await openControlGroup(page, "3D Fold");
  await openControlGroup(page, "Финальное падение");
  await openControlGroup(page, "Физика");
  await openControlGroup(page, "Камень");
  await openControlGroup(page, "Рука");
  await openControlGroup(page, "Траектория");
  await openControlGroup(page, "Капель");

  await expect(page.locator('[name="stationaryAutoSlipEnabled"]')).toHaveCount(0);
  await expect(page.locator('[name="heightGates"]')).toHaveCount(1);
  await expect(page.getByTestId("height-gate-add")).toBeVisible();
  await expect(page.locator('[name^="positionScroll"]')).toHaveCount(0);
  await expect(page.locator('[name="manualVerticalScrollEnabled"]')).toHaveCount(
    0,
  );
  await expect(page.locator('[name="cameraFollowLerp"]')).toHaveValue("0.1");
  await expect(page.locator('[name="cameraFollowLerp"]')).toHaveAttribute(
    "min",
    "0.01",
  );
  await expect(page.locator('[name="cameraFollowLerp"]')).toHaveAttribute(
    "max",
    "1",
  );
  await expect(page.locator('[name="handVisibilityMode"]')).toHaveValue(
    "always",
  );
  await expect(page.locator('[name="handImageChangeDelayMs"]')).toHaveValue(
    "0",
  );
  await expect(page.locator('[name="trailAnchorHeightPercent"]')).toHaveValue(
    "100",
  );
  await expect(page.locator('[name="bounce"]')).toHaveAttribute("step", "0.01");
  await expect(page.locator('[name="inertia"]')).toHaveAttribute("max", "5");
  await expect(page.locator('[name="horizontalInertia"]')).toHaveAttribute(
    "max",
    "5",
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("8");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("35");
  await expect(page.locator('[name^="returnScroll"]')).toHaveCount(0);
  await expect(page.locator("[data-cubic-bezier-control]")).toHaveCount(7);
  await expect(page.locator('[name="foldAngle"]')).toHaveValue("30");
  await expect(page.locator('[name="foldZoneSize"]')).toHaveValue("20");

  await setRange(page, "cameraFollowLerp", 0.25);
  await page.locator('[name="handVisibilityMode"]').selectOption("hover");
  await setRange(page, "handImageChangeDelayMs", 375);
  await setField(page, "rockMinWidthVw", 40);
  await setField(page, "rockMaxWidthVw", 10);
  await setCheckbox(page, "finalFallEnabled", true);
  await setRange(page, "finalFallDelaySeconds", 3.5);
  await setRange(page, "drizzleStartVolume", 0.2);
  await setRange(page, "drizzleEndVolume", 0.8);
  await setField(
    page,
    "drizzleVolumeEasing",
    "cubic-bezier(0, 0, 1, 1)",
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("40");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("10");
  await setRange(page, "sceneHeightScreens", 10);

  await page.locator(".settings-version-toggle").click();
  await page.locator('[data-settings-version-choice=""]').click();
  await page.locator(".settings-version-name").fill("camera-ui-smoke");
  await page.locator(".settings-version-save").click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Версия и настройки комнаты сохранены",
  );
  await expect(page.locator("#settings-version-current")).toContainText(
    "camera-ui-smoke",
  );

  await closeSettingsPanel(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        end: window.__sisyphusTestApi.params.rockMaxWidthVw,
        sceneHeight: window.__sisyphusTestApi.params.sceneHeightScreens,
        start: window.__sisyphusTestApi.params.rockMinWidthVw,
      })),
    )
    .toEqual({ end: 10, sceneHeight: 10, start: 40 });
  await expect(page.locator("html")).toHaveClass(/is-manual-scroll-disabled/);
  await expect(page.locator("body")).toHaveClass(/is-manual-scroll-disabled/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(400, 400);
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(120);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await openSettingsPanel(page);
  await openControlGroup(page, "Камера");
  await openControlGroup(page, "Финальное падение");
  await openControlGroup(page, "Камень");
  await openControlGroup(page, "Рука");
  await openControlGroup(page, "Капель");
  await expect(page.locator('[name="cameraFollowLerp"]')).toHaveValue("0.25");
  await expect(page.locator('[name="handVisibilityMode"]')).toHaveValue(
    "hover",
  );
  await expect(page.locator('[name="handImageChangeDelayMs"]')).toHaveValue(
    "375",
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("40");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("10");
  await expect(page.locator('[name="finalFallEnabled"]')).toBeChecked();
  await expect(page.locator('[name="finalFallDelaySeconds"]')).toHaveValue(
    "3.5",
  );
  await expect(page.locator('[name="drizzleStartVolume"]')).toHaveValue("0.2");
  await expect(page.locator('[name="drizzleEndVolume"]')).toHaveValue("0.8");
  await expect(page.locator('[name="drizzleVolumeEasing"]')).toHaveValue(
    "cubic-bezier(0, 0, 1, 1)",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}",
        );
        return {
          delay: stored.finalFallDelaySeconds,
          drizzle: [
            stored.drizzleStartVolume,
            stored.drizzleEndVolume,
            stored.drizzleVolumeEasing,
          ],
          cameraFollowLerp: stored.cameraFollowLerp,
          finalFallEnabled: stored.finalFallEnabled,
          handVisibilityMode: stored.handVisibilityMode,
          handImageChangeDelayMs: stored.handImageChangeDelayMs,
          size: [stored.rockMinWidthVw, stored.rockMaxWidthVw],
        };
      }),
    )
    .toEqual({
      delay: 3.5,
      drizzle: [0.2, 0.8, "cubic-bezier(0, 0, 1, 1)"],
      cameraFollowLerp: 0.25,
      finalFallEnabled: true,
      handVisibilityMode: "hover",
      handImageChangeDelayMs: 375,
      size: [40, 10],
    });
  await setCheckbox(page, "finalFallEnabled", false);
  await setRange(page, "finalFallDelaySeconds", 2);
  await setRange(page, "drizzleStartVolume", 0.1);
  await setRange(page, "drizzleEndVolume", 1);
  await setField(
    page,
    "drizzleVolumeEasing",
    "cubic-bezier(0.4, 0, 0.2, 1)",
  );
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
});

test("Капель работает с новыми настройками", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await watchAudioPlayCalls(page, "Капель.mp3");
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Финальное падение");
  await openControlGroup(page, "Капель");

  await expect(page.locator('[name="drizzleEnabled"]')).toBeChecked();
  await expect(page.locator('[name="drizzleStartVolume"]')).toBeEnabled();
  await expect(page.locator('[name="drizzleEndVolume"]')).toBeEnabled();
  await expect(page.locator('[name="drizzleVolumeEasing"]')).toBeEnabled();

  await setCheckbox(page, "finalFallEnabled", true);
  await setRange(page, "finalFallDelaySeconds", 3.5);
  await setRange(page, "drizzleStartVolume", 0.2);
  await setRange(page, "drizzleEndVolume", 0.8);
  await setField(
    page,
    "drizzleVolumeEasing",
    "cubic-bezier(0, 0, 1, 1)",
  );
  await saveRoomSettings(page);
  await closeSettingsPanel(page);

  await expectReadyAtBottom(page);
  await grabVisibleRock(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__sisyphusTestApi.getDrizzleAudioState().startCount,
        ),
      { timeout: 15_000 },
    )
    .toBe(1);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getDrizzleAudioState().startCount,
      ),
    )
    .toBe(1);

  await openSettingsPanel(page);
  await openControlGroup(page, "Капель");
  await setCheckbox(page, "drizzleEnabled", false);
  await expect(page.locator('[name="drizzleStartVolume"]')).toBeDisabled();
  await expect(page.locator('[name="drizzleEndVolume"]')).toBeDisabled();
  await expect(page.locator('[name="drizzleVolumeEasing"]')).toBeDisabled();
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getDrizzleAudioState()),
    )
    .toMatchObject({
      activeSourceCount: 0,
      fadeActive: false,
      playing: false,
      running: false,
      schedulerActive: false,
      startCount: 0,
    });
  await grabVisibleRock(page);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getDrizzleAudioState().startCount,
      ),
    )
    .toBe(0);
  await openSettingsPanel(page);
  await openControlGroup(page, "Капель");
  await setCheckbox(page, "drizzleEnabled", true);
  await expect(page.locator('[name="drizzleStartVolume"]')).toBeEnabled();
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await grabVisibleRock(page);
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getDrizzleAudioState()),
    )
    .toMatchObject({
      playing: true,
      running: true,
      schedulerActive: true,
      startCount: 1,
    });

  const drizzleVolumes = await page.evaluate(() => {
    collab.enabled = false;
    collab.snapshots.length = 0;
    motion.phase = SharedPhysics.PHASES.PLAY;
    motion.dragging = false;
    motion.suspended = true;
    updateBounds();
    setPosition(bounds.maxX / 2, bounds.maxY);
    const bottomVolume =
      window.__sisyphusTestApi.getDrizzleAudioState().volume;
    setPosition(bounds.maxX / 2, 0);
    const topVolume =
      window.__sisyphusTestApi.getDrizzleAudioState().volume;

    return {
      bottomVolume,
      topVolume,
    };
  });
  expect(drizzleVolumes.bottomVolume).toBeCloseTo(0.2, 5);
  expect(drizzleVolumes.topVolume).toBeCloseTo(0.8, 5);

  await page.evaluate(() => {
    collab.enabled = true;
  });
  await openSettingsPanel(page);
  await openControlGroup(page, "Финальное падение");
  await openControlGroup(page, "Капель");
  await setCheckbox(page, "finalFallEnabled", false);
  await setRange(page, "finalFallDelaySeconds", 2);
  await setRange(page, "drizzleStartVolume", 0.1);
  await setRange(page, "drizzleEndVolume", 1);
  await setField(
    page,
    "drizzleVolumeEasing",
    "cubic-bezier(0.4, 0, 0.2, 1)",
  );
  await expect(page.locator('[name="finalFallEnabled"]')).not.toBeChecked();
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
});

test("gachi накладывается по primary click и доигрывает при падении", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await page.evaluate(() => {
    collab.enabled = false;
    params.handAudioEnabled = false;
  });

  const initial = await page.evaluate(
    () => window.__sisyphusTestApi.getGachiClickAudioState(),
  );
  await scrollToRock(page);
  const point = await visibleRockPoint(page);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.mouse.click(point.x, point.y, { button: "middle" });
  expect(
    await page.evaluate(
      () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
    ),
  ).toBe(initial.playCount);

  await grabVisibleRock(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getGachiClickAudioState()),
    )
    .toMatchObject({
      active: true,
      activeCount: 1,
      playCount: initial.playCount + 1,
    });
  await page.evaluate(() => {
    window.__sisyphusTestApi.playGachiClickSound();
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getGachiClickAudioState()),
    )
    .toMatchObject({
      active: true,
      activeCount: 2,
      playCount: initial.playCount + 2,
    });
  expect(
    await page.evaluate(() =>
      window.SisyphusGachiSounds.GACHI_SOUND_FILENAMES.includes(
        window.__sisyphusTestApi.getGachiClickAudioState().lastFilename,
      ),
    ),
  ).toBe(true);

  const falling = await page.evaluate(() => {
    motion.phase = SharedPhysics.PHASES.PLAY;
    const stopBefore =
      window.__sisyphusTestApi.getGachiClickAudioState().stopCount;
    window.__sisyphusTestApi.receiveSharedSnapshot({
      phase: SharedPhysics.PHASES.FALLING,
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: 1,
      vx: 0,
      vy: 100,
      dragging: false,
      suspended: false,
      holderId: null,
      revision: collab.lastRevision + 1,
      serverTime: Date.now(),
      groundTouchSeq: collab.groundTouchSeq,
    });
    return {
      gachi: window.__sisyphusTestApi.getGachiClickAudioState(),
      expectedPhase: SharedPhysics.PHASES.FALLING,
      phase: motion.phase,
      stopBefore,
    };
  });
  expect(falling.phase).toBe(falling.expectedPhase);
  expect(falling.gachi).toMatchObject({
    active: true,
    activeCount: 2,
    stopCount: falling.stopBefore,
  });
  await page.mouse.up();
});

test("звук удара срабатывает один раз после каждого нового касания рукой", async ({
  page,
}) => {
  await watchAudioPlayCalls(page, "СимуляцияОргазма.mov");
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);

  await grabVisibleRock(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGroundImpactAudioState().armed,
      ),
    )
    .toBe(true);
  await page.mouse.up();

  const localContacts = await page.evaluate(() => {
    collab.enabled = false;
    restartExperience();
    params.finalFallEnabled = false;
    params.bounce = 0.5;
    params.gravity = 10;
    motion.phase = SharedPhysics.PHASES.PLAY;
    motion.suspended = false;
    updateBounds();
    const before =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;

    setPosition(bounds.maxX / 2, bounds.maxY - 1);
    motion.vy = 1000;
    window.__sisyphusTestApi.applyPhysics(SharedPhysics.FIXED_STEP_SECONDS);
    const unarmedAfter =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;

    window.__sisyphusTestApi.armGroundImpactSound();
    setPosition(bounds.maxX / 2, bounds.maxY - 1);
    motion.vy = 1000;
    for (let frame = 0; frame < 600; frame += 1) {
      window.__sisyphusTestApi.applyPhysics(
        SharedPhysics.FIXED_STEP_SECONDS,
      );
    }
    const afterBounces =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;
    const armedAfterBounces =
      window.__sisyphusTestApi.getGroundImpactAudioState().armed;

    window.__sisyphusTestApi.armGroundImpactSound();
    setPosition(bounds.maxX / 2, bounds.maxY - 1);
    motion.vy = 1000;
    window.__sisyphusTestApi.applyPhysics(SharedPhysics.FIXED_STEP_SECONDS);
    return {
      activeCount:
        window.__sisyphusTestApi.getGroundImpactAudioState().activeCount,
      afterBounces,
      afterNewTouch:
        window.__sisyphusTestApi.getGroundImpactAudioState().playCount,
      armedAfterBounces,
      before,
      unarmedAfter,
    };
  });
  expect(localContacts.unarmedAfter).toBe(localContacts.before);
  expect(localContacts.afterBounces).toBe(localContacts.before + 1);
  expect(localContacts.armedAfterBounces).toBe(false);
  expect(localContacts.afterNewTouch).toBe(localContacts.before + 2);
  expect(localContacts.activeCount).toBeGreaterThanOrEqual(2);

  const sharedContacts = await page.evaluate(() => {
    const before =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;
    collab.groundTouchSeq = null;
    window.__sisyphusTestApi.syncSharedGroundTouchSeq(7);
    const initialized =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;
    window.__sisyphusTestApi.armGroundImpactSound();
    window.__sisyphusTestApi.syncSharedGroundTouchSeq(10);
    const firstArmedLanding =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;
    window.__sisyphusTestApi.syncSharedGroundTouchSeq(12);
    const unarmedLandings =
      window.__sisyphusTestApi.getGroundImpactAudioState().playCount;
    window.__sisyphusTestApi.armGroundImpactSound();
    window.__sisyphusTestApi.syncSharedGroundTouchSeq(13);
    window.__sisyphusTestApi.syncSharedGroundTouchSeq(7);
    return {
      before,
      firstArmedLanding,
      afterNewTouch:
        window.__sisyphusTestApi.getGroundImpactAudioState().playCount,
      initialized,
      unarmedLandings,
    };
  });
  expect(sharedContacts.initialized).toBe(sharedContacts.before);
  expect(sharedContacts.firstArmedLanding).toBe(sharedContacts.before + 1);
  expect(sharedContacts.unarmedLandings).toBe(sharedContacts.before + 1);
  expect(sharedContacts.afterNewTouch).toBe(sharedContacts.before + 2);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        filename:
          window.__sisyphusTestApi.getGroundImpactAudioState().lastFilename,
        watched:
          window.__watchedAudioPlayCounts["СимуляцияОргазма.mov"],
      })),
    )
    .toMatchObject({
      filename: "СимуляцияОргазма.mov",
      watched: sharedContacts.afterNewTouch,
    });
});

test("UI выключает hover и grab звуки руки", async ({ page }) => {
  test.setTimeout(60_000);
  await watchAudioPlayCalls(page, "Кандалы");
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Рука");
  await expect(page.locator('[name="handAudioEnabled"]')).toBeChecked();
  await closeSettingsPanel(page);

  await scrollToRock(page);
  const enabledPoint = await visibleRockPoint(page);
  await page.mouse.move(1, 1);
  await page.mouse.move(enabledPoint.x, enabledPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0),
    )
    .toBeGreaterThan(0);

  await openSettingsPanel(page);
  await openControlGroup(page, "Рука");
  await setCheckbox(page, "handAudioEnabled", false);
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        enabled: window.__sisyphusTestApi.params.handAudioEnabled,
        state: getRoleAudioState(),
      })),
    )
    .toMatchObject({
      enabled: false,
      state: {
        fadeActive: false,
        fadeTargetVolume: 0,
      },
    });
  const mutedCount = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Кандалы"] || 0,
  );
  await scrollToRock(page);
  const mutedPoint = await visibleRockPoint(page);
  await page.mouse.move(1, 1);
  await page.mouse.move(mutedPoint.x, mutedPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(350);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0),
    )
    .toBe(mutedCount);

  await openSettingsPanel(page);
  await openControlGroup(page, "Рука");
  await setCheckbox(page, "handAudioEnabled", true);
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await scrollToRock(page);
  const restoredPoint = await visibleRockPoint(page);
  await page.mouse.move(1, 1);
  await page.mouse.move(restoredPoint.x, restoredPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0),
    )
    .toBeGreaterThan(mutedCount);
});

test("dev-каталог шаблонов общий для личных сессий браузеров", async ({
  browser,
}) => {
  const firstContext = await createBrowserContext(
    browser,
    {},
    "00000000-0000-4000-8000-000000000101",
  );
  const secondContext = await createBrowserContext(
    browser,
    {},
    "00000000-0000-4000-8000-000000000102",
  );
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  let freshContext = null;

  try {
    await Promise.all([first.goto("/"), second.goto("/")]);
    await Promise.all([
      expect(first.getByTestId("session-status")).toContainText("В сессии"),
      expect(second.getByTestId("session-status")).toContainText("В сессии"),
    ]);
    await Promise.all([
      openSettingsPanel(first),
      openSettingsPanel(second),
    ]);
    await expect(first.locator(".settings-room-save")).toHaveCount(0);
    await expect(
      first.getByRole("button", {
        name: "Сохранить версию и настройки комнаты",
      }),
    ).toBeVisible();

    await first.locator(".settings-version-toggle").click();
    await first.locator('[data-settings-version-choice=""]').click();
    await setRange(first, "gravity", 8.25);
    await first
      .locator(".settings-version-name")
      .fill("Межбраузерный шаблон");
    await first.locator(".settings-version-save").click();
    await expect(first.locator(".settings-production-status")).toContainText(
      "Версия и настройки комнаты сохранены",
    );

    const firstVersion = first.locator(".settings-version-option", {
      hasText: "Межбраузерный шаблон",
    });
    await expect(firstVersion).toHaveCount(1);
    await first.locator(".settings-version-save").click();
    await expect(first.locator(".settings-production-status")).toContainText(
      "Версия и настройки комнаты сохранены",
    );
    await expect(firstVersion).toHaveCount(1);

    await second.locator(".settings-version-toggle").click();
    const secondVersion = second.locator(".settings-version-option", {
      hasText: "Межбраузерный шаблон",
    });
    await expect(secondVersion).toHaveCount(1);
    await secondVersion.locator(".settings-version-choice").click();
    await expect(second.locator('[name="gravity"]')).toHaveValue("8.25");

    await setRange(second, "gravity", 9.25);
    await expect(first.locator('[name="gravity"]')).toHaveValue("8.25");

    freshContext = await createBrowserContext(
      browser,
      {},
      "00000000-0000-4000-8000-000000000103",
    );
    const fresh = await freshContext.newPage();
    await fresh.goto("/");
    await expect(fresh.getByTestId("session-status")).toContainText("В сессии");
    await openSettingsPanel(fresh);
    await fresh.locator(".settings-version-toggle").click();
    const freshVersion = fresh.locator(".settings-version-option", {
      hasText: "Межбраузерный шаблон",
    });
    await expect(freshVersion).toHaveCount(1);

    await first.locator(".settings-version-toggle").click();
    await firstVersion.locator(".settings-version-delete").click();
    await expect(secondVersion).toHaveCount(0);
    await expect(freshVersion).toHaveCount(0);
  } finally {
    await freshContext?.close();
    await secondContext.close();
    await firstContext.close();
  }
});

async function resetRootExperience(page) {
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.evaluate(() => {
    window.__sisyphusTestApi.restartExperience();
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 0,
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const { motion } = window.__sisyphusTestApi;
        return {
          phase: motion.phase,
          suspended: motion.suspended,
        };
      }),
    )
    .toEqual({
      phase: "play",
      suspended: true,
    });
}

async function visibleRockPoint(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, innerHeight);
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
      throw new Error("Не найдена видимая точка камня");
    }

    const xRatios = [0.5, 0.35, 0.65, 0.2, 0.8];
    const yRatios = [0.5, 0.35, 0.65, 0.2, 0.8];
    for (const yRatio of yRatios) {
      for (const xRatio of xRatios) {
        const x = left + width * xRatio;
        const y = top + height * yRatio;
        const hit = document.elementFromPoint(x, y);
        if (hit === rock || rock.contains(hit)) {
          return { x, y };
        }
      }
    }
    throw new Error("Не найдена видимая точка камня");
  });
}

async function scrollToRock(page) {
  await page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const targetY =
      window.scrollY + rect.top + rect.height / 2 - window.innerHeight * 0.45;
    window.scrollTo(0, Math.max(0, targetY));
  });
  await expect
    .poll(
      async () => {
        try {
          await visibleRockPoint(page);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 3000 }
    )
    .toBe(true);
}

async function grabVisibleRock(page) {
  await page.evaluate(() => {
    window.__sisyphusTestApi.completePreclickRockGuidance();
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 0,
    });
  });
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await scrollToRock(page);
    const point = await visibleRockPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    try {
      await expect
        .poll(
          () =>
            page.evaluate(
              () =>
                motion.dragging &&
                (!collab.enabled || collab.hasControl || collab.pendingControl)
            ),
          { timeout: 1500 }
        )
        .toBe(true);
      return point;
    } catch (error) {
      lastError = error;
      await page.mouse.up();
    }
  }
  throw lastError;
}

async function moveSharedDragToBottom(...pages) {
  await Promise.all(pages.map((page) => page.evaluate(() => {
    const target = {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: SharedPhysics.WORLD_HEIGHT,
    };
    const local = canonicalToLocal(target.x, target.y);
    setPosition(local.x, local.y);
    motion.dragTargetX = local.x;
    motion.dragTargetY = local.y;
    motion.pointerVx = 0;
    motion.pointerVy = 0;
    syncReturnTheme();
    sendShared("control.move", {
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      pointer: {
        ...collab.localPointer,
        x: target.x,
        y: target.y,
        mode: "grabbing",
        visible: true,
      },
    });
  })));
}

async function expectReadyAtBottom(page) {
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        updateBounds();
        const rock = document.querySelector(".rock");
        const rect = rock.getBoundingClientRect();
        return {
          phase: motion.phase,
          suspended: motion.suspended,
          y: motion.y,
          maxY: bounds.maxY,
          scrollY: window.scrollY,
          maxScroll:
            document.documentElement.scrollHeight - window.innerHeight,
          pointerEvents: getComputedStyle(rock).pointerEvents,
          imprintVisible: document
            .querySelector(".rock-imprint")
            .classList.contains("is-visible"),
          rockVisible: rect.bottom > 0 && rect.top < window.innerHeight,
        };
      })
    )
    .toMatchObject({
      phase: "play",
      suspended: true,
      pointerEvents: "auto",
      imprintVisible: true,
      rockVisible: true,
    });
  const position = await page.evaluate(() => ({
    y: motion.y,
    maxY: bounds.maxY,
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    rockCenterY: (() => {
      const rect = document.querySelector(".rock").getBoundingClientRect();
      return rect.top + rect.height / 2;
    })(),
    viewportCenterY: window.innerHeight / 2,
  }));
  expect(position.y).toBeLessThan(position.maxY);
  expect(
    Math.abs(position.rockCenterY - position.viewportCenterY)
  ).toBeLessThanOrEqual(3);
  expect(position.scrollY).toBeGreaterThanOrEqual(position.maxScroll - 2);
}

async function expectImprintCenteredInTopViewport(
  page,
  { checkImprintCenter = true } = {},
) {
  await expect(page.getByTestId("rock-imprint")).toHaveClass(/is-visible/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.locator(".top-inscription")).toHaveCount(0);
  const position = await page.getByTestId("rock-imprint").evaluate((imprint) => {
    const rect = imprint.getBoundingClientRect();
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportCenterX: window.innerWidth / 2,
      viewportCenterY: window.innerHeight / 2,
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  if (checkImprintCenter) {
    expect(
      Math.abs(position.centerX - position.viewportCenterX),
    ).toBeLessThanOrEqual(3);
    expect(
      Math.abs(position.centerY - position.viewportCenterY),
    ).toBeLessThanOrEqual(3);
  }
  expect(position.documentScrollWidth).toBeLessThanOrEqual(
    position.viewportWidth,
  );
}

async function expectReturnImprintDoesNotScrollToTop(page) {
  const returnState = await page.evaluate(() => {
    const originalScrollTo = window.scrollTo.bind(window);
    window.__returnScrollCalls = [];
    window.__restoreScrollTo = () => {
      window.scrollTo = originalScrollTo;
      delete window.__restoreScrollTo;
    };
    window.scrollTo = (...args) => {
      window.__returnScrollCalls.push(args);
      const [first, second] = args;
      if (first && typeof first === "object") {
        originalScrollTo({ ...first, behavior: "auto" });
        return;
      }
      originalScrollTo(first, second);
    };

    originalScrollTo(0, document.documentElement.scrollHeight);
    const imprint = document.querySelector(".rock-imprint");
    const x = Number.parseFloat(imprint.style.getPropertyValue("--imprint-x"));
    const y = Number.parseFloat(imprint.style.getPropertyValue("--imprint-y"));
    motion.suspended = false;
    setPosition(x, y);
    syncReturnTheme();
    return {
      bodyClassAfterSync: document.body.className,
      themeTransitionDuration: getComputedStyle(document.body)
        .getPropertyValue("--theme-transition-duration")
        .trim(),
      x,
      y,
    };
  });

  expect(returnState.bodyClassAfterSync).toContain("theme-light");
  expect(returnState.themeTransitionDuration).toBe("1100ms");
  expect(Number.isFinite(returnState.x)).toBe(true);
  expect(Number.isFinite(returnState.y)).toBe(true);
  await page.waitForTimeout(150);
  const scrollState = await page.evaluate(() => ({
    calls: window.__returnScrollCalls,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    scrollY: window.scrollY,
  }));
  expect(
    scrollState.calls.some(
      ([left, top]) => left === 0 && Number(top) === 0
    )
  ).toBe(false);
  expect(scrollState.scrollY).toBeGreaterThanOrEqual(
    scrollState.maxScroll - 2
  );
  const exitState = await page.evaluate(({ x, y }) => {
    setPosition(bounds.maxX / 2, bounds.maxY);
    syncReturnTheme();
    const result = {
      bodyClassAfterExit: document.body.className,
      themeTransitionDuration: getComputedStyle(document.body)
        .getPropertyValue("--theme-transition-duration")
        .trim(),
    };
    setPosition(x, y);
    syncReturnTheme();
    return result;
  }, returnState);
  expect(exitState.bodyClassAfterExit).toContain("theme-dark");
  expect(exitState.themeTransitionDuration).toBe("2000ms");
  await page.evaluate(() => window.__restoreScrollTo?.());
}

async function expectScrollDoesNotAffectPhysics(page) {
  await expectReadyAtBottom(page);
  const before = await page.evaluate(() => ({
    phase: motion.phase,
    x: motion.x,
    y: motion.y,
    vx: motion.vx,
    vy: motion.vy,
    suspended: motion.suspended,
    themeClass:
      [...document.body.classList].find((name) => name.startsWith("theme-")) ||
      "",
  }));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({
    phase: motion.phase,
    x: motion.x,
    y: motion.y,
    vx: motion.vx,
    vy: motion.vy,
    suspended: motion.suspended,
    firstFallTriggered: motion.firstFallTriggered,
  }));
  expect(after).toMatchObject({
    phase: before.phase,
    x: before.x,
    y: before.y,
    vx: before.vx,
    vy: before.vy,
    suspended: true,
    firstFallTriggered: false,
  });
  await scrollToRock(page);
  expect((await page.locator("body").getAttribute("class")) || "").toContain(
    before.themeClass,
  );
}

async function trailHasVisiblePixels(page) {
  return page
    .locator(`${SOURCE_TRAIL}, #root > .world > .trail-session`)
    .evaluateAll((canvases) =>
      canvases.some((canvas) => {
        const context = canvas.getContext("2d");
        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;
        return data.some(
          (channel, index) => index % 4 === 3 && channel > 0,
        );
      }),
    );
}

test("dev при запуске мигрирует прямые legacy-настройки раньше шаблонов", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "sisyphus-czar-settings-v20",
      JSON.stringify({ gravity: 3 }),
    );
    localStorage.setItem(
      "sisyphus-czar-settings-versions-v1",
      JSON.stringify({
        selectedId: "older",
        entries: [
          {
            id: "older",
            name: "Старый",
            settingsSchemaVersion: 20,
            createdAt: "2026-07-24T10:00:00.000Z",
            updatedAt: "2026-07-24T10:00:00.000Z",
            settings: { gravity: 5 },
          },
          {
            id: "latest",
            name: "Последний",
            settingsSchemaVersion: 20,
            createdAt: "2026-07-25T10:00:00.000Z",
            updatedAt: "2026-07-25T12:00:00.000Z",
            settings: { gravity: 9.8 },
          },
        ],
      }),
    );
  });

  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await openSettingsPanel(page);
  const migratedGravity = Number(
    await page.locator('[name="gravity"]').inputValue(),
  );
  expect(migratedGravity).toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}",
        );
        return stored.gravity;
      }),
    )
    .toBe(migratedGravity);
});

test("локальные настройки v20 мигрируют в v48 без потери trailEnabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.removeItem("sisyphus-czar-settings-v48");
    localStorage.setItem(
      "sisyphus-czar-settings-v20",
      JSON.stringify({
        gravity: 7.5,
        themeMode: "light",
        trailEnabled: false,
      }),
    );
  });

  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await openSettingsPanel(page);
  await expect(page.locator('[name="gravity"]')).toHaveValue("7.5");
  await expect(page.locator('[name="trailEnabled"]')).not.toBeChecked();
  await expect(page.locator('[name="glowOptimizationMode"]')).toHaveValue(
    "balanced",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}",
        );
        return {
          gravity: stored.gravity,
          glowOptimizationMode: stored.glowOptimizationMode,
          cameraFollowLerp: stored.cameraFollowLerp,
          handVisibilityMode: stored.handVisibilityMode,
          handImageChangeDelayMs: stored.handImageChangeDelayMs,
          preclickHopGuardClickCount: stored.preclickHopGuardClickCount,
          preclickHopActivationRadiusPercent:
            stored.preclickHopActivationRadiusPercent,
          preclickHopMaxDistancePercent:
            stored.preclickHopMaxDistancePercent,
          hasLegacyPreclick: Object.keys(stored).some((key) =>
            key.startsWith("preclickParallax") ||
            key === "preclickHopActivationRadiusVw" ||
            key === "preclickHopMaxDistanceVw",
          ),
          themeMode: stored.themeMode,
          trailEnabled: stored.trailEnabled,
        };
      }),
    )
    .toEqual({
      gravity: 7.5,
      glowOptimizationMode: "balanced",
      cameraFollowLerp: 0.1,
      handVisibilityMode: "always",
      handImageChangeDelayMs: 0,
      preclickHopGuardClickCount: 1,
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 62.5,
      hasLegacyPreclick: false,
      themeMode: "light",
      trailEnabled: false,
    });
});

test("старая session-ссылка очищается до корневого URL личной сессии", async ({ browser }) => {
  test.setTimeout(70_000);
  const context = await createBrowserContext(browser);
  const page = await context.newPage();
  const missingSessionId = "AAAAAAAAAAAAAAAAAAAAAA";

  await page.goto(`/?session=${missingSessionId}`);
  await expect.poll(() => page.url()).not.toContain(missingSessionId);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page.getByTestId("share-session-top")).toHaveCount(0);

  await context.close();
});

test(
  "верхний отпечаток центрируется в середине первого экрана",
  async ({ browser }) => {
    const context = await createBrowserContext(browser, {
      viewport: { width: 1905, height: 899 },
    });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    await resetRootExperience(page);
    await expectReadyAtBottom(page);
    await expectImprintCenteredInTopViewport(page);
    await expectReturnImprintDoesNotScrollToTop(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await expectImprintCenteredInTopViewport(page, {
      checkImprintCenter: false,
    });

    await context.close();
  }
);

test("траектория сбрасывается при касании земли", async ({ browser }) => {
  const context = await createBrowserContext(browser, {
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Траектория");
  await setCheckbox(page, "trailReset", true);
  await saveRoomSettings(page);
  await closeSettingsPanel(page);

  const result = await page.evaluate(() => {
    params.bounce = 0;
    updateBounds();
    trail.points = [
      { x: 10, y: 20 },
      { x: 20, y: 40 },
    ];
    trail.lastX = 20;
    trail.lastY = 40;
    trail.followX = 20;
    trail.followY = 40;
    trail.dirty = true;
    motion.phase = SharedPhysics.PHASES.PLAY;
    motion.suspended = false;
    motion.dragging = false;
    motion.vx = 0;
    motion.vy = 900;
    setPosition(bounds.maxX / 2, Math.max(0, bounds.maxY - 1));
    window.__sisyphusTestApi.applyPhysics(SharedPhysics.FIXED_STEP_SECONDS);
    return {
      points: trail.points.length,
      skipNextRecord: trail.skipNextRecord,
      y: motion.y,
      maxY: bounds.maxY,
    };
  });

  expect(result.points).toBe(0);
  expect(result.skipNextRecord).toBe(true);
  expect(result.y).toBeCloseTo(result.maxY, 1);

  await context.close();
});

test("общая и проходная прозрачность траектории применяются раздельно", async ({
  browser,
}) => {
  const context = await createBrowserContext(browser, {
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Траектория");
  await setRange(page, "lineOpacity", 0.4);
  await setRange(page, "linePassOpacity", 0.1);
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  await expect
    .poll(() =>
      page.evaluate(() => ({
        lineOpacity: window.__sisyphusTestApi.params.lineOpacity,
        linePassOpacity: window.__sisyphusTestApi.params.linePassOpacity,
      })),
    )
    .toEqual({ lineOpacity: 0.4, linePassOpacity: 0.1 });

  const result = await page.evaluate(() => {
    params.lineColor = "#ffffff";
    params.useGradient = false;
    params.dashStyle = "solid";
    params.glow = 0;
    params.lineWidth = 12;
    params.lineCap = "butt";
    trail.points = [
      { x: window.scrollX + 100, y: window.scrollY + 100 },
      { x: window.scrollX + 300, y: window.scrollY + 100 },
    ];
    trail.sessionPoints = trail.points.slice();
    trail.dirty = false;
    trail.sessionDirty = true;
    window.__sisyphusTestApi.drawTrail();

    const canvas = document.querySelector(".trail-session");
    const ratio = canvas.width / window.innerWidth;
    const context2d = canvas.getContext("2d");
    const pixel = context2d.getImageData(
      Math.round(200 * ratio),
      Math.round(100 * ratio),
      1,
      1
    ).data;

    const additiveCanvas = document.createElement("canvas");
    additiveCanvas.width = 4;
    additiveCanvas.height = 4;
    const additiveContext = additiveCanvas.getContext("2d");
    additiveContext.globalCompositeOperation = "lighter";
    additiveContext.globalAlpha = 0.1;
    additiveContext.fillStyle = "#ffffff";
    for (let pass = 0; pass < 10; pass += 1) {
      additiveContext.fillRect(0, 0, 4, 4);
    }

    return {
      additiveAlpha: additiveContext.getImageData(2, 2, 1, 1).data[3],
      canvasOpacity: getComputedStyle(canvas).opacity,
      lineAlpha: pixel[3],
      lineOpacity: params.lineOpacity,
      linePassOpacity: params.linePassOpacity,
    };
  });

  expect(result).toMatchObject({
    canvasOpacity: "0.4",
    lineOpacity: 0.4,
    linePassOpacity: 0.1,
  });
  expect(result.lineAlpha).toBeGreaterThanOrEqual(24);
  expect(result.lineAlpha).toBeLessThanOrEqual(27);
  expect(result.additiveAlpha).toBe(255);

  await context.close();
});

test("glow ограничивает стоимость, Fold копирует только ревизии, а glow=0 останавливает проходы", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expect(
    page.locator('[data-fold-layer][data-fold-ready="true"]'),
  ).toHaveCount(1);

  const initialPasses = await page.evaluate(
    () => window.__sisyphusTestApi.getGlowRenderState().renderPasses,
  );
  await page.evaluate(() => {
    collab.enabled = false;
    collab.snapshots.length = 0;
    motion.suspended = true;
    params.trailEnabled = true;
    params.glow = 24;
    params.glowOptimizationMode = "performance";
    params.lineWidth = 8;
    params.dashStyle = "solid";
    trail.points = Array.from({ length: 5000 }, (_, index) => ({
      x: window.scrollX + 80 + (index % 800),
      y: window.scrollY + 100 + ((index * 7) % 500),
    }));
    trail.historyPoints = trail.points.slice();
    trail.dirty = true;
    trail.glowDirty = true;
    window.__sisyphusTestApi.drawTrail();
  });

  await expect
    .poll(
      () =>
        page.evaluate(() => window.__sisyphusTestApi.getGlowRenderState()),
      { timeout: 10_000 },
    )
    .toMatchObject({
      profile: {
        bufferScale: 0.25,
        maxPoints: 350,
        updateFps: 24,
      },
      rendered: true,
    });

  const rendered = await page.evaluate(() => {
    const state = window.__sisyphusTestApi.getGlowRenderState();
    const canvas = document.querySelector("#root > .world > .trail-glow");
    return {
      ...state,
      canvasHeight: canvas.height,
      canvasWidth: canvas.width,
      maxHeight: Math.ceil(window.innerHeight * 0.5),
      maxWidth: Math.ceil(window.innerWidth * 0.5),
    };
  });
  expect(rendered.renderPasses).toBeGreaterThan(initialPasses);
  expect(rendered.sampledPointCount).toBeGreaterThan(1);
  expect(rendered.sampledPointCount).toBeLessThanOrEqual(350);
  expect(rendered.canvasWidth).toBeLessThanOrEqual(rendered.maxWidth);
  expect(rendered.canvasHeight).toBeLessThanOrEqual(rendered.maxHeight);

  const mirrorSelector = '[data-fold-zone] .trail-glow';
  await expect
    .poll(() =>
      page.evaluate((selector) => {
        const source = document.querySelector("#root > .world > .trail-glow");
        const mirror = document.querySelector(selector);
        const state = window.__sisyphusTestApi.getGlowRenderState();
        return Boolean(
          source &&
            mirror?.dataset.foldCopyCount &&
            mirror.dataset.foldSourceRevision ===
              source.dataset.canvasRevision &&
            state.animationFrameId === null &&
            state.timerId === null,
        );
      }, mirrorSelector),
    )
    .toBe(true);
  const foldBefore = await page.locator(mirrorSelector).evaluate((canvas) => ({
    copies: canvas.dataset.foldCopyCount,
    revision: canvas.dataset.foldSourceRevision,
  }));
  await page.waitForTimeout(180);
  const foldAfter = await page.locator(mirrorSelector).evaluate((canvas) => ({
    copies: canvas.dataset.foldCopyCount,
    revision: canvas.dataset.foldSourceRevision,
  }));
  expect(foldAfter).toEqual(foldBefore);

  const disabledState = await page.evaluate(() => {
    params.glow = 0;
    trail.glowDirty = true;
    window.__sisyphusTestApi.drawTrail();
    return window.__sisyphusTestApi.getGlowRenderState();
  });
  expect(disabledState.rendered).toBe(false);
  const disabledRevision = disabledState.glowRevision;
  const disabledPasses = disabledState.renderPasses;

  await page.evaluate(() => {
    trail.points.push({ x: window.scrollX + 200, y: window.scrollY + 200 });
    trail.dirty = true;
    trail.glowDirty = true;
    window.__sisyphusTestApi.drawTrail();
  });
  await page.waitForTimeout(180);
  const stillDisabled = await page.evaluate(() =>
    window.__sisyphusTestApi.getGlowRenderState(),
  );
  expect(stillDisabled.glowRevision).toBe(disabledRevision);
  expect(stillDisabled.renderPasses).toBe(disabledPasses);
  expect(stillDisabled.rendered).toBe(false);
});

test("history и session canvas разделяют 10000 точек и не рисуют в idle", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);

  await expect(page.locator(".trail-history:not([data-fold-layer] *)")).toHaveCount(1);
  await expect(page.locator(".trail-session:not([data-fold-layer] *)")).toHaveCount(1);
  await expect(page.locator(".trail-glow:not([data-fold-layer] *)")).toHaveCount(1);

  const baselinePasses = await page.evaluate(() => {
    collab.enabled = false;
    collab.snapshots.length = 0;
    params.trailEnabled = true;
    params.trailMaxPoints = 10000;
    params.trailRenderProfile = "desktop";
    params.glow = 0;
    const points = Array.from({ length: 10000 }, (_, index) => [
      100 + ((index * 17) % 800),
      (index / 9999) * 2000,
      2,
    ]);
    const before = window.__sisyphusTestApi.getTrailState().historyRenderPasses;
    window.__sisyphusTestApi.loadSharedTrail(points);
    return before;
  });

  await expect
    .poll(() => page.evaluate(() => window.__sisyphusTestApi.getTrailState()))
    .toMatchObject({
      pointCount: 10000,
      canonicalPointCount: 10000,
      historyPointCount: 10000,
      sessionPointCount: 0,
      renderScheduled: false,
    });

  const loaded = await page.evaluate(() =>
    window.__sisyphusTestApi.getTrailState(),
  );
  expect(loaded.historyRenderPasses).toBeGreaterThan(baselinePasses);
  expect(loaded.historyStrokeBatches).toBeLessThanOrEqual(50);
  expect(loaded.profile.historyMaxPoints).toBe(10000);

  const idleBefore = {
    historyRevision: loaded.historyRevision,
    historyRenderPasses: loaded.historyRenderPasses,
    sessionRevision: loaded.sessionRevision,
    sessionRenderPasses: loaded.sessionRenderPasses,
  };
  await page.waitForTimeout(1200);
  const idleAfter = await page.evaluate(() =>
    window.__sisyphusTestApi.getTrailState(),
  );
  expect({
    historyRevision: idleAfter.historyRevision,
    historyRenderPasses: idleAfter.historyRenderPasses,
    sessionRevision: idleAfter.sessionRevision,
    sessionRenderPasses: idleAfter.sessionRenderPasses,
  }).toEqual(idleBefore);
  expect(idleAfter.renderScheduled).toBe(false);
  expect(idleAfter.sharedRenderScheduled).toBe(false);

  await page.evaluate(() => {
    const points = Array.from({ length: 32 }, (_, index) => [
      500 + index,
      1960 + index,
      2,
    ]);
    window.__sisyphusTestApi.appendSharedTrail(points);
  });
  await expect
    .poll(() => page.evaluate(() => window.__sisyphusTestApi.getTrailState()))
    .toMatchObject({
      pointCount: 10000,
      historyPointCount: 9968,
      sessionPointCount: 32,
      renderScheduled: false,
    });
  const live = await page.evaluate(() =>
    window.__sisyphusTestApi.getTrailState(),
  );
  expect(live.historyRevision).toBe(loaded.historyRevision);
  expect(live.sessionRevision).toBeGreaterThan(loaded.sessionRevision);

  await page.evaluate(() => {
    window.__sisyphusTestApi.checkpointTrail({ force: true });
    window.__sisyphusTestApi.scheduleTrailRender();
  });
  await expect
    .poll(() => page.evaluate(() => window.__sisyphusTestApi.getTrailState()))
    .toMatchObject({
      pointCount: 10000,
      historyPointCount: 10000,
      sessionPointCount: 0,
      renderScheduled: false,
    });
  const checkpointed = await page.evaluate(() =>
    window.__sisyphusTestApi.getTrailState(),
  );
  expect(checkpointed.historyRevision).toBeGreaterThan(live.historyRevision);
  expect(checkpointed.historyStrokeBatches).toBeLessThanOrEqual(50);
});

test("trail.append пакетируется по 16 точек или 50 мс", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSend = WebSocket.prototype.send;
    window.__trailAppendMessages = [];
    WebSocket.prototype.send = function send(data) {
      try {
        const message = JSON.parse(String(data));
        if (message.type === "trail.append") {
          window.__trailAppendMessages.push(message);
        }
      } catch {
        // Test instrumentation ignores non-JSON websocket payloads.
      }
      return nativeSend.call(this, data);
    };
  });
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  await page.evaluate(() => {
    collab.trailWriterId = collab.clientId;
    for (let index = 0; index < 15; index += 1) {
      window.__sisyphusTestApi.queueSharedTrailPoint({ x: index, y: index });
    }
  });
  expect(await page.evaluate(() => window.__trailAppendMessages.length)).toBe(0);

  await page.evaluate(() => {
    window.__sisyphusTestApi.queueSharedTrailPoint({ x: 15, y: 15 });
  });
  await expect
    .poll(() => page.evaluate(() => window.__trailAppendMessages.length))
    .toBe(1);
  expect(await page.evaluate(() => window.__trailAppendMessages[0])).toMatchObject({
    v: 1,
    type: "trail.append",
    payload: {
      points: Array.from({ length: 16 }, (_, index) => ({ x: index, y: index })),
    },
  });

  await page.evaluate(() => {
    collab.trailWriterId = collab.clientId;
    window.__sisyphusTestApi.queueSharedTrailPoint({ x: 16, y: 16 });
  });
  await expect
    .poll(() => page.evaluate(() => window.__trailAppendMessages.length))
    .toBe(2);
  const sizes = await page.evaluate(() =>
    window.__trailAppendMessages.map((message) => message.payload.points.length),
  );
  expect(sizes).toEqual([16, 1]);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(16);
});

test("кривая нехватки силы замедляет фактический подъём камня", async ({
  browser,
}) => {
  const context = await createBrowserContext(browser, {
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto("/");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await openSettingsPanel(page);
  await openControlGroup(page, "Рука");
  const easingInput = page.locator('[name="handForceDeficitEasing"]');
  await expect(easingInput).toHaveValue("cubic-bezier(0.42, 0, 1, 1)");
  await closeSettingsPanel(page);

  const sampleLiftDistance = () =>
    page.evaluate(() => {
      params.mass = 10;
      params.gravity = 10;
      params.handForce = 50;
      updateBounds();
      const startY = bounds.maxY * 0.75;
      setPosition(bounds.maxX / 2, startY);
      motion.phase = SharedPhysics.PHASES.PLAY;
      motion.suspended = false;
      motion.dragging = true;
      motion.dragTargetX = motion.x;
      motion.dragTargetY = Math.max(0, startY - 500);
      window.__sisyphusTestApi.applyDragTargetMovement(0.001, 1);
      const distance = startY - motion.y;
      motion.dragging = false;
      return distance;
    });

  const easedDistance = await sampleLiftDistance();
  await openSettingsPanel(page);
  await openControlGroup(page, "Рука");
  await setField(page, "handForceDeficitEasing", "cubic-bezier(0, 0, 1, 1)");
  await saveRoomSettings(page);
  await closeSettingsPanel(page);
  const linearDistance = await sampleLiftDistance();

  expect(easedDistance).toBeGreaterThan(0);
  expect(linearDistance).toBeGreaterThan(easedDistance);

  await context.close();
});

test("личная сессия выпрыгивает вверх по независимому таймеру", async ({
  browser,
}) => {
  const context = await createBrowserContext(browser);
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings(
      {
        randomDropEnabled: false,
        rockJumpEnabled: true,
        rockJumpIntervalSeconds: 1,
        rockJumpAngleSpreadDegrees: 0,
        rockJumpInertiaSpreadPercent: 0,
        stationaryAutoSlipEnabled: false,
      },
      { broadcastChanges: true },
    );
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        inFlight: Boolean(collab.settingsUpdateInFlight),
        pending: Object.keys(collab.pendingRoomSettingsChanges),
        rockJumpIntervalSeconds: params.rockJumpIntervalSeconds,
        stationaryAutoSlipEnabled: params.stationaryAutoSlipEnabled,
      })),
    )
    .toEqual({
      inFlight: false,
      pending: [],
      rockJumpIntervalSeconds: 1,
      stationaryAutoSlipEnabled: false,
    });

  await grabVisibleRock(page);
  await expect.poll(() => page.evaluate(() => collab.hasControl)).toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__sisyphusTestApi.getCollaborationDebugState()
              .lastControlSlip,
        ),
      { timeout: 5000 },
    )
    .toMatchObject({ reason: "jumped" });
  const jumpState = await page.evaluate(() => ({
    hasControl: collab.hasControl,
    slip:
      window.__sisyphusTestApi.getCollaborationDebugState().lastControlSlip,
  }));
  expect(jumpState.hasControl).toBe(false);
  expect(jumpState.slip.angleDegrees).toBe(0);
  expect(jumpState.slip.speed).toBeGreaterThan(0);
  await expect(page.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);

  await context.close();
});

test("вход на корень открывает рабочую личную сессию", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await createBrowserContext(browser);
  const page = await context.newPage();
  const documentRequests = [];
  await watchAudioPlayCalls(page, ["Камень", "Кандалы"]);
  page.on("request", (request) => {
    if (request.resourceType() === "document") {
      const url = new URL(request.url());
      documentRequests.push(`${url.pathname}${url.search}`);
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect(page).toHaveTitle("The Path of Tzarey");
  await expect(page.locator(".top-inscription")).toHaveCount(0);
  await expect(page.getByTestId("summit-timer")).toHaveText("00:00:00");
  await expect(page.locator("#root > .world > .summit .title")).toHaveText(
    "The Path of Tzarey",
  );
  await expect(page.locator("#root > .world > .summit .title2")).toHaveText(
    "miniature",
  );
  await expect(page.locator("#root > .world")).toHaveAttribute(
    "aria-label",
    "Сцена The Path of Tzarey",
  );
  await expect(page.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).not.toHaveClass(/is-scroll-locked/);
  await expect(page.locator("body")).toHaveClass(/theme-dark/);
  await resetRootExperience(page);
  await expectReadyAtBottom(page);
  const startState = await page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    return {
      point: {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      },
      centerDelta: {
        x: Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2),
        y: Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2),
      },
      pointerEvents: getComputedStyle(rock).pointerEvents,
      scale: Number.parseFloat(style.getPropertyValue("--rock-scale")),
      sceneHeightScreens: window.__sisyphusTestApi.params.sceneHeightScreens,
      scrollable: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  expect(startState.centerDelta.x).toBeLessThan(2);
  expect(startState.centerDelta.y).toBeLessThan(3);
  expect(startState.pointerEvents).toBe("auto");
  expect(startState.scale).toBeGreaterThan(0);
  expect(startState.scrollable).toBe(startState.sceneHeightScreens > 1);
  await page.evaluate(() => document.fonts.ready);
  const summitTimerLayout = await page.getByTestId("summit-timer").evaluate(
    (timer) => {
      const title = document.querySelector(".title");
      const subtitle = document.querySelector(".title2");
      const timerRect = timer.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const subtitleRect = subtitle.getBoundingClientRect();
      const timerStyle = getComputedStyle(timer);
      const titleStyle = getComputedStyle(title);
      const subtitleStyle = getComputedStyle(subtitle);
      return {
        centerDelta: Math.abs(
          timerRect.left + timerRect.width / 2 - window.innerWidth / 2
        ),
        fitsViewport: timerRect.width <= window.innerWidth,
        fontSize: Number.parseFloat(timerStyle.fontSize),
        fontLoaded: document.fonts.check('16px "Comico"'),
        subtitleFitsViewport:
          subtitleRect.left >= 0 && subtitleRect.right <= window.innerWidth,
        subtitleFontFamily: subtitleStyle.fontFamily,
        titleFitsViewport:
          titleRect.left >= 0 && titleRect.right <= window.innerWidth,
        titleFontFamily: titleStyle.fontFamily,
        titleFontSize: Number.parseFloat(titleStyle.fontSize),
        zIndex: Number.parseInt(timerStyle.zIndex, 10),
        titleZIndex: Number.parseInt(titleStyle.zIndex, 10),
      };
    }
  );
  expect(summitTimerLayout.centerDelta).toBeLessThan(2);
  expect(summitTimerLayout.fitsViewport).toBe(true);
  expect(summitTimerLayout.fontLoaded).toBe(true);
  expect(summitTimerLayout.titleFitsViewport).toBe(true);
  expect(summitTimerLayout.subtitleFitsViewport).toBe(true);
  expect(summitTimerLayout.titleFontFamily).toContain("Comico");
  expect(summitTimerLayout.subtitleFontFamily).toContain("Comico");
  expect(summitTimerLayout.fontSize).toBeGreaterThan(
    summitTimerLayout.titleFontSize
  );
  expect(summitTimerLayout.zIndex).toBeLessThan(summitTimerLayout.titleZIndex);
  await expect.poll(() => documentRequests.length).toBeGreaterThanOrEqual(1);
  expect(documentRequests[0]).toBe("/");
  expect(documentRequests.at(-1)).toBe("/");

  await openSettingsPanel(page);
  await expect(page.getByTestId("share-session")).toHaveCount(0);
  await expect(
    page.locator(".settings-panel .control-group[open]")
  ).toHaveCount(0);
  await page.locator(".settings-version-name").fill("Проверка удаления");
  await page.locator(".settings-version-save").click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Версия и настройки комнаты сохранены",
  );
  await page.locator(".settings-version-toggle").click();
  const savedVersion = page.locator(".settings-version-option", {
    hasText: "Проверка удаления",
  });
  await expect(savedVersion).toHaveCount(1);
  await expect(savedVersion.locator(".settings-version-choice")).toHaveText(
    /^Проверка удаления — \d{2}\.\d{2} \d{2}:\d{2}$/,
  );
  await savedVersion.locator(".settings-version-delete").click();
  await expect(savedVersion).toHaveCount(0);
  await expect(page.locator("#settings-version-current")).toHaveText("Черновик");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-versions-v1") || "{}",
        );
        return Boolean(
          stored.entries?.some((entry) => entry.name === "Проверка удаления"),
        );
      })
    )
    .toBe(false);
  await page.getByRole("button", { name: "Сцена 2. Репка" }).click();
  await openControlGroup(page, "Физика");
  await page.locator('[name="gravity"]').hover();
  await expect(page.locator(".hint .katex").first()).toBeVisible();
  await expect(page.locator(".hint__formulas code")).toHaveCount(0);
  await setRange(page, "gravity", 10);
  await openControlGroup(page, "Камень");
  await setField(page, "rockScaleEasing", "cubic-bezier(0, 0, 1, 1)");
  await setField(page, "rockMinWidthVw", 10);
  await setField(page, "rockMaxWidthVw", 40);
  await expect(page.locator('[name="rockScaleEasing"]')).toHaveValue(
    "cubic-bezier(0, 0, 1, 1)"
  );
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("10");
  await expect(page.locator('[name="rockMaxWidthVw"]')).toHaveValue("40");
  await saveRoomSettings(page);
  await closeSettingsPanel(page);

  await expectScrollDoesNotAffectPhysics(page);
  await expect(page.getByTestId("rock-imprint")).toHaveClass(/is-visible/);
  await expect(page.locator("body")).toHaveClass(/theme-(?:dark|light)/);
  await expect(page.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);
  const scaleSamples = await page.evaluate(() => {
    const rock = document.querySelector(".rock");
    const sample = (y) => {
      setPosition(0, y);
      const leftRect = rock.getBoundingClientRect();
      setPosition(bounds.maxX, y);
      const rightRect = rock.getBoundingClientRect();
      setPosition(bounds.maxX / 2, y);
      const centerRect = rock.getBoundingClientRect();
      return {
        scale: Number.parseFloat(
          getComputedStyle(rock).getPropertyValue("--rock-scale")
        ),
        leftGap: leftRect.left,
        rightGap: window.innerWidth - rightRect.right,
        width: centerRect.width,
      };
    };
    const viewportWidth = window.innerWidth;
    const bottom = sample(bounds.maxY);
    const middle = sample(bounds.maxY / 2);
    const top = sample(0);
    motion.suspended = false;
    motion.vx = 0;
    motion.vy = 0;
    setPosition(bounds.maxX / 2, bounds.maxY);
    return {
      bottom,
      middle,
      top,
      viewportWidth,
      wallPenetrationPercent: params.rockWallPenetrationPercent,
    };
  });
  expect(Math.abs(scaleSamples.top.width - scaleSamples.viewportWidth * 0.4))
    .toBeLessThan(1);
  expect(
    Math.abs(scaleSamples.middle.width - scaleSamples.viewportWidth * 0.25)
  ).toBeLessThan(1);
  expect(
    Math.abs(scaleSamples.bottom.width - scaleSamples.viewportWidth * 0.1)
  ).toBeLessThan(1);
  [scaleSamples.bottom, scaleSamples.middle, scaleSamples.top].forEach(
    (sample) => {
      const expectedGap =
        (-sample.width * scaleSamples.wallPenetrationPercent) / 100;
      expect(Math.abs(sample.leftGap - expectedGap)).toBeLessThan(1);
      expect(Math.abs(sample.rightGap - expectedGap)).toBeLessThan(1);
    }
  );
  await expect
    .poll(() => page.evaluate(() => motion.firstFallTriggered))
    .toBe(false);
  await expect(page.locator("body")).not.toHaveClass(/state-intro/);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Камень"] || 0)
    )
    .toBe(0);
  const firstImpactSoundCount = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Камень"] || 0
  );
  await page.evaluate(() => {
    updateBounds();
    motion.phase = SharedPhysics.PHASES.PLAY;
    motion.dragging = true;
    motion.dragTargetX = motion.x;
    motion.dragTargetY = bounds.maxY;
    setPosition(motion.x, Math.max(0, bounds.maxY - 20));
    window.__sisyphusTestApi.applyDragTargetMovement(1, 0);
    motion.dragging = false;
  });
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Камень"] || 0)
    )
    .toBe(firstImpactSoundCount);
  await scrollToRock(page);

  const trailPoint = await visibleRockPoint(page);
  await page.mouse.move(trailPoint.x, trailPoint.y);
  await page.mouse.down();
  await page.mouse.move(trailPoint.x - 24, trailPoint.y - 6);
  await page.mouse.up();
  await scrollToRock(page);
  await expect
    .poll(() => page.evaluate(() => trail.points.length))
    .toBeGreaterThan(0);
  await expect
    .poll(() => trailHasVisiblePixels(page))
    .toBe(true);
  await openSettingsPanel(page);
  await openControlGroup(page, "Траектория");
  const trailEnabled = page.locator('[name="trailEnabled"]');
  await expect(trailEnabled).toBeChecked();
  await closeSettingsPanel(page);
  await scrollToRock(page);

  await expect(page.locator(SOURCE_ROCK)).toHaveCSS("pointer-events", "auto");
  const playablePoint = await visibleRockPoint(page);
  const chainSoundCountBeforeHover = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Кандалы"] || 0
  );
  await page.mouse.move(1, 1);
  await page.mouse.move(playablePoint.x, playablePoint.y);
  await expect(page.locator(SOURCE_HAND)).toHaveClass(/is-visible/);
  const masterHandSize = await page.locator(SOURCE_HAND).evaluate((hand) => {
    const rect = hand.getBoundingClientRect();
    return { viewportWidth: window.innerWidth, width: rect.width };
  });
  expect(masterHandSize.width).toBeCloseTo(
    masterHandSize.viewportWidth * 0.14375,
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBeGreaterThan(chainSoundCountBeforeHover);
  const chainSoundCountAfterEnter = await page.evaluate(
    () => window.__watchedAudioPlayCounts["Кандалы"] || 0
  );
  await page.locator(SOURCE_ROCK).evaluate((rock, point) => {
    rock.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x + 3,
        clientY: point.y + 3,
        pointerId: 1,
        pointerType: "mouse",
      })
    );
  }, playablePoint);
  await page.waitForTimeout(150);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBe(chainSoundCountAfterEnter);
  await page.waitForTimeout(850);
  await page.locator(SOURCE_ROCK).evaluate((rock, point) => {
    rock.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x - 3,
        clientY: point.y - 3,
        pointerId: 1,
        pointerType: "mouse",
      })
    );
  }, playablePoint);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBe(chainSoundCountAfterEnter);
  await grabVisibleRock(page);
  await expect.poll(() => page.evaluate(() => collab.hasControl)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBeGreaterThanOrEqual(chainSoundCountAfterEnter + 1);
  await expect
    .poll(() => page.evaluate(() => getSessionAudioState()?.scheduled))
    .toBe(false);
  const masterSessionAudio = await page.evaluate(() => getSessionAudioState());
  expect(masterSessionAudio).toMatchObject({
    role: "master",
    scheduled: false,
  });
  expect(masterSessionAudio.filename).toMatch(/^Кандалы_\d{2}\.mp3$/u);
  const masterRoleAudioFadeIn = await page.evaluate(() => getRoleAudioState());
  expect(masterRoleAudioFadeIn).toMatchObject({
    fadeDurationMs: 300,
    fadeTargetVolume: 1,
    role: "master",
  });
  expect(masterRoleAudioFadeIn.volume).toBeGreaterThanOrEqual(0);
  expect(masterRoleAudioFadeIn.volume).toBeLessThanOrEqual(1);
  if (!masterRoleAudioFadeIn.fadeActive) {
    expect(masterRoleAudioFadeIn.volume).toBe(1);
  }
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => collab.hasControl)).toBe(false);
  await page.waitForTimeout(100);
  await expect
    .poll(() =>
      page.evaluate(() => window.__watchedAudioPlayCounts["Кандалы"] || 0)
    )
    .toBeGreaterThanOrEqual(chainSoundCountAfterEnter + 1);
  await expect
    .poll(() => page.evaluate(() => getRoleAudioState()))
    .toEqual({
      fadeActive: false,
      fadeDurationMs: 300,
      fadeTargetVolume: 1,
      role: "master",
      volume: 1,
    });

  await grabVisibleRock(page);
  await expect(page.getByTestId("session-status")).toContainText("вы держите");
  await page.mouse.up();
  await resetRootExperience(page);
  await expectReadyAtBottom(page);

  const urlBeforeReload = page.url();
  await page.reload();
  await expect(page).toHaveURL(urlBeforeReload);
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expectReadyAtBottom(page);
  await expect(page.getByTestId("restart-session")).toBeVisible();

  await context.close();
});

test("reload восстанавливает активную сессию и возвращает камень в viewport", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);

  const target = await page.evaluate(() => {
    const state = {
      phase: SharedPhysics.PHASES.PLAY,
      suspended: false,
      x: SharedPhysics.WORLD_WIDTH * 0.3,
      y: SharedPhysics.WORLD_HEIGHT * 0.2,
    };
    sendShared("physics.update", {
      bounce: 0,
      gravity: 0.1,
      turbulence: 0,
    });
    sendShared("session.restart", state);
    return {
      ...state,
      sessionId: collab.sessionId,
    };
  });
  await expect
    .poll(() =>
      page.evaluate((expected) => {
        const state = currentSharedState();
        return (
          collab.sessionId === expected.sessionId &&
          state.phase === expected.phase &&
          !state.suspended &&
          Math.abs(state.x - expected.x) < 25 &&
          state.y < SharedPhysics.WORLD_HEIGHT * 0.5
        );
      }, target),
    )
    .toBe(true);

  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect
    .poll(() =>
      page.evaluate((expected) => {
        const state = currentSharedState();
        const rock = document.querySelector("#root > .world > .rock");
        const rect = rock?.getBoundingClientRect();
        return {
          activeStateRestored:
            state.phase === expected.phase &&
            !state.suspended &&
            Math.abs(state.x - expected.x) < 25 &&
            state.y < SharedPhysics.WORLD_HEIGHT * 0.65,
          rockInViewport: Boolean(
            rect &&
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.top < innerHeight,
          ),
          sameSession:
            collab.sessionId === expected.sessionId &&
            sessionStorage.getItem("sisyphus-room-session-id") ===
              expected.sessionId,
          stateClassRestored: document.body.classList.contains("state-play"),
        };
      }, target),
    )
    .toEqual({
      activeStateRestored: true,
      rockInViewport: true,
      sameSession: true,
      stateClassRestored: true,
    });
});

test("reload высокой сцены открывает низ и сохраняет suspended-сессию", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(page);

  const preparedRoom = await page.evaluate(() => {
    const settingsRevision = collab.settingsRevision;
    sendShared("roomSettings.update", { sceneHeightScreens: 12 });
    return {
      sessionId: collab.sessionId,
      settingsRevision,
    };
  });
  await expect
    .poll(() => page.evaluate(() => collab.settingsRevision))
    .toBeGreaterThan(preparedRoom.settingsRevision);
  await expect
    .poll(() => page.evaluate(() => currentSharedState().suspended))
    .toBe(true);

  await page.evaluate(() => {
    localStorage.setItem(
      "sisyphus-czar-settings-v48",
      JSON.stringify({ ...params, sceneHeightScreens: 1 }),
    );
    window.scrollTo(0, 0);
  });
  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  await expect
    .poll(() =>
      page.evaluate((expectedSessionId) => {
        const rock = document.querySelector(".rock");
        const rect = rock?.getBoundingClientRect();
        const maxScroll =
          document.documentElement.scrollHeight - window.innerHeight;
        return {
          atBottom: window.scrollY >= maxScroll - 2,
          highSceneRestored: params.sceneHeightScreens === 12,
          rockVisible: Boolean(
            rect && rect.bottom > 0 && rect.top < window.innerHeight,
          ),
          sameSession:
            collab.sessionId === expectedSessionId &&
            sessionStorage.getItem("sisyphus-room-session-id") ===
              expectedSessionId,
          suspended: currentSharedState().suspended,
        };
      }, preparedRoom.sessionId),
    )
    .toEqual({
      atBottom: true,
      highSceneRestored: true,
      rockVisible: true,
      sameSession: true,
      suspended: true,
    });
});

test("кнопка Начать сначала возвращает preclick и сохраняет настройки", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");

  const activeState = await page.evaluate(() => {
    params.gravity = 8;
    sendShared("physics.update", {
      bounce: 0,
      gravity: 8,
      turbulence: 0,
    });
    sendShared("session.restart", {
      phase: SharedPhysics.PHASES.PLAY,
      suspended: false,
      x: SharedPhysics.WORLD_WIDTH * 0.3,
      y: SharedPhysics.WORLD_HEIGHT * 0.2,
    });
    return {
      sessionId: collab.sessionId,
    };
  });
  await expect
    .poll(() =>
      page.evaluate(() => ({
        gravity: params.gravity,
        suspended: currentSharedState().suspended,
      })),
    )
    .toEqual({
      gravity: 8,
      suspended: false,
    });

  const restartButton = page.getByRole("button", { name: "Начать сначала" });
  await expect(restartButton).toBeVisible();
  await expect(restartButton).toBeEnabled();
  await restartButton.focus();
  await expect(restartButton).toBeFocused();
  await restartButton.press("Enter");

  await expect
    .poll(() =>
      page.evaluate((expectedSessionId) => ({
        gravity: params.gravity,
        phase: currentSharedState().phase,
        preclick: document.body.classList.contains("preclick-rock-guidance"),
        sameSession: collab.sessionId === expectedSessionId,
        suspended: currentSharedState().suspended,
      }), activeState.sessionId),
    )
    .toEqual({
      gravity: 8,
      phase: "play",
      preclick: true,
      sameSession: true,
      suspended: true,
    });
  await expect(page.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);
  await expect(page.locator("body")).toHaveClass(/is-manual-scroll-disabled/);
});

test.skip("legacy: общий pointerdown-звук не применяется к личным сессиям", async ({ browser }) => {
  const firstContext = await createBrowserContext(
    browser,
    {},
    MASTER_CLIENT_ID,
  );
  const secondContext = await createBrowserContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const audioTargets = ["Кандалы"];
  await watchAudioPlayCalls(first, audioTargets);
  await watchAudioPlayCalls(second, audioTargets);

  await first.goto("/");
  await expect(first).toHaveURL(/\/$/);
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  const sharedSessionId = await first.evaluate(() => collab.sessionId);
  await second.goto(`/?session=${sharedSessionId}`);
  await expect(first.getByTestId("session-status")).toContainText("В сессии: 2");
  await expect(second.getByTestId("session-status")).toContainText("В сессии: 2");

  async function waitForPlayedEvent(page, role) {
    await expect
      .poll(() =>
        page.evaluate((expectedRole) => {
          const state = getSessionAudioState();
          return state?.role === expectedRole && state.scheduled === false;
        }, role)
      )
      .toBe(true);
    return page.evaluate(() => {
      const { eventId, actorId, role, filename, playAt } =
        getSessionAudioState();
      return { eventId, actorId, role, filename, playAt };
    });
  }

  async function audioCount(page, target) {
    return page.evaluate(
      (filenameTarget) =>
        window.__watchedAudioPlayCounts[filenameTarget] || 0,
      target,
    );
  }

  await scrollToRock(first);
  const masterPoint = await visibleRockPoint(first);
  await first.mouse.move(1, 1);
  await first.mouse.move(masterPoint.x, masterPoint.y);
  await first.waitForTimeout(100);
  const masterCountsBefore = await Promise.all([
    audioCount(first, "Кандалы"),
    audioCount(second, "Кандалы"),
  ]);
  await first.mouse.down();
  await first.mouse.up();
  const [masterEventAtFirst, masterEventAtSecond] = await Promise.all([
    waitForPlayedEvent(first, "master"),
    waitForPlayedEvent(second, "master"),
  ]);
  expect(masterEventAtSecond).toEqual(masterEventAtFirst);
  expect(masterEventAtFirst.filename).toMatch(/^Кандалы_\d{2}\.mp3$/u);
  await expect
    .poll(() => audioCount(first, "Кандалы"))
    .toBe(masterCountsBefore[0] + 1);
  await expect
    .poll(() => audioCount(second, "Кандалы"))
    .toBe(masterCountsBefore[1] + 1);

  await scrollToRock(second);
  const secondPoint = await visibleRockPoint(second);
  await second.mouse.move(1, 1);
  await second.mouse.move(secondPoint.x, secondPoint.y);
  await second.waitForTimeout(100);
  const secondCountsBefore = await Promise.all([
    audioCount(first, "Кандалы"),
    audioCount(second, "Кандалы"),
  ]);
  await second.mouse.down();
  await second.mouse.up();
  const [secondEventAtFirst, secondEventAtSecond] = await Promise.all([
    waitForPlayedEvent(first, "master"),
    waitForPlayedEvent(second, "master"),
  ]);
  expect(secondEventAtSecond).toEqual(secondEventAtFirst);
  expect(secondEventAtFirst.filename).toMatch(/^Кандалы_\d{2}\.mp3$/u);
  await expect
    .poll(() => audioCount(first, "Кандалы"))
    .toBe(secondCountsBefore[0] + 1);
  await expect
    .poll(() => audioCount(second, "Кандалы"))
    .toBe(secondCountsBefore[1] + 1);

  const countsAfterPointerDown = await Promise.all([
    audioCount(first, "Кандалы"),
    audioCount(second, "Кандалы"),
  ]);
  await second.waitForTimeout(400);
  expect(await audioCount(first, "Кандалы")).toBe(
    countsAfterPointerDown[0],
  );
  expect(await audioCount(second, "Кандалы")).toBe(
    countsAfterPointerDown[1],
  );
  const roleAudioState = await second.evaluate(() => getRoleAudioState());
  expect(roleAudioState).toMatchObject({
    fadeDurationMs: 300,
    fadeTargetVolume: 1,
    role: "master",
  });
  expect(roleAudioState.volume).toBeGreaterThanOrEqual(0);
  expect(roleAudioState.volume).toBeLessThanOrEqual(1);

  await firstContext.close();
  await secondContext.close();
});

test("падение компенсируется при изменении высоты сцены", async ({ browser }) => {
  test.setTimeout(60_000);

  async function profileForHeight(height) {
    const context = await createBrowserContext(browser, {
      viewport: { width: 1280, height },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    const profile = await page.evaluate(() => {
      const stepCount = 90;
      const stepSeconds = SharedPhysics.FIXED_STEP_SECONDS;
      const initial = {
        phase: SharedPhysics.PHASES.PLAY,
        x: SharedPhysics.WORLD_WIDTH / 2,
        y: SharedPhysics.WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        suspended: false,
        turbTime: 0,
      };

      Object.assign(params, SharedPhysics.sanitizePhysics({
        ...params,
        firstFallVelocity: 0,
        gravity: 1,
        bounce: 0,
        turbulence: 0,
      }));
      const local = canonicalToLocal(initial.x, initial.y);
      setPosition(local.x, local.y);
      motion.phase = SharedPhysics.PHASES.PLAY;
      motion.suspended = false;
      motion.vx = 0;
      motion.vy = 0;
      motion.turbTime = 0;

      for (let index = 0; index < stepCount; index += 1) {
        applyPhysics(stepSeconds);
      }
      updateBounds();
      return {
        elapsedSeconds: stepCount * stepSeconds,
        sceneMaxY: bounds.maxY,
        localStartY: local.y,
        localAfterY: motion.y,
        initial,
        after: currentSharedState(),
      };
    });
    await context.close();
    return profile;
  }

  const low = await profileForHeight(600);
  const high = await profileForHeight(900);
  expect(low.sceneMaxY).not.toBeCloseTo(high.sceneMaxY, 0);
  expect(low.localAfterY).not.toBeCloseTo(high.localAfterY, 0);
  expect(low.elapsedSeconds).toBeCloseTo(1.5, 6);
  expect(high.elapsedSeconds).toBeCloseTo(low.elapsedSeconds, 6);
  expect(Math.abs(low.initial.y - high.initial.y)).toBeLessThan(1);
  expect(Math.abs(low.after.y - high.after.y)).toBeLessThan(1);
  expect(low.after.vy).toBeCloseTo(high.after.vy, 6);
  expect(low.after.phase).toBe(high.after.phase);

  async function profileForSceneHeight(sceneHeightScreens) {
    const context = await createBrowserContext(browser, {
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await page.evaluate((value) => {
      window.__sisyphusTestApi.applyTestSettings({
        sceneHeightScreens: value,
      });
    }, sceneHeightScreens);
    await expect
      .poll(() =>
        page.evaluate(() => window.__sisyphusTestApi.params.sceneHeightScreens),
      )
      .toBe(sceneHeightScreens);
    const profile = await page.evaluate(() => {
      const stepCount = 90;
      const stepSeconds = SharedPhysics.FIXED_STEP_SECONDS;
      const initial = {
        phase: SharedPhysics.PHASES.PLAY,
        x: SharedPhysics.WORLD_WIDTH / 2,
        y: SharedPhysics.WORLD_HEIGHT / 2,
        vx: 0,
        vy: 0,
        suspended: false,
        turbTime: 0,
      };

      Object.assign(params, SharedPhysics.sanitizePhysics({
        ...params,
        firstFallVelocity: 0,
        gravity: 1,
        bounce: 0,
        turbulence: 0,
      }));
      const local = canonicalToLocal(initial.x, initial.y);
      setPosition(local.x, local.y);
      motion.phase = SharedPhysics.PHASES.PLAY;
      motion.suspended = false;
      motion.vx = 0;
      motion.vy = 0;
      motion.turbTime = 0;

      for (let index = 0; index < stepCount; index += 1) {
        applyPhysics(stepSeconds);
      }
      updateBounds();
      return {
        sceneHeightScreens: params.sceneHeightScreens,
        sceneMaxY: bounds.maxY,
        motionScale: window.SisyphusRoomSettings.sceneMotionMultiplier(params),
        localDeltaY: motion.y - local.y,
        after: currentSharedState(),
      };
    });
    await context.close();
    return profile;
  }

  const singleScreen = await profileForSceneHeight(1);
  const compact = await profileForSceneHeight(10);
  const legacy = await profileForSceneHeight(100);
  expect(singleScreen.sceneHeightScreens).toBe(1);
  expect(singleScreen.sceneMaxY).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(singleScreen.localDeltaY)).toBe(true);
  expect(singleScreen.motionScale).toBeCloseTo(1000, 6);
  expect(compact.motionScale).toBeCloseTo(100, 6);
  expect(legacy.motionScale).toBeCloseTo(10, 6);
  expect(compact.sceneMaxY).toBeLessThan(legacy.sceneMaxY);
  expect(compact.after.y).toBeGreaterThan(legacy.after.y);
  expect(compact.localDeltaY).toBeGreaterThan(0);
  expect(legacy.localDeltaY).toBeGreaterThan(0);
  expect(compact.localDeltaY / legacy.localDeltaY).toBeGreaterThan(0.9);
  expect(compact.localDeltaY / legacy.localDeltaY).toBeLessThan(1.1);
});

test.skip("legacy: два браузера больше не объединяют камень и настройки сессии", async ({ browser }) => {
  test.setTimeout(120_000);
  const firstContext = await createBrowserContext(browser, {
    permissions: ["clipboard-read", "clipboard-write"],
  }, MASTER_CLIENT_ID);
  const secondContext = await createBrowserContext(browser);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  await first.goto("/");
  await expect(first).toHaveURL(/\/$/);
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  await resetRootExperience(first);
  await setRange(first, "sceneHeightScreens", 10);
  await expectReadyAtBottom(first);
  const sceneProjection = await first.evaluate(() => {
    updateBounds();
    const bottom = canonicalToLocal(SharedPhysics.WORLD_WIDTH / 2, SharedPhysics.WORLD_HEIGHT);
    const originalMaxY = bounds.maxY;
    const rock = document.querySelector(".rock");
    const rockRect = rock.getBoundingClientRect();
    const rockScale = Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-scale")
    );
    const bottomScale =
      (window.innerWidth * params.rockMinWidthVw) / 100 / rock.offsetWidth;
    return {
      bottomScale,
      maxY: originalMaxY,
      bottomY: bottom.y,
      visualBottomAtMaxY:
        originalMaxY + (rock.offsetHeight * (1 + bottomScale)) / 2,
      worldHeight: SharedPhysics.WORLD_HEIGHT,
      renderedHeight: document.querySelector(".world").offsetHeight,
      viewportHeight: window.innerHeight,
      rockBaseWidth: rock.offsetWidth,
      rockRenderedWidth: rockRect.width,
      initialRockCenterY: rockRect.top + rockRect.height / 2,
      initialY: motion.y,
      suspended: motion.suspended,
      rockHeight: rock.offsetHeight,
      rockScale,
    };
  });
  expect(sceneProjection.renderedHeight / sceneProjection.viewportHeight).toBeCloseTo(10, 0);
  expect(sceneProjection.rockBaseWidth).toBeCloseTo(sceneProjection.viewportHeight * 0.42, 0);
  expect(
    sceneProjection.rockRenderedWidth / sceneProjection.rockBaseWidth
  ).toBeCloseTo(sceneProjection.rockScale, 1);
  expect(sceneProjection.rockScale).toBeGreaterThanOrEqual(
    sceneProjection.bottomScale
  );
  expect(sceneProjection.maxY).toBeCloseTo(
    sceneProjection.renderedHeight -
      (sceneProjection.rockHeight * (1 + sceneProjection.bottomScale)) / 2,
    1
  );
  expect(sceneProjection.visualBottomAtMaxY).toBeCloseTo(
    sceneProjection.renderedHeight,
    1
  );
  expect(sceneProjection.bottomY).toBeCloseTo(sceneProjection.maxY, 1);
  expect(sceneProjection.initialY).toBeLessThan(sceneProjection.maxY);
  expect(sceneProjection.suspended).toBe(true);
  expect(sceneProjection.initialRockCenterY).toBeCloseTo(
    sceneProjection.viewportHeight / 2,
    0
  );
  const sharedUrl = first.url();
  await expect(first.getByTestId("share-session-top")).toHaveCount(0);

  await first.locator(".settings-toggle").click();
  await expect(first.getByTestId("share-session")).toHaveCount(0);
  await expect(
    first.locator(".settings-panel .control-group[open]")
  ).toHaveCount(0);
  await openControlGroup(first, "Траектория");
  const trailEnabled = first.locator('[name="trailEnabled"]');
  const trailLength = first.locator('[name="trailMaxPoints"]');
  const trailRenderProfile = first.locator('[name="trailRenderProfile"]');
  await expect(trailEnabled).toBeChecked();
  await expect(first.locator('[name="trailUnlimited"]')).toHaveCount(0);
  await expect(trailLength).toHaveAttribute("max", "10000");
  await setRange(first, "trailMaxPoints", 10000);
  await trailRenderProfile.selectOption("low");
  const trailCounts = await first.evaluate(() => {
    trail.points = Array.from({ length: 10005 }, (_, index) => ({
      x: index,
      y: index,
    }));
    trimTrailToLimit();
    const limited = trail.points.length;
    resetTrail();
    return { limited };
  });
  expect(trailCounts).toEqual({ limited: 10000 });
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}"
        );
        return stored.trailRenderProfile;
      })
    )
    .toBe("low");
  await openControlGroup(first, "Дождь");
  const firstRain = first.getByTestId("weather-rain");
  await setRange(first, "rainStrength", 1.25);
  await setRange(first, "rainMaxVolume", 2.5);
  await setField(first, "rainBlendMode", "screen");
  await setField(first, "rainBlurBlendMode", "overlay");
  await setRange(first, "rainBlurPx", 18);
  await setRange(first, "rainBlurOpacity", 0.3);
  await setRange(first, "rainBlurSaturation", 1.25);
  await setField(first, "rainEnterEasing", "cubic-bezier(0.12, 0.8, 0.2, 1)");
  await setField(first, "rainExitEasing", "cubic-bezier(0.7, 0, 0.3, 1)");
  await setRange(first, "rainEnterMs", 0.7);
  await setRange(first, "rainExitMs", 0.7);
  await setField(first, "rainZIndex", 9);
  await setField(first, "rainDropColor", "#336699");
  await setField(first, "rainHighlightColor", "#ffcc00");
  await expect(first.locator('[data-output="rainStrength"]')).toHaveText("125%");
  await expect(first.locator('[data-output="rainMaxVolume"]')).toHaveText("250%");
  await expect(first.locator('[data-output="rainBackgroundBlurSteps"]')).toHaveText("3");
  await expect(first.locator('[data-output="rainBlurPx"]')).toHaveText("18 px");
  await expect(first.locator('[data-output="rainBlurOpacity"]')).toHaveText("30%");
  await expect(first.locator('[data-output="rainBlurSaturation"]')).toHaveText("125%");
  await expect(first.locator('[data-output="rainEnterMs"]')).toHaveText("0.7 s");
  await expect(first.locator('[data-output="rainExitMs"]')).toHaveText("0.7 s");
  await expect(first.locator('[name="rainAudioEnterMs"]')).toHaveCount(0);
  await expect(first.locator('[name="rainAudioExitMs"]')).toHaveCount(0);
  await expect(first.locator('[data-output="rainZIndex"]')).toHaveText("9");
  await expect(first.locator('[name="rainBlendMode"]')).toHaveValue("screen");
  await expect(first.locator('[name="rainBlurBlendMode"]')).toHaveValue("overlay");
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}"
        );
        return {
          rainEnterEasing: stored.rainEnterEasing,
          rainEnterMs: stored.rainEnterMs,
          rainExitEasing: stored.rainExitEasing,
          rainExitMs: stored.rainExitMs,
          rainBlendMode: stored.rainBlendMode,
          rainBackgroundBlurSteps: stored.rainBackgroundBlurSteps,
          rainBlurBlendMode: stored.rainBlurBlendMode,
          rainBlurOpacity: stored.rainBlurOpacity,
          rainBlurPx: stored.rainBlurPx,
          rainBlurSaturation: stored.rainBlurSaturation,
          rainMaxVolume: stored.rainMaxVolume,
          rainStrength: stored.rainStrength,
          rainZIndex: stored.rainZIndex,
        };
      })
    )
    .toEqual({
      rainEnterEasing: "cubic-bezier(0.12, 0.8, 0.2, 1)",
      rainEnterMs: 700,
      rainExitEasing: "cubic-bezier(0.7, 0, 0.3, 1)",
      rainExitMs: 700,
      rainBlendMode: "screen",
      rainBackgroundBlurSteps: 3,
      rainBlurBlendMode: "overlay",
      rainBlurOpacity: 0.3,
      rainBlurPx: 18,
      rainBlurSaturation: 1.25,
      rainMaxVolume: 2.5,
      rainStrength: 1.25,
      rainZIndex: 9,
    });
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const layerStyle = getComputedStyle(layer);
        const canvas = layer.querySelector(".weather-rain__canvas");
        const fallbackCanvas = layer.querySelector(".weather-rain__canvas--fallback");
        const blurStyle = getComputedStyle(
          layer.querySelector(".weather-rain__blur")
        );
        const canvasStyle = getComputedStyle(canvas);
        const fallbackStyle = getComputedStyle(fallbackCanvas);
        return {
          enterDuration: layerStyle
            .getPropertyValue("--rain-enter-duration")
            .trim(),
          enterEasing: layerStyle
            .getPropertyValue("--rain-enter-easing")
            .trim(),
          exitDuration: layerStyle
            .getPropertyValue("--rain-exit-duration")
            .trim(),
          exitEasing: layerStyle
            .getPropertyValue("--rain-exit-easing")
            .trim(),
          hasBlurLayer: Boolean(layer.querySelector(".weather-rain__blur")),
          blurDisplay: getComputedStyle(
            layer.querySelector(".weather-rain__blur")
          ).display,
          blurBlendMode: blurStyle.mixBlendMode,
          layerBlendMode: layerStyle.mixBlendMode,
          canvasBlendMode: canvasStyle.mixBlendMode,
          fallbackOpacity: fallbackStyle.opacity,
          layerZIndex: layerStyle.zIndex,
          canvasZIndex: canvasStyle.zIndex,
        };
      })
    )
    .toEqual({
      enterDuration: "700ms",
      enterEasing: "cubic-bezier(0.12, 0.8, 0.2, 1)",
      exitDuration: "700ms",
      exitEasing: "cubic-bezier(0.7, 0, 0.3, 1)",
      hasBlurLayer: true,
      blurDisplay: "block",
      blurBlendMode: "overlay",
      layerBlendMode: "normal",
      canvasBlendMode: "screen",
      fallbackOpacity: "0",
      layerZIndex: "9",
      canvasZIndex: "10",
    });
  await expect(first.locator('[name="rainEnabled"]')).not.toBeChecked();
  await setCheckbox(first, "rainEnabled", true);
  await expect(firstRain).toHaveClass(/is-rain-visible/);
  const rainAudioFadeIn = await first.evaluate(() => getRainAudioState());
  expect(rainAudioFadeIn.amplificationAvailable).toBe(true);
  expect(rainAudioFadeIn.backend).toBe("buffer");
  expect(rainAudioFadeIn.crossfadeRatio).toBe(0.2);
  expect(rainAudioFadeIn.fadeDurationMs).toBe(700);
  expect(rainAudioFadeIn.fadeActive).toBe(true);
  expect(rainAudioFadeIn.fadeTargetVolume).toBe(2.5);
  expect(rainAudioFadeIn.playing).toBe(true);
  expect(rainAudioFadeIn.volume).toBeLessThan(2.5);
  await expect
    .poll(() => first.evaluate(() => getRainAudioState()))
    .toMatchObject({
      activeSourceCount: 1,
      bufferReady: true,
      decodeCount: 1,
      running: true,
      schedulerActive: true,
      startCount: 1,
    });
  await setRange(first, "rainMaxVolume", 3);
  await expect(first.locator('[data-output="rainMaxVolume"]')).toHaveText("300%");
  const amplifiedRain = await first.evaluate(() => getRainAudioState());
  expect(amplifiedRain.fadeDurationMs).toBe(700);
  expect(amplifiedRain.fadeActive).toBe(true);
  expect(amplifiedRain.fadeMode).toBe("volume");
  expect(amplifiedRain.fadeTargetVolume).toBe(3);
  expect(amplifiedRain.playing).toBe(true);
  expect(amplifiedRain.decodeCount).toBe(1);
  expect(amplifiedRain.startCount).toBe(1);
  expect(amplifiedRain.schedulerActive).toBe(true);
  await expect(firstRain.locator(".weather-rain__blur")).toHaveCount(1);
  await expect
    .poll(() => first.evaluate(() => getLastRainRendererProfile()))
    .toMatchObject({
      fallbackColor: [51, 102, 153],
      raindropDiffuseLight: [0.27, 0.54, 0.81],
      raindropSpecularLight: [1, 1, 0],
    });
  const rainRenderToken = await first.evaluate(() => getRainRenderToken());
  await setRange(first, "rainBackgroundBlurSteps", 4);
  await expect(first.locator('[data-output="rainBackgroundBlurSteps"]')).toHaveText("4");
  await expect
    .poll(() => first.evaluate(() => getRainRenderToken()))
    .toBeGreaterThan(rainRenderToken);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}"
        );
        return stored.rainBackgroundBlurSteps;
      })
    )
    .toBe(4);
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const canvas = layer.querySelector(".weather-rain__canvas");
        const fallbackCanvas = layer.querySelector(".weather-rain__canvas--fallback");
        return {
          canvasZIndex: getComputedStyle(canvas).zIndex,
          fallbackOpacity: getComputedStyle(fallbackCanvas).opacity,
        };
      })
    )
    .toEqual({ canvasZIndex: "10", fallbackOpacity: "0" });
  await expect
    .poll(() =>
      firstRain.locator("canvas").evaluateAll((canvases) =>
        Math.max(
          ...canvases.map((canvas) =>
            Number.parseFloat(
              canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
            )
          )
        )
      )
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}"
        );
        return stored.rainEnabled;
      })
    )
    .toBe(true);
  await setCheckbox(first, "rainEnabled", false);
  const rainAudioFadeOut = await first.evaluate(() => getRainAudioState());
  expect(rainAudioFadeOut.fadeDurationMs).toBe(700);
  expect(rainAudioFadeOut.fadeActive).toBe(true);
  expect(rainAudioFadeOut.fadeTargetVolume).toBe(0);
  expect(rainAudioFadeOut.playing).toBe(true);
  expect(rainAudioFadeOut.volume).toBeGreaterThan(0);
  await expect
    .poll(() =>
      first.evaluate(() => {
        const stored = JSON.parse(
          localStorage.getItem("sisyphus-czar-settings-v48") || "{}"
        );
        return stored.rainEnabled;
      })
    )
    .toBe(false);
  await expect(firstRain).not.toHaveClass(/is-rain-/, { timeout: 2000 });
  await expect
    .poll(() =>
      firstRain.locator("canvas").evaluateAll((canvases) =>
        canvases.map((canvas) =>
          Number.parseFloat(
            canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
          )
        )
      )
    )
    .toEqual([0, 0]);
  await expect
    .poll(() => first.evaluate(() => getRainAudioState()))
    .toMatchObject({
      activeSourceCount: 0,
      bufferReady: true,
      fadeActive: false,
      playing: false,
      running: false,
      schedulerActive: false,
      volume: 0,
    });
  await setCheckbox(first, "rainEnabled", true);
  await expect
    .poll(() => first.evaluate(() => getRainAudioState()))
    .toMatchObject({
      activeSourceCount: 1,
      bufferReady: true,
      decodeCount: 1,
      playing: true,
      running: true,
      schedulerActive: true,
      startCount: 2,
    });
  await setCheckbox(first, "rainEnabled", false);
  await expect
    .poll(() => first.evaluate(() => getRainAudioState()))
    .toMatchObject({
      activeSourceCount: 0,
      decodeCount: 1,
      playing: false,
      running: false,
      schedulerActive: false,
      startCount: 2,
    });
  await openControlGroup(first, "Физика");
  await setRange(first, "gravity", 10);
  await setRange(first, "turbulence", 0.3);
  await setRange(first, "bounce", 0.1);
  await setRange(first, "inertia", 0.8);
  await setRange(first, "horizontalInertia", 0.3);
  await setRange(first, "groundFriction", 0.2);
  await openControlGroup(first, "Камень");
  await setRange(first, "mass", 10);
  await openControlGroup(first, "Руки");
  await setRange(first, "handForce", 500);
  await setField(
    first,
    "handForceDeficitEasing",
    "cubic-bezier(0, 0, 1, 1)",
  );
  await setRange(first, "pointerInfluence", 1.8);
  await setRange(first, "handWidthVw", 40);
  await expect(first.locator('[data-output="handWidthVw"]')).toHaveText("40.0vw");
  await expect
    .poll(() =>
      first.evaluate(() => Object.keys(collab.pendingRoomSettingsChanges).length)
    )
    .toBe(0);

  await second.goto("/");
  await expect(second).toHaveURL(/\/$/);
  expect(second.url()).toBe(sharedUrl);
  await second.goto(sharedUrl);
  await expect(second.getByTestId("session-status")).toContainText("В сессии");
  await expectReadyAtBottom(second);
  await expect.poll(() => first.evaluate(() => collab.clientRole)).toBe("master");
  await expect.poll(() => second.evaluate(() => collab.clientRole)).toBe("master");
  await expect(first.getByTestId("summit-timer")).toHaveText("00:00:00");
  await expect(second.getByTestId("summit-timer")).toHaveText("00:00:00");
  await expect(first.getByTestId("summit-timer")).toHaveAttribute(
    "data-running",
    "false"
  );
  await expect(second.getByTestId("summit-timer")).toHaveAttribute(
    "data-running",
    "false"
  );
  await expect(second.locator(".settings-toggle")).toBeVisible();
  await expect(second.locator(".settings-toggle")).toBeEnabled();
  await second.locator(".settings-toggle").click();
  await expect(second.locator("#settings-panel")).toHaveClass(/is-open/);
  await expect(second.locator('[name="rainBlendMode"]')).toHaveValue(
    await first.locator('[name="rainBlendMode"]').inputValue()
  );
  await expect(second.locator('[name="rainBlurBlendMode"]')).toHaveValue(
    await first.locator('[name="rainBlurBlendMode"]').inputValue()
  );
  await expect(second.locator('[name="rainMaxVolume"]')).toHaveValue("3");
  await expect(second.locator('[name="handWidthVw"]')).toHaveValue("40");
  await expect(second.locator('[name="handForceDeficitEasing"]')).toHaveValue(
    "cubic-bezier(0, 0, 1, 1)",
  );
  await setRange(second, "rainExitMs", 0.3);
  await expect(second.locator('[data-output="rainExitMs"]')).toHaveText("0.3 s");
  await expect(first.locator('[name="rainExitMs"]')).toHaveValue("0.3");
  await expect(first.getByTestId("session-status")).toContainText("2");
  const expectedPhysics = {
    mass: "10",
    gravity: "10",
    handForce: "500",
    pointerInfluence: "1.8",
    bounce: "0.1",
    inertia: "0.8",
    horizontalInertia: "0.3",
    groundFriction: "0.2",
    turbulence: "0.3",
  };
  for (const [name, value] of Object.entries(expectedPhysics)) {
    await expect(second.locator(`[name="${name}"]`)).toHaveValue(value);
  }
  const expectedRoomSettings = await first.evaluate(() => getRoomSettings());
  await expect
    .poll(() => second.evaluate(() => getRoomSettings()))
    .toEqual(expectedRoomSettings);
  await expect
    .poll(() =>
      second.evaluate(() => ({
        drop: document.querySelector('[name="rainDropColor"]').value,
        highlight: document.querySelector('[name="rainHighlightColor"]').value,
      }))
    )
    .toEqual({ drop: "#336699", highlight: "#ffcc00" });
  await expect(first.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(second.locator("html")).not.toHaveClass(/is-scroll-locked/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);

  await second.evaluate(() => collab.socket.close(4100, "test_reconnect"));
  await expect(second.getByTestId("session-status")).toContainText("Переподключение");
  await setRange(first, "gravity", 8);
  await expect(second.locator('[name="gravity"]')).toHaveValue("8", {
    timeout: 5000,
  });
  await expect.poll(() => second.evaluate(() => collab.clientRole)).toBe("master");

  await first.locator(".settings-toggle").click();
  const remoteCursor = second.getByTestId("remote-cursor");

  await expectScrollDoesNotAffectPhysics(first);
  await expect(second.locator("body")).toHaveClass(/state-play/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect(first.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);
  await expect(second.locator(SOURCE_ROCK)).not.toHaveClass(/is-dragging/);
  const firstImprint = first.getByTestId("rock-imprint");
  const secondImprint = second.getByTestId("rock-imprint");
  await expect(firstImprint).toHaveClass(/is-visible/);
  await expect(secondImprint).toHaveClass(/is-visible/);

  const trailBuffer = await first.locator(SOURCE_TRAIL).evaluate((canvas) => ({
    width: canvas.width,
    height: canvas.height,
    maxWidth: Math.ceil(window.innerWidth * 2),
    maxHeight: Math.ceil(window.innerHeight * 2),
    zIndex: getComputedStyle(canvas).zIndex,
  }));
  expect(trailBuffer.width).toBeLessThanOrEqual(trailBuffer.maxWidth);
  expect(trailBuffer.height).toBeLessThanOrEqual(trailBuffer.maxHeight);
  expect(trailBuffer.zIndex).toBe("1");
  await expect(first.locator(SOURCE_TRAIL)).toHaveCSS("mix-blend-mode", "normal");

  await expect(first.locator("body")).toHaveClass(/state-play/, { timeout: 45_000 });
  await expect(second.locator("body")).toHaveClass(/state-play/, { timeout: 45_000 });
  await scrollToRock(first);
  await first.evaluate(() => {
    sendShared("pointer.update", {
      x: SharedPhysics.WORLD_WIDTH / 2,
      y: SharedPhysics.WORLD_HEIGHT / 2,
      mode: "grab",
      visible: true,
    });
  });
  await expect(remoteCursor).toHaveClass(/is-visible/);
  await expect(remoteCursor).toBeVisible();
  await expect(remoteCursor).not.toHaveClass(/is-grabbing/);
  await expect(remoteCursor).toHaveCSS("opacity", "1");
  await expect(remoteCursor).toHaveCSS(
    "background-image",
    /cursor-grab-02(?:-[A-Za-z0-9_-]+)?\.png/
  );
  await expect
    .poll(() =>
      remoteCursor.evaluate((cursor) => {
        const rect = cursor.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      })
    )
    .toEqual({ height: 679, width: 512 });
  await first.evaluate(() => {
    sendShared("pointer.update", {
      ...collab.localPointer,
      mode: "grab",
      visible: false,
    });
  });
  await expect(remoteCursor).toHaveCount(0);

  await scrollToRock(second);
  await expect.poll(() => second.evaluate(() => params.trailEnabled)).toBe(true);
  await scrollToRock(first);
  const firstGrabPoint = await visibleRockPoint(first);
  await first.mouse.move(firstGrabPoint.x, firstGrabPoint.y);
  await first.mouse.down();
  await expect.poll(() => first.evaluate(() => collab.hasControl)).toBe(true);
  await expect
    .poll(() =>
      first.locator(SOURCE_ROCK).evaluate((rock, target) => {
        updateBounds();
        const rect = rock.getBoundingClientRect();
        const scaleX = bounds.rockWidth > 0 ? rect.width / bounds.rockWidth : 1;
        const scaleY =
          bounds.rockHeight > 0 ? rect.height / bounds.rockHeight : 1;
        const heldPoint = {
          x: rect.left + motion.grabX * scaleX,
          y: rect.top + motion.grabY * scaleY,
        };
        return Math.max(
          Math.abs(heldPoint.x - target.x),
          Math.abs(heldPoint.y - target.y)
        );
      }, firstGrabPoint)
    )
    .toBeLessThanOrEqual(3);
  const firstGrabMove = { x: -48, y: 0 };
  await first.mouse.move(
    firstGrabPoint.x + firstGrabMove.x,
    firstGrabPoint.y + firstGrabMove.y
  );
  await expect
    .poll(() =>
      first.locator(SOURCE_ROCK).evaluate((rock, target) => {
        updateBounds();
        const rect = rock.getBoundingClientRect();
        const scaleX = bounds.rockWidth > 0 ? rect.width / bounds.rockWidth : 1;
        const scaleY =
          bounds.rockHeight > 0 ? rect.height / bounds.rockHeight : 1;
        const heldPoint = {
          x: rect.left + motion.grabX * scaleX,
          y: rect.top + motion.grabY * scaleY,
        };
        return Math.max(
          Math.abs(heldPoint.x - target.x),
          Math.abs(heldPoint.y - target.y)
        );
      }, {
        x: firstGrabPoint.x + firstGrabMove.x,
        y: firstGrabPoint.y + firstGrabMove.y,
      })
    )
    .toBeLessThanOrEqual(3);
  await expect(first.getByTestId("session-status")).toContainText("силы хватает");
  await grabVisibleRock(second);
  await expect.poll(() => second.evaluate(() => collab.hasControl)).toBe(true);
  await moveSharedDragToBottom(first, second);
  const secondVisiblePointAfterMove = await visibleRockPoint(second);
  await second.mouse.move(
    secondVisiblePointAfterMove.x,
    secondVisiblePointAfterMove.y
  );
  await expect(first.getByTestId("session-status")).toContainText("силы хватает");
  await expect(second.getByTestId("session-status")).toContainText("силы хватает");
  const localGrabbingCursor = second.locator(
    ".hand-cursor:not(.is-remote).is-visible"
  );
  await expect(localGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(localGrabbingCursor).toHaveCSS(
    "background-image",
    /cursor-grabbing-02(?:-[A-Za-z0-9_-]+)?\.png/
  );
  const grabbingCursorSize = await localGrabbingCursor.evaluate((cursor) => {
    const style = getComputedStyle(cursor);
    return {
      width: Math.round(Number.parseFloat(style.width)),
      height: Math.round(Number.parseFloat(style.height)),
    };
  });
  expect(grabbingCursorSize.width).toBeGreaterThan(36);
  expect(grabbingCursorSize.height).toBeGreaterThan(36);
  const remoteGrabbingCursor = first.locator(
    ".hand-cursor.is-remote.is-visible"
  );
  await expect(remoteGrabbingCursor).toHaveClass(/is-grabbing/);
  await expect(remoteGrabbingCursor).toHaveCSS(
    "background-image",
    /cursor-grabbing-02(?:-[A-Za-z0-9_-]+)?\.png/
  );
  const remoteGrabbingCursorSize = await remoteGrabbingCursor.evaluate(
    (cursor) => {
      const style = getComputedStyle(cursor);
      return {
        width: Math.round(Number.parseFloat(style.width)),
        height: Math.round(Number.parseFloat(style.height)),
      };
    }
  );
  expect(remoteGrabbingCursorSize.width).toBeGreaterThan(36);
  expect(remoteGrabbingCursorSize.height).toBeGreaterThan(36);
  const secondRain = second.getByTestId("weather-rain");
  await expect(first.locator("body")).not.toHaveClass(/state-won/);
  await expect(second.locator("body")).not.toHaveClass(/state-won/);
  await expect(first.locator(SOURCE_ROCK)).toHaveClass(/is-dragging/);
  await expect(second.locator(SOURCE_ROCK)).toHaveClass(/is-dragging/);
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      firstRain.evaluate((layer) => {
        const blur = layer.querySelector(".weather-rain__blur");
        const blurStyle = getComputedStyle(blur);
        const layerStyle = getComputedStyle(layer);
        return {
          hasBlurFilter: blurStyle.backdropFilter.includes("blur(18px)"),
          hasSaturationFilter:
            blurStyle.backdropFilter.includes("saturate(1.25)"),
          hasLinearGradient:
            blurStyle.backgroundImage.includes("linear-gradient"),
          hasRadialGradient:
            blurStyle.backgroundImage.includes("radial-gradient"),
          blurBlendMode: blurStyle.mixBlendMode,
          display: blurStyle.display,
          opacity: blurStyle.opacity,
          radius: layerStyle.getPropertyValue("--rain-blur-radius").trim(),
          saturation: layerStyle
            .getPropertyValue("--rain-blur-saturation")
            .trim(),
        };
      })
    )
    .toEqual({
      hasBlurFilter: true,
      hasSaturationFilter: true,
      hasLinearGradient: true,
      hasRadialGradient: false,
      blurBlendMode: "overlay",
      display: "block",
      opacity: "0.3",
      radius: "18px",
      saturation: "1.25",
    });
  await second.mouse.up();
  await first.mouse.up();
  await expect(first.locator("body")).toHaveClass(/theme-dark/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  await expect
    .poll(() => second.evaluate(() => getRainAudioState()))
    .toMatchObject({
      playing: false,
      schedulerActive: false,
      startCount: 0,
    });
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      firstRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas")).mixBlendMode
      )
    )
    .toBe("screen");
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await expect(first.locator("body")).toHaveClass(/state-play/);
  await expect(second.locator("body")).toHaveClass(/state-play/);
  const releaseState = await first.locator(SOURCE_ROCK).evaluate((rock) => ({
    maxY: bounds.maxY,
    y: Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y")),
  }));
  if (releaseState.y >= releaseState.maxY - 1) {
    expect(releaseState.y).toBeGreaterThanOrEqual(releaseState.maxY - 1);
  } else {
    await expect
      .poll(() =>
        first.locator(SOURCE_ROCK).evaluate((rock) =>
          Number.parseFloat(getComputedStyle(rock).getPropertyValue("--rock-y"))
        )
      )
      .toBeGreaterThan(releaseState.y);
  }
  await expect(firstRain).not.toHaveClass(/is-rain-hiding/, { timeout: 1800 });
  await expect(secondRain).not.toHaveClass(/is-rain-hiding/, { timeout: 3500 });
  await expect(firstRain).not.toHaveClass(/is-rain-visible/);
  await expect(secondRain).not.toHaveClass(/is-rain-visible/);
  await expect
    .poll(() =>
      secondRain.locator("canvas").evaluateAll((canvases) =>
        canvases.map((canvas) =>
          Number.parseFloat(
            canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
          )
        )
      )
    )
    .toEqual([0, 0]);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) => {
        const style = getComputedStyle(layer);
        return {
          opacity: style.opacity,
          visibility: style.visibility,
        };
      })
    )
    .toEqual({ opacity: "0", visibility: "hidden" });
  await setCheckbox(first, "rainEnabled", true);
  await expect(firstRain).toHaveClass(/is-rain-visible/);
  await expect(secondRain).toHaveClass(/is-rain-visible/);
  await expect(second.locator("body")).toHaveClass(/theme-dark/);
  const expectedRainBlendModes = await firstRain.evaluate((layer) => {
    const canvas = layer.querySelector(".weather-rain__canvas--fx");
    return {
      canvasBlendMode: getComputedStyle(canvas).mixBlendMode,
      layerBlendMode: getComputedStyle(layer).mixBlendMode,
    };
  });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) => {
        const canvas = layer.querySelector(".weather-rain__canvas--fx");
        return {
          canvasBlendMode: getComputedStyle(canvas).mixBlendMode,
          layerBlendMode: getComputedStyle(layer).mixBlendMode,
        };
      })
    )
    .toEqual(expectedRainBlendModes);
  await second.evaluate(() => {
    const style = document.createElement("style");
    style.dataset.testRainBlendOverride = "true";
    style.textContent = ".weather-rain__canvas--fx { mix-blend-mode: difference; }";
    document.head.append(style);
  });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(
          layer.querySelector(".weather-rain__canvas--fx")
        ).mixBlendMode
      )
    )
    .toBe("difference");
  await second.evaluate(() => {
    document.querySelector("[data-test-rain-blend-override]")?.remove();
  });
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(
          layer.querySelector(".weather-rain__canvas--fx")
        ).mixBlendMode
      )
    )
    .toBe(expectedRainBlendModes.canvasBlendMode);
  await expect
    .poll(() =>
      secondRain.evaluate((layer) =>
        getComputedStyle(layer.querySelector(".weather-rain__canvas--fallback"))
          .opacity
      )
    )
    .toBe("0");
  await expect
    .poll(() =>
      secondRain.locator(".weather-rain__canvas--fx").evaluate((canvas) =>
        Number.parseFloat(
          canvas.style.getPropertyValue("--rain-fx-opacity") || "0"
        )
      )
    )
    .toBeGreaterThan(0);
  await setCheckbox(first, "rainEnabled", false);
  await expect(firstRain).not.toHaveClass(/is-rain-visible/, { timeout: 2000 });
  await expect(secondRain).not.toHaveClass(/is-rain-visible/, { timeout: 2000 });

  await first.reload();
  await expect(first.getByTestId("session-status")).toContainText("В сессии");
  await expect(first.getByTestId("restart-session")).toBeVisible();
  await expect
    .poll(() =>
      first.evaluate(
        () =>
          window.scrollY >=
          document.documentElement.scrollHeight - window.innerHeight - 2
      )
    )
    .toBe(true);
  const firstRestartState = await first.evaluate(() => ({
    bodyState: document.body.className,
    firstFallTriggered: motion.firstFallTriggered,
    htmlState: document.documentElement.className,
    imprintVisible: document
      .querySelector(".rock-imprint")
      .classList.contains("is-visible"),
    introFallTimerActive: motion.introFallTimerId !== null,
    pointerEvents: getComputedStyle(document.querySelector(".rock"))
      .pointerEvents,
    rainState: document.querySelector(".weather-rain").className,
    scrollY: window.scrollY,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    suspended: motion.suspended,
    trailPoints: trail.points.length,
  }));
  expect(firstRestartState.bodyState).toContain("state-play");
  expect(firstRestartState).toMatchObject({
    firstFallTriggered: false,
    imprintVisible: true,
    introFallTimerActive: false,
    pointerEvents: "auto",
    suspended: true,
    trailPoints: 0,
  });
  expect(firstRestartState.scrollY).toBeGreaterThanOrEqual(
    firstRestartState.maxScroll - 2
  );
  expect(firstRestartState.bodyState).toContain("theme-dark");
  expect(firstRestartState.htmlState).not.toContain("is-scroll-locked");
  expect(firstRestartState.rainState).not.toMatch(/is-rain-/);
  await expect(first.locator('[name="gravity"]')).toHaveValue("8");
  await expect(second.locator('[name="gravity"]')).toHaveValue("8");

  await first.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  await expect(second.getByTestId("session-status")).toContainText("В сессии: 1");
  await first.close();

  await second.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  await second.waitForTimeout(300);
  await second.close();

  const verification = await secondContext.newPage();
  await verification.waitForTimeout(3200);
  await verification.goto(sharedUrl);
  await expect(verification).toHaveURL(sharedUrl);
  await expect(verification.getByTestId("session-status")).toContainText("В сессии");
  await expect
    .poll(() =>
      verification.evaluate(() => ({
        gravity: params.gravity,
        role: collab.clientRole,
        suspended: motion.suspended,
      })),
    )
    .toEqual({
      gravity: 8,
      role: "master",
      suspended: true,
    });

  await firstContext.close();
  await secondContext.close();
});
