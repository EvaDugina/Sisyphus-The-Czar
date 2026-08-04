import { useRef } from "react";

export const DEFAULT_DRAFT_BLEND_POINTS = Object.freeze([
  0.333,
  0,
  0.667,
  1,
]);

const COORDINATES = Object.freeze(["x1", "y1", "x2", "y2"]);
const COORDINATE_MAX = 2;
const KEYBOARD_STEP = 0.01;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundCoordinate(value) {
  return (
    Math.round(clamp(Number(value) || 0, 0, COORDINATE_MAX) * 1000) /
    1000
  );
}

function formatCoordinate(value) {
  return String(roundCoordinate(value));
}

export function formatDraftBlendCurve(points) {
  return `cubic-bezier(${points
    .map(formatCoordinate)
    .join(", ")})`;
}

function graphPoint(index, points) {
  return {
    x: (points[index * 2] / COORDINATE_MAX) * 100,
    y: 100 - (points[index * 2 + 1] / COORDINATE_MAX) * 100,
  };
}

export function DraftBlendCurveEditor({
  enabled,
  onChange,
  points,
}) {
  const graphRef = useRef(null);
  const activeHandleRef = useRef(null);
  const firstPoint = graphPoint(0, points);
  const secondPoint = graphPoint(1, points);
  const curveEnd = 100 / COORDINATE_MAX;
  const curvePath = `M 0 100 C ${firstPoint.x} ${firstPoint.y}, ${secondPoint.x} ${secondPoint.y}, ${curveEnd} ${100 - curveEnd}`;
  const curveText = formatDraftBlendCurve(points);

  function publishPoints(nextPoints) {
    onChange(nextPoints.map(roundCoordinate));
  }

  function updateHandleFromPointer(event, handleIndex) {
    const graph = graphRef.current;
    if (
      !enabled ||
      !graph ||
      activeHandleRef.current !== handleIndex
    ) {
      return;
    }
    const rect = graph.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const nextPoints = [...points];
    nextPoints[handleIndex * 2] = clamp(
      ((event.clientX - rect.left) / rect.width) * COORDINATE_MAX,
      0,
      COORDINATE_MAX,
    );
    nextPoints[handleIndex * 2 + 1] = clamp(
      (1 - (event.clientY - rect.top) / rect.height) * COORDINATE_MAX,
      0,
      COORDINATE_MAX,
    );
    publishPoints(nextPoints);
  }

  function beginHandleDrag(event, handleIndex) {
    if (!enabled) {
      return;
    }
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

  function handleCoordinate(index, rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return;
    }
    const nextPoints = [...points];
    nextPoints[index] = value;
    publishPoints(nextPoints);
  }

  function handleHandleKeyDown(event, handleIndex) {
    if (!enabled) {
      return;
    }
    const nextPoints = [...points];
    const xIndex = handleIndex * 2;
    const yIndex = xIndex + 1;
    const step = event.shiftKey ? KEYBOARD_STEP * 5 : KEYBOARD_STEP;

    if (event.key === "ArrowLeft") {
      nextPoints[xIndex] -= step;
    } else if (event.key === "ArrowRight") {
      nextPoints[xIndex] += step;
    } else if (event.key === "ArrowUp") {
      nextPoints[yIndex] += step;
    } else if (event.key === "ArrowDown") {
      nextPoints[yIndex] -= step;
    } else {
      return;
    }

    event.preventDefault();
    publishPoints(nextPoints);
  }

  return (
    <fieldset
      className="draft-fold-blend-editor"
      data-draft-fold-blend-editor
      data-disabled={String(!enabled)}
      disabled={!enabled}
    >
      <legend>Кривая смешивания</legend>
      <output className="draft-fold-blend-editor__value">
        {curveText}
      </output>

      <svg
        className="bezier-graph"
        ref={graphRef}
        viewBox="0 0 100 100"
        role="img"
        aria-label="График смешивания: позиция к верхнему краю и интенсивность"
      >
        <path className="bezier-grid-line" d="M 0 75 H 100" />
        <path className="bezier-grid-line" d="M 0 50 H 100" />
        <path className="bezier-grid-line" d="M 0 25 H 100" />
        <path className="bezier-diagonal" d="M 0 100 L 100 0" />
        <path
          className="bezier-handle-line"
          d={`M 0 100 L ${firstPoint.x} ${firstPoint.y}`}
        />
        <path
          className="bezier-handle-line"
          d={`M ${curveEnd} ${100 - curveEnd} L ${secondPoint.x} ${secondPoint.y}`}
        />
        <path className="bezier-curve" d={curvePath} />
        {[firstPoint, secondPoint].map((point, index) => {
          const x = points[index * 2];
          const y = points[index * 2 + 1];
          return (
            <circle
              className={`bezier-handle is-${index + 1}`}
              cx={point.x}
              cy={point.y}
              key={COORDINATES[index * 2]}
              r="5"
              role="button"
              tabIndex={enabled ? 0 : -1}
              aria-disabled={String(!enabled)}
              aria-label={`Контрольная точка ${index + 1}: x ${formatCoordinate(x)}, y ${formatCoordinate(y)}`}
              data-draft-fold-bezier-handle={index + 1}
              onKeyDown={(event) =>
                handleHandleKeyDown(event, index)
              }
              onPointerDown={(event) => beginHandleDrag(event, index)}
              onPointerMove={(event) =>
                updateHandleFromPointer(event, index)
              }
              onPointerUp={endHandleDrag}
              onPointerCancel={endHandleDrag}
            />
          );
        })}
        <text className="bezier-axis-label" x="50" y="98">
          к верхнему краю
        </text>
        <text
          className="bezier-axis-label"
          x="4"
          y="50"
          transform="rotate(-90 4 50)"
        >
          интенсивность
        </text>
      </svg>

      <div className="bezier-coordinate-grid">
        {COORDINATES.map((coordinate, index) => (
          <label key={coordinate}>
            <span>{coordinate}</span>
            <input
              aria-label={`Кривая смешивания: ${coordinate}`}
              data-draft-fold-bezier-coordinate={coordinate}
              max={COORDINATE_MAX}
              min="0"
              name={`draftFoldBlend${coordinate.toUpperCase()}`}
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
    </fieldset>
  );
}
