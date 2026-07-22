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
          data-hint="Название для новой или выбранной версии всех настроек панели."
        >
          <span>Название версии</span>
          <input
            className="settings-version-name"
            type="text"
            placeholder="Авто: дата и время"
            autoComplete="off"
          />
        </label>
        <div className="settings-versions__actions">
          <button className="settings-version-save" type="button">
            Сохранить
          </button>
          <button className="settings-version-rename" type="button">
            Переименовать
          </button>
        </div>
        <label
          className="settings-versions__field"
          data-hint="Выбор версии сразу применяет сохранённые значения ко всем настройкам панели."
        >
          <span>Версии</span>
          <select className="settings-version-select" defaultValue="">
            <option value="">Нет сохранённых</option>
          </select>
        </label>
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
          data-hint="Возвращает камень, отпечаток и след в начало текущей комнаты."
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
