export function Toolbar({
  settingsLinkRef,
  sessionRestartButtonRef,
  sessionStatusRef,
  settingsUiEnabled = true,
  settingsAvailable,
}) {
  return (
    <>
      {settingsUiEnabled ? (
        <a
          ref={settingsLinkRef}
          className="settings-toggle settings-link"
          href="/settings/"
          aria-label="Параметры"
          title="Параметры"
          hidden={!settingsAvailable}
        >
          ⚙
        </a>
      ) : null}
      <section
        className="session-panel session-panel--toolbar"
        aria-label="Совместная сессия"
      >
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
          ref={sessionRestartButtonRef}
          className="session-restart"
          type="button"
          data-testid="restart-session"
        >
          Начать сначала
        </button>
      </section>
    </>
  );
}
