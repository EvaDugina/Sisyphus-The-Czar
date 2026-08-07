import { useEffect, useRef } from "react";
import { SettingsPanel } from "./components/SettingsPanel";
import { createSettingsPageRuntime } from "./runtime/createSettingsPageRuntime.js";

export function SettingsPage() {
  const panelRef = useRef(null);
  const sessionStatusRef = useRef(null);
  const restartButtonRef = useRef(null);
  const hintRef = useRef(null);

  useEffect(() => {
    document.body.classList.add("settings-page", "theme-dark");
    const runtime = createSettingsPageRuntime({
      hint: hintRef.current,
      sessionRestartButton: restartButtonRef.current,
      sessionStatus: sessionStatusRef.current,
      settingsPanel: panelRef.current,
    });
    return () => {
      runtime.dispose();
      document.body.classList.remove("settings-page");
    };
  }, []);

  const sceneUrl = (() => {
    const session = new URL(window.location.href).searchParams.get("session");
    return session ? `/?session=${encodeURIComponent(session)}` : "/";
  })();

  return (
    <>
      <a className="settings-page__back" href={sceneUrl}>
        ← Сцена
      </a>
      <main className="settings-page__content">
        <h1>Настройки комнаты</h1>
        <p className="settings-page__intro">
          Изменения станут общими для всех участников после сохранения и
          применятся на сцене после её перезагрузки.
        </p>
        <SettingsPanel
          panelRef={panelRef}
          restartButtonRef={restartButtonRef}
          sessionStatusRef={sessionStatusRef}
          isOpen
          settingsAvailable
        />
      </main>
      <div ref={hintRef} className="hint" role="tooltip" aria-hidden="true" />
    </>
  );
}
