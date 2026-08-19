export function Toolbar({ nextSceneHref, sessionRestartButtonRef }) {
  return (
    <nav className="scene-actions scene-actions--production" aria-label="Управление сценой">
      <button
        ref={sessionRestartButtonRef}
        className="session-restart session-restart--production"
        type="button"
        data-testid="restart-session"
      >
        Начать сначала
      </button>
      <a
        className="scene-next-link scene-next-link--production"
        href={nextSceneHref}
        data-testid="next-scene-link"
      >
        Следующая сцена: {nextSceneHref}
      </a>
    </nav>
  );
}
