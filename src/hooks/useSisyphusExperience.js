import { useEffect } from "react";
import { createSisyphusRuntime } from "../runtime/createSisyphusRuntime";
import { useRainEffect } from "./useRainEffect";
import { useRealtimeSession } from "./useRealtimeSession";
import { useSceneController } from "./useSceneController";
import { useSettings } from "./useSettings";
import { useTrailCanvas } from "./useTrailCanvas";

export function useSisyphusExperience() {
  const settings = useSettings();
  const realtime = useRealtimeSession();
  const scene = useSceneController();
  const trail = useTrailCanvas();
  const rain = useRainEffect();

  const {
    settingsPanelRef,
    settingsToggleRef,
  } = settings;
  const {
    sessionRestartButtonRef,
    sessionShareToggleRef,
    sessionStatusRef,
  } = realtime;
  const {
    handCursorRef,
    hintRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
    worldRef,
  } = scene;
  const { trailCanvasRef } = trail;
  const {
    rainFallbackCanvasRef,
    rainFxCanvasRef,
    rainLayerRef,
  } = rain;

  useEffect(() => {
    const runtime = createSisyphusRuntime({
      world: worldRef.current,
      rock: rockRef.current,
      rockImprint: rockImprintRef.current,
      handCursor: handCursorRef.current,
      remoteCursorLayer: remoteCursorLayerRef.current,
      settingsToggle: settingsToggleRef.current,
      settingsPanel: settingsPanelRef.current,
      trailCanvas: trailCanvasRef.current,
      rainLayer: rainLayerRef.current,
      rainFxCanvas: rainFxCanvasRef.current,
      rainFallbackCanvas: rainFallbackCanvasRef.current,
      hint: hintRef.current,
      sessionStatus: sessionStatusRef.current,
      sessionShareToggle: sessionShareToggleRef.current,
      sessionRestartButton: sessionRestartButtonRef.current,
    });

    return () => runtime.dispose();
  }, [
    handCursorRef,
    hintRef,
    rainFallbackCanvasRef,
    rainFxCanvasRef,
    rainLayerRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
    sessionRestartButtonRef,
    sessionShareToggleRef,
    sessionStatusRef,
    settingsPanelRef,
    settingsToggleRef,
    trailCanvasRef,
    worldRef,
  ]);

  return { settings, realtime, scene, trail, rain };
}
