import { useEffect, useRef } from "react";
import { createSisyphusRuntime } from "../runtime/createSisyphusRuntime";
import { useSettings } from "./useSettings";

export function useSisyphusExperience() {
  const settings = useSettings();
  const realtime = {
    sessionStatusRef: useRef(null),
    sessionShareToggleRef: useRef(null),
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
  };
  const rain = {
    rainLayerRef: useRef(null),
    rainFxCanvasRef: useRef(null),
    rainFallbackCanvasRef: useRef(null),
  };

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
