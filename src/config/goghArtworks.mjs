import { createGoghArtworkCatalog } from "../lib/goghArtworkSelection.mjs";

const goghArtworkModules = import.meta.glob(
  "../../assets/gogh/*.{avif,gif,jpeg,jpg,png,webp}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

export const GOGH_ARTWORKS = createGoghArtworkCatalog(goghArtworkModules);

export const GOGH_ARTWORK_OPTIONS = Object.freeze(
  GOGH_ARTWORKS.map((artwork) => Object.freeze([artwork.id, artwork.id])),
);
