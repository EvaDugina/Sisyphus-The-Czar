function versionTimestamp(entry) {
  const value = Date.parse(entry?.updatedAt || entry?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function compareSettingsVersionEntries(left, right) {
  const timestampDelta = versionTimestamp(left) - versionTimestamp(right);
  if (timestampDelta !== 0) {
    return timestampDelta;
  }
  return String(left?.id || "").localeCompare(String(right?.id || ""));
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
    return compareSettingsVersionEntries(entry, latest) > 0 ? entry : latest;
  }, null);
}

export function settingsFromLatestVersionEntry(entries) {
  const latest = selectLatestSettingsVersionEntry(entries);
  return latest?.settings && typeof latest.settings === "object"
    ? { ...latest.settings }
    : null;
}
