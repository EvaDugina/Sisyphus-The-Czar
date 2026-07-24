import { Scene } from "./components/Scene";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toolbar } from "./components/Toolbar";
import { useSisyphusExperience } from "./hooks/useSisyphusExperience";

export function App() {
  const experience = useSisyphusExperience();
  const { clientRole, settings, realtime, scene, trail, rain } = experience;
  const settingsAvailable = clientRole === "master";

  return (
    <>
      <Toolbar
        sessionShareToggleRef={realtime.sessionShareToggleRef}
        settingsToggleRef={settings.settingsToggleRef}
        isSettingsOpen={settings.isOpen}
        onToggleSettings={settings.toggle}
        settingsAvailable={settingsAvailable}
      />
      <SettingsPanel
        panelRef={settings.settingsPanelRef}
        restartButtonRef={realtime.sessionRestartButtonRef}
        sessionStatusRef={realtime.sessionStatusRef}
        isOpen={settings.isOpen}
        settingsAvailable={settingsAvailable}
      />
      <div ref={scene.hintRef} className="hint" role="tooltip" aria-hidden="true" />
      <Scene scene={scene} trail={trail} rain={rain} />
    </>
  );
}
