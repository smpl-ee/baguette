import { vi } from 'vitest';

// Ensures the SDK is not called in tests.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));
