import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import net from 'net';

/** Release stdio streams and listeners after the child exits (task row stays for UI/logs). */
function detachChildProcess(child) {
  try {
    child.stdin?.destroy();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.removeAllListeners();
  } catch {
    // ignore
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

/**
 * Represents a single ephemeral task (child process).
 * Instantiated by TasksService; emits events back through the injected taskService.
 */
export class Task {
  #process = null;
  #logBuffer = [];
  #taskService;

  constructor({ id, sessionId, command, label, ports, taskService }) {
    this.id = id;
    this.session_id = sessionId;
    this.command = command;
    this.label = label ?? null;
    this.ports = {}; // { ENV_VAR_NAME: portNumber } — populated after start()
    this._portEnvVars = Array.isArray(ports) ? ports : [];
    this.pid = null;
    this.status = 'running';
    this.exit_code = null;
    this.created_at = new Date().toISOString();
    this.#taskService = taskService;
  }

  /**
   * Allocate any requested ports, then spawn the child process.
   * May only be called once per Task instance.
   * @param {{ cwd: string, env: object, onLog?: Function, onExit?: Function }} opts
   */
  async start({ cwd, env, onLog, onExit } = {}) {
    // Allocate a free port for each requested env var
    const portAssignments = {};
    for (const envVar of this._portEnvVars) {
      portAssignments[envVar] = await getFreePort();
    }
    this.ports = portAssignments;

    // Merge port numbers (as strings) into the process env.
    // Strip NODE_ENV so the task doesn't inherit the server's environment mode.
    const fullEnv = { ...env };
    for (const [key, port] of Object.entries(portAssignments)) {
      fullEnv[key] = String(port);
    }

    let scriptPath = null;
    if (this.command.includes('\n')) {
      scriptPath = join(tmpdir(), `baguette-task-${this.id}-${Date.now()}.sh`);
      await writeFile(scriptPath, `#!/bin/sh\nset -e\n${this.command}\n`, 'utf8');
    }

    const child = scriptPath
      ? spawn('sh', [scriptPath], { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('sh', ['-c', this.command], { cwd, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'] });

    this.pid = child.pid;
    this.#process = child;

    const handleData = (stream) => (data) => {
      const line = data.toString();
      this.#logBuffer.push(line);
      if (this.#logBuffer.length > 10000) this.#logBuffer.shift();
      onLog?.(this.id, stream, line);
      this.#taskService?.emit('log', {
        id: this.id,
        session_id: this.session_id,
        stream,
        data: line,
      });
    };

    child.stdout.on('data', handleData('stdout'));
    child.stderr.on('data', handleData('stderr'));

    child.on('exit', (code, signal) => {
      if (scriptPath) unlink(scriptPath).catch(() => {});
      const exitCode = code ?? (signal ? 1 : 0);
      this.status = 'exited';
      this.exit_code = exitCode;
      this.#process = null;
      detachChildProcess(child);
      onExit?.(this.id, exitCode);
      this.#taskService?.emit('patched', this.toPublic());
    });

    return this;
  }

  /**
   * Send SIGTERM; escalate to SIGKILL after 5 s if still running.
   * @returns {boolean} true if a signal was sent, false if already exited/no process.
   */
  kill() {
    if (this.status !== 'running' || !this.#process) return false;
    this.#process.kill('SIGTERM');
    setTimeout(() => {
      if (this.status === 'running' && this.#process) {
        this.#process.kill('SIGKILL');
      }
    }, 5000);
    return true;
  }

  /** Force-kill immediately (SIGKILL). */
  forceKill() {
    if (this.#process) {
      try {
        this.#process.kill('SIGKILL');
      } catch {
        /* process may already be gone */
      }
    }
  }

  /** Return the full log buffer as a single string. */
  getLogs() {
    return this.#logBuffer.join('');
  }

  /** Return a plain public object (no private fields). */
  toPublic() {
    return {
      id: this.id,
      session_id: this.session_id,
      command: this.command,
      label: this.label,
      pid: this.pid,
      status: this.status,
      exit_code: this.exit_code,
      created_at: this.created_at,
      ports: this.ports,
    };
  }
}
