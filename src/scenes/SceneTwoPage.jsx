import { ScenePage } from "../components/ScenePage";
import { SETTINGS_SCENES } from "../config/settings.mjs";

export function SceneTwoPage() {
  return (
    <ScenePage
      sceneId={SETTINGS_SCENES.TURNIP}
      sceneLabel="Сцена 2. Репка"
      nextSceneHref="/scene-3"
    />
  );
}
