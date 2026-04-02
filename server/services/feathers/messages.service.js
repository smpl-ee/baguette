import { KnexService } from '@feathersjs/knex';
import { requireUser, scopeBySessionUser } from './hooks.js';
import { MESSAGES_PAGINATE } from '../../config.js';

/**
 * Messages service (table: session_messages). Scoped by session; access restricted to sessions owned by params.user.
 */
export class MessagesService extends KnexService {}

export function registerMessagesService(app, path = 'messages') {
  const options = {
    Model: app.get('db'),
    name: 'session_messages',
    id: 'id',
    paginate: MESSAGES_PAGINATE,
  };
  app.use(path, new MessagesService(options));
  app.service(path).hooks(messagesHooks);
}

async function afterCreateNotifySessionsAndAgent(context) {
  if (!context.result) return context;
  const message = context.result;
  await context.app.service('sessions').onMessageCreated(message);
  await context.app.service('claude-agent').onMessageCreated(message);
  return context;
}

export const messagesHooks = {
  before: {
    all: [requireUser, scopeBySessionUser],
  },
  after: {
    create: [afterCreateNotifySessionsAndAgent],
  },
};
