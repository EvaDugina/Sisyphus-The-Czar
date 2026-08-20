import { useEffect, useRef, useState } from "react";

import "../../shared/room-settings.js";

const SharedRoomSettings = globalThis.SisyphusRoomSettings;
const EFFECT_OPTIONS = Object.freeze([
  ["brandon-mercer", "Brandon Mercer Flowmap"],
  ["liquid-bulge", "Liquid Bulge"],
  ["vortex-lens", "Vortex Lens"],
  ["pinch-tunnel", "Pinch Tunnel"],
  ["ripple-glass", "Ripple Glass"],
]);
const RECOVERY_THRESHOLD = 0.05;
const RECOVERY_FPS = 60;

function parseConfig(value) {
  try {
    return SharedRoomSettings.sanitizeRockLensConfig(
      typeof value === "string" ? JSON.parse(value || "{}") : value,
    );
  } catch {
    return SharedRoomSettings.sanitizeRockLensConfig({});
  }
}

function recoverySeconds(dissipation) {
  const clean = Math.min(0.999, Math.max(0.01, Number(dissipation) || 0.96));
  return Math.log(RECOVERY_THRESHOLD) / (RECOVERY_FPS * Math.log(clean));
}

function dissipationForSeconds(seconds) {
  const clean = Math.max(0.1, Number(seconds) || 1.2);
  return Math.pow(RECOVERY_THRESHOLD, 1 / (RECOVERY_FPS * clean));
}

function RangeField({ label, min, max, step, value, output, onChange }) {
  return (
    <label className="rock-lens-control__field">
      <span>
        {label}
        <output>{output}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function RockLensControl({ control, hidden = false }) {
  const { defaultValue, hint, label, name } = control;
  const inputRef = useRef(null);
  const [config, setConfig] = useState(() => parseConfig(defaultValue));

  function commit(candidate) {
    const clean = SharedRoomSettings.sanitizeRockLensConfig(candidate, config);
    setConfig(clean);
    if (!inputRef.current) {
      return;
    }
    inputRef.current.value = JSON.stringify(clean);
    inputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function selectEffect(effect) {
    commit(SharedRoomSettings.ROCK_LENS_PRESETS[effect]);
  }

  function update(key, value) {
    commit({ ...config, [key]: value });
  }

  function resetPreset() {
    commit(SharedRoomSettings.ROCK_LENS_PRESETS[config.effect]);
  }

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return undefined;
    }
    const sync = () => setConfig(parseConfig(input.value));
    input.addEventListener("settings-control-sync", sync);
    return () => input.removeEventListener("settings-control-sync", sync);
  }, []);

  const recovery = recoverySeconds(config.dissipation);
  const limits = SharedRoomSettings.ROOM_SETTINGS_LIMITS;

  return (
    <div
      className="control rock-lens-control"
      data-hint={hint}
      data-setting-control
      data-structured-setting-control
      data-testid="rock-lens-control"
      hidden={hidden}
    >
      <div className="control-label">
        <span>{label}</span>
        <output className="control-value">
          {EFFECT_OPTIONS.find(([value]) => value === config.effect)?.[1]}
        </output>
      </div>
      <input
        ref={inputRef}
        data-setting-input
        name={name}
        type="hidden"
        defaultValue={JSON.stringify(config)}
      />

      <label className="rock-lens-control__field rock-lens-control__effect">
        <span>Эффект</span>
        <select
          aria-label="Эффект линзы"
          value={config.effect}
          onChange={(event) => selectEffect(event.target.value)}
        >
          {EFFECT_OPTIONS.map(([value, text]) => (
            <option key={value} value={value}>{text}</option>
          ))}
        </select>
      </label>

      <div className="rock-lens-control__grid">
        <RangeField
          label="Радиус"
          min={limits.rockLensRadius[0]}
          max={limits.rockLensRadius[1]}
          step={0.01}
          value={config.radius}
          output={`${Math.round(config.radius * 100)}%`}
          onChange={(value) => update("radius", value)}
        />
        <RangeField
          label="Сила UV"
          min={limits.rockLensStrength[0]}
          max={limits.rockLensStrength[1]}
          step={0.01}
          value={config.strength}
          output={config.strength.toFixed(2)}
          onChange={(value) => update("strength", value)}
        />
        <RangeField
          label="Мягкость края"
          min={limits.rockLensSoftness[0]}
          max={limits.rockLensSoftness[1]}
          step={0.05}
          value={config.softness}
          output={config.softness.toFixed(2)}
          onChange={(value) => update("softness", value)}
        />
        <RangeField
          label="Закручивание"
          min={limits.rockLensTwistDegrees[0]}
          max={limits.rockLensTwistDegrees[1]}
          step={5}
          value={config.twistDegrees}
          output={`${Math.round(config.twistDegrees)}°`}
          onChange={(value) => update("twistDegrees", value)}
        />
        <RangeField
          label="Инерция следа"
          min={limits.rockLensTrail[0]}
          max={limits.rockLensTrail[1]}
          step={0.01}
          value={config.trail}
          output={`${config.trail.toFixed(2)} / ${Math.min(0.1, config.trail).toFixed(2)}`}
          onChange={(value) => update("trail", value)}
        />
        <RangeField
          label="Восстановление"
          min={0.1}
          max={5}
          step={0.1}
          value={Math.min(5, Math.max(0.1, recovery))}
          output={`${recovery.toFixed(1)} с · ${config.dissipation.toFixed(3)}`}
          onChange={(value) => update("dissipation", dissipationForSeconds(value))}
        />
      </div>

      <div className="rock-lens-control__actions">
        <label className="rock-lens-control__field">
          <span>Активация</span>
          <select
            aria-label="Активация линзы"
            value={config.activation}
            onChange={(event) => update("activation", event.target.value)}
          >
            <option value="hover">Наведение — как на сайте</option>
            <option value="hold">Удержание pointer down</option>
          </select>
        </label>
        <button type="button" data-testid="rock-lens-reset" onClick={resetPreset}>
          Сбросить пресет
        </button>
      </div>
    </div>
  );
}
