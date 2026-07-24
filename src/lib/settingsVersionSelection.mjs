function versionTimestamp(entry) {
  const value = Date.parse(entry?.updatedAt || entry?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

export function selectLatestSettingsVersionEntry(entries) {
  if (!Array.isArray(entries)) {
    return null;
  }
  return entries.reduce((latest, entry) => {
    if (!entry || typeof entry !== "object") {
      return latest;
    }
    if (!latest) {
      return entry;
    }
    return versionTimestamp(entry) >= versionTimestamp(latest) ? entry : latest;
  }, null);
}

export function settingsFromLatestVersionEntry(entries) {
  const latest = selectLatestSettingsVersionEntry(entries);
  return latest?.settings && typeof latest.settings === "object"
    ? { ...latest.settings }
    : null;
}
