import { Scene } from "./components/Scene";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toolbar } from "./components/Toolbar";
import { useSisyphusExperience } from "./hooks/useSisyphusExperience";

export function App() {
  const experience = useSisyphusExperience();
  const { settings, realtime, scene, trail, rain } = experience;

  return (
    <>
      <Toolbar
        sessionShareToggleRef={realtime.sessionShareToggleRef}
        settingsToggleRef={settings.settingsToggleRef}
        isSettingsOpen={settings.isOpen}
        onToggleSettings={settings.toggle}
      />
      <SettingsPanel
        panelRef={settings.settingsPanelRef}
        restartButtonRef={realtime.sessionRestartButtonRef}
        sessionStatusRef={realtime.sessionStatusRef}
        isOpen={settings.isOpen}
      />
      <div ref={scene.hintRef} className="hint" role="tooltip" aria-hidden="true" />
      <Scene scene={scene} trail={trail} rain={rain} />
    </>
  );
}
