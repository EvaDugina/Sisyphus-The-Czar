import { createRoot } from "react-dom/client";
import { appPath, stripAppBasePath } from "./config/appBasePath.mjs";
import { sceneRouteForPath } from "./config/sceneRoutes.mjs";
import { SceneOnePage } from "./scenes/SceneOnePage";
import { SceneTwoPage } from "./scenes/SceneTwoPage";
import { SceneThreePage } from "./scenes/SceneThreePage";
import "./styles/base.css";
import "./styles/controls.css";
import "./styles/fold.css";
import "./styles/scene.css";

const route = sceneRouteForPath(stripAppBasePath(window.location.pathname));

if (!route) {
  window.location.replace(
    `${appPath("/scene-1")}${window.location.search}${window.location.hash}`,
  );
} else {
  const SceneComponent = {
    1: SceneOnePage,
    2: SceneTwoPage,
    3: SceneThreePage,
  }[route.number];
  createRoot(document.getElementById("root")).render(<SceneComponent />);
}
