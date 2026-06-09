import { query } from '@anthropic-ai/claude-agent-sdk';
import * as cache from '../lib/cache.js';

const MODELS_CACHE_KEY = 'anthropic-models';
const MODELS_CACHE_TTL = 24 * 60 * 60; // 24 hours

export async function listModels() {
  return cache.fetch(MODELS_CACHE_KEY, MODELS_CACHE_TTL, async () => {
    const q = query({ prompt: '' });
    try {
      const sdkModels = await q.supportedModels();
      return sdkModels.map((m) => ({ id: m.value, display_name: m.displayName, description: m.description }));
    } finally {
      q.close();
    }
  });
}