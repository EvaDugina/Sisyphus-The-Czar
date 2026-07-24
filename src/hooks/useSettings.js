import { useEffect, useRef, useState } from "react";

export function useSettings(isAvailable) {
  const [isOpen, setIsOpen] = useState(false);
  const settingsToggleRef = useRef(null);
  const settingsPanelRef = useRef(null);

  useEffect(() => {
    if (!isAvailable) {
      setIsOpen(false);
    }
  }, [isAvailable]);

  return {
    isOpen,
    settingsToggleRef,
    settingsPanelRef,
    toggle: () => {
      if (isAvailable) {
        setIsOpen((current) => !current);
      }
    },
  };
}
