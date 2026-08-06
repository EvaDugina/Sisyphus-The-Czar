import { CubicBezierControl } from "./CubicBezierControl";
import { HeightGatesControl } from "./HeightGatesControl";
import { serializeSettingDependency } from "../lib/settingsDependencies.mjs";

export function SettingsControl({ control }) {
  const {
    activeLabel,
    defaultChecked,
    defaultValue,
    enabledWhen,
    formulas,
    hint,
    label,
    name,
    inactiveLabel,
    options,
    output,
    scope,
    type,
    ...inputProps
  } = control;
  const formulasAttr =
    Array.isArray(formulas) && formulas.length > 0
      ? JSON.stringify(formulas)
      : undefined;

  if (type === "cubic-bezier") {
    return <CubicBezierControl control={control} />;
  }

  if (type === "height-gates") {
    return <HeightGatesControl control={control} />;
  }

  if (type === "checkbox") {
    return (
      <label
        className="control is-check"
        data-hint={hint}
        data-formulas={formulasAttr}
        data-setting-control
        data-setting-enabled-when={serializeSettingDependency(enabledWhen)}
        data-setting-scope={scope}
      >
        <input
          data-setting-input
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
        />
        <span>{label}</span>
      </label>
    );
  }

  if (type === "toggle-button") {
    const activeText = activeLabel || "Включено";
    const inactiveText = inactiveLabel || "Выключено";
    const updateButton = (button, active) => {
      button.setAttribute("aria-pressed", String(active));
      button.textContent = active ? activeText : inactiveText;
    };
    const toggle = (event) => {
      const button = event.currentTarget;
      const input = button
        .closest("[data-setting-control]")
        ?.querySelector('input[type="checkbox"][name]');
      if (!input || input.disabled) {
        return;
      }
      input.checked = !input.checked;
      updateButton(button, input.checked);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };

    return (
      <div
        className="control is-toggle-button"
        data-hint={hint}
        data-formulas={formulasAttr}
        data-setting-control
        data-setting-enabled-when={serializeSettingDependency(enabledWhen)}
        data-setting-scope={scope}
      >
        <span className="control-label">
          <span>{label}</span>
        </span>
        <input
          data-setting-input
          name={name}
          type="checkbox"
          defaultChecked={defaultChecked}
          hidden
        />
        <button
          className="control-toggle-button"
          type="button"
          aria-pressed={String(Boolean(defaultChecked))}
          data-setting-toggle-button
          data-active-label={activeText}
          data-inactive-label={inactiveText}
          onClick={toggle}
        >
          {defaultChecked ? activeText : inactiveText}
        </button>
      </div>
    );
  }

  const field =
    type === "select" ? (
      <select data-setting-input name={name} defaultValue={defaultValue}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    ) : (
      <input
        name={name}
        data-setting-input
        type={type}
        defaultValue={defaultValue}
        {...inputProps}
      />
    );

  return (
    <label
      className="control"
      data-hint={hint}
      data-formulas={formulasAttr}
      data-setting-control
      data-setting-enabled-when={serializeSettingDependency(enabledWhen)}
      data-setting-scope={scope}
    >
      <span className="control-label">
        <span>{label}</span>
        {output !== undefined && (
          <output className="control-value" data-output={name}>
            {output}
          </output>
        )}
      </span>
      {field}
    </label>
  );
}
