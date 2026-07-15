import { SETTINGS_GROUPS } from "../config/settings";
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
