const { test, expect } = require("@playwright/test");

const ROCK = "#root > .scene-page > .world > .rock";
const HAND = "#root > .scene-page > .world > .hand-cursor:not(.is-remote)";

async function waitForScene(page, path) {
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(page.locator("body")).toHaveAttribute("data-scene", path.slice(1));
  await expect(page.locator("body")).toHaveAttribute("data-client-role", "master");
  await expect(page.locator(ROCK)).toBeVisible();
}

async function visibleRockPoint(page) {
  return page.locator(ROCK).evaluate((rock) => {
    const rect = rock.getBoundingClientRect();
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (hit !== rock && !rock.contains(hit)) {
      throw new Error("Центр камня не доступен для нажатия");
    }
    return { x, y };
  });
}

async function moveToVisibleRock(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const point = await visibleRockPoint(page);
    await page.mouse.move(point.x, point.y);
    const stillHitsRock = await page.locator(ROCK).evaluate(
      (rock, target) => new Promise((resolve) => {
        requestAnimationFrame(() => {
          const hit = document.elementFromPoint(target.x, target.y);
          resolve(hit === rock || rock.contains(hit));
        });
      }),
      point,
    );
    if (stillHitsRock) {
      return point;
    }
    await page.waitForTimeout(100);
  }
  throw new Error("Не удалось стабилизировать точку настоящего нажатия");
}

test("production предоставляет три независимые scene page", async ({ page }) => {
  const scenes = [
    ["/scene-1", "/scene-2"],
    ["/scene-2", "/scene-3"],
    ["/scene-3", "/scene-1"],
  ];

  for (const [path, nextPath] of scenes) {
    await waitForScene(page, path);
    await expect(page.locator("#root > .scene-page")).toHaveCount(1);
    await expect(page.locator("#root > .scene-page > .world")).toHaveCount(1);
    await expect(page.locator(".settings-panel")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Начать сначала" })).toBeVisible();
    await expect(page.getByTestId("next-scene-link")).toHaveAttribute("href", nextPath);
    expect(await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi"))).toBe(false);
  }
});

test("root и settings ведут к первой сцене, slash канонизируется", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/scene-1$/);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/scene-1$/);
  await page.goto("/scene-2/");
  await expect(page).toHaveURL(/\/scene-2$/);
});

test("scene 1 завершается на первом настоящем нажатии и restart сбрасывает её", async ({ page }) => {
  await waitForScene(page, "/scene-1");
  const rock = page.locator(ROCK);
  await expect(rock).toHaveClass(/is-preclick-hop/);

  const fakePoint = await visibleRockPoint(page);
  await page.mouse.click(fakePoint.x, fakePoint.y);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");
  await expect(rock).not.toHaveClass(/is-dragging/);

  await page.waitForTimeout(900);
  await moveToVisibleRock(page);
  await page.mouse.down();
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "true");
  await expect(page.locator("body")).toHaveAttribute(
    "data-scene-completion-reason",
    "first-real-rock-press",
  );
  await expect(page).toHaveURL(/\/scene-1$/);
  await page.mouse.up();

  await page.getByRole("button", { name: "Начать сначала" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");
  await expect(rock).toHaveClass(/is-preclick-hop/);
});

test("scene 2 стартует подвешенной в центре и первый клик сохраняет захват", async ({ page }) => {
  await waitForScene(page, "/scene-2");
  const rock = page.locator(ROCK);
  const viewport = page.viewportSize();
  const initial = await rock.boundingBox();
  expect(initial.x + initial.width / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(initial.y + initial.height / 2).toBeCloseTo(viewport.height / 2, 0);

  await page.waitForTimeout(250);
  const suspended = await rock.boundingBox();
  expect(suspended.y).toBeCloseTo(initial.y, 0);
  const point = await visibleRockPoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await expect(rock).toHaveClass(/is-dragging/);
  await expect(page.locator(HAND)).toHaveClass(/is-grabbing/);
  await expect(page.locator("body")).toHaveAttribute("data-scene-complete", "false");
  await page.mouse.move(point.x + 40, point.y - 40, { steps: 5 });
  await expect(rock).toHaveClass(/is-dragging/);
  await page.mouse.up();
});

test("scene 3 сразу показывает вершину, камень в руке и циклическую ссылку", async ({ page }) => {
  await waitForScene(page, "/scene-3");
  await expect(page.getByTestId("rock-imprint").first()).toBeVisible();
  await expect(page.locator(ROCK)).toHaveClass(/is-scene-start-held/);
  await expect(page.locator(HAND)).toHaveClass(/is-visible/);
  await expect(page.locator(HAND)).toHaveClass(/is-grabbing/);
  await expect(page.getByTestId("next-scene-link")).toHaveAttribute("href", "/scene-1");
  expect(await page.evaluate(() => scrollY)).toBeLessThan(32);
});

test("production legacy drafts маршруты возвращают 404", async ({ request }) => {
  for (const path of ["/drafts", "/drafts/", "/drafts/assets/missing.js"]) {
    expect((await request.get(path)).status()).toBe(404);
  }
});
