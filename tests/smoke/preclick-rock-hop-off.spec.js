const { test, expect } = require("@playwright/test");

const SOURCE_ROCK = "#root > .world > .rock";

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

async function rockCenter(page) {
  return page.locator(SOURCE_ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  });
}

test("выключенный эксперимент сохраняет непрерывный preclick parallax", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("session-status")).toContainText("В сессии");
  await scrollToRock(page);
  await page.evaluate(() => {
    params.preclickParallaxActivationRadiusVw = 10;
    params.preclickParallaxMaxOffsetVw = 5;
    params.preclickParallaxEndMaxOffsetVw = 5;
    params.preclickParallaxStartDelayMs = 0;
    params.preclickParallaxEndDelayMs = 0;
    params.preclickParallaxReturnDurationMs = 0;
  });

  const rock = page.locator(SOURCE_ROCK);
  await expect(rock).toHaveClass(/is-preclick-parallax/);
  await expect(rock).not.toHaveClass(/is-preclick-hop/);
  expect(await page.evaluate(() => window.__sisyphusTestApi.getPreclickHopState()))
    .toMatchObject({
      enabled: false,
      hopCount: 0,
      audioPlayCount: 0,
    });

  const initialCenter = await rockCenter(page);
  await page.mouse.move(initialCenter.x - 180, initialCenter.y);
  await page.mouse.move(initialCenter.x - 60, initialCenter.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => Math.abs(
          window.__sisyphusTestApi.getPreclickHopState().offset.x,
        ),
      ),
    )
    .toBeGreaterThan(0);
  const firstOffset = await page.evaluate(
    () => Math.abs(window.__sisyphusTestApi.getPreclickHopState().offset.x),
  );

  await page.mouse.move(initialCenter.x - 20, initialCenter.y);
  await expect
    .poll(() =>
      page.evaluate(
        () => Math.abs(
          window.__sisyphusTestApi.getPreclickHopState().offset.x,
        ),
      ),
    )
    .toBeGreaterThan(firstOffset);
  expect(await page.evaluate(() => window.__sisyphusTestApi.getPreclickHopState()))
    .toMatchObject({
      hopCount: 0,
      audioPlayCount: 0,
    });

  await page.mouse.move(0, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__sisyphusTestApi.getPreclickHopState().offset.x,
      ),
    )
    .toBe(0);
});
