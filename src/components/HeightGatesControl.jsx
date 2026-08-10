import { useEffect, useRef, useState } from "react";

import "../../shared/room-settings.js";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;
const DEFAULT_GATE_DURATION_SECONDS = 10;

function parseHeightGates(value) {
  try {
    return SharedRoomSettings.sanitizeHeightGates(JSON.parse(value || "[]"));
  } catch {
    return [];
  }
}

function createHeightGateId() {
  if (globalThis.crypto?.randomUUID) {
    return `height-gate-${globalThis.crypto.randomUUID()}`;
  }
  return `height-gate-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextFreeHeight(gates) {
  const used = new Set(gates.map((gate) => gate.heightPercent));
  const preferred = [50, 25, 75];
  return (
    preferred.find((height) => !used.has(height)) ||
    Array.from({ length: 99 }, (_, index) => index + 1).find(
      (height) => !used.has(height),
    ) ||
    50
  );
}

export function HeightGatesControl({ control, hidden = false }) {
  const { defaultValue, hint, label, name } = control;
  const inputRef = useRef(null);
  const [gates, setGates] = useState(() => parseHeightGates(defaultValue));

  function commit(candidateGates) {
    const clean = SharedRoomSettings.sanitizeHeightGates(candidateGates);
    setGates(clean);
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = JSON.stringify(clean);
    inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function updateGate(id, changes) {
    const candidate = gates.map((gate) =>
      gate.id === id ? { ...gate, ...changes } : gate,
    );
    const clean = SharedRoomSettings.sanitizeHeightGates(candidate);
    if (clean.length !== gates.length) {
      return;
    }
    commit(clean);
  }

  function addGate() {
    if (gates.length >= SharedRoomSettings.MAX_HEIGHT_GATES) {
      return;
    }
    commit([
      ...gates,
      {
        id: createHeightGateId(),
        heightPercent: nextFreeHeight(gates),
        durationSeconds: DEFAULT_GATE_DURATION_SECONDS,
      },
    ]);
  }

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }
    const sync = () => setGates(parseHeightGates(input.value));
    input.addEventListener("settings-control-sync", sync);
    return () => input.removeEventListener("settings-control-sync", sync);
  }, []);

  return (
    <div
      className="control height-gates-control"
      data-hint={hint}
      data-setting-control
      data-structured-setting-control
      hidden={hidden}
    >
      <div className="control-label">
        <span>{label}</span>
        <output className="control-value">
          {gates.length}/{SharedRoomSettings.MAX_HEIGHT_GATES}
        </output>
      </div>
      <input
        ref={inputRef}
        data-setting-input
        name={name}
        type="hidden"
        defaultValue={JSON.stringify(gates)}
      />
      <div className="height-gates-control__list">
        {gates.map((gate, index) => (
          <div
            className="height-gates-control__row"
            data-testid="height-gate-row"
            key={gate.id}
          >
            <span className="height-gates-control__index">{index + 1}</span>
            <label>
              <span>Высота, %</span>
              <input
                aria-label={`Высота метки ${index + 1}`}
                type="number"
                min={1}
                max={99}
                step={1}
                value={gate.heightPercent}
                onChange={(event) =>
                  updateGate(gate.id, {
                    heightPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Пауза, с</span>
              <input
                aria-label={`Длительность метки ${index + 1}`}
                type="number"
                min={1}
                max={60}
                step={1}
                value={gate.durationSeconds}
                onChange={(event) =>
                  updateGate(gate.id, {
                    durationSeconds: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              type="button"
              aria-label={`Удалить метку ${index + 1}`}
              data-testid="height-gate-remove"
              onClick={() => commit(gates.filter((item) => item.id !== gate.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="height-gates-control__add"
        type="button"
        data-testid="height-gate-add"
        disabled={gates.length >= SharedRoomSettings.MAX_HEIGHT_GATES}
        onClick={addGate}
      >
        Добавить метку
      </button>
    </div>
  );
}
