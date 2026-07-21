function handLabel(count) {
  const normalized = Math.max(0, Math.trunc(Number(count) || 0));
  const lastDigit = normalized % 10;
  const lastTwoDigits = normalized % 100;
  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return `${normalized} рука`;
  }
  if (
    lastDigit >= 2 &&
    lastDigit <= 4 &&
    (lastTwoDigits < 12 || lastTwoDigits > 14)
  ) {
    return `${normalized} руки`;
  }
  return `${normalized} рук`;
}

export function deriveSessionStatus(session) {
  if (!session.enabled) {
    return { text: "Локальная сессия", state: "local" };
  }
  if (session.expired) {
    return {
      text: "Сессия истекла или сервер перезапущен",
      state: "error",
    };
  }
  if (!session.connected) {
    return { text: "Переподключение…", state: "connecting" };
  }
  const holderIds = Array.isArray(session.holderIds) ? session.holderIds : [];
  const requiredHolders = Math.max(1, Number(session.requiredHolders) || 2);
  const holderCount = holderIds.length;
  const liftReady =
    typeof session.liftReady === "boolean"
      ? session.liftReady
      : holderCount >= requiredHolders;
  const holdersLabel = handLabel(holderCount);
  if (session.hasControl || session.pendingControl) {
    if (liftReady) {
      return {
        text: `В сессии: ${session.participants} · тяните, силы хватает (${holdersLabel})`,
        state: "online",
      };
    }
    return {
      text: `В сессии: ${session.participants} · вы держите, силы не хватает (${holdersLabel})`,
      state: "online",
    };
  }
  if (holderCount > 0 || session.remoteControllerId) {
    return {
      text: `В сессии: ${session.participants} · камень держат (${holdersLabel})`,
      state: "online",
    };
  }
  return {
    text: `В сессии: ${session.participants} · камень свободен`,
    state: "online",
  };
}
