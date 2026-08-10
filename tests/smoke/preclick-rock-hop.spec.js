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

function hopState(page) {
  return page.evaluate(() => window.__sisyphusTestApi.getPreclickHopState());
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
  const outside = {
    x: Math.max(5, initialCenter.x - radius - 10),
    y: initialCenter.y,
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const inside = {
    x: Math.min(viewportWidth - 5, center.x + radius / 2),
    y: center.y,
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

async function enterFromTop(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const outside = {
    x: initialCenter.x,
    y: Math.max(5, initialCenter.y - radius - 80),
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const inside = { x: center.x, y: center.y - radius / 2 };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

async function enterFromBottomRight(page, radius, delayMs) {
  const initialCenter = await rockCenter(page);
  const viewport = page.viewportSize();
  const outside = {
    x: Math.min(viewport.width - 5, initialCenter.x + radius + 80),
    y: Math.min(viewport.height - 5, initialCenter.y + radius + 80),
  };
  await page.mouse.move(outside.x, outside.y);
  await page.waitForTimeout(Math.max(16, delayMs));
  const center = await rockCenter(page);
  const component = radius / (2 * Math.sqrt(2));
  const inside = {
    x: center.x + component,
    y: center.y + component,
  };
  await page.mouse.move(inside.x, inside.y);
  return { center, initialCenter, inside, outside };
}

function wrap(value, span) {
  return ((value % span) + span) % span;
}

function hopDistance(maxDistancePx, speedPxPerSecond) {
  const speedProgress = Math.min(Math.max(speedPxPerSecond / 2000, 0), 1);
  return maxDistancePx * (0.28 + 0.72 * speedProgress);
}

test("камень прыгает накопительно, сохраняет guidance и завершается первым захватом", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1200 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
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
  await scrollToRock(page);

  const rock = page.locator(SOURCE_ROCK);
  await expect(rock).toHaveClass(/is-preclick-hop/);
  await page.evaluate(() => {
    params.preclickHopActivationRadiusVw = 5;
    params.preclickHopMaxDistanceVw = 10;
  });
  const radius = 100;
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
    audioPlayCount: 1,
    activeAudioCount: 1,
    lastFilename: "Смех.mp3",
    animating: false,
  });
  const first = await hopState(page);
  expect(first.offset.x).toBeGreaterThan(0);
  expect(Math.abs(first.offset.y)).toBeLessThan(2);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(1);

  const movedCenter = await rockCenter(page);
  await page.mouse.move(movedCenter.x, movedCenter.y);
  await page.waitForTimeout(450);
  expect(await hopState(page)).toMatchObject({
    hopCount: 1,
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
    hopCount: 2,
    audioPlayCount: 2,
    activeAudioCount: 2,
    animating: false,
  });
  const second = await hopState(page);
  const slowDistance = Math.hypot(first.offset.x, first.offset.y);
  const fastDistance = Math.hypot(
    second.offset.x - first.offset.x,
    second.offset.y - first.offset.y,
  );
  expect(second.offset.x).toBeLessThan(first.offset.x);
  expect(fastDistance).toBeGreaterThan(slowDistance);
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
  const beforeReducedHop = await hopState(page);
  await enterFromLeft(page, 45, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: beforeReducedHop.hopCount + 1,
    animating: false,
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
  expect(beforeGrab.audioPlayCount).toBe(beforeGrab.hopCount);
  expect(beforeGrab.activeAudioCount).toBe(beforeGrab.hopCount);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(
    beforeGrab.hopCount,
  );
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
    Math.max(50, afterGrabCenter.y - 300),
    { steps: 8 },
  );
  if (scrollAtActivation > 0) {
    await expect
      .poll(() => page.evaluate(() => scrollY))
      .toBeLessThan(scrollAtActivation);
  } else {
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  }
  await page.mouse.up();
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
    params.preclickHopActivationRadiusVw = 5;
    params.preclickHopMaxDistanceVw = 200;
  });

  const radius = 50;
  const horizontalEntry = await enterFromLeft(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 1,
    audioPlayCount: 1,
    animating: false,
  });
  const horizontalState = await hopState(page);
  const horizontalDistance = hopDistance(
    2000,
    horizontalState.speedPxPerSecond,
  );
  const horizontalCenter = await rockCenter(page);
  expect(horizontalCenter.x).toBeCloseTo(
    wrap(horizontalEntry.center.x + horizontalDistance, 1000),
    0,
  );
  expect(horizontalCenter.y).toBeCloseTo(horizontalEntry.center.y, 0);

  const verticalEntry = await enterFromTop(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 2,
    audioPlayCount: 2,
    animating: false,
  });
  const verticalState = await hopState(page);
  const verticalDistance = hopDistance(
    2000,
    verticalState.speedPxPerSecond,
  );
  const verticalCenter = await rockCenter(page);
  expect(verticalCenter.x).toBeCloseTo(verticalEntry.center.x, 0);
  expect(verticalCenter.y).toBeCloseTo(
    wrap(verticalEntry.center.y + verticalDistance, 700),
    0,
  );

  const cornerEntry = await enterFromBottomRight(page, radius, 20);
  await expect.poll(() => hopState(page)).toMatchObject({
    hopCount: 3,
    audioPlayCount: 3,
    animating: false,
  });
  const cornerState = await hopState(page);
  const cornerCenter = await rockCenter(page);
  const cornerComponent = hopDistance(
    2000,
    cornerState.speedPxPerSecond,
  ) / Math.sqrt(2);
  expect(cornerCenter.x).toBeCloseTo(
    wrap(cornerEntry.center.x - cornerComponent, 1000),
    0,
  );
  expect(cornerCenter.y).toBeCloseTo(
    wrap(cornerEntry.center.y - cornerComponent, 700),
    0,
  );
  expect(cornerCenter.x).toBeGreaterThanOrEqual(0);
  expect(cornerCenter.x).toBeLessThan(1000);
  expect(cornerCenter.y).toBeGreaterThanOrEqual(0);
  expect(cornerCenter.y).toBeLessThan(700);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(3);

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
    audioPlayCount: 3,
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
