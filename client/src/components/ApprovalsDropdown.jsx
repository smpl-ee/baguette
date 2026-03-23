import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

export default function ApprovalsDropdown() {
  const { pendingApprovals, sessions, reopenApproval } = useSessionsContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  const sessionById = useMemo(() => {
    const m = new Map();
    (sessions || []).forEach((s) => m.set(s.id, s));
    return m;
  }, [sessions]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (pendingApprovals.length === 0) return null;

  const handleApprovalClick = (approval) => {
    setOpen(false);
    const session = sessionById.get(approval.sessionId);
    const isModalMode =
      session?.agent_type === 'reviewer' ? !!user?.reviewer_modal_mode : !!user?.builder_modal_mode;
    if (!isModalMode) {
      if (session) navigate(`/session/${session.short_id}`);
    } else {
      reopenApproval(approval.requestId);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative text-zinc-400 hover:text-white transition-colors"
        title="Pending approvals"
      >
        <Bell className="w-5 h-5" />
        <span className="absolute -top-1 -right-1 bg-amber-500 text-zinc-950 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
          {pendingApprovals.length}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2">
            <Bell className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400">Pending Approvals</span>
          </div>
          <div className="max-h-64 overflow-auto">
            {pendingApprovals.map((approval) => {
              const session = sessionById.get(approval.sessionId);
              return (
                <div
                  key={approval.requestId}
                  onClick={() => handleApprovalClick(approval)}
                  className="px-3 py-2.5 border-b border-zinc-800 last:border-b-0 cursor-pointer hover:bg-zinc-800/60 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-200 truncate">
                      {approval.description || approval.toolName || 'Approval required'}
                    </p>
                    {session && (
                      <span className="text-[11px] text-zinc-500 truncate block mt-0.5">
                        {session.label || session.repo_full_name}
                        {session.base_branch && (
                          <span className="text-zinc-600 ml-1">{session.base_branch}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
