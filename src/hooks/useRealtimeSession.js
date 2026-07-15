import { useRef } from "react";

export function useRealtimeSession() {
  return {
    sessionStatusRef: useRef(null),
    sessionShareToggleRef: useRef(null),
    sessionRestartButtonRef: useRef(null),
  };
}
