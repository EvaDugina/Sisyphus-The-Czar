import { useRef } from "react";

export function useSceneController() {
  return {
    worldRef: useRef(null),
    rockRef: useRef(null),
    rockImprintRef: useRef(null),
    handCursorRef: useRef(null),
    remoteCursorLayerRef: useRef(null),
    hintRef: useRef(null),
  };
}
