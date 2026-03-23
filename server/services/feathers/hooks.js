import { NotAuthenticated, Forbidden } from '@feathersjs/errors';

export async function requireUser(context) {
  if (!context.params.user?.id) {
    throw new NotAuthenticated('Not authenticated');
  }
  return context;
}

export async function scopeByUser(context) {
  if (context.method === 'create') {
    context.data.user_id = context.params.user.id;
    return context;
  }

  const query = context.service.createQuery(context.params);
  context.params.knex = query.where('user_id', context.params.user.id);
  return context;
}

export async function scopeBySessionUser(context) {
  if (context.method === 'create') {
    if (!context.data.session_id) {
      throw new Error('session_id is required');
    }
    await context.app
      .service('sessions')
      .get(context.data.session_id, { user: context.params.user });
    return context;
  }

  if (context.method === 'patch') {
    await context.service.get(context.id, { user: context.params.user });
    return context;
  }

  const query = context.service.createQuery(context.params);
  context.params.knex = query.whereExists(function () {
    this.select(1)
      .from('sessions')
      .whereRaw(`sessions.id = ${context.service.fullName}.session_id`)
      .where('sessions.user_id', context.params.user.id);
  });

  return context;
}

export function only(fields) {
  const allowedFields = new Set(fields);
  return async (context) => {
    if (context.provider && (context.method === 'create' || context.method === 'patch')) {
      for (const key in context.data) {
        if (!allowedFields.has(key)) {
          delete context.data[key];
        }
      }
    }
    return context;
  };
}

export async function disableExternal(context) {
  if (context.params?.provider) {
    throw new Forbidden('External access forbidden');
  }
  return context;
}
