/**
 * Integration tests for Task.kill / Task.forceKill with a real child process.
 * (Kept separate from task.test.js, which mocks child_process.)
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { setTimeout as delay } from 'timers/promises';

import { Task } from '../task.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const listenerPath = join(__dirname, '../../scripts/task-signal-listener.js');

async function waitFor(pred, { timeoutMs = 10_000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await delay(intervalMs);
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

describe('Task kill integration', () => {
  it(
    'kill() delivers SIGTERM to exec listener script; forceKill() ends the process',
    async () => {
      const task = new Task({
        id: 1,
        sessionId: 1,
        command: listenerPath,
        taskService: null,
      });

      await task.start({
        cwd: process.cwd(),
        env: { ...process.env },
      });

      await waitFor(() => task.getLogs().includes('signal-listener started'));
      task.kill()
      await waitFor(() => task.getLogs().includes('received SIGTERM'), { timeoutMs: 5000 });
      expect(task.status).toBe('running');

      // We could wait for the auto-force-kill, but let's keep the test short. 
      task.forceKill();
      await waitFor(() => task.status === 'exited', { timeoutMs: 5000 });

      expect(task.status).toBe('exited');
      expect(task.exit_code).toBe(1);
    },
    15_000
  );
});
