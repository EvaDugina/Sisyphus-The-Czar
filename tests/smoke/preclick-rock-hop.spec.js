const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";

async function watchLaughPlayCalls(page) {
  await page.addInitScript(() => {
    window.__laughPlayCount = 0;
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
  expect(beforeGrab.audioPlayCount).toBe(beforeGrab.hopCount);
  expect(beforeGrab.activeAudioCount).toBe(beforeGrab.hopCount);
  expect(await page.evaluate(() => window.__laughPlayCount)).toBe(
    beforeGrab.hopCount,
  );
  await page.mouse.down();
  await expect(rock).not.toHaveClass(/is-preclick-hop/);
  await expect.poll(() => hopState(page)).toMatchObject({
    activeAudioCount: beforeGrab.activeAudioCount,
    completed: true,
    hopCount: beforeGrab.hopCount,
    offset: { x: 0, y: 0 },
  });
  await page.mouse.up();
  await page.mouse.move(10, 10);
  await page.mouse.move(point.x, point.y);
  expect(await hopState(page)).toMatchObject({
    audioPlayCount: beforeGrab.audioPlayCount,
    hopCount: beforeGrab.hopCount,
  });
});
