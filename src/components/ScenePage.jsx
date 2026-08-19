import { FoldLayer } from "./FoldLayer";
import { Scene } from "./Scene";
import { SettingsPanel } from "./SettingsPanel";
import { Toolbar } from "./Toolbar";
import { useSisyphusExperience } from "../hooks/useSisyphusExperience";

export function ScenePage({ sceneId, sceneLabel, nextSceneHref }) {
  const experience = useSisyphusExperience(sceneId);
  const { fold, settings, realtime, scene, trail, rain } = experience;
  const settingsUiEnabled =
    import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true";

  return (
    <div className="scene-page" data-scene-page={sceneId}>
      <Toolbar
        nextSceneHref={nextSceneHref}
        sessionPanelRef={realtime.sessionPanelRef}
        sessionRestartButtonRef={realtime.sessionRestartButtonRef}
        sessionStatusRef={realtime.sessionStatusRef}
      />
      {settingsUiEnabled ? (
        <>
          <SettingsPanel
            panelRef={settings.settingsPanelRef}
            sceneId={sceneId}
            sceneLabel={sceneLabel}
            sessionStatusRef={settings.settingsStatusRef}
            isOpen
            settingsAvailable
          />
          <div
            ref={scene.hintRef}
            className="hint"
            role="tooltip"
            aria-hidden="true"
          />
        </>
      ) : null}
      <Scene scene={scene} trail={trail} rain={rain} />
      <FoldLayer settingsRef={fold.settingsRef} worldRef={scene.worldRef} />
    </div>
  );
}
