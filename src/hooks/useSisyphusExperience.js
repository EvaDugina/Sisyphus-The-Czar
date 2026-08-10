import { useEffect, useRef } from "react";
import { createSisyphusRuntime } from "../runtime/createSisyphusRuntime";
import { useSettings } from "./useSettings";

export function useSisyphusExperience() {
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

  const { settingsLinkRef } = settings;
  const {
    sessionPanelRef,
    sessionRestartButtonRef,
    sessionStatusRef,
  } = realtime;
  const {
    handCursorRef,
    heightGateStatusRef,
    hintRef,
    remoteCursorLayerRef,
    rockImprintRef,
    rockRef,
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
      rock: rockRef.current,
      rockImprint: rockImprintRef.current,
      handCursor: handCursorRef.current,
      heightGateStatus: heightGateStatusRef.current,
      remoteCursorLayer: remoteCursorLayerRef.current,
      settingsToggle: settingsLinkRef.current,
      settingsLink: settingsLinkRef.current,
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
    settingsLinkRef,
    trailCanvasRef,
    trailSessionCanvasRef,
    trailGlowCanvasRef,
    worldRef,
  ]);

  return { settings, realtime, scene, trail, rain, fold };
}
