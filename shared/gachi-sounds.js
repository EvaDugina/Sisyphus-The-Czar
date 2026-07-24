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
    "242203-4fac17c9-0dad-4df2-83aa-47ba726e0380.mp3",
    "242203-f961897c-6013-4bc7-87a2-2e6fdd317000.mp3",
    "567969-53534.mp3",
    "56800453453.mp3",
    "568023243432.mp3",
    "568029535.mp3",
    "568156-543354.mp3",
    "568164355435.mp3",
    "56816945334.mp3",
    "5681822344.mp3",
    "568230-5354.mp3",
    "568265424332.mp3",
    "ahhhhhhh.mp3",
    "boy-next-door.mp3",
    "thats-amazing.mp3",
    "welcome-to-the-club.mp3",
  ]);

  function isGachiSoundFilename(value) {
    return GACHI_SOUND_FILENAMES.includes(value);
  }

  return Object.freeze({
    GACHI_SOUND_FILENAMES,
    isGachiSoundFilename,
  });
});
