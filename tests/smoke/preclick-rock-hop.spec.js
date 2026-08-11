const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";

async function watchLaughPlayCalls(page) {
  await page.addInitScript(() => {
    window.__laughPlayCount = 0;
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
      if (decodedSrc.includes("Смех.mp3")) {
        window.__laughPlayCount += 1;
      }
      return Promise.resolve();
    };
  });
}

async function scrollToRock(page) {
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
  const outside = {
    x: Math.max(5, initialCenter.x - radius - 80),
    y: initialCenter.y,
  };
  await page.mouse.move(outside.x, outside.y);
  if (delayMs > 0) {
    await page.waitForTimeout(delayMs);
  }
  const center = await rockCenter(page);
  const inside = { x: center.x - radius / 2, y: center.y };
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

test("камень прыгает накопительно, сохраняет guidance и завершается первым захватом", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1200 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await expect
    .poll(() =>
      page.evaluate(() => ({
        followDown: params.cameraFollowDownEnabled,
        followUp: params.upperZoneAutoScrollEnabled,
      })),
    )
    .toEqual({ followDown: true, followUp: true });
  await page.waitForTimeout(250);
  const body = page.locator("body");
  const html = page.locator("html");
  await expect(body).toHaveClass(/preclick-rock-guidance/);
  await expect(body).toHaveClass(/is-manual-scroll-disabled/);
  await expect(html).toHaveClass(/is-manual-scroll-disabled/);
  const scrollBeforeWheel = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => scrollY)).toBe(scrollBeforeWheel);

  await page.reload();
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
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
    params.preclickHopGuardClickCount = 1;
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

  const firstMove = await enterFromLeft(page, radius, 650);
  const stateAfterFirstMove = await hopState(page);
  expect(
    stateAfterFirstMove.insideRadius,
    JSON.stringify({ firstMove, stateAfterFirstMove }),
  ).toBe(true);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 1,
    audioPlayCount: 0,
    activeAudioCount: 0,
    animating: false,
  });
  const first = await hopState(page);
  expect(first.offset.x).toBeGreaterThan(0);
  expect(Math.abs(first.offset.y)).toBeLessThan(2);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(0);

  const movedCenter = await rockCenter(page);
  await page.mouse.move(movedCenter.x, movedCenter.y);
  await page.waitForTimeout(450);
  expect(await hopState(page)).toMatchObject({
    hopCount: 1,
    audioPlayCount: 0,
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
    hopCount: 2,
    audioPlayCount: 0,
    activeAudioCount: 0,
    animating: false,
  });
  const second = await hopState(page);
  const slowDistance = Math.hypot(first.offset.x, first.offset.y);
  const fastDistance = Math.hypot(
    second.offset.x - first.offset.x,
    second.offset.y - first.offset.y,
  );
  expect(second.offset.x).toBeLessThan(first.offset.x);
  expect(fastDistance).toBeGreaterThanOrEqual(slowDistance);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(0);

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
  const beforeReducedHop = await hopState(page);
  const reducedRadius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await enterFromLeft(page, reducedRadius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: beforeReducedHop.hopCount,
    radiusHopCount: 2,
    forcedRadiusMissConsumed: true,
    lastRadiusDecision: "forced-miss",
    animating: false,
  });

  const fakeClickPoint = await rockCenter(page);
  const popupPromise = page.waitForEvent("popup");
  await page.mouse.click(fakeClickPoint.x, fakeClickPoint.y);
  const fakeClickPopup = await popupPromise;
  await expect(fakeClickPopup.locator("img")).toHaveCount(0);
  await expect(fakeClickPopup.locator("body")).toBeEmpty();
  await expect.poll(() => hopState(page)).toMatchObject({
    guardClicksUsed: 1,
    hopCount: beforeReducedHop.hopCount + 1,
    audioPlayCount: 1,
    lastFilename: "Смех.mp3",
  });

  const point = await rockCenter(page);
  await page.mouse.move(point.x, point.y);
  const beforeGrab = await hopState(page);
  const beforeGrabCenter = await rockCenter(page);
  const beforeGrabGeometry = await rockGeometry(page);
  const beforeGrabMotion = await page.evaluate(() => ({
    x: window.__sisyphusTestApi.motion.x,
    y: window.__sisyphusTestApi.motion.y,
  }));
  expect(beforeGrab.audioPlayCount).toBe(1);
  expect(beforeGrab.activeAudioCount).toBe(1);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(1);
  await page.mouse.down();
  const afterGrabCenter = await rockCenter(page);
  const afterGrabGeometry = await rockGeometry(page);
  const afterGrabMotion = await page.evaluate(() => ({
    x: window.__sisyphusTestApi.motion.x,
    y: window.__sisyphusTestApi.motion.y,
  }));
  const grabGeometry = JSON.stringify({
    afterGrabGeometry,
    beforeGrabGeometry,
  });
  expect(
    Math.abs(afterGrabCenter.x - beforeGrabCenter.x),
    grabGeometry,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(afterGrabCenter.y - beforeGrabCenter.y),
    grabGeometry,
  ).toBeLessThanOrEqual(2);
  expect(
    Math.hypot(
      afterGrabMotion.x - beforeGrabMotion.x,
      afterGrabMotion.y - beforeGrabMotion.y,
    ),
  ).toBeGreaterThan(1);
  await expect(rock).not.toHaveClass(/is-preclick-hop/);
  await expect.poll(() => hopState(page)).toMatchObject({
    activeAudioCount: beforeGrab.activeAudioCount,
    completed: true,
    hopCount: beforeGrab.hopCount,
    offset: { x: 0, y: 0 },
  });
  await expect(body).not.toHaveClass(/preclick-rock-guidance/);
  await expect(body).not.toHaveClass(/is-manual-scroll-disabled/);
  await expect(html).not.toHaveClass(/is-manual-scroll-disabled/);
  await expect
    .poll(() =>
      page.evaluate(() => window.__controlAcquireMessages.at(-1) || null),
    )
    .not.toBeNull();
  const acquiredLocalPosition = await page.evaluate(() => {
    const payload = window.__controlAcquireMessages.at(-1);
    return window.__sisyphusTestApi.canonicalToLocal(payload.x, payload.y);
  });
  expect(acquiredLocalPosition.x).toBeCloseTo(afterGrabMotion.x, 5);
  expect(acquiredLocalPosition.y).toBeCloseTo(afterGrabMotion.y, 5);
  const scrollAtActivation = await page.evaluate(() => scrollY);
  await page.mouse.move(
    afterGrabCenter.x,
    50,
    { steps: 80 },
  );
  if (scrollAtActivation > 0) {
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeLessThan(scrollAtActivation);
  } else {
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  }
  await page.mouse.up();
  const scrollBeforeDownwardFollow = await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.applyTestSettings({ cameraFollowLerp: 1 });
    const middleY = api.bounds.maxY / 2;
    api.setPosition(api.motion.x, middleY);
    api.updateCameraFollow({ immediate: true });
    return scrollY;
  });
  await page.evaluate(() => {
    const api = window.__sisyphusTestApi;
    api.setPosition(
      api.motion.x,
      Math.min(api.bounds.maxY, api.motion.y + window.innerHeight),
    );
    api.updateCameraFollow({ immediate: true });
  });
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeGreaterThan(scrollBeforeDownwardFollow + 1);
  await page.mouse.move(10, 10);
  await page.mouse.move(point.x, point.y);
  expect(await hopState(page)).toMatchObject({
    audioPlayCount: beforeGrab.audioPlayCount,
    hopCount: beforeGrab.hopCount,
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
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await scrollToRock(page);
  await page.evaluate(() => {
    params.preclickHopGuardClickCount = 0;
    params.preclickHopActivationRadiusPercent = 50;
    params.preclickHopMaxDistancePercent = 150;
    params.preclickHopMissProbabilityPercent = 0;
    params.rockPressShrinkPercent = 0;
    params.rockWallPenetrationPercent = 0;
  });

  const rock = page.locator(SOURCE_ROCK);
  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  const viewport = page.viewportSize();
  const horizontalEntry = await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 1,
    audioPlayCount: 0,
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
    hopCount: 2,
    audioPlayCount: 0,
    animating: false,
  });
  const verticalCenter = await rockCenter(page);
  expect(
    toroidalDistance(verticalEntry.center, verticalCenter, viewport),
  ).toBeGreaterThan(2);
  expect(
    toroidalDistance(verticalEntry.inside, verticalCenter, viewport),
  ).toBeGreaterThanOrEqual(radius - 1);

  await enterFromBottomRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 2,
    audioPlayCount: 0,
    forcedRadiusMissConsumed: true,
    lastRadiusDecision: "forced-miss",
    animating: false,
  });

  const cornerEntry = await enterFromBottomRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 3,
    audioPlayCount: 0,
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
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(0);

  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest(".rock") !== null,
      cornerCenter,
    ),
  ).toBe(true);
  const beforeGrabCenter = await rockCenter(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: cornerCenter.x,
    y: cornerCenter.y,
    button: "left",
    clickCount: 1,
  });
  const afterGrabCenter = await rockCenter(page);
  expect(afterGrabCenter.x).toBeCloseTo(beforeGrabCenter.x, 0);
  expect(afterGrabCenter.worldY).toBeCloseTo(beforeGrabCenter.worldY, 0);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: true,
    hopCount: 3,
    audioPlayCount: 0,
    offset: { x: 0, y: 0 },
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: cornerCenter.x,
    y: cornerCenter.y,
    button: "left",
    clickCount: 1,
  });
  await cdp.detach();
});

test("N фейковых кликов отталкивают камень, а клик N+1 включает физику", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.getByTestId("restart-session").click();
  await expect.poll(() => page.evaluate(() => motion.phase)).toBe("play");
  await scrollToRock(page);
  const rock = page.locator(SOURCE_ROCK);
  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopGuardClickCount: 3,
      preclickHopActivationRadiusPercent: 50,
      preclickHopMaxDistancePercent: 25,
      handAudioEnabled: true,
      gachiClickSoundFilename: "Camen.mp3",
      rockPressShrinkPercent: 0,
      rockWallPenetrationPercent: 0,
    });
  });

  const radius = await rock.evaluate(
    (element) => element.getBoundingClientRect().width * 0.5,
  );
  await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    guardClickCount: 3,
    guardClicksUsed: 0,
    hopCount: 1,
    animating: false,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(0);

  await page.evaluate(() => {
    window.__sisyphusTestApi.applyTestSettings({
      preclickHopActivationRadiusPercent: 0,
    });
  });
  const cdp = await page.context().newCDPSession(page);
  for (let click = 1; click <= 3; click += 1) {
    const point = await visibleRockPoint(page);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      clickCount: 1,
    });
    await expect.poll(() => hopState(page)).toMatchObject({
      completed: false,
      guardClickCount: 3,
      guardClicksUsed: click,
      hopCount: click + 1,
      audioPlayCount: click,
      animating: false,
    });
    expect(await page.evaluate(() => window.__controlAcquireMessages.length)).toBe(0);
    expect(await page.evaluate(() => window.__sisyphusTestApi.motion.dragging)).toBe(false);
    expect(
      await page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    ).toBe(0);
    expect(await page.evaluate(() => window.__laughPlayCount)).toBe(click);
  }

  const realClickPoint = await visibleRockPoint(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: realClickPoint.x,
    y: realClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: true,
    guardClickCount: 3,
    guardClicksUsed: 3,
    hopCount: 4,
    offset: { x: 0, y: 0 },
  });
  await expect
    .poll(() => page.evaluate(() => window.__controlAcquireMessages.length))
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
      ),
    )
    .toBe(0);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: realClickPoint.x,
    y: realClickPoint.y,
    button: "left",
    clickCount: 1,
  });

  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(3);
  const sceneTwoClickPoint = await visibleRockPoint(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: sceneTwoClickPoint.x,
    y: sceneTwoClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__sisyphusTestApi.getGachiClickAudioState(),
      ),
    )
    .toMatchObject({ playCount: 1, lastFilename: "Camen.mp3" });
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(3);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: sceneTwoClickPoint.x,
    y: sceneTwoClickPoint.y,
    button: "left",
    clickCount: 1,
  });
  for (let click = 2; click <= 3; click += 1) {
    await rock.dispatchEvent("pointerdown", {
      pointerType: "mouse",
      pointerId: click + 10,
      button: 0,
      buttons: 1,
      isPrimary: true,
    });
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__sisyphusTestApi.getGachiClickAudioState().playCount,
        ),
      )
      .toBe(click);
  }
  await expect
    .poll(() =>
      page.evaluate(() => window.__sisyphusTestApi.getGachiClickAudioState()),
    )
    .toMatchObject({
      activeCount: 3,
      playCount: 3,
      stopCount: 0,
      lastFilename: "Camen.mp3",
    });
  await cdp.detach();

  await page.getByTestId("restart-session").click();
  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    guardClicksUsed: 0,
    hopCount: 0,
  });
});

test("фейковый отскок первой сцены не создаёт след траектории", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
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
  await enterFromLeft(page, radius, 20);

  await expect.poll(() => hopState(page)).toMatchObject({
    completed: false,
    hopCount: 1,
    animating: false,
  });
  await expect.poll(() => trailState(page)).toMatchObject({
    enabled: true,
    pointCount: 0,
    canonicalPointCount: 0,
  });
});
