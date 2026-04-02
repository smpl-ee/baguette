/**
 * Integration tests for the secrets Feathers service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerSecretsService } from '../feathers/secrets.service.js';

const db = createTestDb({ beforeEach, afterEach });

const user1 = { id: 1 };
const user2 = { id: 2 };
const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  registerSecretsService(app);
  return app;
}

let app;

beforeEach(async () => {
  // Seed users so DB is not empty (secrets table exists after migrations)
  await db('users').insert([
    { github_id: 1, username: 'admin', approved: true },
    { github_id: 2, username: 'alice', approved: true },
  ]);
  app = makeApp(db);
  await app.setup();
});

describe('Secrets service - find', () => {
  it('any authenticated user can list secrets', async () => {
    await db('secrets').insert([
      { key: 'FOO', value: 'bar' },
      { key: 'BAZ', value: 'qux' },
    ]);

    const result = await app.service('secrets').find(params(user2));
    const data = result.data ?? result;
    expect(data).toHaveLength(2);
    expect(data.map((s) => s.key)).toContain('FOO');
  });

  it('returns safeValue (masked) instead of the raw value', async () => {
    await db('secrets').insert({ key: 'API_KEY', value: 'supersecretvalue' });

    const result = await app.service('secrets').find(params(user2));
    const data = result.data ?? result;
    const row = data.find((s) => s.key === 'API_KEY');
    expect(row.value).toBeUndefined();
    expect(row.safeValue).toMatch(/•/);
    expect(row.safeValue).not.toBe('supersecretvalue');
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('secrets').find(unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - create', () => {
  it('admin can create a new secret', async () => {
    await app.service('secrets').create({ key: 'NEW_KEY', value: 'secret' }, params(user1));

    const row = await db('secrets').where({ key: 'NEW_KEY' }).first();
    expect(row).toBeTruthy();
    expect(row.value).toBe('secret');
  });

  it('admin upserts when key already exists — updates value', async () => {
    await db('secrets').insert({ key: 'EXISTING', value: 'old' });

    const result = await app
      .service('secrets')
      .create({ key: 'EXISTING', value: 'new' }, params(user1));

    const rows = await db('secrets').where({ key: 'EXISTING' });
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe('new'); // raw DB value is updated
    expect(result.value).toBeUndefined(); // raw value stripped from response
    expect(result.safeValue).toMatch(/•/); // masked value returned as safeValue
  });

  it('any authenticated user can create a secret', async () => {
    await app.service('secrets').create({ key: 'K', value: 'v' }, params(user2));
    const row = await db('secrets').where({ key: 'K' }).first();
    expect(row).toBeTruthy();
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app.service('secrets').create({ key: 'K', value: 'v' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - get', () => {
  it('any authenticated user can get a secret by id (returns safeValue)', async () => {
    const [id] = await db('secrets').insert({ key: 'MY_KEY', value: 'mysecret' });

    const result = await app.service('secrets').get(id, params(user2));
    expect(result.id).toBe(id);
    expect(result.key).toBe('MY_KEY');
    expect(result.value).toBeUndefined();
    expect(result.safeValue).toMatch(/•/);
  });

  it('unauthenticated get is rejected', async () => {
    const [id] = await db('secrets').insert({ key: 'MY_KEY', value: 'mysecret' });
    await expect(app.service('secrets').get(id, unauthParams)).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - patch', () => {
  it('any authenticated user can patch a secret', async () => {
    const [id] = await db('secrets').insert({ key: 'PATCH_KEY', value: 'original' });

    const result = await app.service('secrets').patch(id, { value: 'updated' }, params(user2));
    expect(result.id).toBe(id);
    const row = await db('secrets').where({ id }).first();
    expect(row.value).toBe('updated');
  });

  it('unauthenticated patch is rejected', async () => {
    const [id] = await db('secrets').insert({ key: 'PATCH_KEY', value: 'original' });
    await expect(
      app.service('secrets').patch(id, { value: 'updated' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Secrets service - remove', () => {
  it('admin can delete a secret by id', async () => {
    const [id] = await db('secrets').insert({ key: 'TO_DELETE', value: 'val' });

    await app.service('secrets').remove(id, params(user1));

    const row = await db('secrets').where({ id }).first();
    expect(row).toBeUndefined();
  });

  it('any authenticated user can delete a secret', async () => {
    const [id] = await db('secrets').insert({ key: 'PROTECTED', value: 'val' });

    await app.service('secrets').remove(id, params(user2));
    const row = await db('secrets').where({ id }).first();
    expect(row).toBeUndefined();
  });

  it('unauthenticated remove is rejected', async () => {
    const [id] = await db('secrets').insert({ key: 'ALSO_PROTECTED', value: 'val' });

    await expect(app.service('secrets').remove(id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
