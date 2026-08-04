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
  const liftReady =
    typeof session.liftReady === "boolean"
      ? session.liftReady
      : true;
  if (session.hasControl || session.pendingControl) {
    if (liftReady) {
      return {
        text: `В сессии: ${session.participants} · вы держите камень, силы хватает`,
        state: "online",
      };
    }
    return {
      text: `В сессии: ${session.participants} · вы держите, камень отстаёт`,
      state: "online",
    };
  }
  if (session.holderId || session.remoteControllerId) {
    return {
      text: `В сессии: ${session.participants} · камень удерживается`,
      state: "online",
    };
  }
  return {
    text: `В сессии: ${session.participants} · камень свободен`,
    state: "online",
  };
}
