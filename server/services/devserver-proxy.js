import net from 'net';
import http from 'http';
import cookie from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import { extractSessionIdFromHost, verifyPreviewToken } from './preview.js';
import { PUBLIC_HOST, ENCRYPTION_KEY } from '../config.js';
import { loadBaguetteConfig } from './baguette-config.js';

const PREVIEW_COOKIE_TTL = 60 * 60 * 1000; // 1 hour

const STARTUP_TIMEOUT_MS = 1 * 60 * 1000; // 1 minutes
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1000;

function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

export class DevserverProxy {
  constructor(app) {
    this.app = app;
    // Map<sessionId, state>
    this.devservers = new Map();
  }

  // undefined = not preview host; null = host matched but no session row; else session
  async previewSession(req) {
    const sessionId = extractSessionIdFromHost(req.headers.host);
    if (!sessionId) return undefined;
    const db = this.app.get('db');
    const session = await db('sessions').where({ short_id: sessionId }).first();
    return session ?? null;
  }

  async startDevserver(session, webserverConfig) {
    const sessionId = session.id;
    const portEnvVars = Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [];
    const exposeEnvVar = webserverConfig.expose;

    const state = {
      task: null,
      port: null, // set after task.start() allocates ports
      status: 'starting',
      lastTraffic: null,
      startupTimer: null,
      idleTimer: null,
      pollerInterval: null,
      sseClients: new Set(),
    };
    this.devservers.set(sessionId, state);

    const publicTask = await this.app.service('tasks').create(
      {
        session_id: sessionId,
        command: webserverConfig.command,
        ports: portEnvVars,
        onLog: (_taskId, _stream, line) => {
          for (const res of state.sseClients) {
            res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
          }
        },
        onExit: (_taskId, code) => {
          if (this.devservers.get(sessionId) !== state) return;
          if (code !== 0 && state.status === 'starting') {
            this._onCrashed(sessionId, state);
          } else {
            this._cleanup(sessionId, state);
          }
        },
      },
      { user: { id: session.user_id } }
    );

    const task = await this.app.service('tasks').getTask(publicTask.id);

    const exposePort = task.ports[exposeEnvVar];
    if (!exposePort) {
      this._cleanup(sessionId, state);
      throw new Error(`webserver.expose "${exposeEnvVar}" not found in webserver.ports`);
    }

    state.task = task;
    state.port = exposePort;

    const allPorts = Object.values(task.ports);

    // Poll until all allocated ports are listening
    state.pollerInterval = setInterval(async () => {
      const results = await Promise.all(allPorts.map(isPortListening));
      if (results.every(Boolean)) {
        this._onListening(sessionId, state);
      }
    }, POLL_INTERVAL_MS);

    // Startup timeout
    state.startupTimer = setTimeout(() => {
      if (state.status === 'starting') {
        state.status = 'timedout';
        clearInterval(state.pollerInterval);
        this.app.service('tasks').deleteTask(state.task.id);
        for (const res of state.sseClients) {
          res.write(`event: timeout\ndata: {}\n\n`);
          res.end();
        }
        state.sseClients.clear();
      }
    }, STARTUP_TIMEOUT_MS);

    return state;
  }

  _onListening(sessionId, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'listening';

    for (const res of state.sseClients) {
      res.write(`event: ready\ndata: {}\n\n`);
      res.end();
    }
    state.sseClients.clear();

    this._resetIdleTimer(sessionId, state);
  }

  _onCrashed(sessionId, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'crashed';
    for (const res of state.sseClients) {
      res.write(`event: error\ndata: {}\n\n`);
      res.end();
    }
    state.sseClients.clear();
  }

  _resetIdleTimer(sessionId, state) {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      if (this.devservers.get(sessionId) === state) {
        this._cleanup(sessionId, state);
      }
    }, IDLE_TIMEOUT_MS);
  }

  _cleanup(sessionId, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    clearTimeout(state.idleTimer);
    if (state.task != null) {
      this.app.service('tasks').deleteTask(state.task.id);
    }
    for (const res of state.sseClients) {
      try {
        res.end();
      } catch {
        /* response may already be closed */
      }
    }
    state.sseClients.clear();
    this.devservers.delete(sessionId);
  }

  /**
   * Proxy WebSocket upgrade to the session dev server (same host + cookie rules as HTTP).
   * Uses http.request so the 101 handshake is forwarded correctly (no duplicate Host lines).
   */
  async handlePreviewUpgrade(req, socket, head, session) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const signed = cookies['baguette_preview'] || '';
    const shortId = signed.startsWith('s:') ? unsign(signed.slice(2), ENCRYPTION_KEY) : false;

    if (!shortId || shortId !== session.short_id) {
      socket.destroy();
      return;
    }

    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    if (!baguetteConfig?.webserver) {
      socket.destroy();
      return;
    }

    const webserverConfig = baguetteConfig.webserver;
    const sessionId = session.id;

    let state = this.devservers.get(sessionId);

    if (state?.task != null) {
      const liveTask = this.app.service('tasks').getTask(state.task.id);
      if (!liveTask || liveTask.status === 'exited') {
        this._cleanup(sessionId, state);
        state = null;
      }
    }

    if (!state) {
      state = await this.startDevserver(session, webserverConfig);
    }

    const ok = await this._waitUntilListeningOrTerminal(state, STARTUP_TIMEOUT_MS);
    if (!ok || state.status !== 'listening') {
      socket.destroy();
      return;
    }

    this._resetIdleTimer(sessionId, state);
    this._proxyUpgrade(req, socket, head, state.port);
  }

  _waitUntilListeningOrTerminal(state, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (state.status === 'listening') {
          resolve(true);
          return;
        }
        if (state.status === 'timedout' || state.status === 'crashed') {
          resolve(false);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          resolve(false);
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      };
      tick();
    });
  }

  _proxyUpgrade(req, socket, head, port) {
    const headers = { ...req.headers };
    const proxyReq = http.request(
      {
        agent: false,
        hostname: '127.0.0.1',
        port,
        path: req.url,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        if (proxyRes.statusCode !== 101) {
          socket.destroy();
        }
      }
    );

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage || ''}`];
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const v of value) lines.push(`${key}: ${v}`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n');
      if (proxyHead?.length) socket.write(proxyHead);
      if (head?.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
      proxySocket.on('error', () => socket.destroy());
      socket.on('error', () => proxySocket.destroy());
    });

    proxyReq.on('error', (err) => { logger.error({ err: err.message }, 'DEBUG _proxyUpgrade error'); socket.destroy(); });
    proxyReq.end();
  }

  async handleRequest(req, res, session, baguetteConfig) {
    const webserverConfig = baguetteConfig.webserver;
    const sessionId = session.id;
    const previewRoute = `${PUBLIC_HOST}/preview?session=${session.short_id}`;

    // Auth: exchange signed token for a preview session cookie
    if (req.path === '/_baguette/auth') {
      const { sign } = req.query;
      if (sign) {
        try {
          const shortId = verifyPreviewToken(sign);
          if (shortId !== session.short_id) throw new Error('Session mismatch');
          res.cookie('baguette_preview', session.short_id, {
            signed: true,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: PREVIEW_COOKIE_TTL,
          });
          return res.redirect('/');
        } catch (e) {
          logger.error(e, 'Preview token verification error');
        }
      }
    }

    // All other requests require a valid preview session cookie
    const previewCookie = req.signedCookies?.baguette_preview;
    if (previewCookie !== session.short_id) {
      // Non-GET requests can't follow redirects cleanly (POST→GET body loss), so return 401
      if (req.method !== 'GET') {
        return res.status(401).json({ error: 'Unauthorized', authUrl: previewRoute });
      }
      return res.redirect(previewRoute);
    }

    // Renew cookie TTL on every proxied request
    res.cookie('baguette_preview', session.short_id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: PREVIEW_COOKIE_TTL,
    });

    // Special baguette routes
    if (req.url === '/_baguette/logs') {
      return this._serveSseLogs(req, res, session);
    }
    if (req.method === 'POST' && req.url === '/_baguette/retry') {
      const state = this.devservers.get(sessionId);
      if (state) this._cleanup(sessionId, state);
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    let state = this.devservers.get(sessionId);

    // If our tracked task was deleted or stopped externally, discard the stale state
    if (state?.task != null) {
      const liveTask = this.app.service('tasks').getTask(state.task.id);
      if (!liveTask || liveTask.status === 'exited') {
        this._cleanup(sessionId, state);
        state = null;
      }
    }

    if (!state) {
      state = await this.startDevserver(session, webserverConfig);
    }

    if (state.status === 'timedout' || state.status === 'crashed') {
      return this._serveErrorPage(res, state.status);
    }

    if (state.status === 'starting') {
      return this._serveLoadingPage(res);
    }

    // listening
    state.lastTraffic = new Date();
    this._resetIdleTimer(sessionId, state);
    return this._proxyRequest(req, res, state.port);
  }

  _proxyRequest(req, res, port) {
    const options = {
      hostname: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502);
      }
      res.end('Bad Gateway');
    });

    req.pipe(proxyReq);
  }

  _serveLoadingPage(res) {
    res.render('devserver-loading');
  }

  _serveErrorPage(res, reason = 'timedout') {
    const title = reason === 'crashed' ? 'Dev server exited' : 'Dev server timed out';
    const message =
      reason === 'crashed'
        ? 'The dev server process exited with a non-zero code.'
        : 'The dev server did not become ready within the timeout period.';
    res.status(reason === 'crashed' ? 500 : 504).render('devserver-error', { title, message });
  }

  _serveSseLogs(req, res, session) {
    const sessionId = session.id;
    const state = this.devservers.get(sessionId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    if (!state) {
      res.end();
      return;
    }

    // Send buffered logs from the task
    if (state.task != null) {
      const buffered = state.task.getLogs();
      if (buffered) {
        res.write(`event: log\ndata: ${JSON.stringify(buffered)}\n\n`);
      }
    }

    // If already done, send appropriate terminal event
    if (state.status === 'listening') {
      res.write(`event: ready\ndata: {}\n\n`);
      res.end();
      return;
    }
    if (state.status === 'timedout') {
      res.write(`event: timeout\ndata: {}\n\n`);
      res.end();
      return;
    }
    if (state.status === 'crashed') {
      res.write(`event: error\ndata: {}\n\n`);
      res.end();
      return;
    }

    // Register for future log lines
    state.sseClients.add(res);
    req.on('close', () => {
      state.sseClients.delete(res);
    });
  }
}
