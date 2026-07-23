export function formatSettingsVersionSavedAt(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatSettingsVersionOptionLabel(entry) {
  const name = String(entry?.name || "").trim();
  if (!name) {
    return "";
  }
  const savedAt = formatSettingsVersionSavedAt(
    entry?.updatedAt || entry?.createdAt || "",
  );
  return savedAt ? `${name} — ${savedAt}` : name;
}
