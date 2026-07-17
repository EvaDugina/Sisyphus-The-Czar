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
  const holdersLabel = `${holderCount}/${requiredHolders}`;
  if (session.hasControl || session.pendingControl) {
    if (holderCount >= requiredHolders) {
      return {
        text: `В сессии: ${session.participants} · тащите вместе ${holdersLabel}`,
        state: "online",
      };
    }
    return {
      text: `В сессии: ${session.participants} · вы держите ${holdersLabel}, нужен второй`,
      state: "online",
    };
  }
  if (holderCount > 0 || session.remoteControllerId) {
    return {
      text: `В сессии: ${session.participants} · камень держат ${holdersLabel}`,
      state: "online",
    };
  }
  return {
    text: `В сессии: ${session.participants} · камень свободен`,
    state: "online",
  };
}
