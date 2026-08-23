import { useState } from "react";
import { FoldLayer } from "./FoldLayer";
import { Scene } from "./Scene";
import { SettingsPanel } from "./SettingsPanel";
import { Toolbar } from "./Toolbar";
import { useSisyphusExperience } from "../hooks/useSisyphusExperience";

export function ScenePage({ sceneId, sceneLabel, nextSceneHref }) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const experience = useSisyphusExperience(sceneId);
  const { fold, settings, realtime, scene, trail, rain } = experience;
  const settingsUiEnabled =
    import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true";
  const settingsToggleLabel = settingsOpen
    ? "Свернуть параметры"
    : "Открыть параметры";

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
          <button
            className="settings-toggle"
            type="button"
            aria-controls="settings-panel"
            aria-expanded={settingsOpen}
            aria-label={settingsToggleLabel}
            title={settingsToggleLabel}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <span aria-hidden="true">
              {settingsOpen ? "−" : "⚙"}
            </span>
          </button>
          <SettingsPanel
            panelRef={settings.settingsPanelRef}
            sceneId={sceneId}
            sceneLabel={sceneLabel}
            sessionStatusRef={settings.settingsStatusRef}
            isOpen={settingsOpen}
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
