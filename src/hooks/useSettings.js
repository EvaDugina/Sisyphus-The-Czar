import { useRef } from "react";

export function useSettings() {
  return {
    settingsPanelRef: useRef(null),
    settingsStatusRef: useRef(null),
  };
}
