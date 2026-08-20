import { useEffect, useRef } from "react";
import {
  settingsGroupsForScene,
  settingsGroupControls,
} from "../config/settings.mjs";
import { GOGH_ARTWORK_OPTIONS } from "../config/goghArtworks.mjs";
import { SettingsControl } from "./SettingsControl";

function panelWidthBounds(panel) {
  const style = getComputedStyle(panel);
  const minWidth = Number.parseFloat(style.minWidth) || 0;
  const maxWidth = Number.parseFloat(style.maxWidth) || window.innerWidth;
  return { minWidth, maxWidth };
}

export function SettingsPanel({
  panelRef,
  sceneId,
  sceneLabel,
  sessionStatusRef,
  isOpen,
  settingsAvailable,
}) {
  const sceneGroups = settingsGroupsForScene(sceneId, {
    goghArtworkOptions: GOGH_ARTWORK_OPTIONS,
  });
  const resizeStateRef = useRef(null);

  useEffect(() => {
    function movePanelResize(event) {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      const { minWidth, maxWidth } = panelWidthBounds(state.panel);
      const width = state.startWidth + state.startX - event.clientX;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, width));
      state.panel.style.setProperty(
        "--settings-panel-width",
        `${nextWidth}px`,
      );
      state.handle.setAttribute("aria-valuenow", String(Math.round(nextWidth)));
    }

    function endPanelResize(event) {
      const state = resizeStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      state.panel.classList.remove("is-resizing");
      resizeStateRef.current = null;
    }

    window.addEventListener("pointermove", movePanelResize);
    window.addEventListener("pointerup", endPanelResize);
    window.addEventListener("pointercancel", endPanelResize);
    return () => {
      window.removeEventListener("pointermove", movePanelResize);
      window.removeEventListener("pointerup", endPanelResize);
      window.removeEventListener("pointercancel", endPanelResize);
      resizeStateRef.current?.panel.classList.remove("is-resizing");
      resizeStateRef.current = null;
    };
  }, []);

  function applyPanelWidth(panel, handle, width) {
    const { minWidth, maxWidth } = panelWidthBounds(panel);
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, width));
    panel.style.setProperty("--settings-panel-width", `${nextWidth}px`);
    handle.setAttribute("aria-valuenow", String(Math.round(nextWidth)));
  }

  function beginPanelResize(event) {
    if (event.button !== 0) {
      return;
    }
    const handle = event.currentTarget;
    const panel = handle.closest(".settings-panel");
    if (!panel) {
      return;
    }
    event.preventDefault();
    resizeStateRef.current = {
      handle,
      panel,
      pointerId: event.pointerId,
      startWidth: panel.getBoundingClientRect().width,
      startX: event.clientX,
    };
    panel.classList.add("is-resizing");
  }

  function resizePanelWithKeyboard(event) {
    const direction = event.key === "ArrowLeft"
      ? 1
      : event.key === "ArrowRight"
        ? -1
        : 0;
    if (!direction) {
      return;
    }
    const handle = event.currentTarget;
    const panel = handle.closest(".settings-panel");
    if (!panel) {
      return;
    }
    event.preventDefault();
    applyPanelWidth(
      panel,
      handle,
      panel.getBoundingClientRect().width + direction * 16,
    );
  }

  return (
    <aside
      ref={panelRef}
      className={`settings-panel${isOpen ? " is-open" : ""}`}
      id="settings-panel"
      aria-hidden={String(!settingsAvailable || !isOpen)}
      hidden={!settingsAvailable}
      data-settings-scene={sceneId}
    >
      <div
        className="settings-panel__resize-handle"
        role="separator"
        aria-controls="settings-panel"
        aria-label="Изменить ширину панели параметров"
        aria-orientation="vertical"
        tabIndex="0"
        onKeyDown={resizePanelWithKeyboard}
        onPointerDown={beginPanelResize}
      />
      <div className="settings-panel__scroll">
        <h2 className="settings-panel__scene-title">Параметры · {sceneLabel}</h2>

        <section className="settings-versions" aria-label="Версии настроек">
        <div
          className="settings-versions__field"
          data-hint="Выбор версии сразу применяет сохранённые значения ко всем настройкам панели."
        >
          <span id="settings-version-label">Версия</span>
          <div className="settings-version-dropdown">
            <button
              className="settings-version-toggle"
              type="button"
              aria-haspopup="menu"
              aria-expanded="false"
              aria-labelledby="settings-version-label settings-version-current"
              data-hint="Открывает список сохранённых версий настроек."
            >
              <span id="settings-version-current">Черновик</span>
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <div
              className="settings-version-menu"
              role="menu"
              aria-labelledby="settings-version-label"
              hidden
            />
          </div>
        </div>
        <div
          className="settings-versions__save"
          data-hint="Название для новой или выбранной версии всех настроек панели."
        >
          <input
            className="settings-version-name"
            type="text"
            placeholder="Название версии"
            aria-label="Название версии настроек"
            autoComplete="off"
          />
          <button
            className="settings-version-save"
            type="button"
            aria-label="Сохранить версию и настройки комнаты"
            title="Сохранить версию и настройки комнаты"
            data-hint="Сохраняет или обновляет версию и применяет текущие настройки ко всей комнате."
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 4h12l2 2v14H5z" />
              <path d="M8 4v6h8V4" />
              <path d="M8 16h8" />
            </svg>
          </button>
        </div>
        <p
          className="settings-production-status"
          role="status"
          aria-live="polite"
        />
        </section>

        <section className="session-panel" aria-label="Совместная сессия">
        <div
          ref={sessionStatusRef}
          className="session-state"
          data-session-status
          data-state="local"
          data-testid="session-status"
          aria-live="polite"
        >
          Локальная сессия
        </div>
        </section>

        {sceneGroups.map((group) => {
          return (
            <details
              className="control-group"
              key={group.title}
            >
            <summary>{group.title}</summary>
            {group.controls?.length
              ? group.controls.map((control) => (
                  <SettingsControl
                    control={control}
                    key={control.name}
                  />
                ))
              : null}
            {group.subgroups?.map((subgroup) => {
              return (
                <details
                  className="control-subgroup"
                  key={subgroup.title}
                  aria-label={`${group.title}: ${subgroup.title}`}
                  open
                >
                  <summary>{subgroup.title}</summary>
                  {settingsGroupControls(subgroup).map((control) => (
                    <SettingsControl
                      control={control}
                      key={control.name}
                    />
                  ))}
                </details>
              );
            })}
            {group.action && (
              <button
                className={group.action.className}
                type="button"
                data-hint={group.action.hint}
              >
                {group.action.label}
              </button>
            )}
            </details>
          );
        })}
      </div>
    </aside>
  );
}
