import { NotFound, BadRequest } from '@feathersjs/errors';
import { Task } from '../task.js';
import { requireUser, only, disableExternal } from './hooks.js';
import { resolveDataDirRelativePath } from '../../config.js';
import { loadBaguetteConfig, getScriptCommand } from '../baguette-config.js';

const MAX_TASKS = 20; // Only keeps 20 task (running + history)

/**
 * Tasks service — in-memory, no DB persistence.
 * Tasks disappear on server restart.
 * Owns the task store and all lifecycle management.
 */
export class TasksService {
  constructor() {
    this._tasks = new Map();
    this._nextId = 1;
  }

  setup(app) {
    this.app = app;
  }

  // ── Store management ──────────────────────────────────────────────────────

  /**
   * Create a new in-memory Task.  Does NOT start its process.
   * Evicts an exited task (or the oldest entry) if at capacity.
   */
  createTask({ sessionId, command, label, ports }) {
    if (this._tasks.size >= MAX_TASKS) {
      let evicted = false;
      for (const [id, t] of this._tasks) {
        if (t.status === 'exited') {
          this._tasks.delete(id);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        const oldest = this._tasks.keys().next().value;
        this._tasks.delete(oldest);
      }
    }

    const id = this._nextId++;
    const task = new Task({ id, sessionId, command, label, ports, taskService: this });
    this._tasks.set(id, task);
    return task;
  }

  /** Get the Task instance by id (accepts string or number), or null. */
  getTask(id) {
    return this._tasks.get(Number(id)) ?? null;
  }

  /**
   * Return public task objects filtered by a Set of session IDs and/or status.
   */
  filterTasks({ sessionIds = null, status = null } = {}) {
    let result = Array.from(this._tasks.values());
    if (sessionIds != null) result = result.filter((t) => sessionIds.has(t.session_id));
    if (status != null) result = result.filter((t) => t.status === status);
    return result.map((t) => t.toPublic());
  }

  /**
   * Remove a task from memory (force-killing its process if still running).
   * Returns true if the task existed.
   */
  deleteTask(id) {
    const task = this._tasks.get(Number(id));
    if (!task) return false;
    task.kill();
    this._tasks.delete(Number(id));
    return true;
  }

  /** Kill all running tasks for a session (SIGTERM). */
  killSessionTasks(sessionId) {
    for (const task of this._tasks.values()) {
      if (task.session_id === sessionId && task.status === 'running') {
        task.kill();
      }
    }
  }

  /** Remove all tasks for a session from memory. */
  deleteSessionTasks(sessionId) {
    const ids = [];
    for (const [id, task] of this._tasks) {
      if (task.session_id === sessionId) ids.push(id);
    }
    for (const id of ids) this.deleteTask(id);
  }

  /** SIGKILL all running tasks and clear the store. For server shutdown. */
  killAllTasks() {
    for (const task of this._tasks.values()) {
      task.forceKill();
    }
    this._tasks.clear();
  }

  /** Reset all in-memory state. For use in tests only. */
  _resetForTest() {
    this._tasks.clear();
    this._nextId = 1;
  }

  // ── Feathers service methods ──────────────────────────────────────────────

  /** Return all tasks the user has access to, optionally filtered by status. */
  async find(params) {
    const { user } = params;
    const query = params.query || {};
    const status = query.status;
    const sessionId = query.session_id;

    let sessionIds;
    if (sessionId) {
      try {
        await this.app.service('sessions').get(sessionId, { user });
        sessionIds = new Set([sessionId]);
      } catch {
        return [];
      }
    } else {
      const rows = await this.app.get('db')('sessions').where({ user_id: user.id }).select('id');
      sessionIds = new Set(rows.map((r) => r.id));
    }

    const result = this.filterTasks({ sessionIds, status });
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return result;
  }

  /** Get a single task by id, verifying the user owns its session. */
  async get(id, params) {
    const task = this.getTask(id);
    if (!task) throw new NotFound(`Task ${id} not found`);
    await this.app.service('sessions').get(task.session_id, { user: params.user });
    return task.toPublic();
  }

  /** Create a task in memory and spawn its process. */
  async create(data, params) {
    const { session_id, command, label, ports, onLog, onExit, skipInit } = data;
    const session = await this.app.service('sessions').get(session_id, { user: params.user });
    if (session.archived_at) throw new BadRequest('Cannot start task on an archived session');

    // Lazy init: prepend the session init command so its logs stream with this task.
    let effectiveCommand = command;
    if (!skipInit && !session.initialized && session.worktree_path) {
      const baguetteConfig = await loadBaguetteConfig(session.worktree_path);
      const initCommand = getScriptCommand(baguetteConfig?.session?.init);
      // Mark initialized first to prevent double-init on concurrent task starts.
      await this.app.get('db')('sessions').where({ id: session_id }).update({ initialized: true });
      if (initCommand) {
        effectiveCommand = `${initCommand}\n${command}`;
      }
    }

    const task = this.createTask({
      sessionId: session_id,
      command: effectiveCommand,
      label,
      ports,
    });
    const env = await this.app.service('sessions').getTaskEnv(session.id);
    const cwd = session.absolute_worktree_path ?? resolveDataDirRelativePath(session.worktree_path);
    await task.start({ cwd, env, onLog, onExit });
    return task.toPublic();
  }

  /**
   * Update a task in memory and emit a patched event.
   * External access is forbidden by the disableExternal hook.
   */
  async patch(id, data, _params) {
    const task = this.getTask(id);
    if (!task) throw new NotFound(`Task ${id} not found`);
    Object.assign(task, data);
    const pub = task.toPublic();
    this.emit('patched', pub);
    return pub;
  }

  /** Remove a task from memory (kills its process if still running). */
  async remove(id, params) {
    const pub = await this.get(id, params); // verifies ownership
    await this.deleteTask(id);
    this.emit('removed', pub);
    return pub;
  }

  async kill(data, params) {
    const task = await this.get(data, params);
    const success = this.getTask(task.id)?.kill() ?? false;
    return { success };
  }

  async logs(data, params) {
    const task = await this.get(data, params);
    const logs = this.getTask(task.id)?.getLogs() ?? '';
    return { id: task.id, logs };
  }
}

export function registerTasksService(app, path = 'tasks') {
  app.use(path, new TasksService(), {
    methods: ['find', 'get', 'create', 'patch', 'remove', 'kill', 'logs'],
    events: ['log'],
  });
  app.service(path).hooks(tasksHooks);
}

export const tasksHooks = {
  before: {
    all: [requireUser],
    create: [only(['session_id', 'command', 'label', 'ports'])],
    patch: [disableExternal],
  },
};
