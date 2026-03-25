import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeByUser, encryptFields, decryptFields } from './hooks.js';

const USER_REPO_SECRETS = { anthropic_api_key: 'anthropic_api_key_encrypted' };

class UserReposService extends KnexService {}

export const userReposHooks = {
  before: {
    all: [requireUser, scopeByUser],
    patch: [encryptFields(USER_REPO_SECRETS)],
  },
  after: {
    find: [decryptFields(USER_REPO_SECRETS)],
    get: [decryptFields(USER_REPO_SECRETS)],
    patch: [decryptFields(USER_REPO_SECRETS)],
  },
};

export function registerUserReposService(app, path = 'user-repos') {
  const options = {
    Model: app.get('db'),
    name: 'user_repos',
    id: 'id',
    paginate: false,
  };
  app.use(path, new UserReposService(options), {
    methods: ['find', 'get', 'patch'],
  });
  app.service(path).hooks(userReposHooks);
}
