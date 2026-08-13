export function parseModelField(model) {
  if (!model) return null;
  try {
    const parsed = JSON.parse(model);
    if (parsed?.id) return parsed.id;
  } catch {}
  return model;
}

export function parseModelFieldFull(model) {
  if (!model) return { id: null, params: null };
  try {
    const parsed = JSON.parse(model);
    if (parsed?.id) return { id: parsed.id, params: parsed.params || null };
  } catch {}
  return { id: model, params: null };
}

export function variantLabel(variant, modelDisplayName) {
  if (variant.display_name && variant.display_name !== modelDisplayName) {
    return variant.display_name;
  }
  return variant.params?.map((p) => `${p.id}:${p.value}`).join(', ') || variant.display_name || '';
}
