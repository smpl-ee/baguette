import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  MoreVertical,
  ListTodo,
  FolderOpen,
  X,
  Plus,
  AlertCircle,
  MessageSquare,
  ScrollText,
  GitBranch,
  Archive,
  PanelLeft,
} from 'lucide-react';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useFilters } from '../context/FilterContext.jsx';
import { useRepoContext } from '../context/RepoContext.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { apiFetch } from '../api.js';
import { sessionsService, tasksService } from '../feathers.js';
import { useGetSession } from '../hooks/useGetSession.js';
import { useGetMessages } from '../hooks/useGetMessages.js';
import { useGetTasks } from '../hooks/useGetTasks.js';
import TaskPanel from '../components/TaskPanel.jsx';
import TaskLogModal from '../components/TaskLogModal.jsx';
import ArchiveSession from '../components/ArchiveSession.jsx';
import ChatView from './session/ChatView.jsx';
import DiffView from './session/DiffView.jsx';
import LogsView from './session/LogsView.jsx';
import PrStatusBadge from '../components/PrStatusBadge.jsx';

/**
 * Processes a flat list of messages from session history:
 * - Collects tool results from user messages that consist only of tool_result blocks
 * - Stitches those results onto the matching tool_use blocks in assistant messages
 * - Filters out the standalone tool_result user messages (they'd render as noise)
 */
function reconcileMessages(messages) {
  const toolResults = new Map();
  const visible = [];

  for (const msg of messages) {
    if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
      const blocks = msg.message.content;
      if (blocks.length > 0 && blocks.every((b) => b.type === 'tool_result')) {
        for (const block of blocks) {
          const result =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .map((c) => (c.type === 'text' ? c.text : JSON.stringify(c)))
                    .join('\n')
                : JSON.stringify(block.content);
          toolResults.set(block.tool_use_id, { result, isError: !!block.is_error });
        }
        continue; // don't add to visible list
      }
    }
    visible.push(msg);
  }

  const reconciled =
    toolResults.size === 0
      ? visible
      : visible.map((msg) => {
          if (msg.type !== 'assistant' || !msg.message?.content) return msg;
          if (!msg.message.content.some((b) => b.type === 'tool_use')) return msg;
          return {
            ...msg,
            message: {
              ...msg.message,
              content: msg.message.content.map((b) => {
                if (b.type !== 'tool_use') return b;
                const tr = toolResults.get(b.id);
                return tr ? { ...b, ...tr } : b;
              }),
            },
          };
        });

  // Find the last TodoWrite block reference so we can hide all previous ones
  let lastTodoWriteBlock = null;
  for (const msg of reconciled) {
    if (msg.type !== 'assistant' || !msg.message?.content) continue;
    for (const b of msg.message.content) {
      if (b.type === 'tool_use' && b.name === 'TodoWrite') lastTodoWriteBlock = b;
    }
  }
  const withHiddenTodos = !lastTodoWriteBlock
    ? reconciled
    : reconciled.map((msg) => {
        if (msg.type !== 'assistant' || !msg.message?.content) return msg;
        if (
          !msg.message.content.some(
            (b) => b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock
          )
        )
          return msg;
        return {
          ...msg,
          message: {
            ...msg.message,
            content: msg.message.content.map((b) => {
              if (b.type === 'tool_use' && b.name === 'TodoWrite' && b !== lastTodoWriteBlock)
                return { ...b, _hidden: true };
              return b;
            }),
          },
        };
      });

  // Collect sub-agent activity lines per Task/Agent tool_use_id
  const taskActivities = new Map(); // tool_use_id -> string[]
  const SUB_AGENT_SYSTEM_SUBTYPES = new Set(['task_started', 'task_progress', 'task_notification']);

  for (const msg of messages) {
    // Sub-agent assistant messages: extract tool call names + brief inputs
    if (msg.type === 'assistant' && msg.parent_tool_use_id) {
      const key = msg.parent_tool_use_id;
      const lines = taskActivities.get(key) || [];
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          const detail =
            block.input?.command?.slice(0, 80) ||
            block.input?.file_path?.slice(0, 80) ||
            block.input?.pattern?.slice(0, 80) ||
            block.input?.description?.slice(0, 80) ||
            '';
          lines.push(detail ? `${block.name}: ${detail}` : block.name);
        }
      }
      taskActivities.set(key, lines);
    }
    // task_progress system messages: append summary/description
    if (msg.type === 'system' && msg.subtype === 'task_progress' && msg.tool_use_id) {
      const text = msg.summary || msg.description;
      if (text) {
        const lines = taskActivities.get(msg.tool_use_id) || [];
        lines.push(`[${text}]`);
        taskActivities.set(msg.tool_use_id, lines);
      }
    }
  }

  return withHiddenTodos
    .filter((msg) => {
      // Remove sub-agent messages from the main chat view
      if (msg.type === 'assistant' && msg.parent_tool_use_id) return false;
      if (msg.type === 'system' && SUB_AGENT_SYSTEM_SUBTYPES.has(msg.subtype)) return false;
      if (msg.type === 'tool_progress') return false;
      return true;
    })
    .map((msg) => {
      // Attach collected activities to Task/Agent tool_use blocks
      if (msg.type !== 'assistant' || !msg.message?.content || taskActivities.size === 0)
        return msg;
      const hasAgentBlock = msg.message.content.some(
        (b) => b.type === 'tool_use' && (b.name === 'Task' || b.name === 'Agent')
      );
      if (!hasAgentBlock) return msg;
      return {
        ...msg,
        message: {
          ...msg.message,
          content: msg.message.content.map((b) => {
            if (b.type !== 'tool_use' || (b.name !== 'Task' && b.name !== 'Agent')) return b;
            const activities = taskActivities.get(b.id);
            return activities?.length ? { ...b, agentActivities: activities } : b;
          }),
        },
      };
    });
}

function parseMessageRow(row) {
  try {
    return { ...row, ...JSON.parse(row.message_json || '{}'), id: row.id };
  } catch {
    return { ...row, type: row.type, id: row.id };
  }
}

/** Matches sidebar + session header — archive icon vs status dot */
function SessionStatusIndicator({ session }) {
  const isArchived = !!session.archived_at;
  const statusColor =
    {
      running: 'bg-emerald-400 animate-pulse',
      approval: 'bg-amber-400 animate-pulse',
      completed: 'bg-emerald-400',
      stopped: 'bg-zinc-500',
      failed: 'bg-red-400',
      error: 'bg-red-400',
    }[session.status] || 'bg-zinc-600';

  if (isArchived) {
    return <Archive className="w-3 h-3 text-zinc-600 shrink-0" aria-hidden />;
  }
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />;
}

function MiniSessionEntry({ session: s, currentId, onArchive }) {
  const isArchived = !!s.archived_at;

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
        isArchived ? 'opacity-50' : ''
      } ${
        s.short_id === currentId
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
      }`}
    >
      <SessionStatusIndicator session={s} />
      <Link
        to={`/session/${s.short_id}`}
        className="flex-1 min-w-0 line-clamp-2 wrap-break-word leading-snug text-left"
      >
        {s.label || s.repo_full_name}
      </Link>
      {s.pr_status && <PrStatusBadge status={s.pr_status} prUrl={s.pr_url} />}
      {!s.archived_at && (
        <div className="opacity-100 shrink-0">
          <ArchiveSession session={s} onArchive={() => onArchive?.(s)} />
        </div>
      )}
    </div>
  );
}

const VIEWS = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'diff', label: 'Diff', Icon: FolderOpen },
  { id: 'logs', label: 'Logs', Icon: ScrollText },
];

export default function Session() {
  const { short_id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') || 'chat';
  const { user } = useAuth();
  const {
    sessions,
    pendingApprovals,
    dismissedApprovalIds,
    reopenApproval,
    handleApproval,
    setPermissionMode,
    hasMore: hasMoreSessions,
    loadMore: loadMoreSessions,
  } = useSessionsContext();
  const { selectedRepo } = useRepoContext();
  const { showArchived } = useFilters();
  const { session: sessionFromHook, loading: sessionLoading } = useGetSession(short_id);
  const sessionId = sessionFromHook?.id;
  const { messages: hookMessages, loadMore, loadingMore, hasMore } = useGetMessages(sessionId);
  const { tasks: tasksFromHook } = useGetTasks({ sessionId, skip: !sessionId });

  const [session, setSession] = useState(null);
  const [prInfo, setPrInfo] = useState(null);
  const [killedTaskIds, setKilledTaskIds] = useState(new Set());
  const [showTasks, setShowTasks] = useState(false);
  const [showSidebar, setShowSidebar] = useState(null);
  const [diffFiles, setDiffFiles] = useState([]);
  const [hasDiff, setHasDiff] = useState(null);
  const [hasUncommitted, setHasUncommitted] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [models, setModels] = useState([]);
  const [activeTaskModal, setActiveTaskModal] = useState(null);
  const [configCommands, setConfigCommands] = useState([]);
  const [error, setError] = useState(null);
  const menuRef = useRef(null);

  const rawMessages = useMemo(() => (hookMessages || []).map(parseMessageRow), [hookMessages]);
  const messages = useMemo(() => reconcileMessages(rawMessages), [rawMessages]);
  const systemPrompt = useMemo(
    () => rawMessages.find((m) => m.type === 'system' && m.subtype === 'prompt')?.content,
    [rawMessages]
  );

  // If loadMore produced only hidden/filtered messages, keep pulling until something visible appears
  const prevMessagesLengthRef = useRef(null);
  useEffect(() => {
    if (loadingMore) {
      prevMessagesLengthRef.current = messages.length;
    } else if (prevMessagesLengthRef.current !== null) {
      if (messages.length === prevMessagesLengthRef.current && hasMore) {
        loadMore();
      }
      prevMessagesLengthRef.current = null;
    }
  }, [loadingMore, messages.length, hasMore, loadMore]);

  useEffect(() => {
    setSession(sessionFromHook ?? null);
    if (sessionFromHook) {
      if (sessionFromHook.pr_url) {
        setPrInfo({ url: sessionFromHook.pr_url, number: sessionFromHook.pr_number });
      } else {
        setPrInfo(null);
      }
    }
  }, [sessionFromHook]);

  const tasks = useMemo(
    () =>
      (tasksFromHook || []).map((t) => ({
        id: t.id,
        pid: t.pid,
        command: t.command,
        label: t.label,
        created_at: t.created_at,
        ports: t.ports ?? {},
        status:
          killedTaskIds.has(t.id) && t.status === 'running' ? 'exited' : (t.status ?? 'running'),
        exitCode: t.exit_code,
      })),
    [tasksFromHook, killedTaskIds]
  );

  useEffect(() => {
    apiFetch('/api/settings/models')
      .then((d) => setModels(d.models || []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    sessionsService
      .commands(sessionId)
      .then((d) => setConfigCommands(d.commands || []))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || session?.status !== 'completed') return;
    sessionsService
      .diff(sessionId)
      .then((res) => {
        setHasDiff((res.diff || '').trim().length > 0);
        setHasUncommitted(res.hasUncommitted ?? false);
      })
      .catch(() => {});
  }, [sessionId, session?.status]);

  useEffect(() => {
    const onAppError = (msg) => {
      const text = msg.message || 'Something went wrong';
      toast.error(text);
      if (msg.sessionId && sessionId && msg.sessionId === sessionId) {
        setError(text);
      }
    };
    sessionsService.on('app:error', onAppError);
    return () => sessionsService.off('app:error', onAppError);
  }, [sessionId]);

  useEffect(() => {
    if (sessionLoading || !short_id) return;
    if (!sessionFromHook) {
      navigate('/');
    }
  }, [sessionLoading, short_id, sessionFromHook, navigate]);

  const prevSelectedRepoRef = useRef(selectedRepo);
  useEffect(() => {
    if (prevSelectedRepoRef.current === selectedRepo) return;
    prevSelectedRepoRef.current = selectedRepo;
    navigate('/');
  }, [selectedRepo, navigate]);

  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  const handleModeChange = (mode) => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { permission_mode: mode })
      .catch((err) => toastError('Failed to update permission mode', err));
    setShowMenu(false);
  };

  const handlePlanToggle = () => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { plan_mode: !session?.plan_mode })
      .catch((err) => toastError('Failed to toggle plan mode', err));
    setShowMenu(false);
  };

  const handleModelChange = (model) => {
    if (!session?.id) return;
    sessionsService
      .patch(session.id, { model })
      .catch((err) => toastError('Failed to change model', err));
  };

  const handleTaskStart = (command, ports, label) => {
    tasksService
      .create({
        session_id: session?.id,
        command,
        label: label || undefined,
        ports: ports?.length ? ports : undefined,
      })
      .catch((err) => toastError('Failed to start task', err));
  };

  const handleTaskKill = (taskId) => {
    setKilledTaskIds((prev) => new Set([...prev, taskId]));
    tasksService.kill(taskId).catch((err) => toastError('Failed to kill task', err));
  };

  const handleTaskRetry = (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (task) {
      const ports = task.ports ? Object.keys(task.ports) : undefined;
      tasksService
        .create({
          session_id: session?.id,
          command: task.command,
          label: task.label || undefined,
          ports: ports?.length ? ports : undefined,
        })
        .catch((err) => toastError('Failed to start task', err));
      setActiveTaskModal(null);
    }
  };

  const handleTaskDelete = (taskId) => {
    tasksService.remove(taskId).catch((err) => toastError('Failed to delete task', err));
  };

  const handleViewTaskLogs = (taskId) => {
    setActiveTaskModal(taskId);
  };

  const handleStop = async () => {
    setShowMenu(false);
    try {
      await sessionsService.stop(session.id);
    } catch (err) {
      toastError('Failed to stop session', err);
    } finally {
      setSession((prev) => (prev ? { ...prev, status: 'stopped' } : prev));
    }
  };

  const handleArchive = async () => {
    setShowMenu(false);
    try {
      await sessionsService.remove(session.id);
      setSession((prev) => (prev ? { ...prev, archived_at: new Date().toISOString() } : prev));
      if (!showArchived) {
        const firstSession = sessions.find(
          (s) =>
            s.short_id !== short_id &&
            !s.archived_at &&
            (!selectedRepo || s.repo_full_name === selectedRepo)
        );
        navigate(firstSession ? `/session/${firstSession.short_id}` : '/');
      }
    } catch (err) {
      toastError('Failed to archive session', err);
    }
  };

  const setView = (view) => {
    setSearchParams(view === 'chat' ? {} : { view });
  };

  if (!session) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center">
        <div className="text-zinc-400">Loading session...</div>
      </div>
    );
  }

  const isReadonly = !!session.archived_at;

  const dismissedApproval = pendingApprovals.find(
    (p) => p.sessionId === session?.id && dismissedApprovalIds.has(p.requestId)
  );

  const isModalMode =
    session?.agent_type === 'reviewer' ? !!user?.reviewer_modal_mode : !!user?.builder_modal_mode;

  // When modal approval is disabled for this session type, show the approval inline in chat
  const inlineApproval = !isModalMode
    ? pendingApprovals.find(
        (p) => p.sessionId === session?.id && !dismissedApprovalIds.has(p.requestId)
      )
    : null;

    let sidebarClassName = "hidden md:flex"
    if (showSidebar) {
      sidebarClassName = "flex"
    }
    if (showSidebar === false) {
      sidebarClassName = "hidden"
    }
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Top Bar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-3 sm:px-4 py-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Link to="/" className="text-zinc-500 hover:text-zinc-300 shrink-0 md:hidden">
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="flex min-h-6 flex-nowrap items-center gap-2">
                <SessionStatusIndicator session={session} />
                <span className="min-w-0 truncate text-sm font-medium leading-snug text-zinc-300">
                  {session.label || session.repo_full_name}
                </span>
                {prInfo && (
                  <PrStatusBadge
                    status={session?.pr_status}
                    prNumber={prInfo.number}
                    prUrl={prInfo.url}
                  />
                )}
              </div>
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="shrink-0 text-zinc-600">{session.base_branch}</span>
                {session.created_branch && (
                  <span className="flex min-w-0 items-center gap-1 overflow-hidden text-zinc-500">
                    <GitBranch className="w-3 h-3 shrink-0" />
                    <span className="truncate">{session.created_branch}</span>
                  </span>
                )}
                {session.preview_url && (
                  <a
                    href={session.preview_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-sky-400 hover:text-sky-300"
                  >
                    Preview
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isReadonly && (
              <>
                <select
                  value={session.permission_mode}
                  onChange={(e) => handleModeChange(e.target.value)}
                  className="hidden sm:block bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none"
                >
                  <option value="default">Ask approval</option>
                  <option value="acceptEdits">Accept Edits</option>
                  <option value="bypassPermissions">Bypass permissions</option>
                </select>
                <button
                  onClick={handlePlanToggle}
                  title={session.plan_mode ? 'Disable Plan Mode' : 'Enable Plan Mode'}
                  className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border text-xs transition-colors ${
                    session.plan_mode
                      ? 'border-amber-500 text-amber-400 bg-amber-500/10'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
                  }`}
                >
                  Plan mode
                </button>
              </>
            )}

            <button
              onClick={() => setShowTasks(!showTasks)}
              className={`xl:hidden p-1.5 sm:px-3 sm:py-1 rounded border text-xs transition-colors relative ${
                showTasks
                  ? 'border-amber-500 text-amber-400'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {activeView === 'diff' ? (
                <FolderOpen className="w-4 h-4 sm:hidden" />
              ) : (
                <ListTodo className="w-4 h-4 sm:hidden" />
              )}
              <span className="hidden sm:inline">{activeView === 'diff' ? 'Files' : 'Tasks'}</span>
            </button>
            {!isReadonly && (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-600"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
                    <div className="p-2 border-b border-zinc-800">
                      <div className="text-[11px] text-zinc-500 px-2 py-1">Model</div>
                      <select
                        value={session.model || ''}
                        onChange={(e) => {
                          handleModelChange(e.target.value);
                          setShowMenu(false);
                        }}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none mb-1"
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.display_name}
                          </option>
                        ))}
                        {session.model && !models.some((m) => m.id === session.model) && (
                          <option value={session.model}>{session.model}</option>
                        )}
                      </select>
                    </div>
                    <div className="p-2 border-b border-zinc-800 sm:hidden">
                      <div className="text-[11px] text-zinc-500 px-2 py-1">Permission Mode</div>
                      {[
                        { value: 'default', label: 'Default' },
                        { value: 'acceptEdits', label: 'Accept Edits' },
                        { value: 'bypassPermissions', label: 'Bypass' },
                      ].map((m) => (
                        <button
                          key={m.value}
                          onClick={() => handleModeChange(m.value)}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                            session.permission_mode === m.value
                              ? 'text-amber-400 bg-amber-500/10'
                              : 'text-zinc-300 hover:bg-zinc-800'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <div className="p-2 border-b border-zinc-800 sm:hidden">
                      <button
                        onClick={handlePlanToggle}
                        className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center justify-between ${
                          session.plan_mode
                            ? 'text-amber-400 bg-amber-500/10'
                            : 'text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span>Plan Mode</span>
                        <div
                          className={`relative w-7 h-3.5 rounded-full transition-colors ${session.plan_mode ? 'bg-amber-500' : 'bg-zinc-600'}`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 rounded-full bg-white transition-transform ${session.plan_mode ? 'translate-x-3.5' : 'translate-x-0'}`}
                          />
                        </div>
                      </button>
                    </div>
                    <div className="p-1">
                      {session.status === 'running' && (
                        <button
                          onClick={handleStop}
                          className="w-full text-left px-3 py-2 text-xs text-amber-400 hover:bg-zinc-800 rounded"
                        >
                          Stop Session
                        </button>
                      )}
                      <button
                        onClick={handleArchive}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 rounded"
                      >
                        Archive Session
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {isReadonly && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-zinc-800/80 border-b border-zinc-700 text-zinc-400 text-xs">
          <span>This session has been deleted — read only</span>
        </div>
      )}

      {error && (
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-red-950/80 border-b border-red-800 text-red-200 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1 min-w-0">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="shrink-0 p-1 rounded hover:bg-red-800/50 text-red-200"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Sidebar (full height) + main column (tabs + views + tasks) */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Sessions Sidebar - md+ only; top-aligned with tab row */}
        <div className={`${sidebarClassName} w-64 flex-col border-r border-zinc-800 bg-zinc-900 shrink-0 min-h-0`}>
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <Link
              to="/"
              className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              <Plus className="w-3 h-3" />
              <span>New session</span>
            </Link>
            <button
              onClick={() => setShowSidebar(false)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
              title="Hide sidebar"
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto min-h-0">
            {[
              ...(isReadonly && !sessions.some((s) => s.short_id === short_id) ? [session] : []),
              ...sessions.filter(
                (s) =>
                  (showArchived || !s.archived_at) &&
                  (!selectedRepo || s.repo_full_name === selectedRepo)
              ),
            ].map((s) => (
              <MiniSessionEntry
                key={s.id}
                session={s}
                currentId={short_id}
                onArchive={(archived) => {
                  if (archived.short_id !== short_id || showArchived) return;
                  const firstSession = sessions.find(
                    (x) =>
                      x.short_id !== short_id &&
                      !x.archived_at &&
                      (!selectedRepo || x.repo_full_name === selectedRepo)
                  );
                  navigate(firstSession ? `/session/${firstSession.short_id}` : '/');
                }}
              />
            ))}
            {hasMoreSessions && (
              <button
                onClick={loadMoreSessions}
                className="w-full px-3 py-2 text-xs text-zinc-600 hover:text-zinc-400 transition-colors text-left"
              >
                Load more
              </button>
            )}
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* View tabs — only above chat/diff/logs + tasks */}
          <div className="flex shrink-0 items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-3 sm:px-4">
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className="items-center justify-center mr-1 text-zinc-500 hover:text-zinc-300 transition-colors"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              <PanelLeft className="w-4 h-4" />
            </button>
            {VIEWS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors -mb-px ${
                  activeView === id
                    ? 'border-amber-500 text-amber-400'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Active view */}
            {activeView === 'chat' && (
              <ChatView
                messages={messages}
                loadMore={loadMore}
                loadingMore={loadingMore}
                session={session}
                systemPrompt={systemPrompt}
                dismissedApproval={dismissedApproval}
                reopenApproval={reopenApproval}
                inlineApproval={inlineApproval}
                onApproval={handleApproval}
                onModeChange={setPermissionMode}
                onViewChange={setView}
                readonly={isReadonly}
                hasDiff={hasDiff}
                hasUncommitted={hasUncommitted}
              />
            )}
            {activeView === 'diff' && <DiffView session={session} onFilesChange={setDiffFiles} />}
            {activeView === 'logs' && (
              <LogsView rawMessages={rawMessages} loadMore={loadMore} loadingMore={loadingMore} />
            )}

            {/* Task Panel - always visible at lg+, slide-over below */}
            {showTasks && (
              <div
                className="xl:hidden fixed inset-0 bg-black/50 z-30"
                onClick={() => setShowTasks(false)}
              />
            )}
            <div
              className={
                showTasks
                  ? 'flex fixed inset-y-0 right-0 w-[85vw] max-w-sm z-40 xl:relative xl:inset-auto xl:w-80 xl:z-auto border-l border-zinc-800 bg-zinc-900 flex-col'
                  : 'hidden xl:flex xl:w-80 border-l border-zinc-800 bg-zinc-900 flex-col'
              }
            >
              <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-300">
                  {activeView === 'diff' ? 'Files' : 'Tasks'}
                </h3>
                <button
                  onClick={() => setShowTasks(false)}
                  className="text-zinc-500 hover:text-zinc-300 xl:hidden p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {activeView === 'diff' ? (
                <div className="flex-1 overflow-auto min-h-0">
                  {diffFiles.length === 0 ? (
                    <p className="text-xs text-zinc-500 px-3 py-4">No files changed</p>
                  ) : (
                    diffFiles.map((file, i) => {
                      const displayPath =
                        file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            setShowTasks(false);
                            document
                              .getElementById(`diff-file-${i}`)
                              ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-800 transition-colors border-b border-zinc-800/50"
                        >
                          <span className="font-mono text-xs text-zinc-300 truncate flex-1 min-w-0">
                            {displayPath}
                          </span>
                          <span className="text-xs text-emerald-400 shrink-0">
                            +{file.addedCount}
                          </span>
                          <span className="text-xs text-red-400 shrink-0">
                            -{file.removedCount}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : (
                <TaskPanel
                  tasks={tasks}
                  configCommands={configCommands}
                  onStart={handleTaskStart}
                  onKill={handleTaskKill}
                  onDelete={handleTaskDelete}
                  onRetry={handleTaskRetry}
                  onViewLogs={handleViewTaskLogs}
                  readonly={isReadonly}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Task Log Modal */}
      {activeTaskModal != null && (
        <TaskLogModal
          task={tasks.find((t) => t.id === activeTaskModal)}
          session={{
            id: session.id,
            label: session.label,
            repo_full_name: session.repo_full_name,
            base_branch: session.base_branch,
            pr_url: prInfo?.url,
            pr_number: prInfo?.number,
          }}
          onKill={handleTaskKill}
          onRetry={handleTaskRetry}
          onClose={() => setActiveTaskModal(null)}
        />
      )}
    </div>
  );
}
