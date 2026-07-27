export function Toolbar({
  settingsToggleRef,
  isSettingsOpen,
  onToggleSettings,
  settingsUiEnabled = true,
  settingsAvailable,
}) {
  return (
    <>
      {settingsUiEnabled ? (
        <button
          ref={settingsToggleRef}
          className="settings-toggle"
          type="button"
          aria-controls="settings-panel"
          aria-expanded={String(isSettingsOpen)}
          aria-label="Параметры"
          title="Параметры"
          onClick={onToggleSettings}
          hidden={!settingsAvailable}
          disabled={!settingsAvailable}
        >
          ⚙
        </button>
      ) : null}
    </>
  );
}
