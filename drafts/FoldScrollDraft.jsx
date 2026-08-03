import { useEffect, useMemo, useRef, useState } from "react";

import { App } from "../src/App";
import { cubicBezierYForX } from "../src/lib/rockScale.mjs";
import {
  DEFAULT_DRAFT_BLEND_POINTS,
  DraftBlendCurveEditor,
  formatDraftBlendCurve,
} from "./DraftBlendCurveEditor";

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

const FOLD_ANGLE_DEFAULT = 30;
const FOLD_ANGLE_MIN = 0;
const FOLD_ANGLE_MAX = 180;
const FOLD_ZONE_SIZE_DEFAULT = 20;
const FOLD_ZONE_SIZE_MIN = 0;
const FOLD_ZONE_SIZE_MAX = 50;
const FOLD_MASK_SAMPLE_COUNT = 32;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildBlendMask(points) {
  const stops = [];
  for (let index = 0; index <= FOLD_MASK_SAMPLE_COUNT; index += 1) {
    const topProgress = index / FOLD_MASK_SAMPLE_COUNT;
    const curveProgress = 1 - topProgress;
    const opacity = clamp(
      cubicBezierYForX(curveProgress, points),
      0,
      1,
    );
    stops.push(
      `rgba(0, 0, 0, ${opacity.toFixed(3)}) ${(
        topProgress * 100
      ).toFixed(3)}%`,
    );
  }
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

function sanitizeMirror(root) {
  const nodes = [root, ...root.querySelectorAll("*")];
  for (const node of nodes) {
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
  const sourceClone = sourceWorld.cloneNode(true);
  const mirror = document.createElement("div");
  copyPresentation(sourceWorld, mirror);
  mirror.replaceChildren(...sourceClone.childNodes);
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
    // A partially initialized renderer may expose a canvas before it is drawable.
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

function readPositionScrollEnabled() {
  const enabledControl = document.querySelector(
    '[name="positionScrollEnabled"]',
  );
  return enabledControl ? enabledControl.checked : true;
}

function readControlValue(event, fallback, min, max) {
  const parsedValue = Number.parseFloat(event.currentTarget.value);
  return clamp(
    Number.isFinite(parsedValue) ? parsedValue : fallback,
    min,
    max,
  );
}

function DraftFoldControls({
  angle,
  blendEnabled,
  blendPoints,
  onAngleChange,
  onBlendEnabledChange,
  onBlendPointsChange,
  onZoneSizeChange,
  zoneSize,
}) {
  return (
    <section
      className="draft-fold-controls"
      data-draft-fold-controls
      aria-labelledby="draft-fold-controls-title"
    >
      <header className="draft-fold-controls__header">
        <span className="draft-fold-controls__eyebrow">Draft</span>
        <h2 id="draft-fold-controls-title">3D Fold</h2>
      </header>

      <label className="draft-fold-control" htmlFor="draft-fold-angle">
        <span className="draft-fold-control__label">
          <span>Угол линзы</span>
          <output htmlFor="draft-fold-angle">{angle}°</output>
        </span>
        <input
          id="draft-fold-angle"
          name="draftFoldAngle"
          type="range"
          min={FOLD_ANGLE_MIN}
          max={FOLD_ANGLE_MAX}
          step="1"
          value={angle}
          onChange={(event) =>
            onAngleChange(
              readControlValue(
                event,
                FOLD_ANGLE_DEFAULT,
                FOLD_ANGLE_MIN,
                FOLD_ANGLE_MAX,
              ),
            )
          }
        />
      </label>

      <label className="draft-fold-control" htmlFor="draft-fold-zone-size">
        <span className="draft-fold-control__label">
          <span>Размер линзы</span>
          <output htmlFor="draft-fold-zone-size">{zoneSize} vh</output>
        </span>
        <input
          id="draft-fold-zone-size"
          name="draftFoldZoneSize"
          type="range"
          min={FOLD_ZONE_SIZE_MIN}
          max={FOLD_ZONE_SIZE_MAX}
          step="1"
          value={zoneSize}
          onChange={(event) =>
            onZoneSizeChange(
              readControlValue(
                event,
                FOLD_ZONE_SIZE_DEFAULT,
                FOLD_ZONE_SIZE_MIN,
                FOLD_ZONE_SIZE_MAX,
              ),
            )
          }
        />
      </label>

      <button
        className="draft-fold-blend-toggle"
        data-draft-fold-blend-toggle
        type="button"
        aria-pressed={String(blendEnabled)}
        onClick={() => onBlendEnabledChange(!blendEnabled)}
      >
        <span>Плавное смешивание</span>
        <strong>{blendEnabled ? "Включено" : "Выключено"}</strong>
      </button>

      <DraftBlendCurveEditor
        enabled={blendEnabled}
        points={blendPoints}
        onChange={onBlendPointsChange}
      />
    </section>
  );
}

function FoldMirrorZone({ trackRef }) {
  return (
    <div
      className="draft-fold-zone draft-fold-zone--top"
      data-draft-fold-zone="top"
    >
      <div className="draft-fold-camera">
        <div className="draft-fold-surface">
          <div
            className="draft-fold-source-window"
            data-draft-fold-source-window
          >
            <div ref={trackRef} className="draft-fold-track" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FoldScrollDraft() {
  const layerRef = useRef(null);
  const topTrackRef = useRef(null);
  const [foldAngle, setFoldAngle] = useState(FOLD_ANGLE_DEFAULT);
  const [foldZoneSize, setFoldZoneSize] = useState(
    FOLD_ZONE_SIZE_DEFAULT,
  );
  const [foldBlendEnabled, setFoldBlendEnabled] = useState(true);
  const [foldBlendPoints, setFoldBlendPoints] = useState(() => [
    ...DEFAULT_DRAFT_BLEND_POINTS,
  ]);
  const foldBlendCurve = formatDraftBlendCurve(foldBlendPoints);
  const foldBlendMask = useMemo(
    () => buildBlendMask(foldBlendPoints),
    [foldBlendPoints],
  );
  const foldZoneSizeRef = useRef(foldZoneSize);
  foldZoneSizeRef.current = foldZoneSize;

  useEffect(() => {
    const layer = layerRef.current;
    const sourceWorld = document.querySelector("#root > .world");
    const tracks = [topTrackRef.current];
    if (!layer || !sourceWorld || tracks.some((track) => !track)) {
      return undefined;
    }

    const mirrors = tracks.map((track) => {
      const mirror = createMirror(sourceWorld);
      track.replaceChildren(mirror);
      return mirror;
    });

    let animationFrame = null;
    let frameNumber = 0;
    let lastEnabled = null;

    const syncFrame = () => {
      animationFrame = null;
      if (document.hidden) {
        return;
      }

      const effectEnabled =
        readPositionScrollEnabled() && foldZoneSizeRef.current > 0;
      if (effectEnabled !== lastEnabled) {
        layer.dataset.foldEnabled = String(effectEnabled);
        lastEnabled = effectEnabled;
      }

      const scrollOffset = `${window.scrollY}px`;
      for (const track of tracks) {
        track.style.setProperty("--draft-fold-scroll-offset", scrollOffset);
      }
      for (const mirror of mirrors) {
        syncMirror(sourceWorld, mirror);
      }

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
      for (const track of tracks) {
        track.replaceChildren();
      }
    };
  }, []);

  return (
    <>
      <App />
      <DraftFoldControls
        angle={foldAngle}
        blendEnabled={foldBlendEnabled}
        blendPoints={foldBlendPoints}
        zoneSize={foldZoneSize}
        onAngleChange={setFoldAngle}
        onBlendEnabledChange={setFoldBlendEnabled}
        onBlendPointsChange={setFoldBlendPoints}
        onZoneSizeChange={setFoldZoneSize}
      />
      <div
        ref={layerRef}
        className="draft-fold-layer"
        data-draft-fold-layer
        data-fold-angle={foldAngle}
        data-fold-blend-curve={foldBlendCurve}
        data-fold-blend-enabled={String(foldBlendEnabled)}
        data-fold-enabled="false"
        data-fold-ready="false"
        data-fold-zone-size={foldZoneSize}
        aria-hidden="true"
        style={{
          "--draft-fold-angle": `${foldAngle}deg`,
          "--draft-fold-mask-image": foldBlendEnabled
            ? foldBlendMask
            : "none",
          "--draft-fold-zone-height": `${foldZoneSize}vh`,
        }}
      >
        <FoldMirrorZone trackRef={topTrackRef} />
      </div>
    </>
  );
}
