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
      parallax: {
        x: Number.parseFloat(style.getPropertyValue("--rock-parallax-x")) || 0,
        y: Number.parseFloat(style.getPropertyValue("--rock-parallax-y")) || 0,
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

test("экспериментальный камень прыгает накопительно и смеётся один раз на вход", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 1200 });
  await watchLaughPlayCalls(page);
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await page.waitForTimeout(250);
  await expect(page.locator("body")).toHaveClass(/preclick-rock-guidance/);
  await scrollToRock(page);

  const rock = page.locator(SOURCE_ROCK);
  await expect(rock).toHaveClass(/is-preclick-hop/);
  await page.evaluate(() => {
    params.preclickParallaxActivationRadiusVw = 5;
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
        return (
          rect.left >= -1 &&
          rect.right <= innerWidth + 1 &&
          rect.bottom <= innerHeight + 1
        );
      }),
    )
    .toBe(true);
  const clamped = await rock.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      viewportHeight: innerHeight,
      viewportWidth: innerWidth,
    };
  });
  expect(clamped.left).toBeGreaterThanOrEqual(-1);
  expect(clamped.right).toBeLessThanOrEqual(clamped.viewportWidth + 1);
  expect(clamped.bottom).toBeLessThanOrEqual(clamped.viewportHeight + 1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await rock.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).transitionDuration),
    ),
  ).toBeLessThan(0.01);

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
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.mouse.move(point.x, point.y);
  expect(await hopState(page)).toMatchObject({
    audioPlayCount: beforeGrab.audioPlayCount,
    hopCount: beforeGrab.hopCount,
  });
});
