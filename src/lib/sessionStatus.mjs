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
  if (session.hasControl || session.pendingControl) {
    return {
      text: `В сессии: ${session.participants} · камень у вас`,
      state: "online",
    };
  }
  if (session.remoteControllerId) {
    return {
      text: `В сессии: ${session.participants} · камень держит другой участник`,
      state: "online",
    };
  }
  return {
    text: `В сессии: ${session.participants} · камень свободен`,
    state: "online",
  };
}
