const { test, expect } = require("@playwright/test");

const MODE = process.env.COMPOSE_SMOKE_MODE || "prod";
const CLIENT_ID = "00000000-0000-4000-8000-000000018082";
const VERSION_ID = "compose-production-preset";
const VERSION_UPDATED_AT = "2026-07-26T12:00:00.000Z";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(
    ({ clientId, mode, updatedAt, versionId }) => {
      sessionStorage.setItem("sisyphus-client-id", clientId);
      if (mode === "prod") {
        return;
      }
      localStorage.setItem(
        "sisyphus-czar-settings-versions-v1",
        JSON.stringify({
          selectedId: versionId,
          entries: [
            {
              id: versionId,
              name: "Compose preset",
              settingsSchemaVersion: 18,
              createdAt: updatedAt,
              updatedAt,
              settings: {
                gravity: 6.5,
                sceneHeightScreens: 14,
              },
            },
          ],
        }),
      );
    },
    {
      clientId: CLIENT_ID,
      mode: MODE,
      updatedAt: VERSION_UPDATED_AT,
      versionId: VERSION_ID,
    },
  );
});

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

test(`compose lifecycle: ${MODE}`, async ({ page }) => {
  await page.goto("/");

  if (MODE === "dev") {
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    await openSettingsPanel(page);
    await expect(page.locator("#settings-version-current")).toContainText(
      "Compose preset",
    );
    await setRangeValue(page, "gravity", 7);
    await expect(
      page
        .locator('[name="gravity"]')
        .locator("xpath=ancestor::*[@data-setting-control]"),
    ).toHaveClass(/is-dirty/);

    let confirmed = false;
    page.once("dialog", async (dialog) => {
      confirmed = dialog.type() === "beforeunload";
      await dialog.accept();
    });
    await page.reload();
    expect(confirmed).toBe(true);

    await openSettingsPanel(page);
    await page.locator(".settings-version-toggle").click();
    await page
      .locator(`[data-production-preset-select="${VERSION_ID}"]`)
      .click();
    await expect(page.locator(".settings-production-status")).toContainText(
      "Production: Compose preset",
    );
    return;
  }

  if (MODE === "debug") {
    await expect(page.getByTestId("session-status")).toContainText("В сессии");
    await openSettingsPanel(page);
    expect(
      await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi")),
    ).toBe(false);
    await expect(page.locator(".settings-production-status")).toContainText(
      "Production: Compose preset",
    );
    await page.locator(".settings-version-toggle").click();
    await expect(
      page.locator(
        `.settings-version-option.is-production [data-production-preset-select="${VERSION_ID}"]`,
      ),
    ).toBeVisible();
    return;
  }

  await expect(page.locator("#root > .world > .rock")).toBeVisible();
  await expect(page.locator(".settings-toggle")).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.hasOwn(window, "__sisyphusTestApi")),
  ).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--scene-height-vh")
          .trim(),
      ),
    )
    .toBe("1400vh");
});
