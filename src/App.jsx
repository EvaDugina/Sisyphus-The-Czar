import { FoldLayer } from "./components/FoldLayer";
import { Scene } from "./components/Scene";
import { Toolbar } from "./components/Toolbar";
import { useSisyphusExperience } from "./hooks/useSisyphusExperience";

export function App() {
  const experience = useSisyphusExperience();
  const { fold, settings, realtime, scene, trail, rain } = experience;
  const settingsUiEnabled =
    import.meta.env.DEV || import.meta.env.VITE_DEBUG_UI === "true";
  const settingsAvailable = settingsUiEnabled;

  return (
    <>
      <Toolbar
        settingsLinkRef={settings.settingsLinkRef}
        sessionPanelRef={realtime.sessionPanelRef}
        sessionRestartButtonRef={realtime.sessionRestartButtonRef}
        sessionStatusRef={realtime.sessionStatusRef}
        settingsUiEnabled={settingsUiEnabled}
        settingsAvailable={settingsAvailable}
      />
      {settingsUiEnabled ? (
        <div
          ref={scene.hintRef}
          className="hint"
          role="tooltip"
          aria-hidden="true"
        />
      ) : null}
      <Scene scene={scene} trail={trail} rain={rain} />
      <FoldLayer settingsRef={fold.settingsRef} worldRef={scene.worldRef} />
    </>
  );
}
