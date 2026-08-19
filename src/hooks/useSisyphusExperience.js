import { useEffect, useRef } from "react";
import { createSisyphusRuntime } from "../runtime/createSisyphusRuntime";
import { useSettings } from "./useSettings";

export function useSisyphusExperience(sceneId) {
  const settings = useSettings();
  const realtime = {
    sessionPanelRef: useRef(null),
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
    heightGateStatusRef: useRef(null),
    glassStripsRef: useRef(null),
    summitLeaderboardRef: useRef(null),
  };
  const trail = {
    trailCanvasRef: useRef(null),
    trailSessionCanvasRef: useRef(null),
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

  const { settingsPanelRef } = settings;
  const {
    sessionPanelRef,
    sessionRestartButtonRef,
    sessionStatusRef,
  } = realtime;
  const {
    handCursorRef,
    glassStripsRef,
    heightGateStatusRef,
    hintRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
    summitLeaderboardRef,
    worldRef,
  } = scene;
  const { trailCanvasRef, trailSessionCanvasRef, trailGlowCanvasRef } = trail;
  const {
    rainFallbackCanvasRef,
    rainFxCanvasRef,
    rainLayerRef,
  } = rain;

  useEffect(() => {
    const runtime = createSisyphusRuntime({
      world: worldRef.current,
      sceneId,
      rock: rockRef.current,
      rockImprint: rockImprintRef.current,
      summitLeaderboard: summitLeaderboardRef.current,
      handCursor: handCursorRef.current,
      heightGateStatus: heightGateStatusRef.current,
      glassStripsLayer: glassStripsRef.current,
      remoteCursorLayer: remoteCursorLayerRef.current,
      settingsPanel: settingsPanelRef.current,
      trailCanvas: trailCanvasRef.current,
      trailSessionCanvas: trailSessionCanvasRef.current,
      trailGlowCanvas: trailGlowCanvasRef.current,
      rainLayer: rainLayerRef.current,
      rainFxCanvas: rainFxCanvasRef.current,
      rainFallbackCanvas: rainFallbackCanvasRef.current,
      hint: hintRef.current,
      sessionStatus: sessionStatusRef.current,
      sessionPanel: sessionPanelRef.current,
      sessionRestartButton: sessionRestartButtonRef.current,
      foldSettingsRef,
    });

    return () => runtime.dispose();
  }, [
    handCursorRef,
    glassStripsRef,
    heightGateStatusRef,
    foldSettingsRef,
    hintRef,
    rainFallbackCanvasRef,
    rainFxCanvasRef,
    rainLayerRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
    sessionRestartButtonRef,
    sessionPanelRef,
    sessionStatusRef,
    sceneId,
    settingsPanelRef,
    summitLeaderboardRef,
    trailCanvasRef,
    trailSessionCanvasRef,
    trailGlowCanvasRef,
    worldRef,
  ]);

  return { settings, realtime, scene, trail, rain, fold };
}
