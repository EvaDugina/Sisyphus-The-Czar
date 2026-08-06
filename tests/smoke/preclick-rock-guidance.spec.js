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

test("flag включает parallax до первого клика и постоянную руку", async ({
  page,
}, testInfo) => {
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
  await page.mouse.move(24, viewport.height / 2);
  await expect.poll(() => parallaxX(page)).toBeLessThan(0);
  await expect(hand).toHaveClass(/is-visible/);

  await page.mouse.move(viewport.width - 24, viewport.height / 2);
  await expect.poll(() => parallaxX(page)).toBeGreaterThan(0);
  await page.screenshot({
    path: testInfo.outputPath("before-first-click.png"),
  });

  await scrollToRock(page);
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
  await page.screenshot({
    path: testInfo.outputPath("after-first-click.png"),
  });
});
