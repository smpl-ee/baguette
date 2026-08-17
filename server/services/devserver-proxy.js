import http from 'http';
import { parseCookie } from 'cookie';
import { unsign } from 'cookie-signature';
import logger from '../logger.js';
import {
  extractSessionIdFromHost,
  verifyPreviewToken,
  signPreviewToken,
  getServicePreviewHost,
} from './preview.js';
import { PUBLIC_HOST, ENCRYPTION_KEY } from '../config.js';
import { loadBaguetteConfig, resolveWebserverConfig, resolveServicesConfig } from './baguette-config.js';
import { isPortListening } from './port-utils.js';

const PREVIEW_COOKIE_TTL = 60 * 60 * 1000; // 1 hour

const STARTUP_TIMEOUT_MS = 1 * 60 * 1000; // 1 minutes
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 1000;

export class DevserverProxy {
  constructor(app) {
    this.app = app;
    // Map<sessionId, Map<serviceName, state>>
    // serviceName = 'default' for single-webserver sessions
    this.devservers = new Map();
  }

  // undefined = not preview host; null = host matched but no session row; else session
  async previewSession(req) {
    const parsed = extractSessionIdFromHost(req.headers.host);
    if (!parsed) return undefined;
    const db = this.app.get('db');
    const session = await db('sessions').where({ short_id: parsed.shortId }).first();
    return session ?? null;
  }

  _getServiceMap(sessionId) {
    if (!this.devservers.has(sessionId)) {
      this.devservers.set(sessionId, new Map());
    }
    return this.devservers.get(sessionId);
  }

  async startDevserverForService(session, serviceName, webserverConfig) {
    const sessionId = session.id;
    const portEnvVars = Array.isArray(webserverConfig.ports) ? webserverConfig.ports : [];
    const exposeEnvVar = webserverConfig.expose;

    const state = {
      task: null,
      port: null,
      status: 'starting',
      lastTraffic: null,
      startupTimer: null,
      idleTimer: null,
      pollerInterval: null,
      sseClients: new Set(),      // service loading page clients (cleared on ready)
      portalSseClients: new Set(), // portal log panel clients (persistent)
    };

    const serviceMap = this._getServiceMap(sessionId);
    serviceMap.set(serviceName, state);

    const publicTask = await this.app.service('tasks').create(
      {
        session_id: sessionId,
        command: webserverConfig.command,
        label: `baguette:webserver:${serviceName}`,
        ports: portEnvVars,
        ...(webserverConfig.taskKey ? { task_key: webserverConfig.taskKey } : {}),
        onLog: (_taskId, _stream, line) => {
          for (const res of state.sseClients) {
            res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
          }
          for (const res of state.portalSseClients) {
            res.write(`event: log\ndata: ${JSON.stringify(line)}\n\n`);
          }
        },
        onExit: (_taskId, code) => {
          const currentState = this._getServiceMap(sessionId).get(serviceName);
          if (currentState !== state) return;
          if (code !== 0 && state.status === 'starting') {
            this._onCrashed(sessionId, serviceName, state);
          } else {
            this._cleanup(sessionId, serviceName, state);
          }
        },
      },
      { user: { id: session.user_id } }
    );

    const task = await this.app.service('tasks').getTask(publicTask.id);

    const exposePort = task.ports[exposeEnvVar];
    if (!exposePort) {
      this._cleanup(sessionId, serviceName, state);
      throw new Error(`webserver.expose "${exposeEnvVar}" not found in webserver.ports`);
    }

    state.task = task;
    state.port = exposePort;

    const allPorts = Object.values(task.ports);

    state.pollerInterval = setInterval(async () => {
      const results = await Promise.all(allPorts.map(isPortListening));
      if (results.every(Boolean)) {
        this._onListening(sessionId, serviceName, state);
      }
    }, POLL_INTERVAL_MS);

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

  _onListening(sessionId, serviceName, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'listening';

    for (const res of state.sseClients) {
      res.write(`event: ready\ndata: {}\n\n`);
      res.end();
    }
    state.sseClients.clear();

    // Notify portal log panel that service is ready (don't close — portal keeps streaming)
    for (const res of state.portalSseClients) {
      res.write(`event: ready\ndata: {}\n\n`);
    }

    this._resetIdleTimer(sessionId, serviceName, state);
  }

  _onCrashed(sessionId, serviceName, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    state.status = 'crashed';
    for (const res of state.sseClients) {
      res.write(`event: error\ndata: {}\n\n`);
      res.end();
    }
    state.sseClients.clear();
    for (const res of state.portalSseClients) {
      res.write(`event: error\ndata: {}\n\n`);
    }
  }

  _resetIdleTimer(sessionId, serviceName, state) {
    clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(() => {
      const serviceMap = this.devservers.get(sessionId);
      if (serviceMap?.get(serviceName) === state) {
        this._cleanup(sessionId, serviceName, state);
      }
    }, IDLE_TIMEOUT_MS);
  }

  _cleanup(sessionId, serviceName, state) {
    clearInterval(state.pollerInterval);
    clearTimeout(state.startupTimer);
    clearTimeout(state.idleTimer);
    if (state.task != null) {
      this.app.service('tasks').deleteTask(state.task.id);
    }
    for (const res of state.sseClients) {
      try { res.end(); } catch { /* response may already be closed */ }
    }
    state.sseClients.clear();
    for (const res of state.portalSseClients) {
      try { res.end(); } catch { /* response may already be closed */ }
    }
    state.portalSseClients.clear();
    const serviceMap = this.devservers.get(sessionId);
    if (serviceMap) {
      serviceMap.delete(serviceName);
      if (serviceMap.size === 0) {
        this.devservers.delete(sessionId);
      }
    }
  }

  _getOrFixState(sessionId, serviceName) {
    const serviceMap = this.devservers.get(sessionId);
    let state = serviceMap?.get(serviceName);
    if (state?.task != null) {
      const liveTask = this.app.service('tasks').getTask(state.task.id);
      if (!liveTask || liveTask.status === 'exited') {
        this._cleanup(sessionId, serviceName, state);
        state = null;
      }
    }
    return state ?? null;
  }

  /**
   * Proxy WebSocket upgrade to the session dev server.
   */
  async handlePreviewUpgrade(req, socket, head, session) {
    const parsed = extractSessionIdFromHost(req.headers.host);
    if (!parsed) { socket.destroy(); return; }

    const cookies = parseCookie(req.headers.cookie || '');
    const signed = cookies['baguette_preview'] || '';
    const shortId = signed.startsWith('s:') ? unsign(signed.slice(2), ENCRYPTION_KEY) : false;

    if (!shortId || shortId !== session.short_id) {
      socket.destroy();
      return;
    }

    const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
    const serviceName = parsed.serviceName ?? 'default';
    const webserverConfig = this._resolveServiceConfig(baguetteConfig, serviceName);
    if (!webserverConfig) {
      socket.destroy();
      return;
    }

    const sessionId = session.id;
    let state = this._getOrFixState(sessionId, serviceName);

    if (!state) {
      state = await this.startDevserverForService(session, serviceName, webserverConfig);
    }

    const ok = await this._waitUntilListeningOrTerminal(state, STARTUP_TIMEOUT_MS);
    if (!ok || state.status !== 'listening') {
      socket.destroy();
      return;
    }

    this._resetIdleTimer(sessionId, serviceName, state);
    this._proxyUpgrade(req, socket, head, state.port);
  }

  /**
   * Resolve the webserver config for a given service name.
   * For multi-service configs, looks up by name; for single-service ('default'), uses webserver block.
   */
  _resolveServiceConfig(baguetteConfig, serviceName) {
    if (serviceName === 'default') {
      return resolveWebserverConfig(baguetteConfig);
    }
    const services = resolveServicesConfig(baguetteConfig);
    return services?.find((s) => s.name === serviceName) ?? null;
  }

  _waitUntilListeningOrTerminal(state, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        if (state.status === 'listening') { resolve(true); return; }
        if (state.status === 'timedout' || state.status === 'crashed') { resolve(false); return; }
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
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
    const parsed = extractSessionIdFromHost(req.headers.host);
    const { serviceName } = parsed ?? { serviceName: null };

    const servicesConfig = resolveServicesConfig(baguetteConfig);
    const sessionId = session.id;
    const previewRoute = `${PUBLIC_HOST}/preview?session=${session.short_id}`;

    // Multi-service: no service name in host → portal
    if (servicesConfig && !serviceName) {
      return this._handlePortalRequest(req, res, session, servicesConfig);
    }

    // Single-service (webserver block) or specific service subdomain
    const effectiveServiceName = serviceName ?? 'default';
    const webserverConfig = this._resolveServiceConfig(baguetteConfig, effectiveServiceName);

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

    if (req.url === '/_baguette/logs') {
      return this._serveSseLogs(req, res, session, effectiveServiceName);
    }
    if (req.method === 'POST' && req.url === '/_baguette/retry') {
      const state = this._getServiceMap(sessionId).get(effectiveServiceName);
      if (state) this._cleanup(sessionId, effectiveServiceName, state);
      res.writeHead(302, { Location: '/' });
      return res.end();
    }

    let state = this._getOrFixState(sessionId, effectiveServiceName);

    if (!state) {
      state = await this.startDevserverForService(session, effectiveServiceName, webserverConfig);
    }

    if (state.status === 'timedout' || state.status === 'crashed') {
      return this._serveErrorPage(res, state.status);
    }

    if (state.status === 'starting') {
      return this._serveLoadingPage(res);
    }

    // listening
    state.lastTraffic = new Date();
    this._resetIdleTimer(sessionId, effectiveServiceName, state);
    return this._proxyRequest(req, res, state.port);
  }

  async _handlePortalRequest(req, res, session, servicesConfig) {
    const sessionId = session.id;
    const previewRoute = `${PUBLIC_HOST}/preview?session=${session.short_id}`;

    // Auth
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

    const previewCookie = req.signedCookies?.baguette_preview;
    if (previewCookie !== session.short_id) {
      if (req.method !== 'GET') {
        return res.status(401).json({ error: 'Unauthorized', authUrl: previewRoute });
      }
      return res.redirect(previewRoute);
    }

    res.cookie('baguette_preview', session.short_id, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: PREVIEW_COOKIE_TTL,
    });

    // SSE stream for all-service status updates
    if (req.url === '/_baguette/services') {
      return this._serveServicesSSE(req, res, session, servicesConfig);
    }

    // SSE log stream for a specific service (same-origin, for portal log panels)
    if (req.url.startsWith('/_baguette/service-logs')) {
      const svcName = new URL(req.url, 'http://x').searchParams.get('service');
      const svcDef = svcName && servicesConfig.find((s) => s.name === svcName);
      if (!svcDef) return res.status(404).end();
      return this._serveServiceLogsForPortal(req, res, session, svcName);
    }

    // Retry a specific service from the portal
    if (req.method === 'POST' && req.url.startsWith('/_baguette/service-retry')) {
      const svcName = new URL(req.url, 'http://x').searchParams.get('service');
      const state = svcName && this._getServiceMap(sessionId).get(svcName);
      if (state) this._cleanup(sessionId, svcName, state);
      return res.status(204).end();
    }

    // Portal page: pre-sign a token for each service subdomain
    const tokens = {};
    for (const svc of servicesConfig) {
      tokens[svc.name] = signPreviewToken(session.short_id);
    }

    const serviceStatuses = servicesConfig.map((svc) => {
      const state = this._getServiceMap(sessionId).get(svc.name);
      return {
        name: svc.name,
        status: state?.status ?? 'stopped',
        url: getServicePreviewHost(session.short_id, svc.name),
        token: tokens[svc.name],
      };
    });

    return res.render('portal', { services: serviceStatuses });
  }

  _serveServicesSSE(req, res, session, servicesConfig) {
    const sessionId = session.id;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    const sendStatus = () => {
      for (const svc of servicesConfig) {
        const state = this._getServiceMap(sessionId).get(svc.name);
        const status = state?.status ?? 'stopped';
        res.write(`event: status\ndata: ${JSON.stringify({ service: svc.name, status })}\n\n`);
      }
    };

    // Send initial statuses
    sendStatus();

    // Poll and push updates every second
    const interval = setInterval(sendStatus, POLL_INTERVAL_MS);
    req.on('close', () => clearInterval(interval));
  }

  _serveServiceLogsForPortal(req, res, session, serviceName) {
    const sessionId = session.id;
    const state = this._getServiceMap(sessionId).get(serviceName);

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

    // Send buffered logs
    if (state.task != null) {
      const buffered = state.task.getLogs();
      if (buffered) {
        res.write(`event: log\ndata: ${JSON.stringify(buffered)}\n\n`);
      }
    }

    // Send terminal event if already done
    if (state.status === 'listening') {
      res.write(`event: ready\ndata: {}\n\n`);
      // Keep connection open so future restarts can stream new logs
    } else if (state.status === 'timedout') {
      res.write(`event: timeout\ndata: {}\n\n`);
    } else if (state.status === 'crashed') {
      res.write(`event: error\ndata: {}\n\n`);
    }

    state.portalSseClients.add(res);
    req.on('close', () => {
      state.portalSseClients.delete(res);
    });
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

  _serveSseLogs(req, res, session, serviceName) {
    const sessionId = session.id;
    const state = this._getServiceMap(sessionId).get(serviceName);

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

    if (state.task != null) {
      const buffered = state.task.getLogs();
      if (buffered) {
        res.write(`event: log\ndata: ${JSON.stringify(buffered)}\n\n`);
      }
    }

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

    state.sseClients.add(res);
    req.on('close', () => {
      state.sseClients.delete(res);
    });
  }
}
