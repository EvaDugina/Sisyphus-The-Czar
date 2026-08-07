export function Toolbar({ sessionRestartButtonRef }) {
  return (
    <button
      ref={sessionRestartButtonRef}
      className="session-restart session-restart--production"
      type="button"
      data-testid="restart-session"
    >
      Начать сначала
    </button>
  );
}
