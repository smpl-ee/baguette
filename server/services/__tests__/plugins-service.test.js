import { describe, it, expect } from 'vitest';
import { parsePluginInput } from '../plugins-service.js';

describe('parsePluginInput', () => {
  it('parses repo-root URL (no path after branch)', () => {
    expect(
      parsePluginInput('https://github.com/obra/superpowers/tree/main')
    ).toEqual({
      owner: 'obra',
      repo: 'superpowers',
      branch: 'main',
      pluginPath: '.',
    });
  });

  it('parses repo-root URL with trailing slash', () => {
    expect(parsePluginInput('https://github.com/obra/superpowers/tree/main/')).toEqual({
      owner: 'obra',
      repo: 'superpowers',
      branch: 'main',
      pluginPath: '.',
    });
  });

  it('parses nested plugin path', () => {
    expect(
      parsePluginInput('https://github.com/owner/repo/tree/main/plugins/foo')
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      pluginPath: 'plugins/foo',
    });
  });

  it('rejects non-GitHub tree URLs', () => {
    expect(() => parsePluginInput('https://gitlab.com/a/b/tree/main')).toThrow(/Invalid plugin URL/);
  });
});
