export function Toolbar({
  nextSceneHref,
  sessionPanelRef,
  sessionRestartButtonRef,
  sessionStatusRef,
}) {
  return (
    <section
      ref={sessionPanelRef}
      className="session-panel session-panel--toolbar"
      aria-label="Управление сценой"
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
      <a
        className="scene-next-link"
        href={nextSceneHref}
        data-testid="next-scene-link"
      >
        Следующая сцена: {nextSceneHref}
      </a>
    </section>
  );
}
