import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoghArtworkCatalog,
  createGoghArtworkSelector,
  resolveGoghArtwork,
} from "../../src/lib/goghArtworkSelection.mjs";

const ARTWORKS = Object.freeze([
  Object.freeze({ id: "01.png", alt: "Картина 01", url: "/01.png" }),
  Object.freeze({ id: "02.png", alt: "Картина 02", url: "/02.png" }),
  Object.freeze({ id: "03.png", alt: "Картина 03", url: "/03.png" }),
]);

function queuedRandom(samples) {
  let index = 0;
  return () => samples[index++] ?? 0;
}

test("каталог Gogh собирает поддерживаемые файлы в стабильной сортировке", () => {
  const catalog = createGoghArtworkCatalog({
    "../../assets/gogh/10.png": "/assets/10.png",
    "../../assets/gogh/2.webp": { default: "/assets/2.webp" },
    "../../assets/gogh/Этюд.jpg": "/assets/study.jpg",
    "../../assets/gogh/readme.txt": "/assets/readme.txt",
    "../../assets/gogh/empty.gif": "",
  });

  assert.deepEqual(
    catalog.map(({ id, alt, url }) => ({ id, alt, url })),
    [
      { id: "2.webp", alt: "Картина 2", url: "/assets/2.webp" },
      { id: "10.png", alt: "Картина 10", url: "/assets/10.png" },
      {
        id: "Этюд.jpg",
        alt: "Картина Этюд",
        url: "/assets/study.jpg",
      },
    ],
  );
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog[0]), true);
});

test("random выбирает независимо и допускает последовательный повтор", () => {
  const selector = createGoghArtworkSelector({
    artworks: ARTWORKS,
    random: queuedRandom([0.45, 0.45, 0.99]),
  });

  assert.deepEqual(
    [
      selector.select({ mode: "random" }).id,
      selector.select({ mode: "random" }).id,
      selector.select({ mode: "random" }).id,
    ],
    ["02.png", "02.png", "03.png"],
  );
});

test("shuffle исключает повторы внутри цикла и затем начинает новый", () => {
  const selector = createGoghArtworkSelector({
    artworks: ARTWORKS,
    random: queuedRandom([0.99, 0, 0, 0.5, 0, 0]),
  });
  const selected = Array.from(
    { length: ARTWORKS.length * 2 },
    () => selector.select({ mode: "shuffle" }).id,
  );

  assert.equal(new Set(selected.slice(0, 3)).size, 3);
  assert.equal(new Set(selected.slice(3, 6)).size, 3);
  assert.deepEqual([...selected.slice(0, 3)].sort(), ARTWORKS.map(({ id }) => id));
  assert.deepEqual([...selected.slice(3, 6)].sort(), ARTWORKS.map(({ id }) => id));
});

test("single всегда возвращает выбранный файл и использует первый fallback", () => {
  const selector = createGoghArtworkSelector({ artworks: ARTWORKS });

  assert.equal(
    selector.select({ mode: "single", artworkId: "03.png" }).id,
    "03.png",
  );
  assert.equal(
    selector.select({ mode: "single", artworkId: "missing.png" }).id,
    "01.png",
  );
  assert.equal(resolveGoghArtwork(ARTWORKS, "02.png").id, "02.png");
  assert.equal(resolveGoghArtwork([], "02.png"), null);
});

test("reset и повторный вход в shuffle начинают новый цикл", () => {
  const selector = createGoghArtworkSelector({
    artworks: ARTWORKS,
    random: () => 0,
  });
  selector.select({ mode: "shuffle" });
  assert.equal(selector.getState().remainingShuffleIds.length, 2);

  selector.reset();
  assert.deepEqual(selector.getState(), {
    activeMode: null,
    completedCycles: 0,
    remainingShuffleIds: [],
  });
  assert.equal(selector.select({ mode: "shuffle" }).id, "01.png");
});
