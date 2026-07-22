import { SETTINGS_GROUPS } from "../config/settings.mjs";
import { SettingsControl } from "./SettingsControl";

export function SettingsPanel({
  panelRef,
  restartButtonRef,
  sessionStatusRef,
  isOpen,
}) {
  return (
    <aside
      ref={panelRef}
      className={`settings-panel${isOpen ? " is-open" : ""}`}
      id="settings-panel"
      aria-hidden={String(!isOpen)}
    >
      <section className="settings-versions" aria-label="Версии настроек">
        <label
          className="settings-versions__field"
          data-hint="Выбор версии сразу применяет сохранённые значения ко всем настройкам панели."
        >
          <span>Версия</span>
          <select className="settings-version-select" defaultValue="">
            <option value="">Черновик</option>
          </select>
        </label>
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
            aria-label="Сохранить версию настроек"
            title="Сохранить версию"
            data-hint="Сохраняет текущие настройки как новую версию или обновляет выбранную."
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 4h12l2 2v14H5z" />
              <path d="M8 4v6h8V4" />
              <path d="M8 16h8" />
            </svg>
          </button>
        </div>
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
        <button
          ref={restartButtonRef}
          className="session-restart"
          type="button"
          data-testid="restart-session"
          data-hint="Возвращает камень, отпечаток и траекторию в начало текущей комнаты."
        >
          Начать сначала
        </button>
      </section>

      {SETTINGS_GROUPS.map((group) => (
        <details className="control-group" key={group.title}>
          <summary>{group.title}</summary>
          {group.controls.map((control) => (
            <SettingsControl control={control} key={control.name} />
          ))}
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
      ))}
    </aside>
  );
}
