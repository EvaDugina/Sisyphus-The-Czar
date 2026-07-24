export function Toolbar({ sessionShareToggleRef }) {
  return (
    <button
      ref={sessionShareToggleRef}
      className="session-share-toggle"
      type="button"
      data-testid="share-session-top"
      data-state="local"
      aria-label="Скопировать ссылку"
      title="Скопировать ссылку"
    >
      <svg data-share-icon="link" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
        <path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" />
      </svg>
      <svg data-share-icon="check" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 12 4 4L19 6" />
      </svg>
    </button>
  );
}
