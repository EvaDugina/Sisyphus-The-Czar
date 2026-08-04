import { FoldLayer } from "./components/FoldLayer";
import { Scene } from "./components/Scene";
import { SettingsPanel } from "./components/SettingsPanel";
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
        settingsToggleRef={settings.settingsToggleRef}
        isSettingsOpen={settings.isOpen}
        onToggleSettings={settings.toggle}
        settingsUiEnabled={settingsUiEnabled}
        settingsAvailable={settingsAvailable}
      />
      <SettingsPanel
        panelRef={settings.settingsPanelRef}
        restartButtonRef={realtime.sessionRestartButtonRef}
        sessionStatusRef={realtime.sessionStatusRef}
        isOpen={settings.isOpen}
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
