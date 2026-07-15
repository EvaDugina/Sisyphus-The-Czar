import { useRef } from "react";

export function useRainEffect() {
  return {
    rainLayerRef: useRef(null),
    rainFxCanvasRef: useRef(null),
    rainFallbackCanvasRef: useRef(null),
  };
}
