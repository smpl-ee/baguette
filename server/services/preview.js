import crypto from 'crypto';
import { ENCRYPTION_KEY, PUBLIC_API_HOST } from '../config.js';

const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function signPreviewToken(shortId) {
  const payload = JSON.stringify({ s: shortId, e: Date.now() + TTL_MS });
  const encoded = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', ENCRYPTION_KEY).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyPreviewToken(token) {
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) throw new Error('Invalid token format');
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', ENCRYPTION_KEY).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid signature');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (Date.now() > payload.e) throw new Error('Token expired');
  return payload.s; // shortId
}

const SESSION_PREFIX = 'session-';

function buildSessionHostname(base, suffix) {
  return base.startsWith('www.') ? `${suffix}.${base.slice(4)}` : `${suffix}.${base}`;
}

/** Returns the preview subdomain URL for a session (portal or single-service). e.g. https://session-abc123.example.com/ */
export function getPreviewHost(shortId) {
  const hasScheme = /^https?:\/\//.test(PUBLIC_API_HOST);
  const url = new URL(hasScheme ? PUBLIC_API_HOST : `https://${PUBLIC_API_HOST}`);
  url.hostname = buildSessionHostname(url.hostname, `${SESSION_PREFIX}${shortId}`);
  return url.toString();
}

/** Returns the preview subdomain URL for a named service. e.g. https://session-abc123-api.example.com/ */
export function getServicePreviewHost(shortId, serviceName) {
  const hasScheme = /^https?:\/\//.test(PUBLIC_API_HOST);
  const url = new URL(hasScheme ? PUBLIC_API_HOST : `https://${PUBLIC_API_HOST}`);
  url.hostname = buildSessionHostname(url.hostname, `${SESSION_PREFIX}${shortId}-${serviceName}`);
  return url.toString();
}

/**
 * Extract session shortId (and optional service name) from a Host header.
 * Returns { shortId, serviceName } or null if not a session subdomain.
 * serviceName is null for the portal / single-service subdomain.
 */
export function extractSessionIdFromHost(host) {
  const match = host.match(new RegExp(`^${SESSION_PREFIX}([a-f0-9]{4,})(?:-([a-z0-9][a-z0-9-]*))?\\.`));
  if (!match) return null;
  return { shortId: match[1], serviceName: match[2] ?? null };
}
