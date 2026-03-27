import express from '@feathersjs/express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import logger from './logger.js';
import { SDK_QUERY_CLOSED_MESSAGE } from './claude-agent-sdk-constants.js';
import { createAuthRoutes } from './routes/auth.js';
import { PUBLIC_HOST, ENCRYPTION_KEY } from './config.js';
import createSettingsRoutes from './routes/settings.js';
import { createRequireAuth } from './middleware/auth.js';
import {
  createFeathersApp,
  cookieAuthMiddleware,
  configureChannels,
} from './feathers.js';
import { registerFeathersServices } from './services/feathers/index.js';
import { DevserverProxy } from './services/devserver-proxy.js';
import { loadBaguetteConfig } from './services/baguette-config.js';
import db from './db.js';

const { rest } = express;

process.on('unhandledRejection', (reason) => {
  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    reason.message === SDK_QUERY_CLOSED_MESSAGE
  ) {
    logger.debug({ err: reason }, 'Ignored Claude agent SDK query-close rejection');
    return;
  }
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = createFeathersApp();

app.set('db', db);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const server = createServer(app);

// Devserver proxy — instantiated before services so middleware can reference it
const devserverProxy = new DevserverProxy(app);

// Kamal health check
app.get('/up', (req, res) => {
  res.send('OK');
});

app.use(cookieParser(ENCRYPTION_KEY));

// Subdomain proxy — runs before auth, bypasses Feathers routes for devserver traffic
// Body parsers are intentionally placed AFTER this middleware so that POST bodies
// are not consumed before being piped to the devserver.
app.use(async (req, res, next) => {
  const session = await devserverProxy.previewSession(req);
  if (session == null) return next();

  const config = await loadBaguetteConfig(session.worktree_path);
  if (!config?.webserver) return next();

  return devserverProxy.handleRequest(req, res, session, config);
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieAuthMiddleware(app));
app.configure(rest());
registerFeathersServices(app);

const requireAuth = createRequireAuth(app);
app.use(createSettingsRoutes(requireAuth));

// Dev only: redirect GET / to the frontend dev server (e.g. Vite)
if (process.env.VITE_SERVER_ENABLED === 'true') {
  app.get('/', (req, res) => {
    res.redirect(PUBLIC_HOST);
  });
}

app.hooks({
  error: {
    all: [
      async (context) => {
        const error = context.error;

        // Log full error internally
        if (!error.code || error.code >= 500) {
          logger.error(error, 'Feathers error hook');
        }

        return context;
      },
    ],
  },
});

app.use(createAuthRoutes(app));

if (process.env.VITE_SERVER_ENABLED !== 'true') {
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.setup(server);
configureChannels(app);

// WebSocket proxy for devserver subdomains (host + signed preview cookie).
// Replace the default upgrade chain so Engine.io only runs after we know this is
// not a preview devserver WS (avoids Engine.io's non-matching-path destroy race
// with async previewSession). Baguette Socket.io on preview hosts still uses SOCKET_PATH.
const upgradeListeners = server.listeners('upgrade').slice();
server.removeAllListeners('upgrade');
server.on('upgrade', async (req, socket, head) => {
  const session = await devserverProxy.previewSession(req);
  if (session === undefined) {
    for (const fn of upgradeListeners) {
      fn.call(server, req, socket, head);
    }
    return;
  }

  if (session === null) {
    socket.destroy();
    return;
  }

  try {
    await devserverProxy.handlePreviewUpgrade(req, socket, head, session);
  } catch (err) {
    logger.error(err, 'Preview WebSocket upgrade failed');
    socket.destroy();
  }
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === 'production' ? '0.0.0.0' : undefined;
server.listen(PORT, HOST, () => {
  logger.info({ port: PORT, host: HOST ?? 'default' }, 'Server running');
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Shutting down');
  try {
    await app.service('tasks').killAllTasks();
  } catch (err) {
    logger.error({ err }, 'Error while stopping tasks');
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
