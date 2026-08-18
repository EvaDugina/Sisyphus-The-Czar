import { useEffect, useRef, useState } from "react";
import { serializeSettingDependency } from "../lib/settingsDependencies.mjs";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;

function parseGlassStrips(value) {
  try {
    return SharedRoomSettings.sanitizeSceneTwoGlassStrips(
      JSON.parse(value || "[]"),
    );
  } catch {
    return [];
  }
}

function createGlassStripId() {
  if (typeof crypto?.randomUUID === "function") {
    return `glass-strip-${crypto.randomUUID()}`;
  }
  return `glass-strip-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nextHeightPercent(strips) {
  const used = new Set(strips.map((strip) => strip.heightPercent));
  for (let height = 20; height <= 90; height += 15) {
    if (!used.has(height)) {
      return height;
    }
  }
  return Math.min(99, 10 + strips.length * 7);
}

export function GlassStripsControl({ control, hidden = false }) {
  const { defaultValue, enabledWhen, hint, label, name } = control;
  const inputRef = useRef(null);
  const [strips, setStrips] = useState(() => parseGlassStrips(defaultValue));

  function commit(candidateStrips) {
    const clean = SharedRoomSettings.sanitizeSceneTwoGlassStrips(candidateStrips);
    setStrips(clean);
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = JSON.stringify(clean);
    inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function updateStrip(id, changes) {
    commit(
      strips.map((strip) =>
        strip.id === id ? { ...strip, ...changes } : strip,
      ),
    );
  }

  function addStrip() {
    if (strips.length >= SharedRoomSettings.MAX_SCENE_TWO_GLASS_STRIPS) {
      return;
    }
    const index = strips.length;
    commit([
      ...strips,
      {
        id: createGlassStripId(),
        enabled: true,
        heightPercent: nextHeightPercent(strips),
        xPercent: index % 2 === 0 ? 0 : 45,
        widthPercent: 55,
        heightVh: 3,
      },
    ]);
  }

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }
    const sync = () => setStrips(parseGlassStrips(input.value));
    input.addEventListener("settings-control-sync", sync);
    return () => input.removeEventListener("settings-control-sync", sync);
  }, []);

  return (
    <div
      className="control glass-strips-control"
      data-hint={hint}
      data-setting-control
      data-setting-enabled-when={serializeSettingDependency(enabledWhen)}
      data-structured-setting-control
      hidden={hidden}
    >
      <div className="control-label">
        <span>{label}</span>
        <output className="control-value">
          {strips.length}/{SharedRoomSettings.MAX_SCENE_TWO_GLASS_STRIPS}
        </output>
      </div>
      <input
        ref={inputRef}
        data-setting-input
        name={name}
        type="hidden"
        defaultValue={JSON.stringify(strips)}
      />
      <div className="glass-strips-control__list">
        {strips.map((strip, index) => (
          <fieldset
            className="glass-strips-control__row"
            data-testid="glass-strip-row"
            key={strip.id}
          >
            <legend>Полоса {index + 1}</legend>
            <label className="glass-strips-control__enabled">
              <input
                aria-label={`Включить полосу ${index + 1}`}
                type="checkbox"
                checked={strip.enabled}
                onChange={(event) =>
                  updateStrip(strip.id, { enabled: event.target.checked })
                }
              />
              <span>Включена</span>
            </label>
            <label>
              <span>Высота пути, %</span>
              <input
                aria-label={`Высота пути полосы ${index + 1}`}
                type="number"
                min={1}
                max={99}
                step={1}
                value={strip.heightPercent}
                onChange={(event) =>
                  updateStrip(strip.id, {
                    heightPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Слева, %</span>
              <input
                aria-label={`Положение слева полосы ${index + 1}`}
                type="number"
                min={0}
                max={90}
                step={1}
                value={strip.xPercent}
                onChange={(event) =>
                  updateStrip(strip.id, {
                    xPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Ширина, %</span>
              <input
                aria-label={`Ширина полосы ${index + 1}`}
                type="number"
                min={10}
                max={90}
                step={1}
                value={strip.widthPercent}
                onChange={(event) =>
                  updateStrip(strip.id, {
                    widthPercent: Number(event.target.value),
                  })
                }
              />
            </label>
            <label>
              <span>Толщина, vh</span>
              <input
                aria-label={`Толщина полосы ${index + 1}`}
                type="number"
                min={1}
                max={40}
                step={0.5}
                value={strip.heightVh}
                onChange={(event) =>
                  updateStrip(strip.id, {
                    heightVh: Number(event.target.value),
                  })
                }
              />
            </label>
            <button
              type="button"
              aria-label={`Удалить полосу ${index + 1}`}
              data-testid="glass-strip-remove"
              onClick={() => commit(strips.filter((item) => item.id !== strip.id))}
            >
              Удалить
            </button>
          </fieldset>
        ))}
      </div>
      <button
        className="glass-strips-control__add"
        type="button"
        data-testid="glass-strip-add"
        disabled={strips.length >= SharedRoomSettings.MAX_SCENE_TWO_GLASS_STRIPS}
        onClick={addStrip}
      >
        Добавить полосу
      </button>
    </div>
  );
}
