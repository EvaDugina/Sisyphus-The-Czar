(function attachChainSounds(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusChainSounds = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createChainSounds() {
  "use strict";

  const CHAIN_SOUND_FILENAMES = Object.freeze([
    "Кандалы_01.mp3",
    "Кандалы_02.mp3",
    "Кандалы_03.mp3",
    "Кандалы_04.mp3",
    "Кандалы_05.mp3",
    "Кандалы_06.mp3",
    "Кандалы_07.mp3",
    "Кандалы_08.mp3",
    "Кандалы_09.mp3",
    "Кандалы_10.mp3",
    "Кандалы_11.mp3",
    "Кандалы_12.mp3",
    "Кандалы_13.mp3",
  ]);

  function isChainSoundFilename(value) {
    return CHAIN_SOUND_FILENAMES.includes(value);
  }

  return Object.freeze({
    CHAIN_SOUND_FILENAMES,
    isChainSoundFilename,
  });
});
