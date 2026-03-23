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
/** Returns the preview subdomain URL for a session, e.g. https://abc123.example.com/ */
export function getPreviewHost(shortId) {
  const hasScheme = /^https?:\/\//.test(PUBLIC_API_HOST);
  const url = new URL(hasScheme ? PUBLIC_API_HOST : `https://${PUBLIC_API_HOST}`);
  url.hostname = url.hostname.startsWith('www.')
    ? `${SESSION_PREFIX}${shortId}.${url.hostname.slice(4)}`
    : `${SESSION_PREFIX}${shortId}.${url.hostname}`;
  return url.toString();
}

export function extractSessionIdFromHost(host) {
  const match = host.match(new RegExp(`^${SESSION_PREFIX}([a-f0-9]{4,})\\.`));
  return match ? match[1] : null;
}
