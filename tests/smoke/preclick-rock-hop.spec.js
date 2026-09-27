const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .scene-page > .world > .rock";

async function watchLaughPlayCalls(page) {
  await page.addInitScript(() => {
    window.__laughPlayCount = 0;
    window.__playedAudioFilenames = [];
    window.__controlAcquireMessages = [];
    const sendWebSocketMessage = WebSocket.prototype.send;
    WebSocket.prototype.send = function send(data) {
      try {
        const message = JSON.parse(String(data));
        if (message?.type === "control.acquire") {
          window.__controlAcquireMessages.push(message.payload);
        }
      } catch {
        // Бинарные и не-JSON сообщения этому smoke не нужны.
      }
      return sendWebSocketMessage.call(this, data);
    };
    HTMLMediaElement.prototype.play = function play() {
      let decodedSrc = this.currentSrc || this.src || "";
      try {
        decodedSrc = decodeURIComponent(decodedSrc);
      } catch {
        // URL уже может быть декодирован.
      }
      const filename = decodedSrc.split("/").at(-1).split("?")[0];
      window.__playedAudioFilenames.push(filename);
      if (decodedSrc.includes("Смех.mp3")) {
        window.__laughPlayCount += 1;
      }
      return Promise.resolve();
    };
  });
}

async function scrollToRock(page) {
  await page.locator("#settings-panel").evaluate((panel) => {
    panel.style.display = "none";
  });
  await page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    window.scrollTo(
      0,
      Math.max(
        0,
        window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2,
      ),
    );
  });
  await expect
    .poll(() =>
      page.locator(SOURCE_ROCK).evaluate((rock) => {
        const rect = rock.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight;
      }),
    )
    .toBe(true);
}

function rockCenter(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      worldY: rect.top + rect.height / 2 + scrollY,
    };
  });
}

function visibleRockPoint(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(innerHeight, rect.bottom);
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
    throw new Error("Не найдена кликабельная точка камня");
  });
}

function hopState(page) {
  return page.evaluate(() => window.__sisyphusTestApi.getPreclickHopState());
}

async function performInitialClick(page) {
  const before = await hopState(page);
  expect(before).toMatchObject({
    awaitingInitialClick: true,
    initialClickConsumed: false,
    guardClicksUsed: 0,
    radiusHopCount: 0,
  });
  const point = await visibleRockPoint(page);
  const context = page.context();
  const pageCountBefore = context.pages().length;
  const unexpectedPopups = [];
  const captureUnexpectedPopup = (popup) => unexpectedPopups.push(popup);
  page.on("popup", captureUnexpectedPopup);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => hopState(page)).toMatchObject({
    awaitingInitialClick: false,
    initialClickConsumed: true,
    guardClicksUsed: 0,
    radiusHopCount: 0,
    hopCount: before.hopCount + 1,
    lastRadiusDecision: "initial-click",
    lastHopRequest: {
      trigger: "initial-click",
      fixedDistanceFactor: 1,
      endpointSafe: true,
    },
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  page.off("popup", captureUnexpectedPopup);
  expect(unexpectedPopups).toHaveLength(0);
  expect(context.pages()).toHaveLength(pageCountBefore);
  await expect.poll(() => hopState(page)).toMatchObject({
    animating: false,
    audioPlayCount: before.audioPlayCount,
    activeAudioCount: before.activeAudioCount,
    lastHopRequest: { completed: true },
  });
}

function trailState(page) {
  return page.evaluate(() => window.__sisyphusTestApi.getTrailState());
}

function rockGeometry(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    const { bounds, motion } = window.__sisyphusTestApi;
    return {
      bounds: { maxX: bounds.maxX, maxY: bounds.maxY },
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      className: rock.className,
      motion: { x: motion.x, y: motion.y },
      hopOffset: {
        x: Number.parseFloat(style.getPropertyValue("--rock-hop-x")) || 0,
        y: Number.parseFloat(style.getPropertyValue("--rock-hop-y")) || 0,
      },
      rect: {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      },
      rockScale: style.getPropertyValue("--rock-scale"),
      wallCompensation: style.getPropertyValue("--rock-wall-compensation"),
    };
  });
}

async function enterFromLeft(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const viewportWidth = page.viewportSize().width;
  const useLeft = initialCenter.x - radius - 80 >= 5;
  const outside = {
    x: useLeft
      ? initialCenter.x - radius - 80
      : Math.min(viewportWidth - 5, initialCenter.x + radius + 80),
    y: initialCenter.y,
  };
  await page.mouse.move(outside.x, outside.y);
  if (delayMs > 0) {
    await page.waitForTimeout(delayMs);
  }
  const center = await rockCenter(page);
  const inside = {
    x: useLeft
      ? Math.max(5, center.x - radius / 2)
      : Math.min(viewportWidth - 5, center.x + radius / 2),
    y: center.y,
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

async function enterFromRight(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const viewportWidth = page.viewportSize().width;
  const useRight = initialCenter.x + radius + 80 <= viewportWidth - 5;
  const outside = {
    x: useRight
      ? initialCenter.x + radius + 80
      : Math.max(5, initialCenter.x - radius - 80),
    y: initialCenter.y,
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const inside = {
    x: useRight
      ? Math.min(viewportWidth - 5, center.x + radius / 2)
      : Math.max(5, center.x - radius / 2),
    y: center.y,
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

async function advancePastRequiredPostGuardHop(
  page,
  radius,
  { persistent = false } = {},
) {
  const beforeRequiredHop = await hopState(page);
  expect(beforeRequiredHop).toMatchObject({
    requiredHoverHopPending: true,
    clickAllowed: false,
  });
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: beforeRequiredHop.guardClicksUsed,
    hopCount: beforeRequiredHop.hopCount + 1,
    requiredHoverHopPending: false,
    clickAllowed: false,
    lastRadiusDecision: "post-guard-required-hop",
    animating: false,
  });
  const afterRequiredHop = await hopState(page);
  await enterFromRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject(
    persistent
      ? {
          guardClicksUsed: beforeRequiredHop.guardClicksUsed,
          hopCount: afterRequiredHop.hopCount + 1,
          requiredHoverHopPending: false,
          clickAllowed: false,
          lastRadiusDecision: "persistent-fake-hop",
        }
      : {
          guardClicksUsed: beforeRequiredHop.guardClicksUsed,
          hopCount: afterRequiredHop.hopCount,
          requiredHoverHopPending: false,
          clickAllowed: true,
          lastRadiusDecision: "random-miss",
        },
  );
  return hopState(page);
}

async function enterFromTop(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const viewportHeight = page.viewportSize().height;
  const useTop = initialCenter.y - radius - 80 >= 5;
  const outside = {
    x: initialCenter.x,
    y: useTop
      ? initialCenter.y - radius - 80
      : Math.min(viewportHeight - 5, initialCenter.y + radius + 80),
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const inside = {
    x: center.x,
    y: useTop ? center.y - radius / 2 : center.y + radius / 2,
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

async function enterFromBottomRight(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const viewport = page.viewportSize();
  const useBottomRight =
    initialCenter.x + radius + 80 <= viewport.width - 5 &&
    initialCenter.y + radius + 80 <= viewport.height - 5;
  const outside = {
    x: useBottomRight
      ? initialCenter.x + radius + 80
      : Math.max(5, initialCenter.x - radius - 80),
    y: useBottomRight
      ? initialCenter.y + radius + 80
      : Math.max(5, initialCenter.y - radius - 80),
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const component = radius / (2 * Math.sqrt(2));
  const inside = {
    x: center.x + (useBottomRight ? component : -component),
    y: center.y + (useBottomRight ? component : -component),
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

function toroidalDistance(first, second, viewport) {
  const deltaX = Math.abs(first.x - second.x);
  const deltaY = Math.abs(first.y - second.y);
  return Math.hypot(
    Math.min(deltaX, viewport.width - deltaX),
    Math.min(deltaY, viewport.height - deltaY),
  );
}

test("камера независимо следует за камнем вверх и вниз при скрытом overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );

  const directionalCamera = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.completePreclickRockGuidance();
    api.applyTestSettings({ sceneHeightScreens: 4 });
    api.updateBounds();
    const middleY = api.bounds.maxY / 2;
    const upY = Math.max(api.bounds.minY, middleY - window.innerHeight);
    const downY = Math.min(api.bounds.maxY, middleY + window.innerHeight);
    const measure = (targetY, settings) => {
      api.applyTestSettings({
        cameraFollowUpLerp: 1,
        cameraFollowDownLerp: 1,
        sceneTwoOverflowYVisible: false,
        ...settings,
      });
      api.setPosition(api.motion.x, middleY);
      api.updateCameraFollow({ immediate: true });
      const before = scrollY;
      api.setPosition(api.motion.x, targetY);
      api.updateCameraFollow();
      return { before, after: scrollY };
    };
    return {
      overflowY: document.documentElement.style.overflowY,
      upEnabled: measure(upY, {
        cameraFollowUpEnabled: true,
        cameraFollowDownEnabled: false,
      }),
      upBlocked: measure(upY, {
        cameraFollowUpEnabled: false,
        cameraFollowDownEnabled: true,
      }),
      downEnabled: measure(downY, {
        cameraFollowUpEnabled: false,
        cameraFollowDownEnabled: true,
      }),
      downBlocked: measure(downY, {
        cameraFollowUpEnabled: true,
        cameraFollowDownEnabled: false,
      }),
    };
  });

  expect(directionalCamera.overflowY).toBe("hidden");
  expect(directionalCamera.upEnabled.after).toBeLessThan(
    directionalCamera.upEnabled.before,
  );
  expect(directionalCamera.upBlocked.after).toBeCloseTo(
    directionalCamera.upBlocked.before,
    5,
  );
  expect(directionalCamera.downEnabled.after).toBeGreaterThan(
    directionalCamera.downEnabled.before,
  );
  expect(directionalCamera.downBlocked.after).toBeCloseTo(
    directionalCamera.downBlocked.before,
    5,
  );
});

test("камень прыгает накопительно, а третий настоящий клик завершает сцену", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1200 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        followUp: params.cameraFollowUpEnabled,
        upLerp: params.cameraFollowUpLerp,
        followDown: params.cameraFollowDownEnabled,
        downLerp: params.cameraFollowDownLerp,
        rockAcceleration: params.rockAccelerationEnabled,
      })),
    )
    .toEqual({
      followUp: true,
      upLerp: 0.1,
      followDown: true,
      downLerp: 0.1,
      rockAcceleration: false,
    });
  await page.waitForTimeout(250);
  const body = page.locator("body");
  const html = page.locator("html");
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll(".birch-layer")].every(
          (layer) => getComputedStyle(layer).display === "none",
        ),
      ),
    )
    .toBe(true);
  await expect(body).toHaveClass(/preclick-rock-guidance/);
  await expect(body).toHaveClass(/is-manual-scroll-disabled/);
  await expect(html).toHaveClass(/is-manual-scroll-disabled/);
  const scrollBeforeWheel = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBeforeWheel);

  await page.reload();
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );
  await expect(body).toHaveClass(/preclick-rock-guidance/);
  await expect(html).toHaveClass(/is-manual-scroll-disabled/);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({ sceneHeightScreens: 4 });
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight > window.innerHeight,
      ),
    )
    .toBe(true);
  await scrollToRock(page);

  const rock = page.locator(SOURCE_ROCK);
  await expect(rock).toHaveClass(/is-preclick-hop/);
  await page.evaluate(() => {
    params.preclickHopGuardClickCount = 2;
    params.preclickPopupArtworkMode = "single";
    params.preclickPopupArtworkId = "01.png";
    params.preclickHopActivationRadiusPercent = 50;
    params.preclickHopMaxDistancePercent = 10;
    params.preclickHopMissProbabilityPercent = 0;
    params.preclickHopSpeedPxPerSecond = 1200;
    params.preclickHopSpeedEasing = "cubic-bezier(0.22, 1, 0.36, 1)";
    params.rockPressShrinkPercent = 0;
    params.rockWallPenetrationPercent = 0;
  });
  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  expect(await hopState(page)).toMatchObject({
    enabled: true,
    completed: false,
    finePointer: true,
    hopCount: 0,
    audioPlayCount: 0,
  });

  await enterFromLeft(page, radius, 650);
  const prestartState = await hopState(page);
  expect(prestartState).toMatchObject({
    awaitingInitialClick: true,
    hopCount: 0,
    radiusHopCount: 0,
  });
  await performInitialClick(page);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(0);
  const initial = await hopState(page);

  await enterFromLeft(page, radius, 650);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 2,
    audioPlayCount: 1,
    activeAudioCount: 1,
    animating: false,
  });
  const first = await hopState(page);
  expect(
    Math.hypot(
      first.offset.x - initial.offset.x,
      first.offset.y - initial.offset.y,
    ),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(1);

  const movedCenter = await rockCenter(page);
  await page.mouse.move(movedCenter.x, movedCenter.y);
  await page.waitForTimeout(450);
  expect(await hopState(page)).toMatchObject({
    hopCount: 2,
    audioPlayCount: 1,
    offset: first.offset,
  });

  const outsideCenter = await rockCenter(page);
  await page.mouse.move(
    Math.max(5, outsideCenter.x - radius - 80),
    outsideCenter.y,
  );
  await page.waitForTimeout(500);
  expect((await hopState(page)).offset).toEqual(first.offset);

  await enterFromRight(page, radius, 0);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 3,
    audioPlayCount: 2,
    activeAudioCount: 2,
    animating: false,
  });
  const second = await hopState(page);
  expect(first.lastHopRequest.actualDistance).toBeGreaterThanOrEqual(
    first.lastHopRequest.requestedDistance,
  );
  expect(first.lastHopRequest.endpointSafe).toBe(true);
  expect(second.lastHopRequest.actualDistance).toBeGreaterThanOrEqual(
    second.lastHopRequest.requestedDistance,
  );
  expect(second.lastHopRequest.endpointSafe).toBe(true);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(2);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect
    .poll(() =>
      rock.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        return centerX >= 0 && centerX < innerWidth && centerY >= 0 && centerY < innerHeight;
      }),
    )
    .toBe(true);
  const normalized = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
  expect(normalized.centerX).toBeGreaterThanOrEqual(0);
  expect(normalized.centerX).toBeLessThan(normalized.viewportWidth);
  expect(normalized.centerY).toBeGreaterThanOrEqual(0);
  expect(normalized.centerY).toBeLessThan(normalized.viewportHeight);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopMissProbabilityPercent: 100,
    });
  });
  const beforeRequiredThirdHop = await hopState(page);
  const reducedRadius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await enterFromLeft(page, reducedRadius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: beforeRequiredThirdHop.hopCount + 1,
    radiusHopCount: 3,
    initialHoverAllowConsumed: false,
    lastRadiusDecision: "required-hop",
    animating: false,
  });
  const afterRequiredThirdHop = await hopState(page);

  await enterFromRight(page, reducedRadius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: afterRequiredThirdHop.hopCount,
    radiusHopCount: 3,
    initialHoverAllowConsumed: true,
    lastRadiusDecision: "initial-allow",
    audioPlayCount: afterRequiredThirdHop.audioPlayCount,
    animating: false,
  });

  await enterFromLeft(page, reducedRadius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: afterRequiredThirdHop.hopCount,
    radiusHopCount: 3,
    initialHoverAllowConsumed: true,
    lastRadiusDecision: "random-miss",
    audioPlayCount: afterRequiredThirdHop.audioPlayCount,
    animating: false,
  });

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopSoundFilename: "none",
    });
  });
  const beforeSilentClick = await hopState(page);
  const fakeClickPoint = await rockCenter(page);
  const popupPromise = page.waitForEvent("popup");
  const popupRequestedAt = Date.now();
  await page.mouse.click(fakeClickPoint.x, fakeClickPoint.y);
  const fakeClickPopup = await popupPromise;
  expect(Date.now() - popupRequestedAt).toBeGreaterThanOrEqual(150);
  const popupImage = fakeClickPopup.locator("img");
  await expect(popupImage).toHaveCount(1);
  await expect(popupImage).toHaveAttribute("alt", "Картина 01");
  await expect(popupImage).toHaveAttribute("src", /01[^/]*\.png/);
  await expect
    .poll(() =>
      popupImage.evaluate(
        (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      popupImage.evaluate((image) => {
        const rect = image.getBoundingClientRect();
        return {
          fitsPopup:
            rect.height === innerHeight && rect.width === innerWidth,
          naturalHeight: image.naturalHeight,
          naturalWidth: image.naturalWidth,
          objectFit: getComputedStyle(image).objectFit,
        };
      }),
    )
    .toMatchObject({
      fitsPopup: true,
      naturalHeight: 328,
      naturalWidth: 340,
      objectFit: "fill",
    });
  await fakeClickPopup.close();
  expect(fakeClickPopup.isClosed()).toBe(true);
  await page.bringToFront();
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 1,
    requiredHoverHopPending: true,
    clickAllowed: false,
  });
  const blockedClickPoint = await visibleRockPoint(page);
  await page.mouse.click(blockedClickPoint.x, blockedClickPoint.y);
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 1,
    requiredHoverHopPending: true,
    clickAllowed: false,
  });
  await advancePastRequiredPostGuardHop(page, reducedRadius);
  const secondFakeClickPoint = await rockCenter(page);
  const secondPopupPromise = page.waitForEvent("popup");
  await page.mouse.click(secondFakeClickPoint.x, secondFakeClickPoint.y);
  const secondFakeClickPopup = await secondPopupPromise;
  await expect(secondFakeClickPopup.locator("img")).toHaveAttribute(
    "src",
    /01[^/]*\.png/,
  );
  await secondFakeClickPopup.close();
  expect(secondFakeClickPopup.isClosed()).toBe(true);
  await page.bringToFront();
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 2,
    requiredHoverHopPending: true,
    clickAllowed: false,
  });
  await advancePastRequiredPostGuardHop(page, reducedRadius, {
    persistent: true,
  });
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 2,
    hopCount: beforeSilentClick.hopCount + 5,
    audioPlayCount: beforeSilentClick.audioPlayCount,
    activeAudioCount: 0,
    requiredHoverHopPending: false,
    clickAllowed: false,
    lastRadiusDecision: "persistent-fake-hop",
  });
  const beforePersistentClick = await hopState(page);
  const point = await visibleRockPoint(page);
  const persistentPopupPromise = page.waitForEvent("popup");
  await page.mouse.click(point.x, point.y);
  const persistentPopup = await persistentPopupPromise;
  await expect(persistentPopup.locator("img")).toHaveAttribute(
    "src",
    /01[^/]*\.png/,
  );
  await persistentPopup.close();
  await page.bringToFront();
  await expect.poll(() => hopState(page)).toMatchObject({
    activeAudioCount: beforePersistentClick.activeAudioCount,
    completed: true,
    guardClicksUsed: 2,
    hopCount: beforePersistentClick.hopCount,
    requiredHoverHopPending: false,
    clickAllowed: false,
    lastRadiusDecision: "final-real-click",
  });
  expect((await hopState(page)).lastHopRequest).toEqual(
    beforePersistentClick.lastHopRequest,
  );
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(
    beforePersistentClick.audioPlayCount,
  );
  await expect(rock).not.toHaveClass(/is-preclick-hop/);
  await expect(body).not.toHaveClass(/preclick-rock-guidance/);
  await expect(body).not.toHaveClass(/is-manual-scroll-disabled/);
  await expect(html).not.toHaveClass(/is-manual-scroll-disabled/);
  expect(await page.evaluate(() => window.__controlAcquireMessages.length)).toBe(0);
  expect(await page.evaluate(() => window.__sisyphusTestApi.sceneFlow)).toMatchObject({
    completed: true,
    completionReason: "final-real-click",
  });

  await page.getByTestId("restart-session").click();
  await expect(body).toHaveClass(/preclick-rock-guidance/);
  await expect(html).toHaveClass(/is-manual-scroll-disabled/);
  await expect(rock).toHaveClass(/is-preclick-hop/);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    guardClicksUsed: 0,
    hopCount: 0,
    offset: { x: 0, y: 0 },
  });
});

test("камень бесшовно переносится по обеим осям и остаётся кликабельным", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );
  await scrollToRock(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings(
      {
        preclickHopGuardClickCount: 0,
        preclickHopActivationRadiusPercent: 50,
        preclickHopMaxDistancePercent: 150,
        preclickHopMissProbabilityPercent: 0,
        rockPressShrinkPercent: 0,
        rockPulseEnabled: false,
        rockWallPenetrationPercent: 0,
      },
      { broadcastChanges: true },
    );
  });

  const rock = page.locator(SOURCE_ROCK);
  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await performInitialClick(page);
  const viewport = page.viewportSize();
  const horizontalEntry = await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 2,
    audioPlayCount: 1,
    animating: false,
  });
  const horizontalCenter = await rockCenter(page);
  expect(
    toroidalDistance(horizontalEntry.center, horizontalCenter, viewport),
  ).toBeGreaterThan(2);
  expect(
    toroidalDistance(horizontalEntry.inside, horizontalCenter, viewport),
  ).toBeGreaterThanOrEqual(radius - 1);

  const verticalEntry = await enterFromTop(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 3,
    audioPlayCount: 2,
    animating: false,
  });
  const verticalCenter = await rockCenter(page);
  expect(
    toroidalDistance(verticalEntry.center, verticalCenter, viewport),
  ).toBeGreaterThan(2);
  expect(
    toroidalDistance(verticalEntry.inside, verticalCenter, viewport),
  ).toBeGreaterThanOrEqual(radius - 1);

  const cornerEntry = await enterFromBottomRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 4,
    audioPlayCount: 3,
    animating: false,
  });
  const cornerCenter = await rockCenter(page);
  expect(
    toroidalDistance(cornerEntry.center, cornerCenter, viewport),
  ).toBeGreaterThan(2);
  expect(
    toroidalDistance(cornerEntry.inside, cornerCenter, viewport),
  ).toBeGreaterThanOrEqual(radius - 1);
  expect(cornerCenter.x).toBeGreaterThanOrEqual(0);
  expect(cornerCenter.x).toBeLessThan(1000);
  expect(cornerCenter.y).toBeGreaterThanOrEqual(0);
  expect(cornerCenter.y).toBeLessThan(700);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(3);

  const clickablePoint = await visibleRockPoint(page);
  expect(clickablePoint.x).toBeGreaterThanOrEqual(0);
  expect(clickablePoint.x).toBeLessThan(viewport.width);
  expect(clickablePoint.y).toBeGreaterThanOrEqual(0);
  expect(clickablePoint.y).toBeLessThan(viewport.height);
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 4,
    initialHoverAllowConsumed: true,
    clickAllowed: true,
    lastRadiusDecision: "initial-allow",
  });
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 0,
      preclickHopMissProbabilityPercent: 100,
      preclickHopSoundFilename: "none",
      preclickPopupDelayMs: 0,
    });
  });
  for (let click = 1; click <= 2; click += 1) {
    const fakeClickPoint = await visibleRockPoint(page);
    const popupPromise = page.waitForEvent("popup");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: fakeClickPoint.x,
      y: fakeClickPoint.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: fakeClickPoint.x,
      y: fakeClickPoint.y,
      button: "left",
      clickCount: 1,
    });
    const popup = await popupPromise;
    await popup.close();
    await page.bringToFront();
    await expect.poll(() => hopState(page)).toMatchObject({
      completed: false,
      guardClickCount: 2,
      guardClicksUsed: click,
      hopCount: 4 + click * 2 - 1,
      requiredHoverHopPending: true,
      clickAllowed: false,
    });
    await advancePastRequiredPostGuardHop(page, radius, {
      persistent: click === 2,
    });
  }
  const persistentClickPoint = await visibleRockPoint(page);
  const beforePersistentClick = await hopState(page);
  const beforePersistentRect = await page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  const persistentGrabRatio = {
    x:
      (persistentClickPoint.x - beforePersistentRect.left) /
      beforePersistentRect.width,
    y:
      (persistentClickPoint.y - beforePersistentRect.top) /
      beforePersistentRect.height,
  };
  const persistentPopupPromise = page.waitForEvent("popup");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: persistentClickPoint.x,
    y: persistentClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: persistentClickPoint.x,
    y: persistentClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  const persistentPopup = await persistentPopupPromise;
  await persistentPopup.close();
  await page.bringToFront();
  const afterPersistentRect = await page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(
    Math.hypot(
      afterPersistentRect.left +
        afterPersistentRect.width * persistentGrabRatio.x -
        persistentClickPoint.x,
      afterPersistentRect.top +
        afterPersistentRect.height * persistentGrabRatio.y -
        persistentClickPoint.y,
    ),
  ).toBeLessThan(1);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: true,
    guardClicksUsed: 2,
    hopCount: beforePersistentClick.hopCount,
    audioPlayCount: 3,
    clickAllowed: false,
    lastRadiusDecision: "final-real-click",
  });
  expect((await hopState(page)).lastHopRequest).toEqual(
    beforePersistentClick.lastHopRequest,
  );
  await cdp.detach();
});

test("начальный клик запускает игру, а третий настоящий клик завершает сцену", async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );

  await expect(page.locator('[name="preclickFirstHopOnClick"]')).toHaveCount(0);
  await expect(
    page.locator('[name="preclickPopupOnAnySceneClickEnabled"]'),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 2,
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 10,
      preclickHopMissProbabilityPercent: 100,
      preclickHopSoundFilename: "Смех.mp3",
      preclickPopupDelayMs: 0,
      preclickPopupArtworkMode: "single",
      preclickPopupArtworkId: "01.png",
      rockPressShrinkPercent: 0,
      rockWallPenetrationPercent: 0,
    });
  });

  await scrollToRock(page);
  const rock = page.locator(SOURCE_ROCK);
  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    awaitingInitialClick: true,
    initialClickConsumed: false,
    guardClickCount: 2,
    guardClicksUsed: 0,
    hopCount: 0,
    radiusHopCount: 0,
  });

  const pageCountBeforeActivation = context.pages().length;
  const activationPoint = await visibleRockPoint(page);
  const unexpectedInitialPopups = [];
  const captureUnexpectedInitialPopup = (popup) =>
    unexpectedInitialPopups.push(popup);
  page.on("popup", captureUnexpectedInitialPopup);
  await page.mouse.click(activationPoint.x, activationPoint.y);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    awaitingInitialClick: false,
    initialClickConsumed: true,
    guardClickCount: 2,
    guardClicksUsed: 0,
    hopCount: 1,
    radiusHopCount: 0,
    initialHoverAllowConsumed: false,
    lastRadiusDecision: "initial-click",
    lastHopRequest: {
      trigger: "initial-click",
      maxDistancePercent: 50,
      fixedDistanceFactor: 1,
    },
  });
  await page.waitForTimeout(50);
  page.off("popup", captureUnexpectedInitialPopup);
  expect(unexpectedInitialPopups).toHaveLength(0);
  expect(context.pages()).toHaveLength(pageCountBeforeActivation);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(0);

  for (let requiredHop = 1; requiredHop <= 3; requiredHop += 1) {
    await enterFromLeft(page, radius, 20);
    await expect.poll(() => hopState(page)).toMatchObject({
      guardClicksUsed: 0,
      radiusHopCount: requiredHop,
      clickAllowed: false,
      lastRadiusDecision: "required-hop",
    });
  }
  await enterFromRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 0,
    radiusHopCount: 3,
    initialHoverAllowConsumed: true,
    clickAllowed: true,
    lastRadiusDecision: "initial-allow",
  });

  const fakePopups = [];
  for (let click = 1; click <= 2; click += 1) {
    const point = await visibleRockPoint(page);
    const popupPromise = page.waitForEvent("popup");
    await page.mouse.click(point.x, point.y);
    const popup = await popupPromise;
    fakePopups.push(popup);
    await expect(popup.locator("img")).toHaveAttribute("src", /01[^/]*\.png/);
    await page.bringToFront();
    await expect.poll(() => hopState(page)).toMatchObject({
      completed: false,
      guardClickCount: 2,
      guardClicksUsed: click,
      hopCount: 3 + click * 2,
      requiredHoverHopPending: true,
      clickAllowed: false,
    });
    await advancePastRequiredPostGuardHop(page, radius, {
      persistent: click === 2,
    });
  }

  const persistentClickPoint = await visibleRockPoint(page);
  const beforeFinalClick = await hopState(page);
  const persistentPopupPromise = page.waitForEvent("popup");
  await page.mouse.click(persistentClickPoint.x, persistentClickPoint.y);
  const persistentPopup = await persistentPopupPromise;
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: true,
    guardClickCount: 2,
    guardClicksUsed: 2,
    hopCount: beforeFinalClick.hopCount,
    clickAllowed: false,
    lastRadiusDecision: "final-real-click",
  });
  expect((await hopState(page)).lastHopRequest).toEqual(
    beforeFinalClick.lastHopRequest,
  );
  expect(await page.evaluate(() => window.__sisyphusTestApi.sceneFlow)).toMatchObject({
    completed: true,
    completionReason: "final-real-click",
  });

  await Promise.all(
    [...fakePopups, persistentPopup].map((popup) => popup.close()),
  );
});

test("третий настоящий клик завершает сцену, удерживает камень и возвращает фокус окнам", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );
  await page.getByTestId("restart-session").click();
  await expect.poll(() => page.evaluate(() => motion.phase)).toBe("play");
  await scrollToRock(page);
  const rock = page.locator(SOURCE_ROCK);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 2,
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 25,
      preclickHopMissProbabilityPercent: 100,
      preclickFakeClickHopDistancePercent: 50,
      preclickFakeClickSoundFilename: "СимуляцияОргазма.mov",
      preclickFinalClickSoundFilename: "Dungeon master.mp3",
      preclickHopSoundFilename: "Смех.mp3",
      preclickPopupDelayMs: 0,
      preclickPopupBackgroundDelaySeconds: 3,
      preclickPopupWidthViewportFraction: 0.2,
      preclickPopupArtworkMode: "single",
      preclickPopupArtworkId: "01.png",
      birchBackgroundEnabled: true,
      birchScalePercent: 400,
      handAudioEnabled: true,
      gachiClickSoundFilename: "Aaaaaa.mp3",
      rockActivatedWidthVw: 10,
      rockPressShrinkPercent: 0,
      rockWallPenetrationPercent: 0,
    });
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const layer = document.querySelector(
          "#root > .scene-page > .world > .birch-layer--front",
        );
        const layerRect = layer.getBoundingClientRect();
        const trees = [
          ...document.querySelectorAll(
            "#root > .scene-page > .world > .birch-layer .birch-layer__tree",
          ),
        ];
        const targetCenterY = layerRect.top + layerRect.height / 2;
        return {
          bodyClass: document.body.classList.contains(
            "birch-background-enabled",
          ),
          display: getComputedStyle(layer).display,
          maxCenterDelta: Math.max(
            ...trees.map((tree) => {
              const rect = tree.getBoundingClientRect();
              return Math.abs(rect.top + rect.height / 2 - targetCenterY);
            }),
          ),
          scale: getComputedStyle(document.body)
            .getPropertyValue("--birch-scale")
            .trim(),
        };
      }),
    )
    .toEqual({
      bodyClass: true,
      display: "block",
      maxCenterDelta: 0,
      scale: "4",
    });

  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await performInitialClick(page);
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    guardClickCount: 2,
    guardClicksUsed: 0,
    hopCount: 2,
    animating: false,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getRockEchoTrailState().echoCount,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(0);

  await enterFromRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    radiusHopCount: 2,
    lastRadiusDecision: "required-hop",
    clickAllowed: false,
  });
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    radiusHopCount: 3,
    lastRadiusDecision: "required-hop",
    clickAllowed: false,
  });
  await enterFromRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    radiusHopCount: 3,
    initialHoverAllowConsumed: true,
    lastRadiusDecision: "initial-allow",
    clickAllowed: true,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const cdp = await page.context().newCDPSession(page);
  const popupWidthFractions = [0.1, 0.2];
  const fakeClickSoundFilenames = [
    "СимуляцияОргазма.mov",
    "Like that.mp3",
  ];
  const fakeClickPopups = [];
  let sharedPopupSize = null;
  for (let click = 1; click <= 2; click += 1) {
    const beforeFakeClick = await hopState(page);
    const beforeFakeClickAudio = await page.evaluate(() =>
      window.__sisyphusTestApi.getPreclickFakeClickAudioState(),
    );
    const widthFraction = popupWidthFractions[click - 1];
    const soundFilename = fakeClickSoundFilenames[click - 1];
    const soundFilenameStart = soundFilename.replace(/\.[^.]+$/u, "");
    const beforeSelectedSoundPlayCount = await page.evaluate(
      (expectedFilenameStart) =>
        window.__playedAudioFilenames.filter((filename) =>
          filename.startsWith(expectedFilenameStart),
        ).length,
      soundFilenameStart,
    );
    await page.evaluate(({ nextArtworkId, nextSoundFilename, nextSpeed, nextWidthFraction }) => {
      window.__sisyphusTestApi.applyTestSettings({
        preclickPopupArtworkId: nextArtworkId,
        preclickFakeClickSoundFilename: nextSoundFilename,
        preclickHopSpeedPxPerSecond: nextSpeed,
        preclickPopupWidthViewportFraction: nextWidthFraction,
      });
    }, {
      nextArtworkId: `0${click}.png`,
      nextSoundFilename: soundFilename,
      nextSpeed: click === 1 ? 120 : 1200,
      nextWidthFraction: widthFraction,
    });
    const point = await visibleRockPoint(page);
    const popupPromise = page.waitForEvent("popup");
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    const popup = await popupPromise;
    fakeClickPopups.push(popup);
    const popupImage = popup.locator("img");
    await expect(popupImage).toHaveAttribute(
      "src",
      new RegExp(`0${click}[^/]*\\.png`),
    );
    await expect(popupImage).toHaveAttribute("alt", `Картина 0${click}`);
    await expect.poll(() => popupImage.evaluate(
      (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0,
    )).toBe(true);
    await expect
      .poll(async () => {
        const sizes = await Promise.all(
          fakeClickPopups.map((openPopup) =>
            openPopup.evaluate(() => ({ height: innerHeight, width: innerWidth })),
          ),
        );
        return new Set(sizes.map((size) => JSON.stringify(size))).size;
      })
      .toBe(1);
    sharedPopupSize = await popup.evaluate(() => ({
      height: innerHeight,
      width: innerWidth,
    }));
    await expect.poll(() => popupImage.evaluate((image) => {
      const rect = image.getBoundingClientRect();
      return {
        imageHeight: rect.height,
        imageWidth: rect.width,
        innerHeight,
        innerWidth,
        objectFit: getComputedStyle(image).objectFit,
      };
    })).toEqual({
      imageHeight: sharedPopupSize.height,
      imageWidth: sharedPopupSize.width,
      innerHeight: sharedPopupSize.height,
      innerWidth: sharedPopupSize.width,
      objectFit: "fill",
    });
    await popup.evaluate(() => {
      window.__preclickFocusCalls = 0;
      window.__preclickBlurCalls = 0;
      const nativeFocus = window.focus.bind(window);
      const nativeBlur = window.blur.bind(window);
      window.focus = () => {
        window.__preclickFocusCalls += 1;
        nativeFocus();
      };
      window.blur = () => {
        window.__preclickBlurCalls += 1;
        nativeBlur();
      };
    });
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await expect.poll(() => hopState(page)).toMatchObject({
      completed: false,
      guardClickCount: 2,
      guardClicksUsed: click,
      hopCount: beforeFakeClick.hopCount + 1,
      audioPlayCount: beforeFakeClick.audioPlayCount,
      lastFilename: "Смех.mp3",
      animating: false,
      fakeClickHopDistancePercent: 50,
      requiredHoverHopPending: true,
      clickAllowed: false,
      lastHopRequest: {
        trigger: "fake-click",
        maxDistancePercent: 50,
        fixedDistanceFactor: 1,
        endpointSafe: true,
        completed: true,
      },
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__sisyphusTestApi.getPreclickFakeClickAudioState(),
        ),
      )
      .toMatchObject({
        playCount: beforeFakeClickAudio.playCount + 1,
        lastFilename: soundFilename,
      });
    const lastHopRequest = await page.evaluate(
      () => window.__sisyphusTestApi.getPreclickHopState().lastHopRequest,
    );
    expect(lastHopRequest.requestedDistance).toBeGreaterThan(0);
    expect(lastHopRequest.actualDistance).toBeGreaterThan(0);
    expect(lastHopRequest.actualDistance).toBeGreaterThanOrEqual(
      lastHopRequest.requestedDistance,
    );
    const recoveredCenter = await rockCenter(page);
    expect(
      toroidalDistance(point, recoveredCenter, page.viewportSize()),
    ).toBeGreaterThanOrEqual(radius);
    expect(await page.evaluate(() => window.__controlAcquireMessages.length)).toBe(0);
    expect(await page.evaluate(() => window.__sisyphusTestApi.motion.dragging)).toBe(false);
    await expect
      .poll(() =>
        page.evaluate(() => window.__sisyphusTestApi.getGachiClickAudioState()),
      )
      .toMatchObject({ playCount: 0, lastFilename: null });
    expect(
      await page.evaluate(
        (expectedFilenameStart) =>
          window.__playedAudioFilenames.filter(
            (filename) => filename.startsWith(expectedFilenameStart),
          ).length,
        soundFilenameStart,
      ),
    ).toBe(beforeSelectedSoundPlayCount + 1);
    if (click === 1) {
      await page.evaluate(() => {
        window.__sisyphusTestApi.applyTestSettings({
          preclickHopSpeedPxPerSecond: 1200,
        });
      });
    }
    await advancePastRequiredPostGuardHop(page, radius, {
      persistent: click === 2,
    });
  }

  await expect.poll(() => hopState(page)).toMatchObject({
    animating: false,
    lastRadiusDecision: "persistent-fake-hop",
  });
  const beforePersistentClick = await hopState(page);
  const beforePersistentFakeClickAudio = await page.evaluate(() =>
    window.__sisyphusTestApi.getPreclickFakeClickAudioState(),
  );
  const beforeFinalClickAudio = await page.evaluate(() =>
    window.__sisyphusTestApi.getPreclickFinalClickAudioState(),
  );
  const persistentClickPoint = await visibleRockPoint(page);
  const beforeFinalClickRect = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  const finalGrabRatio = {
    x:
      (persistentClickPoint.x - beforeFinalClickRect.left) /
      beforeFinalClickRect.width,
    y:
      (persistentClickPoint.y - beforeFinalClickRect.top) /
      beforeFinalClickRect.height,
  };
  const persistentPopupPromise = page.waitForEvent("popup");
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: persistentClickPoint.x,
    y: persistentClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  const persistentPopup = await persistentPopupPromise;
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: persistentClickPoint.x,
    y: persistentClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  const persistentPopupImage = persistentPopup.locator("img");
  await expect(persistentPopupImage).toHaveAttribute("alt", "Картина 02");
  await expect(persistentPopupImage).toHaveAttribute("src", /02[^/]*\.png/);
  await expect
    .poll(() =>
      persistentPopupImage.evaluate((image) => ({
        imageHeight: image.getBoundingClientRect().height,
        imageWidth: image.getBoundingClientRect().width,
        innerHeight,
        innerWidth,
      })),
    )
    .toEqual({
      imageHeight: sharedPopupSize.height,
      imageWidth: sharedPopupSize.width,
      innerHeight: sharedPopupSize.height,
      innerWidth: sharedPopupSize.width,
    });
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: true,
    guardClickCount: 2,
    guardClicksUsed: 2,
    hopCount: beforePersistentClick.hopCount,
    audioPlayCount: beforePersistentClick.audioPlayCount,
    animating: false,
    clickAllowed: false,
    requiredHoverHopPending: false,
    lastRadiusDecision: "final-real-click",
  });
  expect((await hopState(page)).lastHopRequest).toEqual(
    beforePersistentClick.lastHopRequest,
  );
  const hand = page.locator(
    "#root > .scene-page > .world > .hand-cursor:not(.is-remote)",
  );
  await expect(rock).toHaveClass(/is-dragging/);
  await expect(hand).toHaveClass(/is-visible/);
  await expect(hand).toHaveClass(/is-grabbing/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getSceneOneFinalHoldState(),
      ),
    )
    .toMatchObject({
      active: true,
      audioTerminated: true,
      dragging: true,
      handGrabbing: true,
      handVisible: true,
      rockDragging: true,
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getPreclickFakeClickAudioState(),
      ),
    )
    .toMatchObject({
      playCount: beforePersistentFakeClickAudio.playCount,
      lastFilename: "Like that.mp3",
    });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getPreclickFinalClickAudioState(),
      ),
    )
    .toMatchObject({
      playCount: beforeFinalClickAudio.playCount + 1,
      lastFilename: "Dungeon master.mp3",
    });
  const audioCountAfterFinalClick = await page.evaluate(
    () => window.__playedAudioFilenames.length,
  );
  expect(
    await page.evaluate(() => window.__playedAudioFilenames.at(-1)),
  ).toBe("Dungeon master.mp3");
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getPreclickPopupState()),
    )
    .toMatchObject({
      preclickWindowCount:
        fakeClickPopups.length + 1,
      preclickWindowsRevealed: true,
      preclickBackgroundPending: true,
      preclickWindowsBackgrounded: false,
    });
  await expect
    .poll(() =>
      Promise.all(
        fakeClickPopups.map((popup) =>
          popup.evaluate(() => window.__preclickFocusCalls),
        ),
      ),
    )
    .toEqual(fakeClickPopups.map(() => 1));
  expect(persistentPopup.isClosed()).toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.__controlAcquireMessages.length))
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(0);

  await Promise.all(
    [...fakeClickPopups, persistentPopup].map((popup) =>
      popup.close()
    ),
  );

  expect(await page.evaluate(() => window.__laughPlayCount)).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () =>
        window.__playedAudioFilenames.filter(
          (filename) => filename === "Aaaaaa.mp3",
        ).length,
    ),
  ).toBe(0);
  expect(await page.evaluate(() => window.__sisyphusTestApi.sceneFlow)).toMatchObject({
    completed: true,
    completionReason: "final-real-click",
  });
  const afterFinalClickRect = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  });
  expect(
    Math.hypot(
      afterFinalClickRect.left +
        afterFinalClickRect.width * finalGrabRatio.x -
        persistentClickPoint.x,
      afterFinalClickRect.top +
        afterFinalClickRect.height * finalGrabRatio.y -
        persistentClickPoint.y,
    ),
  ).toBeLessThan(1);
  const beforeFinalHoldMove = await rockCenter(page);
  const finalHoldTarget = {
    x:
      beforeFinalHoldMove.x < page.viewportSize().width / 2
        ? page.viewportSize().width * 0.75
        : page.viewportSize().width * 0.25,
    y:
      beforeFinalHoldMove.y < page.viewportSize().height / 2
        ? page.viewportSize().height * 0.75
        : page.viewportSize().height * 0.25,
  };
  await page.mouse.move(finalHoldTarget.x, finalHoldTarget.y);
  await expect
    .poll(async () => {
      const rect = await rock.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        };
      });
      return Math.hypot(
        (finalHoldTarget.x - rect.left) / rect.width - finalGrabRatio.x,
        (finalHoldTarget.y - rect.top) / rect.height - finalGrabRatio.y,
      );
    })
    .toBeLessThan(0.01);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getSceneOneFinalHoldState(),
      ),
    )
    .toMatchObject({
      active: true,
      dragging: true,
      pointer: finalHoldTarget,
    });
  await page.evaluate(() => {
    const rock = document.querySelector("#root > .scene-page > .world > .rock");
    rock.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    rock.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true }));
    window.dispatchEvent(new Event("blur"));
  });
  const secondFinalHoldTarget = {
    x: page.viewportSize().width * 0.55,
    y: page.viewportSize().height * 0.45,
  };
  await page.mouse.move(secondFinalHoldTarget.x, secondFinalHoldTarget.y);
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getSceneOneFinalHoldState(),
      ),
    )
    .toMatchObject({
      active: true,
      audioTerminated: true,
      dragging: true,
      handGrabbing: true,
      pointer: secondFinalHoldTarget,
    });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__playedAudioFilenames.length)).toBe(
    audioCountAfterFinalClick,
  );
  await cdp.detach();

  await page.getByTestId("restart-session").click();
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    guardClicksUsed: 0,
    hopCount: 0,
    awaitingInitialClick: true,
  });
  await expect(rock).not.toHaveClass(/is-dragging/);
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getSceneOneFinalHoldState(),
      ),
    )
    .toMatchObject({
      active: false,
      audioTerminated: false,
      dragging: false,
    });
});

test("окна по кликам поля работают без переключателя после начального клика", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );

  await expect(
    page.locator('[name="preclickPopupOnAnySceneClickEnabled"]'),
  ).toHaveCount(0);

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickPopupOnAnySceneClickEnabled: false,
      preclickPopupDelayMs: 0,
      preclickPopupArtworkMode: "single",
      preclickPopupArtworkId: "01.png",
      preclickHopSoundFilename: "none",
    });
  });
  await scrollToRock(page);
  const progressBeforeBackgroundClick = await hopState(page);
  const backgroundPoint = await page.locator(".scene-page > .world").evaluate(
    (world) => {
      for (let y = 40; y < innerHeight - 40; y += 40) {
        for (let x = 40; x < innerWidth - 40; x += 40) {
          const target = document.elementFromPoint(x, y);
          if (target && world.contains(target) && !target.closest(".rock")) {
            return { x, y };
          }
        }
      }
      throw new Error("Не найдена свободная точка игрового поля");
    },
  );
  const prestartPopups = [];
  const capturePrestartPopup = (popup) => prestartPopups.push(popup);
  page.on("popup", capturePrestartPopup);
  await page.mouse.click(backgroundPoint.x, backgroundPoint.y);
  await page.waitForTimeout(100);
  page.off("popup", capturePrestartPopup);
  expect(prestartPopups).toHaveLength(0);
  expect(await hopState(page)).toMatchObject({
    awaitingInitialClick: progressBeforeBackgroundClick.awaitingInitialClick,
    guardClicksUsed: progressBeforeBackgroundClick.guardClicksUsed,
    hopCount: progressBeforeBackgroundClick.hopCount,
    radiusHopCount: progressBeforeBackgroundClick.radiusHopCount,
  });

  const rockPopups = [];
  const captureRockPopup = (popup) => rockPopups.push(popup);
  page.on("popup", captureRockPopup);
  const initialPoint = await visibleRockPoint(page);
  await page.mouse.click(initialPoint.x, initialPoint.y);
  await page.waitForTimeout(250);
  expect(rockPopups).toHaveLength(0);
  page.off("popup", captureRockPopup);
  await expect.poll(() => hopState(page)).toMatchObject({
    initialClickConsumed: true,
    guardClicksUsed: 0,
    hopCount: 1,
    lastRadiusDecision: "initial-click",
  });
  const progressAfterInitialClick = await hopState(page);

  const backgroundPopupPromise = page.waitForEvent("popup");
  await page.mouse.click(backgroundPoint.x, backgroundPoint.y);
  const backgroundPopup = await backgroundPopupPromise;
  await expect(backgroundPopup.locator("img")).toHaveAttribute(
    "src",
    /01[^/]*\.png/,
  );
  expect(await hopState(page)).toMatchObject({
    awaitingInitialClick: false,
    guardClicksUsed: progressAfterInitialClick.guardClicksUsed,
    hopCount: progressAfterInitialClick.hopCount,
    radiusHopCount: progressAfterInitialClick.radiusHopCount,
  });
  await backgroundPopup.close();
  await page.bringToFront();
});

test("фейковый отскок первой сцены не создаёт след траектории", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status").first()).toContainText(
    "В сессии",
  );
  await scrollToRock(page);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      trailEnabled: true,
      trailSampleDist: 1,
      lineDelay: 0,
      preclickHopActivationRadiusPercent: 100,
      preclickHopMaxDistancePercent: 25,
      rockWallPenetrationPercent: 0,
    });
    window.__sisyphusTestApi.resetTrail();
  });
  await expect.poll(() => trailState(page)).toMatchObject({
    enabled: true,
    pointCount: 0,
    canonicalPointCount: 0,
  });

  const rock = page.locator(SOURCE_ROCK);
  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await performInitialClick(page);
  await expect.poll(() => trailState(page)).toMatchObject({
    enabled: true,
    pointCount: 0,
    canonicalPointCount: 0,
  });
  await enterFromLeft(page, radius, 20);

  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    hopCount: 2,
    animating: false,
  });
  await expect.poll(() => trailState(page)).toMatchObject({
    enabled: true,
    pointCount: 0,
    canonicalPointCount: 0,
  });
});
