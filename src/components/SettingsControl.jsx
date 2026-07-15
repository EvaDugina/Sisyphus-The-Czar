export function SettingsControl({ control }) {
  const {
    defaultChecked,
    defaultValue,
    hint,
    label,
    name,
    options,
    output,
    type,
    ...inputProps
  } = control;

  if (type === "checkbox") {
    return (
      <label className="control is-check" data-hint={hint}>
        <input name={name} type="checkbox" defaultChecked={defaultChecked} />
        <span>{label}</span>
      </label>
    );
  }

  const field =
    type === "select" ? (
      <select name={name} defaultValue={defaultValue}>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    ) : (
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        {...inputProps}
      />
    );

  return (
    <label className="control" data-hint={hint}>
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
