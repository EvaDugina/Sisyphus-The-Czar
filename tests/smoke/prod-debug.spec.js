const { test, expect } = require("@playwright/test");

const SETTINGS_STORAGE_KEY = "sisyphus-czar-settings-v18";
const VERSIONS_STORAGE_KEY = "sisyphus-czar-settings-versions-v1";

async function openSettingsPanel(page) {
  const toggle = page.locator(".settings-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator(".settings-panel")).toHaveClass(/is-open/);
}

async function setRangeValue(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("production DEBUG включает UI, draft и выбор следующего preset", async ({
  browser,
  page,
}) => {
  await page.addInitScript(
    ({ settingsKey, versionsKey }) => {
      localStorage.setItem(settingsKey, JSON.stringify({ gravity: 3 }));
      localStorage.setItem(
        versionsKey,
        JSON.stringify({
          selectedId: "older",
          entries: [
            {
              id: "older",
              name: "Старый",
              settingsSchemaVersion: 18,
              createdAt: "2026-07-24T10:00:00.000Z",
              updatedAt: "2026-07-24T10:00:00.000Z",
              settings: {
                gravity: 5,
                sceneHeightScreens: 8,
              },
            },
            {
              id: "latest",
              name: "Последний",
              settingsSchemaVersion: 18,
              createdAt: "2026-07-25T10:00:00.000Z",
              updatedAt: "2026-07-25T12:00:00.000Z",
              settings: {
                gravity: 7.5,
                sceneHeightScreens: 12,
              },
            },
          ],
        }),
      );
    },
    {
      settingsKey: SETTINGS_STORAGE_KEY,
      versionsKey: VERSIONS_STORAGE_KEY,
    },
  );

  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute(
    "data-client-role",
    "master",
  );
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi")),
  ).toBe(false);
  await openSettingsPanel(page);
  await expect(page.locator("#settings-version-current")).toContainText(
    "Последний",
  );
  await expect(page.locator('[name="gravity"]')).toHaveValue("7.5");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--scene-height-vh")
          .trim(),
      ),
    )
    .toBe("1200vh");

  await setRangeValue(page, "gravity", 8.5);
  const gravityControl = page
    .locator('[name="gravity"]')
    .locator("xpath=ancestor::*[@data-setting-control]");
  await expect(gravityControl).toHaveClass(/is-dirty/);
  await expect(page.locator("#settings-version-current")).toHaveText(
    "Черновик",
  );
  await expect(page.locator(".settings-version-save")).toHaveClass(/is-dirty/);

  let beforeUnloadConfirmed = false;
  page.once("dialog", async (dialog) => {
    beforeUnloadConfirmed = dialog.type() === "beforeunload";
    await dialog.accept();
  });
  await page.reload();
  expect(beforeUnloadConfirmed).toBe(true);
  await openSettingsPanel(page);
  await expect(page.locator('[name="gravity"]')).toHaveValue("7.5");
  await expect(gravityControl).not.toHaveClass(/is-dirty/);

  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(
    '[data-production-preset-select="latest"]',
  );
  await expect(productionButton).toBeEnabled();
  await productionButton.click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production: Последний",
  );
  await page.locator(".settings-version-toggle").click();

  await setRangeValue(page, "gravity", 9);
  await page.locator(".settings-version-save").click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Production: Последний",
  );
  await page.locator(".settings-version-toggle").click();
  await expect(
    page.locator(
      '.settings-version-option.is-production [data-production-preset-select="latest"]',
    ),
  ).toBeVisible();
  const stored = await page.evaluate((versionsKey) => {
    const document = JSON.parse(localStorage.getItem(versionsKey) || "{}");
    return document.entries.find((entry) => entry.id === "latest");
  }, VERSIONS_STORAGE_KEY);
  expect(stored.settings.gravity).toBe(9);
  expect(Date.parse(stored.updatedAt)).toBeGreaterThan(
    Date.parse("2026-07-25T12:00:00.000Z"),
  );

  const slaveContext = await browser.newContext();
  const slave = await slaveContext.newPage();
  try {
    await slave.goto("/");
    await expect(slave.locator("body")).toHaveAttribute(
      "data-client-role",
      "slave",
    );
    await openSettingsPanel(slave);
    await expect(slave.locator("#settings-version-current")).toContainText(
      "Последний",
    );
    await setRangeValue(slave, "gravity", 8.25);
    await expect(page.locator('[name="gravity"]')).toHaveValue("8.25");

    await slave.locator(".settings-version-toggle").click();
    const slaveProductionButton = slave.locator(
      '[data-production-preset-select="latest"]',
    );
    await expect(slaveProductionButton).toBeEnabled();
    await slaveProductionButton.click();
    await expect(page.locator(".settings-production-status")).toContainText(
      "Production: Последний",
    );
  } finally {
    await slaveContext.close();
  }
});
