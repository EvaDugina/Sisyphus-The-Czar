function normalizeLeaderboardEntry(source) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const id = typeof source.id === "string" ? source.id : "";
  const name = typeof source.name === "string" ? source.name : "";
  const scoreMs = Number(source.scoreMs);
  if (!id || !name || !Number.isFinite(scoreMs) || scoreMs <= 0) {
    return null;
  }
  const rank = Number(source.rank);
  return {
    ...source,
    id,
    name,
    scoreMs,
    rank: Number.isSafeInteger(rank) && rank > 0 ? rank : null,
  };
}

export function composeSummitLeaderboardRows(payload = {}) {
  const current = normalizeLeaderboardEntry(payload.current);
  const currentId = current?.id || null;
  const rows = [];
  const seenIds = new Set();
  const append = (source, role) => {
    const entry = normalizeLeaderboardEntry(source);
    if (!entry || seenIds.has(entry.id)) {
      return;
    }
    seenIds.add(entry.id);
    rows.push({
      entry,
      role,
      isCurrent: entry.id === currentId,
    });
  };

  const top = Array.isArray(payload.top) ? payload.top.slice(0, 10) : [];
  top.forEach((entry) => {
    append(entry, Number(entry?.rank) === 1 ? "first" : "top-ten");
  });
  append(current, "current");
  append(payload.last, "last");
  return rows;
}
