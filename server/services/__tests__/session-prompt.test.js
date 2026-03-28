import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTestDb } from '../../test-utils/db.js';
import { buildTurnEndInstructions, buildSystemPromptAppend } from '../session-prompt.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../baguette-config.js', () => ({
  loadBaguetteConfig: vi.fn().mockResolvedValue(null),
  interpolateEnv: vi.fn(),
  getScriptCommand: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  resolveDataDirRelativePath: vi.fn((p) => p || ''),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const db = createTestDb({ beforeEach, afterEach });

async function seedSession(fields = {}) {
  await db('users')
    .insert({ github_id: 1, username: 'alice', approved: true })
    .onConflict('github_id')
    .ignore();
  const user = await db('users').where({ username: 'alice' }).first();

  await db('repos')
    .insert({ full_name: 'test/repo', bare_path: '/tmp/repo' })
    .onConflict('full_name')
    .ignore();
  const repo = await db('repos').where({ full_name: 'test/repo' }).first();

  const [id] = await db('sessions').insert({
    user_id: user.id,
    repo_id: repo.id,
    repo_full_name: 'test/repo',
    base_branch: 'main',
    initial_prompt: 'Do something',
    short_id: 'test',
    status: 'running',
    ...fields,
  });

  return db('sessions').where({ id }).first();
}

// ── buildTurnEndInstructions ──────────────────────────────────────────────────

describe('buildTurnEndInstructions', () => {
  describe('with values from the DB (SQLite stores booleans as 0/1)', () => {
    it('auto_push=1, auto_create_pr=1: includes commit/push and PR creation', async () => {
      const session = await seedSession({ auto_push: true, auto_create_pr: true });
      const result = buildTurnEndInstructions(session);
      expect(result).toContain('Stage and commit');
      expect(result).toContain('GitPush');
      expect(result).toContain('If there is no PR open, create one');
    });

    it('auto_push=1, auto_create_pr=0: includes commit/push but forbids PR creation', async () => {
      const session = await seedSession({ auto_push: true, auto_create_pr: false });
      const result = buildTurnEndInstructions(session);
      expect(result).toContain('Stage and commit');
      expect(result).toContain('GitPush');
      expect(result).toContain('Do NOT create a pull request');
      expect(result).not.toContain('If there is no PR open, create one');
    });

    it('auto_push=0: forbids commit/push entirely regardless of auto_create_pr', async () => {
      const session = await seedSession({ auto_push: false, auto_create_pr: true });
      const result = buildTurnEndInstructions(session);
      expect(result).toContain('Do NOT commit or push');
      expect(result).not.toContain('Stage and commit');
      expect(result).not.toContain('GitPush');
      expect(result).not.toContain('create one');
    });

    it('auto_push=0, auto_create_pr=0: forbids everything', async () => {
      const session = await seedSession({ auto_push: false, auto_create_pr: false });
      const result = buildTurnEndInstructions(session);
      expect(result).toContain('Do NOT commit or push');
      expect(result).not.toContain('Stage and commit');
    });
  });

  describe('with default DB values (columns default to 1)', () => {
    it('omitting flags uses defaults: push and PR enabled', async () => {
      const session = await seedSession();
      const result = buildTurnEndInstructions(session);
      expect(result).toContain('Stage and commit');
      expect(result).toContain('If there is no PR open, create one');
    });
  });
});

// ── buildSystemPromptAppend ───────────────────────────────────────────────────

describe('buildSystemPromptAppend', () => {
  it('returns a non-empty string containing the base_branch', async () => {
    const session = await seedSession({ base_branch: 'my-feature' });
    const result = await buildSystemPromptAppend(session);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain('my-feature');
  });

  it('includes commit/push instructions when auto_push=1', async () => {
    const session = await seedSession({ auto_push: true });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Stage and commit');
    expect(result).toContain('GitPush');
  });

  it('includes no-push instruction when auto_push=0', async () => {
    const session = await seedSession({ auto_push: false });
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('Do NOT commit or push');
  });

  it('includes baguette config notice when loadBaguetteConfig returns null', async () => {
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).toContain('no .baguette.yaml config file');
  });

  it('omits baguette config notice when loadBaguetteConfig returns a config', async () => {
    const { loadBaguetteConfig } = await import('../baguette-config.js');
    loadBaguetteConfig.mockResolvedValueOnce({ webserver: { port: 3000 } });
    const session = await seedSession();
    const result = await buildSystemPromptAppend(session);
    expect(result).not.toContain('no .baguette.yaml config file');
  });
});
