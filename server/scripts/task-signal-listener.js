#!/usr/bin/env node
/**
 * Long-running process for manual/integration checks of Task.kill / Task.forceKill.
 * Run directly: ./server/scripts/task-signal-listener.js (after chmod +x)
 *
 * Logs common catchable signals to stdout and does not exit on them.
 * SIGKILL cannot be caught or logged (kernel terminates the process with no handler run).
 */
/* eslint-disable no-console -- script stdout is the contract under test */
console.log('signal-listener started');

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`received ${sig}`);
  });
}

setInterval(() => {}, 60_000);
