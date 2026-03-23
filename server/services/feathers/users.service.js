import { KnexService } from '@feathersjs/knex';
import { NotAuthenticated } from '@feathersjs/errors';
import { requireUser } from './hooks.js';
import { encrypt, decrypt } from '../../lib/encrypt.js';
import { SYSTEM_ALLOWED_COMMANDS } from '../../services/agent-settings.js';

function maskValue(value) {
  if (!value || value.length <= 6) return '••••••';
  return value.slice(0, 3) + '•'.repeat(Math.min(value.length - 6, 10)) + value.slice(-3);
}

/**
 * Users service (table: users). Admin-only. Supports listing, getting,
 * and custom approve/reject methods.
 */
class UsersService extends KnexService {
  async approve(id, _params) {
    const db = this.options.Model;
    await db('users').where({ id }).update({ approved: true });
    return db('users').where({ id }).first();
  }

  async reject(id, _params) {
    const db = this.options.Model;
    const user = await db('users').where({ id }).first();
    if (!user) throw new Error('User not found');
    await db('users').where({ id }).update({ approved: false });
    return db('users').where({ id }).first();
  }
}

async function orderByCreatedAt(context) {
  const query = context.service.createQuery(context.params);
  context.params.knex = query.orderBy('created_at', 'desc');
  return context;
}

function encryptUserSecrets(context) {
  const { github_token, anthropic_api_key, allowed_commands } = context.data;
  if (github_token !== undefined) {
    context.data.github_token_encrypted = github_token ? encrypt(github_token) : null;
    delete context.data.github_token;
  }
  if (anthropic_api_key !== undefined) {
    context.data.anthropic_api_key_encrypted = anthropic_api_key
      ? encrypt(anthropic_api_key)
      : null;
    delete context.data.anthropic_api_key;
  }
  if (allowed_commands !== undefined) {
    context.data.allowed_commands = JSON.stringify(
      Array.isArray(allowed_commands) ? allowed_commands : []
    );
  }
  return context;
}

function formatUserSecrets(context) {
  const isExternal = !!context.params.provider;
  const process = (user) => {
    if (user.github_token_encrypted) {
      try {
        const raw = decrypt(user.github_token_encrypted);
        user.github_token = isExternal ? maskValue(raw) : raw;
      } catch {
        user.github_token = null;
      }
    } else {
      user.github_token = null;
    }
    if (user.anthropic_api_key_encrypted) {
      try {
        const raw = decrypt(user.anthropic_api_key_encrypted);
        user.anthropic_api_key = isExternal ? maskValue(raw) : raw;
      } catch {
        user.anthropic_api_key = null;
      }
    } else {
      user.anthropic_api_key = null;
    }
    delete user.github_token_encrypted;
    delete user.anthropic_api_key_encrypted;
    if (isExternal) {
      delete user.access_token;
      user.allowed_commands = user.allowed_commands ? JSON.parse(user.allowed_commands) : [];
      user.system_allowed_commands = SYSTEM_ALLOWED_COMMANDS;
    }
    return user;
  };
  if (Array.isArray(context.result)) {
    context.result = context.result.map(process);
  } else if (context.result?.data) {
    context.result.data = context.result.data.map(process);
  } else if (context.result) {
    context.result = process(context.result);
  }
  return context;
}

function restrictPatchToSelf(context) {
  if (String(context.params.user?.id) !== String(context.id)) {
    throw new NotAuthenticated('Can only patch own user');
  }
  return context;
}

export const usersHooks = {
  before: {
    all: [requireUser],
    find: [orderByCreatedAt],
    create: [encryptUserSecrets],
    patch: [restrictPatchToSelf, encryptUserSecrets],
  },
  after: {
    find: [formatUserSecrets],
    get: [formatUserSecrets],
    create: [formatUserSecrets],
    patch: [formatUserSecrets],
  },
};

export function registerUsersService(app, path = 'users') {
  const options = {
    Model: app.get('db'),
    name: 'users',
    id: 'id',
    paginate: app.get('paginate') || { default: 20, max: 100 },
  };
  app.use(path, new UsersService(options), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'approve', 'reject'],
  });
  app.service(path).hooks(usersHooks);
}
