export function isFieldVisible(field, values) {
  return (field.attached ?? []).every((condition) => condition.values.includes(values[condition.key]));
}

export function resolveVisibleFields(fields, values) {
  let visible = fields;
  for (;;) {
    const visibleKeys = new Set(visible.map((field) => field.key));
    const effective = Object.fromEntries(fields.map((f) => [f.key, visibleKeys.has(f.key) ? values[f.key] : null]));
    const next = visible.filter((field) => isFieldVisible(field, effective));
    if (next.length === visible.length) return visible;
    visible = next;
  }
}

export function buildForm(fields, values) {
  const ordered = fields.toSorted((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  const visible = resolveVisibleFields(ordered, values);

  const formData = Object.fromEntries(visible.map((field) => [field.key, values[field.key] ?? null]));
  const missingRequired = visible
    .filter((field) => field.required === true && formData[field.key] === null)
    .map((field) => field.key);

  return { formData, missingRequired };
}
