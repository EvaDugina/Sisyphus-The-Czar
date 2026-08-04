export function normalizeSettingDependency(condition) {
  if (typeof condition === "string") {
    const name = condition.trim();
    return name ? { name, values: null } : null;
  }
  if (!condition || typeof condition !== "object") {
    return null;
  }
  const name = String(condition.name || "").trim();
  if (!name) {
    return null;
  }
  const values = Array.isArray(condition.values)
    ? condition.values.map((value) => String(value))
    : null;
  return { name, values };
}

export function serializeSettingDependency(condition) {
  const clean = normalizeSettingDependency(condition);
  if (!clean) {
    return undefined;
  }
  return clean.values === null
    ? clean.name
    : JSON.stringify({ name: clean.name, values: clean.values });
}

export function parseSettingDependencyAttribute(value) {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  if (source.startsWith("{")) {
    try {
      return normalizeSettingDependency(JSON.parse(source));
    } catch {
      return null;
    }
  }
  return normalizeSettingDependency(source);
}

export function settingDependencyMatches(condition, dependencyState = {}) {
  const clean = normalizeSettingDependency(condition);
  if (!clean) {
    return true;
  }
  if (clean.values !== null) {
    return clean.values.includes(String(dependencyState.value ?? ""));
  }
  return dependencyState.type === "checkbox"
    ? Boolean(dependencyState.checked)
    : Boolean(dependencyState.value);
}
