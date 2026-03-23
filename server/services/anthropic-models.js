const MODELS = [
  { id: '', display_name: 'Default' },
  { id: 'claude-opus-4-6', display_name: 'Claude Opus 4.6', model: 'opus' },
  { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6', model: 'sonnet' },
  { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', model: 'haiku' },
];

export async function listModels() {
  return MODELS;
}

export function getModelId(model) {
  const entry = MODELS.find((m) => m.model === model);
  if (!entry) throw new Error(`Unknown model: ${model}`);
  return entry.id;
}
