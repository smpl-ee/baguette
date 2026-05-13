import net from 'net';

/**
 * Check whether a TCP port is currently listening on 127.0.0.1.
 * Resolves to true/false (never rejects).
 */
export function isPortListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

/**
 * Poll until every port in `ports` is listening, or timeout.
 * @param {number[]} ports
 * @param {{ timeoutMs?: number, pollMs?: number }} opts
 * @returns {Promise<boolean>} true if all ports are listening before timeout
 */
export async function waitForPorts(ports, { timeoutMs = 60_000, pollMs = 1000 } = {}) {
  if (!ports.length) return true;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const results = await Promise.all(ports.map(isPortListening));
    if (results.every(Boolean)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}
