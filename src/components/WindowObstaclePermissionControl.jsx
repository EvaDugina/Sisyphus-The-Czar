export function WindowObstaclePermissionControl() {
  return (
    <section
      className="window-obstacle-permission"
      aria-label="Разрешение всплывающих окон"
      data-window-obstacle-permission
    >
      <div className="window-obstacle-permission__row">
        <span>Разрешение popup</span>
        <output
          className="window-obstacle-permission__status"
          data-window-obstacle-popup-status
          data-state="unchecked"
          role="status"
          aria-live="polite"
        >
          Не проверено
        </output>
      </div>
      <button
        className="window-obstacle-permission__test"
        type="button"
        data-window-obstacle-popup-test
        data-hint="Открывает пустое тестовое окно. Если браузер его блокирует, разрешите всплывающие окна для сайта и повторите проверку."
      >
        Проверить открытие окна
      </button>
      <p
        className="window-obstacle-permission__help"
        data-window-obstacle-popup-help
        hidden
      >
        Браузер заблокировал popup. Разрешите всплывающие окна для этого сайта,
        затем повторите проверку.
      </p>
    </section>
  );
}
