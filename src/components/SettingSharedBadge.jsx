export function SettingSharedBadge({ sceneLabel }) {
  if (!sceneLabel) {
    return null;
  }
  const description = `Общий параметр для сцен ${sceneLabel}`;
  return (
    <span
      className="setting-shared-badge"
      aria-label={description}
      data-setting-shared-badge
      title={description}
    >
      Общий <span aria-hidden="true">{sceneLabel}</span>
    </span>
  );
}
