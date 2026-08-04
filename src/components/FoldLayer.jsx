import { useEffect, useRef } from "react";

import {
  buildFoldBlendMask,
  DEFAULT_FOLD_SETTINGS,
  foldEffectEnabled,
  normalizeFoldSettings,
} from "../lib/fold.mjs";

const DYNAMIC_SELECTORS = [
  ".world",
  ".rock",
  ".rock-imprint",
  ".summit-timer",
  ".weather-rain",
  ".hand-cursor:not(.is-remote)",
];

const CANVAS_SELECTORS = [
  ".trail",
  ".weather-rain__canvas--fx",
  ".weather-rain__canvas--fallback",
];

function sanitizeMirror(root) {
  for (const node of [root, ...root.querySelectorAll("*")]) {
    node.removeAttribute("id");
    node.removeAttribute("data-testid");
    node.removeAttribute("aria-label");
    node.removeAttribute("role");
    node.setAttribute("tabindex", "-1");
    if (node instanceof HTMLImageElement) {
      node.alt = "";
      node.draggable = false;
    }
  }
  root.setAttribute("aria-hidden", "true");
  root.setAttribute("inert", "");
  root.setAttribute("role", "presentation");
}

function copyPresentation(source, target) {
  target.className = source.className;
  target.style.cssText = source.style.cssText;
  if (source.hidden) {
    target.setAttribute("hidden", "");
  } else {
    target.removeAttribute("hidden");
  }
}

function createMirror(sourceWorld) {
  const mirror = sourceWorld.cloneNode(true);
  sanitizeMirror(mirror);
  return mirror;
}

function syncRemoteCursors(sourceWorld, mirrorWorld) {
  const sourceLayer = sourceWorld.querySelector(".remote-cursors");
  const mirrorLayer = mirrorWorld.querySelector(".remote-cursors");
  if (!sourceLayer || !mirrorLayer) {
    return;
  }

  const sourcePointers = new Map(
    [...sourceLayer.children].map((pointer) => [
      pointer.dataset.remoteCursor,
      pointer,
    ]),
  );
  const mirrorPointers = new Map(
    [...mirrorLayer.children].map((pointer) => [
      pointer.dataset.remoteCursor,
      pointer,
    ]),
  );

  for (const [clientId, mirrorPointer] of mirrorPointers) {
    if (!sourcePointers.has(clientId)) {
      mirrorPointer.remove();
    }
  }

  for (const [clientId, sourcePointer] of sourcePointers) {
    let mirrorPointer = mirrorPointers.get(clientId);
    if (!mirrorPointer) {
      mirrorPointer = sourcePointer.cloneNode(true);
      sanitizeMirror(mirrorPointer);
      mirrorLayer.append(mirrorPointer);
    }
    copyPresentation(sourcePointer, mirrorPointer);
  }
}

function syncCanvas(sourceWorld, mirrorWorld, selector) {
  const sourceCanvas = sourceWorld.querySelector(selector);
  const mirrorCanvas = mirrorWorld.querySelector(selector);
  if (!sourceCanvas || !mirrorCanvas) {
    return;
  }

  if (mirrorCanvas.width !== sourceCanvas.width) {
    mirrorCanvas.width = sourceCanvas.width;
  }
  if (mirrorCanvas.height !== sourceCanvas.height) {
    mirrorCanvas.height = sourceCanvas.height;
  }
  copyPresentation(sourceCanvas, mirrorCanvas);

  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    return;
  }
  const context = mirrorCanvas.getContext("2d");
  if (!context) {
    return;
  }
  try {
    context.clearRect(0, 0, mirrorCanvas.width, mirrorCanvas.height);
    context.drawImage(sourceCanvas, 0, 0);
  } catch {
    // A renderer may expose its canvas shortly before the first drawable frame.
  }
}

function syncMirror(sourceWorld, mirrorWorld) {
  syncRemoteCursors(sourceWorld, mirrorWorld);

  for (const selector of DYNAMIC_SELECTORS) {
    const source = sourceWorld.matches(selector)
      ? sourceWorld
      : sourceWorld.querySelector(selector);
    const mirror = mirrorWorld.matches(selector)
      ? mirrorWorld
      : mirrorWorld.querySelector(selector);
    if (!source || !mirror) {
      continue;
    }
    copyPresentation(source, mirror);
    if (selector === ".summit-timer") {
      mirror.textContent = source.textContent;
    }
  }

  const sourcePointers = sourceWorld.querySelectorAll(
    ".remote-cursors .hand-cursor",
  );
  const mirrorPointers = mirrorWorld.querySelectorAll(
    ".remote-cursors .hand-cursor",
  );
  for (let index = 0; index < sourcePointers.length; index += 1) {
    if (mirrorPointers[index]) {
      copyPresentation(sourcePointers[index], mirrorPointers[index]);
    }
  }

  for (const selector of CANVAS_SELECTORS) {
    syncCanvas(sourceWorld, mirrorWorld, selector);
  }
}

function applyFoldSettings(layer, settings) {
  const clean = normalizeFoldSettings(settings);
  const mask = clean.draftFoldBlendEnabled
    ? buildFoldBlendMask(clean.draftFoldBlendCurve)
    : "none";
  layer.dataset.foldAngle = String(clean.draftFoldAngle);
  layer.dataset.foldBlendCurve = clean.draftFoldBlendCurve;
  layer.dataset.foldBlendEnabled = String(clean.draftFoldBlendEnabled);
  layer.dataset.foldEnabled = String(foldEffectEnabled(clean));
  layer.dataset.foldZoneSize = String(clean.draftFoldZoneSize);
  layer.style.setProperty("--fold-angle", `${clean.draftFoldAngle}deg`);
  layer.style.setProperty("--fold-mask-image", mask);
  layer.style.setProperty(
    "--fold-zone-height",
    `${clean.draftFoldZoneSize}vh`,
  );
  return clean;
}

export function FoldLayer({ settingsRef, worldRef }) {
  const layerRef = useRef(null);
  const trackRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const track = trackRef.current;
    const sourceWorld = worldRef.current;
    if (!layer || !track || !sourceWorld) {
      return undefined;
    }

    const mirror = createMirror(sourceWorld);
    track.replaceChildren(mirror);
    let animationFrame = null;
    let frameNumber = 0;
    let lastSettingsSignature = "";

    const syncFrame = () => {
      animationFrame = null;
      if (document.hidden) {
        return;
      }

      const clean = normalizeFoldSettings(
        settingsRef.current || DEFAULT_FOLD_SETTINGS,
      );
      const signature = [
        clean.draftFoldAngle,
        clean.draftFoldZoneSize,
        clean.draftFoldBlendEnabled,
        clean.draftFoldBlendCurve,
        clean.positionScrollEnabled,
      ].join(":");
      if (signature !== lastSettingsSignature) {
        applyFoldSettings(layer, clean);
        lastSettingsSignature = signature;
      }

      const scrollOffset = `${window.scrollY}px`;
      track.style.setProperty("--fold-scroll-offset", scrollOffset);
      syncMirror(sourceWorld, mirror);
      frameNumber += 1;
      layer.dataset.mirrorFrame = String(frameNumber);
      layer.dataset.foldReady = "true";
      animationFrame = window.requestAnimationFrame(syncFrame);
    };

    const startSync = () => {
      if (!document.hidden && animationFrame === null) {
        animationFrame = window.requestAnimationFrame(syncFrame);
      }
    };
    const stopSync = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopSync();
      } else {
        startSync();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    startSync();

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      stopSync();
      track.replaceChildren();
    };
  }, [settingsRef, worldRef]);

  return (
    <div
      ref={layerRef}
      className="fold-layer"
      data-fold-layer
      data-fold-angle={DEFAULT_FOLD_SETTINGS.draftFoldAngle}
      data-fold-blend-curve={DEFAULT_FOLD_SETTINGS.draftFoldBlendCurve}
      data-fold-blend-enabled="true"
      data-fold-enabled="false"
      data-fold-ready="false"
      data-fold-zone-size={DEFAULT_FOLD_SETTINGS.draftFoldZoneSize}
      aria-hidden="true"
      style={{
        "--fold-angle": `${DEFAULT_FOLD_SETTINGS.draftFoldAngle}deg`,
        "--fold-mask-image": buildFoldBlendMask(
          DEFAULT_FOLD_SETTINGS.draftFoldBlendCurve,
        ),
        "--fold-zone-height": `${DEFAULT_FOLD_SETTINGS.draftFoldZoneSize}vh`,
      }}
    >
      <div className="fold-zone fold-zone--top" data-fold-zone="top">
        <div className="fold-camera">
          <div className="fold-surface">
            <div className="fold-source-window" data-fold-source-window>
              <div ref={trackRef} className="fold-track" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
