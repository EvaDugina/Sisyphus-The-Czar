(function attachGachiSounds(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.SisyphusGachiSounds = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createGachiSounds() {
  "use strict";

  const GACHI_SOUND_FILENAMES = Object.freeze([
    "Aaaaaa.mp3",
    "Aaaaah.mp3",
    "Camen.mp3",
    "Deep dark fantasies.mp3",
    "Dungeon master.mp3",
    "Get your ass down for me now boy.mp3",
    "Like that.mp3",
    "ahhhhhhh.mp3",
    "thats-amazing.mp3",
  ]);

  function isGachiSoundFilename(value) {
    return GACHI_SOUND_FILENAMES.includes(value);
  }

  return Object.freeze({
    GACHI_SOUND_FILENAMES,
    isGachiSoundFilename,
  });
});
