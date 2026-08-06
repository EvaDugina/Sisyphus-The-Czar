const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";
const SOURCE_HAND = "#root > .world > .hand-cursor:not(.is-remote)";

async function visibleRockPoint(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, innerWidth);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, innerHeight);

    for (const yRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const xRatio of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const x = left + (right - left) * xRatio;
        const y = top + (bottom - top) * yRatio;
        if (document.elementFromPoint(x, y) === rock) {
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
    window.scrollTo(
      0,
      Math.max(
        0,
        window.scrollY + rect.top + rect.height / 2 - window.innerHeight * 0.45,
      ),
    );
  });
  await expect.poll(() => visibleRockPoint(page).then(() => true)).toBe(true);
}

function parallaxX(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) =>
    Number.parseFloat(
      getComputedStyle(rock).getPropertyValue("--rock-parallax-x"),
    ),
  );
}

function handPosition(page) {
  return page.locator(SOURCE_HAND).evaluate((hand) => {
    const style = getComputedStyle(hand);
    return {
      x: Number.parseFloat(style.getPropertyValue("--cursor-x")),
      y: Number.parseFloat(style.getPropertyValue("--cursor-y")),
    };
  });
}

function rockSize(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
}

function rockCenter(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const style = getComputedStyle(rock);
    const offsetX = Number.parseFloat(
      style.getPropertyValue("--rock-parallax-x"),
    ) || 0;
    const offsetY = Number.parseFloat(
      style.getPropertyValue("--rock-parallax-y"),
    ) || 0;
    return {
      x: rect.left + rect.width / 2 - offsetX,
      y: rect.top + rect.height / 2 - offsetY,
    };
  });
}

test("flag включает parallax до первого клика и постоянную руку", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 2400, height: 1400 });
  await page.goto("/");
  await expect(page.locator("body")).toHaveClass(/state-play/);
  await expect(page.locator("body")).toHaveClass(
    /experiment-preclick-rock-guidance/,
  );

  const rock = page.locator(SOURCE_ROCK);
  const hand = page.locator(SOURCE_HAND);
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await expect(hand).toHaveClass(/is-visible/);

  const viewport = page.viewportSize();
  await page.mouse.move(24, 24);
  await expect.poll(() => parallaxX(page)).toBe(0);
  await expect(hand).toHaveClass(/is-visible/);

  await page.mouse.down();
  await expect(hand).toHaveClass(/is-grabbing/);
  expect(
    decodeURIComponent(
      await hand.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ),
  ).toContain("cursor-grabbing");
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);
  expect(
    decodeURIComponent(
      await hand.evaluate(
        (element) => getComputedStyle(element).backgroundImage,
      ),
    ),
  ).toContain("cursor-grab");
  await expect(rock).toHaveClass(/is-preclick-parallax/);

  await scrollToRock(page);
  const center = await rockCenter(page);
  const halfRadius = 500;
  await page.mouse.move(center.x - halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(-6, 3);
  const sizeAtLeft = await rockSize(page);

  await page.mouse.move(center.x + halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(6, 3);
  await expect
    .poll(async () => {
      const sizeAtRight = await rockSize(page);
      return {
        widthDelta: Math.abs(sizeAtRight.width - sizeAtLeft.width),
        heightDelta: Math.abs(sizeAtRight.height - sizeAtLeft.height),
      };
    })
    .toEqual({ widthDelta: 0, heightDelta: 0 });

  const outsideX = center.x + 1100 < viewport.width
    ? center.x + 1100
    : center.x - 1100;
  await page.mouse.move(outsideX, center.y);
  expect(Math.abs(await parallaxX(page))).toBeGreaterThan(0);
  await page.waitForTimeout(50);
  const returningOffset = Math.abs(await parallaxX(page));
  expect(returningOffset).toBeGreaterThan(0);
  expect(returningOffset).toBeLessThan(6);
  const handOutside = await handPosition(page);
  expect(handOutside.x).toBeCloseTo(outsideX, 3);
  expect(handOutside.y).toBeCloseTo(center.y, 3);
  await expect.poll(async () => Math.abs(await parallaxX(page)), {
    timeout: 1000,
  }).toBeCloseTo(0, 3);

  await page.mouse.move(center.x + halfRadius, center.y);
  await expect.poll(() => parallaxX(page)).toBeCloseTo(6, 3);
  await page.screenshot({
    path: testInfo.outputPath("before-first-click.png"),
  });

  const point = await visibleRockPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(rock).not.toHaveClass(/is-preclick-parallax/);
  await expect(hand).toHaveClass(/is-grabbing/);
  await expect.poll(() => parallaxX(page)).toBe(0);

  await page.mouse.up();
  await page.mouse.move(24, 24);
  await expect(hand).toHaveClass(/is-visible/);
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await expect(rock).not.toHaveClass(/is-preclick-parallax/);

  await page.mouse.down();
  await expect(hand).toHaveClass(/is-grabbing/);
  await page.mouse.up();
  await expect(hand).not.toHaveClass(/is-grabbing/);
  await page.screenshot({
    path: testInfo.outputPath("after-first-click.png"),
  });
});
