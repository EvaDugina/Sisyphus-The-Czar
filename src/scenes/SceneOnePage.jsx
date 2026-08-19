import { ScenePage } from "../components/ScenePage";
import { SETTINGS_SCENES } from "../config/settings.mjs";

export function SceneOnePage() {
  return (
    <ScenePage
      sceneId={SETTINGS_SCENES.CATS_AND_MICE}
      sceneLabel="Сцена 1. Кошки-мышки"
      nextSceneHref="/scene-2"
    />
  );
}
