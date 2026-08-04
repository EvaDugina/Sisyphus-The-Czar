import { useEffect, useRef } from "react";
import { createSisyphusRuntime } from "../runtime/createSisyphusRuntime";
import { useSettings } from "./useSettings";

export function useSisyphusExperience() {
  const settings = useSettings(true);
  const realtime = {
    sessionStatusRef: useRef(null),
    sessionRestartButtonRef: useRef(null),
  };
  const scene = {
    worldRef: useRef(null),
    rockRef: useRef(null),
    rockImprintRef: useRef(null),
    handCursorRef: useRef(null),
    remoteCursorLayerRef: useRef(null),
    hintRef: useRef(null),
  };
  const trail = {
    trailCanvasRef: useRef(null),
    trailGlowCanvasRef: useRef(null),
  };
  const rain = {
    rainLayerRef: useRef(null),
    rainFxCanvasRef: useRef(null),
    rainFallbackCanvasRef: useRef(null),
  };
  const fold = {
    settingsRef: useRef(null),
  };
  const { settingsRef: foldSettingsRef } = fold;

  const {
    settingsPanelRef,
    settingsToggleRef,
  } = settings;
  const {
    sessionRestartButtonRef,
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
  const { trailCanvasRef, trailGlowCanvasRef } = trail;
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
      trailGlowCanvas: trailGlowCanvasRef.current,
      rainLayer: rainLayerRef.current,
      rainFxCanvas: rainFxCanvasRef.current,
      rainFallbackCanvas: rainFallbackCanvasRef.current,
      hint: hintRef.current,
      sessionStatus: sessionStatusRef.current,
      sessionRestartButton: sessionRestartButtonRef.current,
      foldSettingsRef,
    });

    return () => runtime.dispose();
  }, [
    handCursorRef,
    foldSettingsRef,
    hintRef,
    rainFallbackCanvasRef,
    rainFxCanvasRef,
    rainLayerRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
    sessionRestartButtonRef,
    sessionStatusRef,
    settingsPanelRef,
    settingsToggleRef,
    trailCanvasRef,
    trailGlowCanvasRef,
    worldRef,
  ]);

  return { settings, realtime, scene, trail, rain, fold };
}
