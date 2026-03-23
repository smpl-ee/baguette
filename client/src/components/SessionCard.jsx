import { useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle2, Circle, XCircle, Square, Archive } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';
import PrStatusBadge from './PrStatusBadge.jsx';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { formatRelativeTime } from '../utils/dates.js';
import ArchiveSession from './ArchiveSession.jsx';

function StatusIcon({ status }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />;
    case 'approval':
      return <AlertCircle className="w-3.5 h-3.5 text-amber-400 animate-pulse shrink-0" />;
    case 'completed':
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    case 'stopped':
      return <Circle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />;
  }
}

const STOPPABLE_STATUSES = new Set(['running']);

export default function SessionCard({ session }) {
  const navigate = useNavigate();
  const { pendingApprovals, dismissedApprovalIds, reopenApproval } = useSessionsContext();
  const isArchived = !!session.archived_at;

  const dismissedApproval = pendingApprovals.find(
    (p) => p.sessionId === session.id && dismissedApprovalIds.has(p.requestId)
  );

  const handleStop = async (e) => {
    e.stopPropagation();
    try {
      await sessionsService.stop(session.id);
    } catch (err) {
      toastError('Failed to stop session', err);
    }
  };

  return (
    <div
      onClick={() => navigate(`/session/${session.short_id}`)}
      className={`w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 sm:p-4 transition-colors border-l-2 cursor-pointer hover:border-zinc-700 active:bg-zinc-800/50 ${
        {
          running: 'border-l-emerald-500',
          approval: 'border-l-amber-500',
          completed: 'border-l-emerald-500/40',
          failed: 'border-l-red-500',
          error: 'border-l-red-500',
        }[session.status] ?? 'border-l-zinc-700'
      } ${isArchived ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 cursor-default">
            {isArchived ? (
              <Archive className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            ) : (
              <StatusIcon status={session.status} />
            )}
          </span>
          <span className="text-white font-medium text-sm truncate">
            {session.label || session.repo_full_name}
          </span>
          {session.created_at && (
            <span className="text-zinc-600 text-xs">{formatRelativeTime(session.created_at)}</span>
          )}
          {session.total_cost_usd != null && (
            <span className="text-zinc-600 text-xs">
              {' '}
              · ${parseFloat(session.total_cost_usd).toFixed(3)}
            </span>
          )}
          {session.agent_type === 'reviewer' && (
            <span className="shrink-0 text-xs text-violet-400 border border-violet-500/30 rounded px-1 py-0.5 leading-none">
              review
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {dismissedApproval && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                reopenApproval(dismissedApproval.requestId);
              }}
              className="px-2 py-0.5 text-xs text-amber-400 border border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 rounded transition-colors"
            >
              Review approval
            </button>
          )}
          {!isArchived && STOPPABLE_STATUSES.has(session.status) && (
            <button
              onClick={handleStop}
              title="Stop session"
              className="p-1 text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 rounded transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}
          {!isArchived && <ArchiveSession session={session} />}
        </div>
      </div>
      <div className="text-xs text-zinc-400 mt-1 mb-1.5 sm:mb-2 ml-5">
        {session.agent_type === 'reviewer' && session.pr_number ? (
          <span> · PR #{session.pr_number}</span>
        ) : (
          <>
            {session.base_branch && <span>{session.base_branch}</span>}
            {session.created_branch && (
              <span className="text-zinc-600"> → {session.created_branch}</span>
            )}
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500 line-clamp-2 ml-5">{session.initial_prompt}</p>
      {(session.pr_url || session.preview_url) && (
        <div className="mt-1.5 sm:mt-2 ml-5 flex items-center gap-3">
          {session.pr_url && (
            <PrStatusBadge
              status={session.pr_status}
              prNumber={session.pr_number}
              prUrl={session.pr_url}
            />
          )}
          {session.preview_url && (
            <a
              href={session.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
            >
              Preview
            </a>
          )}
        </div>
      )}
    </div>
  );
}
