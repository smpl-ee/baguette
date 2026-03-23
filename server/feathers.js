import { feathers } from '@feathersjs/feathers';
import express from '@feathersjs/express';
import socketio from '@feathersjs/socketio';
import cookie from 'cookie';
import { unsign } from 'cookie-signature';
import db from './db.js';
import { ENCRYPTION_KEY } from './config.js';

/**
 * Cookie-based auth: set req.user and req.feathers.user for REST,
 * and socket.feathers.user for Socket.io. Uses signed userId cookie.
 */
export function cookieAuthMiddleware(req, res, next) {
  const userId = req.signedCookies?.userId;
  req.feathers = req.feathers || {};
  if (!userId) {
    return next();
  }
  db('users')
    .where({ id: userId })
    .first()
    .then((user) => {
      if (!user || !user.approved) {
        return next();
      }
      req.user = user;
      req.feathers.user = user;
      next();
    })
    .catch(next);
}

/**
 * Socket.io middleware: parse cookie from handshake, load user, set socket.feathers.user.
 * Same logic as ws.js upgrade (signed cookie -> userId -> user from DB, must be approved).
 */
export function cookieAuthSocketMiddleware(socket, next) {
  const rawCookie = socket.handshake?.headers?.cookie;
  socket.feathers = socket.feathers || {};
  if (!rawCookie) {
    return next();
  }
  const cookies = cookie.parse(rawCookie);
  const signed = cookies['userId'];
  if (!signed) {
    return next();
  }
  const prefix = 's:';
  if (!signed.startsWith(prefix)) {
    return next();
  }
  const userId = unsign(signed.slice(prefix.length), ENCRYPTION_KEY);
  if (userId === false) {
    return next();
  }
  db('users')
    .where({ id: userId })
    .first()
    .then((user) => {
      if (!user || !user.approved) {
        return next();
      }
      socket.feathers.user = user;
      socket.feathers._socket = socket; // raw Socket.io socket for emitting custom events
      next();
    })
    .catch(next);
}

/**
 * Returns a function that sends data to all connections in the user channel.
 * Used by the Claude agent to emit app:error, task:log, etc. to the client.
 */
export function createSendToUserChannel(app) {
  return (userId) => (data) => {
    if (typeof app.channel !== 'function') return;
    const ch = app.channel(`user/${userId}`);
    if (!ch || !ch.connections) return;
    const event = data.type || 'event';
    ch.connections.forEach((conn) => {
      if (conn._socket && typeof conn._socket.emit === 'function') {
        conn._socket.emit(event, data);
      }
    });
  };
}

/**
 * Create the Feathers app (Express-compatible). Does not register services or channels;
 * those are added by the caller (index.js and service files).
 */
export const SOCKET_PATH = process.env.SOCKET_PATH || '/_baguette/ws';

export function createFeathersApp() {
  const app = express(feathers());

  app.configure(
    socketio({ path: SOCKET_PATH, maxHttpBufferSize: 50e6 }, (io) => {
      io.use((socket, next) => {
        cookieAuthSocketMiddleware(socket, next);
      });
    })
  );

  return app;
}

/** Socket channel for app-wide data (e.g. repos list) visible to all authenticated clients. */
export const GLOBAL_FEATHERS_CHANNEL = 'global';

/**
 * Configure channels: join each connection to user/:userId and to the global channel.
 * Call this after app.setup(server).
 */
export function configureChannels(app) {
  if (typeof app.channel !== 'function') return;

  app.on('connection', (connection) => {
    if (!connection.user?.id) return;
    app.channel(`user/${connection.user.id}`).join(connection);
    app.channel(GLOBAL_FEATHERS_CHANNEL).join(connection);

    // Re-emit any pending approval events so clients that connect/reconnect
    // after an approval was issued don't miss it.
    const claudeAgent = app.service('claude-agent');
    if (!claudeAgent || !connection._socket) return;
    for (const sessionState of claudeAgent._activeSessions.values()) {
      if (sessionState.userId !== connection.user.id) continue;
      for (const entry of sessionState.permissionRequests.values()) {
        if (entry.approvalEvent) {
          connection._socket.emit('sessions permission:request', entry.approvalEvent);
        }
      }
    }
  });
}
