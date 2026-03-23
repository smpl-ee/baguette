import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    exclude: ['**/node_modules/**', '**/.data/**'],
    setupFiles: ['./server/test-utils/setup.js'],
  },
});
