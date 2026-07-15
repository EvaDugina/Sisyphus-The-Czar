import { useRef } from "react";

export function useTrailCanvas() {
  return {
    trailCanvasRef: useRef(null),
  };
}
