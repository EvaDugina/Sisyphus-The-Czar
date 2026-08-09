const PRODUCTION_PRESET_ERROR_CODES = new Set([
  "invalid_production_preset",
  "production_preset_store_unavailable",
]);

export function resolveProductionPresetMessage(message) {
  if (!message || typeof message.type !== "string") {
    return null;
  }
  const payload = message.payload || {};
  if (
    message.type === "productionPreset.current" ||
    message.type === "productionPreset.selected"
  ) {
    return {
      kind: "state",
      payload: {
        canSelect: Boolean(payload.canSelect),
        selection:
          payload.selection && typeof payload.selection === "object"
            ? payload.selection
            : null,
      },
    };
  }
  if (
    message.type === "error" &&
    PRODUCTION_PRESET_ERROR_CODES.has(String(payload.code || ""))
  ) {
    return {
      kind: "error",
      message: String(payload.message || "Не удалось сохранить production preset"),
    };
  }
  return null;
}
