export function normalizeAppBasePath(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "";
}

export const APP_BASE_PATH = normalizeAppBasePath(
  import.meta.env?.VITE_BASE_PATH || "",
);

export function appPath(pathname = "/") {
  const normalizedPath = `/${String(pathname || "").replace(/^\/+/, "")}`;
  return `${APP_BASE_PATH}${normalizedPath}`;
}

export function stripAppBasePath(pathname) {
  const normalizedPath = `/${String(pathname || "").replace(/^\/+|\/+$/g, "")}`;
  if (!APP_BASE_PATH) {
    return normalizedPath;
  }
  if (normalizedPath === APP_BASE_PATH) {
    return "/";
  }
  if (!normalizedPath.startsWith(`${APP_BASE_PATH}/`)) {
    return null;
  }
  return normalizedPath.slice(APP_BASE_PATH.length) || "/";
}
