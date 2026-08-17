/**
 * Keeps only loader rows that produce a stable non-empty key and a readable label.
 * Drops non-arrays, nullish items, duplicates (by string key), and rows where
 * getOptionValue / getOptionLabel throw.
 */
export function sanitizeAsyncOptions(list, getOptionValue, getOptionLabel) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (item == null) continue;
    let keyRaw;
    try {
      keyRaw = getOptionValue(item);
    } catch {
      continue;
    }
    if (keyRaw == null) continue;
    const keyStr = String(keyRaw).trim();
    if (!keyStr) continue;
    if (seen.has(keyStr)) continue;
    try {
      void getOptionLabel(item);
    } catch {
      continue;
    }
    seen.add(keyStr);
    out.push(item);
  }
  return out;
}
