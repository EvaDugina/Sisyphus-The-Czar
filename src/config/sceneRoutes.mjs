import { SETTINGS_SCENES } from "./settings.mjs";

export const SCENE_ROUTES = Object.freeze([
  Object.freeze({
    id: SETTINGS_SCENES.CATS_AND_MICE,
    number: 1,
    label: "Сцена 1. Кошки-мышки",
    path: "/scene-1",
    nextPath: "/scene-2",
  }),
  Object.freeze({
    id: SETTINGS_SCENES.TURNIP,
    number: 2,
    label: "Сцена 2. Репка",
    path: "/scene-2",
    nextPath: "/scene-3",
  }),
  Object.freeze({
    id: SETTINGS_SCENES.JUICES,
    number: 3,
    label: "Сцена 3. Соки",
    path: "/scene-3",
    nextPath: "/scene-1",
  }),
]);

const ROUTES_BY_PATH = new Map(SCENE_ROUTES.map((scene) => [scene.path, scene]));

export function normalizeScenePath(pathname) {
  const normalized = `/${String(pathname || "").replace(/^\/+|\/+$/g, "")}`;
  return normalized === "/" ? "/" : normalized;
}

export function sceneRouteForPath(pathname) {
  return ROUTES_BY_PATH.get(normalizeScenePath(pathname)) || null;
}

export function sceneRouteForId(sceneId) {
  return SCENE_ROUTES.find((scene) => scene.id === sceneId) || SCENE_ROUTES[0];
}

export function sceneStorageNamespace(sceneId) {
  return `scene-${sceneRouteForId(sceneId).number}`;
}
