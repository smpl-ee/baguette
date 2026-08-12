import { Cursor } from '@cursor/sdk';
import * as cache from '../lib/cache.js';

const MODELS_CACHE_KEY_PREFIX = 'cursor-models';
const MODELS_CACHE_TTL = 24 * 60 * 60; // 24 hours

export async function listCursorModels(apiKey) {
  const cacheKey = `${MODELS_CACHE_KEY_PREFIX}-keyed`;
  return cache.fetch(cacheKey, MODELS_CACHE_TTL, async () => {
    const sdkModels = await Cursor.models.list({ apiKey });
    return sdkModels
      .filter((m) => m.id !== '')
      .map((m) => ({
        id: m.id,
        display_name: m.displayName ?? m.id,
        description: m.description ?? null,
        variants: m.variants?.length
          ? m.variants.map((v) => ({
              display_name: v.displayName,
              description: v.description ?? null,
              is_default: v.isDefault ?? false,
              params: v.params,
            }))
          : null,
      }));
  });
}
