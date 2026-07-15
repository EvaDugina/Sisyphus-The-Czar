import { useRef, useState } from "react";

export function useSettings() {
  const [isOpen, setIsOpen] = useState(false);
  const settingsToggleRef = useRef(null);
  const settingsPanelRef = useRef(null);

  return {
    isOpen,
    settingsToggleRef,
    settingsPanelRef,
    toggle: () => setIsOpen((current) => !current),
  };
}
