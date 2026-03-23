/**
 * Integration tests for the users Feathers service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { feathers } from '@feathersjs/feathers';
import { createTestDb } from '../../test-utils/db.js';
import { registerUsersService } from '../feathers/users.service.js';

const db = createTestDb({ beforeEach, afterEach });

const params = (user) => ({ provider: 'rest', user });
const unauthParams = { provider: 'rest' };

function makeApp(dbRef) {
  const app = feathers();
  app.set('db', dbRef);
  app.set('paginate', { default: 20, max: 100 });
  registerUsersService(app);
  return app;
}

let app;
let user1;
let user2;
let pendingUser;

beforeEach(async () => {
  await db('users').insert([
    { github_id: 1, username: 'alice', access_token: 'tok1', approved: true },
    { github_id: 2, username: 'bob', access_token: 'tok2', approved: true },
    { github_id: 3, username: 'charlie', access_token: 'tok3', approved: false },
  ]);
  user1 = await db('users').where({ username: 'alice' }).first();
  user2 = await db('users').where({ username: 'bob' }).first();
  pendingUser = await db('users').where({ username: 'charlie' }).first();

  app = makeApp(db);
  await app.setup();
});

describe('Users service - find', () => {
  it('any authenticated user can list all users', async () => {
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    expect(data.length).toBeGreaterThanOrEqual(3);
  });

  it('unauthenticated find is rejected', async () => {
    await expect(app.service('users').find(unauthParams)).rejects.toThrow('Not authenticated');
  });

  it('results are ordered by created_at desc', async () => {
    const result = await app.service('users').find(params(user1));
    const data = result.data ?? result;
    for (let i = 1; i < data.length; i++) {
      expect(new Date(data[i - 1].created_at) >= new Date(data[i].created_at)).toBe(true);
    }
  });
});

describe('Users service - approve', () => {
  it('any authenticated user can approve a pending user', async () => {
    await app.service('users').approve(pendingUser.id, params(user1));

    const updated = await db('users').where({ id: pendingUser.id }).first();
    expect(updated.approved).toBe(1); // SQLite stores booleans as 0/1
  });

  it('unauthenticated approve is rejected', async () => {
    await expect(app.service('users').approve(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - reject', () => {
  it('any authenticated user can reject (revoke) an approved user', async () => {
    await app.service('users').reject(user2.id, params(user1));

    const updated = await db('users').where({ id: user2.id }).first();
    expect(updated.approved).toBe(0);
  });

  it('unauthenticated reject is rejected', async () => {
    await expect(app.service('users').reject(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - get', () => {
  it('any authenticated user can get a user by id', async () => {
    const result = await app.service('users').get(user2.id, params(user1));
    expect(result.id).toBe(user2.id);
    expect(result.username).toBe('bob');
  });

  it('unauthenticated get is rejected', async () => {
    await expect(app.service('users').get(user1.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});

describe('Users service - create', () => {
  it('any authenticated user can create a new user', async () => {
    const result = await app
      .service('users')
      .create(
        { github_id: 999, username: 'newuser', access_token: 'tok_new', approved: false },
        params(user1)
      );
    expect(result.username).toBe('newuser');
    const row = await db('users').where({ username: 'newuser' }).first();
    expect(row).toBeTruthy();
  });

  it('unauthenticated create is rejected', async () => {
    await expect(
      app
        .service('users')
        .create({ github_id: 999, username: 'newuser', access_token: 'tok_new' }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });
});

describe('Users service - patch', () => {
  it('a user can patch themselves', async () => {
    const result = await app
      .service('users')
      .patch(user1.id, { model: 'claude-opus-4-6' }, params(user1));
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('a user cannot patch another user', async () => {
    await expect(
      app.service('users').patch(user2.id, { approved: false }, params(user1))
    ).rejects.toThrow('Can only patch own user');
  });

  it('unauthenticated patch is rejected', async () => {
    await expect(
      app.service('users').patch(user2.id, { approved: false }, unauthParams)
    ).rejects.toThrow('Not authenticated');
  });

  it('encrypts github_token on patch', async () => {
    await app.service('users').patch(user1.id, { github_token: 'ghp_testtoken' }, params(user1));
    const row = await db('users').where({ id: user1.id }).first();
    expect(row.github_token_encrypted).toBeTruthy();
    expect(row.github_token_encrypted).not.toBe('ghp_testtoken');
  });

  it('returns masked github_token for external calls', async () => {
    await app.service('users').patch(user1.id, { github_token: 'ghp_testtoken123' }, params(user1));
    const result = await app.service('users').get(user1.id, params(user1));
    expect(result.github_token).toBeTruthy();
    expect(result.github_token).not.toBe('ghp_testtoken123');
    expect(result.github_token_encrypted).toBeUndefined();
    expect(result.access_token).toBeUndefined();
  });

  it('returns decrypted github_token for internal calls (no provider)', async () => {
    await app.service('users').patch(user1.id, { github_token: 'ghp_testtoken123' }, params(user1));
    const result = await app.service('users').get(user1.id, { user: user1 }); // no provider = internal
    expect(result.github_token).toBe('ghp_testtoken123');
    expect(result.github_token_encrypted).toBeUndefined();
  });
});

describe('Users service - remove', () => {
  it('any authenticated user can remove a user', async () => {
    await app.service('users').remove(pendingUser.id, params(user1));
    const row = await db('users').where({ id: pendingUser.id }).first();
    expect(row).toBeUndefined();
  });

  it('unauthenticated remove is rejected', async () => {
    await expect(app.service('users').remove(pendingUser.id, unauthParams)).rejects.toThrow(
      'Not authenticated'
    );
  });
});
