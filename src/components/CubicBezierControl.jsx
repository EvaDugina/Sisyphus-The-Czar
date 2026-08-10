import { useEffect, useRef, useState } from "react";

import { parseCubicBezier } from "../lib/rockScale.mjs";
import { serializeSettingDependency } from "../lib/settingsDependencies.mjs";

const FALLBACK_POINTS = Object.freeze([0.25, 0.1, 0.25, 1]);
const COORDINATE_LABELS = Object.freeze(["x1", "y1", "x2", "y2"]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundCoordinate(value) {
  return Math.round(value * 1000) / 1000;
}

function formatCoordinate(value) {
  const normalized = Math.abs(value) < 0.005 ? 0 : roundCoordinate(value);
  return String(normalized);
}

function formatCurve(points) {
  return `cubic-bezier(${points.map(formatCoordinate).join(", ")})`;
}

function graphPoint(index, points, descending = false) {
  return {
    x: points[index * 2] * 100,
    y: descending
      ? points[index * 2 + 1] * 100
      : 100 - points[index * 2 + 1] * 100,
  };
}

function formatGraphValue(value, precision, unit) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? number : 0;
  return `${normalized.toFixed(precision)} ${unit}`;
}

function CurvePreview({ curve, previewKey }) {
  return (
    <div
      className="bezier-preview"
      style={{ "--bezier-preview-easing": curve }}
    >
      <div className="bezier-preview-row">
        <span>Кривая</span>
        <span className="bezier-preview-track" aria-hidden="true">
          <span
            className="bezier-preview-marker"
            key={`curve-${previewKey}`}
          />
        </span>
      </div>
      <div className="bezier-preview-row">
        <span>Linear</span>
        <span className="bezier-preview-track" aria-hidden="true">
          <span
            className="bezier-preview-marker is-linear"
            key={`linear-${previewKey}`}
          />
        </span>
      </div>
    </div>
  );
}

export function CubicBezierControl({ control, hidden = false }) {
  const {
    defaultValue,
    enabledWhen,
    formulas,
    graph,
    hint,
    label,
    name,
    scope,
  } = control;
  const initialPoints =
    parseCubicBezier(defaultValue) || [...FALLBACK_POINTS];
  const [points, setPoints] = useState(initialPoints);
  const [curveText, setCurveText] = useState(
    formatCurve(initialPoints),
  );
  const [previewKey, setPreviewKey] = useState(0);
  const [graphValues, setGraphValues] = useState({
    start: graph?.startDefault ?? 0,
    end: graph?.endDefault ?? 1,
    duration: graph?.durationDefault ?? 1,
  });
  const inputRef = useRef(null);
  const graphRef = useRef(null);
  const activeHandleRef = useRef(null);
  const formulasAttr =
    Array.isArray(formulas) && formulas.length > 0
      ? JSON.stringify(formulas)
      : undefined;
  const descending = Boolean(graph && graphValues.end < graphValues.start);
  const firstPoint = graphPoint(0, points, descending);
  const secondPoint = graphPoint(1, points, descending);
  const graphStartY = descending ? 0 : 100;
  const graphEndY = descending ? 100 : 0;
  const curvePath = `M 0 ${graphStartY} C ${firstPoint.x} ${firstPoint.y}, ${secondPoint.x} ${secondPoint.y}, 100 ${graphEndY}`;
  const validCurve = formatCurve(points);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }
    const syncFromExternalValue = () => {
      const nextText = String(input.value || "");
      const parsed = parseCubicBezier(nextText);
      setCurveText(nextText);
      if (parsed) {
        setPoints(parsed);
        setPreviewKey((value) => value + 1);
      }
    };
    input.addEventListener("settings-control-sync", syncFromExternalValue);
    return () => {
      input.removeEventListener(
        "settings-control-sync",
        syncFromExternalValue,
      );
    };
  }, []);

  useEffect(() => {
    if (!graph) {
      return undefined;
    }
    const names = [
      graph.startSetting,
      graph.endSetting,
      graph.durationSetting,
    ];
    const elements = names.map((settingName) =>
      document.querySelector(
        `[data-setting-input][name="${settingName}"]`,
      ),
    );
    const syncGraphValues = () => {
      const [startInput, endInput, durationInput] = elements;
      const start = Number(startInput?.value);
      const end = Number(endInput?.value);
      const duration = Number(durationInput?.value);
      setGraphValues({
        start: Number.isFinite(start) ? start : graph.startDefault,
        end: Number.isFinite(end) ? end : graph.endDefault,
        duration: Number.isFinite(duration)
          ? duration
          : graph.durationDefault,
      });
    };
    const events = ["input", "change", "settings-control-sync"];
    elements.forEach((element) => {
      events.forEach((eventName) => {
        element?.addEventListener(eventName, syncGraphValues);
      });
    });
    syncGraphValues();
    return () => {
      elements.forEach((element) => {
        events.forEach((eventName) => {
          element?.removeEventListener(eventName, syncGraphValues);
        });
      });
    };
  }, [graph]);

  function publishPoints(nextPoints) {
    const normalized = nextPoints.map((value, index) => {
      const rounded = roundCoordinate(Number(value));
      return index === 0 || index === 2
        ? clamp(rounded, 0, 1)
        : clamp(rounded, -2, 2);
    });
    const nextCurve = formatCurve(normalized);
    setPoints(normalized);
    setCurveText(nextCurve);
    setPreviewKey((value) => value + 1);
    if (inputRef.current) {
      inputRef.current.value = nextCurve;
      inputRef.current.dispatchEvent(
        new Event("input", { bubbles: true }),
      );
    }
  }

  function handleCurveText(event) {
    const nextText = event.target.value;
    const parsed = parseCubicBezier(nextText);
    setCurveText(nextText);
    if (parsed) {
      setPoints(parsed);
      setPreviewKey((value) => value + 1);
    }
  }

  function handleCoordinate(index, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return;
    }
    const nextPoints = [...points];
    nextPoints[index] = number;
    publishPoints(nextPoints);
  }

  function updateHandleFromPointer(event, handleIndex) {
    const graph = graphRef.current;
    if (!graph || activeHandleRef.current !== handleIndex) {
      return;
    }
    const rect = graph.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const nextPoints = [...points];
    nextPoints[handleIndex * 2] = clamp(
      (event.clientX - rect.left) / rect.width,
      0,
      1,
    );
    const pointerProgress = clamp(
      (event.clientY - rect.top) / rect.height,
      0,
      1,
    );
    nextPoints[handleIndex * 2 + 1] = descending
      ? pointerProgress
      : 1 - pointerProgress;
    publishPoints(nextPoints);
  }

  function beginHandleDrag(event, handleIndex) {
    activeHandleRef.current = handleIndex;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateHandleFromPointer(event, handleIndex);
  }

  function endHandleDrag(event) {
    activeHandleRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="control cubic-bezier-control"
      data-cubic-bezier-control
      data-hint={hint}
      data-formulas={formulasAttr}
      data-setting-control
      data-setting-enabled-when={serializeSettingDependency(enabledWhen)}
      data-setting-scope={scope}
      hidden={hidden}
    >
      <label className="control-label" htmlFor={`setting-${name}`}>
        <span>{label}</span>
      </label>

      <div className="bezier-editor">
        <svg
          className="bezier-graph"
          ref={graphRef}
          viewBox="0 0 100 100"
          role="img"
          aria-label={
            graph
              ? `График ${label}: ${formatGraphValue(graphValues.start, graph.precision, graph.unit)} → ${formatGraphValue(graphValues.end, graph.precision, graph.unit)} за ${graphValues.duration} с`
              : `График ${label}`
          }
        >
          <path className="bezier-grid-line" d="M 0 75 H 100" />
          <path className="bezier-grid-line" d="M 0 50 H 100" />
          <path className="bezier-grid-line" d="M 0 25 H 100" />
          <path className="bezier-diagonal" d="M 0 100 L 100 0" />
          <path
            className="bezier-handle-line"
            d={`M 0 ${graphStartY} L ${firstPoint.x} ${firstPoint.y}`}
          />
          <path
            className="bezier-handle-line"
            d={`M 100 ${graphEndY} L ${secondPoint.x} ${secondPoint.y}`}
          />
          <path className="bezier-curve" d={curvePath} />
          {[firstPoint, secondPoint].map((point, index) => (
            <circle
              className={`bezier-handle is-${index + 1}`}
              cx={point.x}
              cy={point.y}
              key={COORDINATE_LABELS[index * 2]}
              r="5"
              onPointerDown={(event) => beginHandleDrag(event, index)}
              onPointerMove={(event) =>
                updateHandleFromPointer(event, index)
              }
              onPointerUp={endHandleDrag}
              onPointerCancel={endHandleDrag}
            />
          ))}
          <text className="bezier-axis-label" x="50" y="98">
            время
          </text>
          <text
            className="bezier-axis-label"
            x="4"
            y="50"
            transform="rotate(-90 4 50)"
          >
            {graph ? graph.unit : "прогресс"}
          </text>
        </svg>

        {graph && (
          <div className="bezier-graph-range" aria-hidden="true">
            <span>
              {formatGraphValue(
                graphValues.start,
                graph.precision,
                graph.unit,
              )}
            </span>
            <span>0–{graphValues.duration} s</span>
            <span>
              {formatGraphValue(
                graphValues.end,
                graph.precision,
                graph.unit,
              )}
            </span>
          </div>
        )}

        <div className="bezier-coordinate-grid">
          {COORDINATE_LABELS.map((coordinate, index) => (
            <label key={coordinate}>
              <span>{coordinate}</span>
              <input
                aria-label={`${label}: ${coordinate}`}
                data-bezier-coordinate={coordinate}
                max={index === 0 || index === 2 ? 1 : 2}
                min={index === 0 || index === 2 ? 0 : -2}
                onChange={(event) =>
                  handleCoordinate(index, event.target.value)
                }
                step="0.001"
                type="number"
                value={formatCoordinate(points[index])}
              />
            </label>
          ))}
        </div>
      </div>

      <label className="bezier-value-label" htmlFor={`setting-${name}`}>
        <span>Значение</span>
        <input
          aria-invalid={parseCubicBezier(curveText) ? "false" : "true"}
          autoComplete="off"
          data-setting-input
          id={`setting-${name}`}
          name={name}
          onChange={handleCurveText}
          ref={inputRef}
          spellCheck="false"
          type="text"
          value={curveText}
        />
      </label>

      <div className="bezier-preview-panel">
        <div className="bezier-preview-header">
          <span>Preview &amp; compare</span>
          <button
            onClick={() => setPreviewKey((value) => value + 1)}
            type="button"
          >
            Повторить
          </button>
        </div>
        <CurvePreview curve={validCurve} previewKey={previewKey} />
      </div>
    </div>
  );
}
