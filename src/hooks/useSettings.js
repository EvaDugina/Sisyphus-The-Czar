import { useRef } from "react";

export function useSettings() {
  const settingsLinkRef = useRef(null);
  return {
    settingsLinkRef,
  };
}
