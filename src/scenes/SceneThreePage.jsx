import { ScenePage } from "../components/ScenePage";
import { SETTINGS_SCENES } from "../config/settings.mjs";

export function SceneThreePage() {
  return (
    <ScenePage
      sceneId={SETTINGS_SCENES.JUICES}
      sceneLabel="Сцена 3. Соки"
      nextSceneHref="/scene-1"
    />
  );
}
