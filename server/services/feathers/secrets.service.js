import { KnexService } from '@feathersjs/knex';
import { requireUser } from './hooks.js';

/**
 * Secrets service (table: secrets). Any authenticated user can list secrets;
 * only admins can create or delete. Create upserts by key.
 */
class SecretsService extends KnexService {}

async function upsertIfExists(context) {
  const db = context.app.get('db');
  const { key, value } = context.data;
  const existing = await db('secrets').where({ key }).first();
  if (existing) {
    await db('secrets').where({ id: existing.id }).update({ value });
    context.result = await db('secrets').where({ id: existing.id }).first();
  }
  return context;
}

function maskValue(value) {
  if (!value || value.length <= 6) return '••••••';
  return value.slice(0, 3) + '•'.repeat(Math.min(value.length - 6, 10)) + value.slice(-3);
}

function maskSecretValues(context) {
  const mask = ({ value, ...row }) => ({ ...row, safeValue: maskValue(value) });
  if (context.result?.data) {
    context.result.data = context.result.data.map(mask);
  } else if (Array.isArray(context.result)) {
    context.result = context.result.map(mask);
  } else if (context.result?.value !== undefined) {
    context.result = mask(context.result);
  }
  return context;
}

export const secretsHooks = {
  before: {
    all: [requireUser],
    create: [upsertIfExists],
  },
  after: {
    find: [maskSecretValues],
    get: [maskSecretValues],
    create: [maskSecretValues],
  },
};

export function registerSecretsService(app, path = 'secrets') {
  const options = {
    Model: app.get('db'),
    name: 'secrets',
    id: 'id',
    paginate: app.get('paginate') || { default: 20, max: 100 },
  };
  app.use(path, new SecretsService(options));
  app.service(path).hooks(secretsHooks);
}
