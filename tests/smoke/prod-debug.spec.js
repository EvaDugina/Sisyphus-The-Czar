const { test, expect } = require("@playwright/test");

const SETTINGS_STORAGE_KEY = "sisyphus-czar-settings-v56:cats-and-mice";
const VERSIONS_STORAGE_KEY =
  "sisyphus-czar-settings-versions-v1:cats-and-mice";

async function openSettingsPanel(page) {
  const toggle = page.locator(".settings-toggle");
  const panel = page.locator(".settings-panel");
  await expect(toggle).toBeVisible();
  if (!(await panel.evaluate((element) => element.classList.contains("is-open")))) {
    await toggle.click();
  }
  await expect(panel).toHaveClass(/is-open/);
}

async function setRangeValue(page, name, value) {
  await page.locator(`[name="${name}"]`).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("production DEBUG мгновенно применяет последний параметр во время отправки", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeAddEventListener = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function addEventListener(
      type,
      listener,
      options,
    ) {
      if (type !== "message") {
        return nativeAddEventListener.call(this, type, listener, options);
      }
      return nativeAddEventListener.call(
        this,
        type,
        function delayedSettingsApplied(event) {
          let message;
          try {
            message = JSON.parse(event.data);
          } catch {
            listener.call(this, event);
            return;
          }
          if (message.type === "settings.applied") {
            setTimeout(() => listener.call(this, event), 600);
            return;
          }
          listener.call(this, event);
        },
        options,
      );
    };
  });
  await page.goto("/");
  await expect(
    page.locator('[data-testid="session-status"][data-state="online"]'),
  ).toContainText("В сессии");
  await openSettingsPanel(page);
  await setRangeValue(page, "rockMinWidthVw", 27);
  await setRangeValue(page, "rockPulseShrinkPercent", 2.5);
  await page.locator(".settings-version-save").click();

  await page.waitForTimeout(200);
  await setRangeValue(page, "rockMinWidthVw", 28);
  await setRangeValue(page, "rockPulseShrinkPercent", 3.5);
  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("28");
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "3.5",
  );

  await page.waitForTimeout(700);
  await expect
    .poll(() =>
      page.evaluate((settingsKey) => {
        const stored = JSON.parse(localStorage.getItem(settingsKey) || "{}");
        return [stored.rockMinWidthVw, stored.rockPulseShrinkPercent];
      }, SETTINGS_STORAGE_KEY),
    )
    .toEqual([28, 3.5]);

  await expect(page.locator('[name="rockMinWidthVw"]')).toHaveValue("28");
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "3.5",
  );
});

test("stale realtime session creates a clean replacement session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__prodDebugSockets = [];
    window.WebSocket = class InstrumentedWebSocket extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        window.__prodDebugSockets.push(this);
      }
    };
  });
  await page.goto("/");
  await expect(
    page.locator('[data-testid="session-status"][data-state="online"]'),
  ).toHaveAttribute(
    "data-state",
    "online",
  );

  const originalSessionId = await page.evaluate(() => {
    const socket = window.__prodDebugSockets.at(-1);
    return socket ? new URL(socket.url).searchParams.get("session") : null;
  });
  expect(originalSessionId).toMatch(/^[A-Za-z0-9_-]{22}$/);
  await page.evaluate(() => {
    const socket = window.__prodDebugSockets.at(-1);
    if (!socket) {
      throw new Error("Production WebSocket не найден");
    }
    socket.close(4004, "session_not_found");
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const socket = window.__prodDebugSockets.at(-1);
        return socket ? new URL(socket.url).searchParams.get("session") : null;
      }),
    )
    .not.toBe(originalSessionId);
  await expect(
    page.locator('[data-testid="session-status"][data-state="online"]'),
  ).toHaveAttribute("data-state", "online");
});

test("production DEBUG включает UI, draft и изолированные возможности master", async ({
  browser,
  page,
}) => {
  const sessionSnapshots = [];
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "session.snapshot") {
          sessionSnapshots.push(message.payload);
        }
      } catch {
        // Не-JSON кадры не относятся к realtime-протоколу приложения.
      }
    });
  });
  await page.addInitScript(
    ({ settingsKey, versionsKey }) => {
      localStorage.setItem(
        settingsKey,
        JSON.stringify({
          rockPulseEnabled: false,
          rockPulseShrinkPercent: 5,
        }),
      );
      localStorage.setItem(
        versionsKey,
        JSON.stringify({
          selectedId: "older",
          entries: [
            {
              id: "older",
              name: "Старый",
              settingsSchemaVersion: 20,
              createdAt: "2026-07-24T10:00:00.000Z",
              updatedAt: "2026-07-24T10:00:00.000Z",
              settings: {
                rockPulseEnabled: false,
                rockPulseShrinkPercent: 4,
              },
            },
            {
              id: "latest",
              name: "Последний",
              settingsSchemaVersion: 20,
              createdAt: "2026-07-25T10:00:00.000Z",
              updatedAt: "2026-07-25T12:00:00.000Z",
              settings: {
                rockPulseEnabled: false,
                rockPulseShrinkPercent: 3,
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
  await expect
    .poll(() => sessionSnapshots.at(-1)?.roomSettings?.rockPulseEnabled)
    .toBe(true);
  await openSettingsPanel(page);
  await expect(page.locator("#settings-version-current")).toHaveText("Черновик");
  await expect(page.locator('[name="rockPulseEnabled"]')).toBeChecked();
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "1",
  );
  await page.locator(".settings-version-toggle").click();
  await expect(
    page.locator('[data-settings-version-choice="latest"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-settings-version-choice="older"]'),
  ).toHaveCount(0);
  await page.locator(".settings-version-toggle").click();

  await page.locator(".settings-version-name").fill("Серверная версия");
  await setRangeValue(page, "rockPulseShrinkPercent", 2.5);
  await page.locator(".settings-version-save").click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Общий шаблон сохранён",
  );
  await expect(page.locator("#settings-version-current")).toContainText(
    "Серверная версия",
  );
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "2.5",
  );
  const serverEntryId = await page.evaluate((versionsKey) => {
    const document = JSON.parse(localStorage.getItem(versionsKey) || "{}");
    return document.entries.find((entry) => entry.name === "Серверная версия")
      ?.id;
  }, VERSIONS_STORAGE_KEY);
  expect(serverEntryId).toMatch(/^scene-1--settings-version-/);

  await setRangeValue(page, "rockPulseShrinkPercent", 3.5);
  const pulseControl = page
    .locator('[name="rockPulseShrinkPercent"]')
    .locator("xpath=ancestor::*[@data-setting-control]");
  await expect(pulseControl).toHaveClass(/is-dirty/);
  await expect(page.locator("#settings-version-current")).toHaveText(
    "Черновик",
  );
  await expect(page.locator(".settings-version-save")).toHaveClass(/is-dirty/);
  await expect
    .poll(
      () =>
        sessionSnapshots.at(-1)?.roomSettings?.rockPulseShrinkPercent,
    )
    .toBe(3.5);

  let beforeUnloadConfirmed = false;
  page.once("dialog", async (dialog) => {
    beforeUnloadConfirmed = dialog.type() === "beforeunload";
    await dialog.accept();
  });
  await page.reload();
  expect(beforeUnloadConfirmed).toBe(true);
  await expect(page.locator('[name="rockPulseEnabled"]')).toBeChecked();
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "1",
  );
  await expect(page.locator("#settings-version-current")).toHaveText("Черновик");

  await page.locator(".settings-version-toggle").click();
  const productionButton = page.locator(
    `[data-production-preset-select="${serverEntryId}"]`,
  );
  await expect(productionButton).toBeEnabled();
  await page
    .locator(`[data-settings-version-choice="${serverEntryId}"]`)
    .click();
  await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
    "2.5",
  );

  await setRangeValue(page, "rockPulseShrinkPercent", 4);
  await page.locator(".settings-version-save").click();
  await expect(page.locator(".settings-production-status")).toContainText(
    "Общий шаблон сохранён",
  );
  const stored = await page.evaluate((versionsKey) => {
    const document = JSON.parse(localStorage.getItem(versionsKey) || "{}");
    return document.entries.find((entry) => entry.name === "Серверная версия");
  }, VERSIONS_STORAGE_KEY);
  expect(stored.id).toBe(serverEntryId);
  expect(stored.settings.rockPulseEnabled).toBe(true);
  expect(stored.settings.rockPulseShrinkPercent).toBe(4);

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  try {
    await second.goto("/");
    await expect(second.locator("body")).toHaveAttribute(
      "data-client-role",
      "master",
    );
    await openSettingsPanel(second);
    await second.locator(".settings-version-toggle").click();
    const secondProductionButton = second.locator(
      `[data-production-preset-select="${serverEntryId}"]`,
    );
    await expect(secondProductionButton).toBeEnabled();
    await second
      .locator(`[data-settings-version-choice="${serverEntryId}"]`)
      .click();
    await expect(second.locator("#settings-version-current")).toContainText(
      "Серверная версия",
    );
    await expect(
      second.locator('[name="rockPulseShrinkPercent"]'),
    ).toHaveValue("4");
    await setRangeValue(second, "rockPulseShrinkPercent", 4.3);
    await expect(
      second.locator('[name="rockPulseShrinkPercent"]'),
    ).toHaveValue("4.3");
    await expect(page.locator('[name="rockPulseShrinkPercent"]')).toHaveValue(
      "4",
    );
  } finally {
    await secondContext.close();
  }
});
