import { query } from '@anthropic-ai/claude-agent-sdk';
import * as cache from '../lib/cache.js';

const MODELS_CACHE_KEY = 'anthropic-models';
const MODELS_CACHE_TTL = 24 * 60 * 60; // 24 hours

export async function listModels() {
  return cache.fetch(MODELS_CACHE_KEY, MODELS_CACHE_TTL, async () => {
    const q = query({ prompt: '' });
    try {
      const sdkModels = await q.supportedModels();
      return [
        ...sdkModels.map((m) => {
          // Description always start with Name X.Y, let's try to extract the name and version 
          const displayName = m.description.match(/^([\w\s]+)([\d.]+)/)?.[0] || m.displayName;
          return { id: m.value, display_name: displayName, description: m.description };
        }),
      ];
    } finally {
      q.close();
    }
  });
}