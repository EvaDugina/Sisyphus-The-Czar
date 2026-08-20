const SUPPORTED_GOGH_ARTWORK_PATTERN = /\.(?:avif|gif|jpe?g|png|webp)$/i;

function moduleUrl(moduleValue) {
  if (typeof moduleValue === "string") {
    return moduleValue;
  }
  return typeof moduleValue?.default === "string" ? moduleValue.default : "";
}

function artworkIdFromPath(modulePath) {
  return String(modulePath || "").split(/[\\/]/).at(-1)?.trim() || "";
}

export function createGoghArtworkCatalog(assetModules = {}) {
  const seenIds = new Set();
  const artworks = Object.entries(assetModules)
    .map(([modulePath, moduleValue]) => ({
      id: artworkIdFromPath(modulePath),
      url: moduleUrl(moduleValue),
    }))
    .filter(({ id, url }) => {
      if (!id || !url || !SUPPORTED_GOGH_ARTWORK_PATTERN.test(id)) {
        return false;
      }
      const normalizedId = id.toLocaleLowerCase("ru");
      if (seenIds.has(normalizedId)) {
        return false;
      }
      seenIds.add(normalizedId);
      return true;
    })
    .sort((left, right) =>
      left.id.localeCompare(right.id, "ru", {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .map((artwork) =>
      Object.freeze({
        ...artwork,
        alt: `Картина ${artwork.id.replace(/\.[^.]+$/, "")}`,
      }),
    );
  return Object.freeze(artworks);
}

export function resolveGoghArtwork(artworks, artworkId) {
  const catalog = Array.isArray(artworks) ? artworks : [];
  const requestedId = String(artworkId || "");
  return catalog.find((artwork) => artwork.id === requestedId) || catalog[0] || null;
}

function randomIndex(length, random) {
  if (length <= 1) {
    return 0;
  }
  const sample = Number(random());
  const normalized = Number.isFinite(sample)
    ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON)
    : 0;
  return Math.floor(normalized * length);
}

export function createGoghArtworkSelector({
  artworks,
  random = Math.random,
} = {}) {
  const catalog = Array.isArray(artworks) ? [...artworks] : [];
  let activeMode = null;
  let remainingShuffleIds = [];
  let completedCycles = 0;

  function reset() {
    activeMode = null;
    remainingShuffleIds = [];
    completedCycles = 0;
  }

  function select({ mode, artworkId } = {}) {
    const normalizedMode = ["random", "shuffle", "single"].includes(mode)
      ? mode
      : "shuffle";
    if (activeMode !== normalizedMode) {
      activeMode = normalizedMode;
      remainingShuffleIds = [];
      completedCycles = 0;
    }
    if (catalog.length === 0) {
      return null;
    }
    if (normalizedMode === "single") {
      return resolveGoghArtwork(catalog, artworkId);
    }
    if (normalizedMode === "random") {
      return catalog[randomIndex(catalog.length, random)];
    }
    if (remainingShuffleIds.length === 0) {
      if (completedCycles > 0) {
        completedCycles += 1;
      } else {
        completedCycles = 1;
      }
      remainingShuffleIds = catalog.map((artwork) => artwork.id);
    }
    const index = randomIndex(remainingShuffleIds.length, random);
    const [selectedId] = remainingShuffleIds.splice(index, 1);
    return resolveGoghArtwork(catalog, selectedId);
  }

  function getState() {
    return {
      activeMode,
      completedCycles,
      remainingShuffleIds: [...remainingShuffleIds],
    };
  }

  return Object.freeze({ getState, reset, select });
}
