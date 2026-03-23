import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { toastError } from '../utils/toastError.jsx';
import { CheckCircle, XCircle, X } from 'lucide-react';
import { useGetUserSessions } from '../hooks/useGetUserSessions.js';
import { sessionsService } from '../feathers.js';
import { requestNotificationPermission, showBrowserNotification } from '../utils/notifications.js';

const SessionsContext = createContext(null);

function isTabHidden() {
  return document.visibilityState === 'hidden';
}

export function SessionsProvider({ children }) {
  const { sessions, loading, refetch, hasMore, loadMore } = useGetUserSessions();
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [dismissedApprovalIds, setDismissedApprovalIds] = useState(new Set());
  const prevStatusRef = useRef(new Map());
  const sessionsRef = useRef(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const initializedRef = useRef(false);
  const location = useLocation();
  const locationRef = useRef(location);
  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Seed prevStatusRef once sessions load (avoid false positives on hydration)
  useEffect(() => {
    if (loading || initializedRef.current) return;
    initializedRef.current = true;
    sessions.forEach((s) => prevStatusRef.current.set(s.id, s.status));
  }, [sessions, loading]);

  const isCurrentSession = useCallback(
    (session) => locationRef.current.pathname === `/session/${session.short_id}`,
    []
  );

  const notifyCompleted = useCallback((session) => {
    if (isCurrentSession(session)) return;
    const label = session.label || `Session #${session.id}`;
    toast.custom(
      (t) => (
        <div
          className={`bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
        >
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{label}</p>
            <p className="text-zinc-400 text-xs">Session completed</p>
          </div>
          <Link
            to={`/session/${session.short_id}`}
            onClick={() => toast.dismiss(t.id)}
            className="text-amber-400 text-xs font-medium shrink-0 hover:text-amber-300"
          >
            View
          </Link>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="text-zinc-500 hover:text-zinc-300 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
      { duration: 8000 }
    );

    if (isTabHidden()) {
      showBrowserNotification('Session completed', label, `session-completed-${session.id}`, () => {
        window.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyFailed = useCallback((session) => {
    if (isCurrentSession(session)) return;
    const label = session.label || `Session #${session.id}`;
    toast.custom(
      (t) => (
        <div
          className={`bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg w-full max-w-sm transition-all ${t.visible ? 'opacity-100' : 'opacity-0'}`}
        >
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-medium truncate">{label}</p>
            <p className="text-zinc-400 text-xs">Session failed</p>
          </div>
          <Link
            to={`/session/${session.short_id}`}
            onClick={() => toast.dismiss(t.id)}
            className="text-amber-400 text-xs font-medium shrink-0 hover:text-amber-300"
          >
            View
          </Link>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="text-zinc-500 hover:text-zinc-300 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
      { duration: 8000 }
    );
    if (isTabHidden()) {
      showBrowserNotification('Session failed', label, `session-failed-${session.id}`, () => {
        window.focus();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for status transitions
  useEffect(() => {
    const onPatched = (session) => {
      const prev = prevStatusRef.current.get(session.id);
      if (prev !== undefined && prev !== session.status) {
        if (session.status === 'completed') notifyCompleted(session);
        if (session.status === 'failed') notifyFailed(session);
      }
      prevStatusRef.current.set(session.id, session.status);
    };
    sessionsService.on('patched', onPatched);
    return () => sessionsService.off('patched', onPatched);
  }, [notifyCompleted, notifyFailed]);

  useEffect(() => {
    const onPermissionHandled = (msg) => {
      if (!msg.requestId) return;
      setPendingApprovals((prev) => prev.filter((p) => p.requestId !== msg.requestId));
      setDismissedApprovalIds((prev) => {
        const next = new Set(prev);
        next.delete(msg.requestId);
        return next;
      });
    };
    sessionsService.on('permission:handled', onPermissionHandled);
    return () => sessionsService.off('permission:handled', onPermissionHandled);
  }, []);

  useEffect(() => {
    const onPermissionRequest = (msg) => {
      if (!msg.sessionId) return;
      setPendingApprovals((prev) => {
        if (prev.some((p) => p.requestId === msg.requestId)) return prev;
        return [...prev, msg];
      });
      const session = sessionsRef.current.find((s) => s.id === msg.sessionId);
      const isReviewerAskQuestion =
        session?.agent_type === 'reviewer' && msg.toolName === 'AskUserQuestion';
      if (!isReviewerAskQuestion && isTabHidden()) {
        showBrowserNotification(
          'Approval required',
          msg.description || 'Claude needs your approval to continue.',
          `approval-${msg.requestId}`,
          () => {
            window.focus();
          }
        );
      }
    };
    sessionsService.on('permission:request', onPermissionRequest);
    return () => sessionsService.off('permission:request', onPermissionRequest);
  }, []);

  const handleApproval = useCallback(
    (requestId, approved, reason, answers) => {
      const approval = pendingApprovals.find((p) => p.requestId === requestId);
      if (!approval) return;
      sessionsService
        .resolvePermission({ sessionId: approval.sessionId, requestId, approved, reason, answers })
        .catch((err) => toastError('Failed to resolve permission', err));
      setPendingApprovals((prev) => prev.filter((p) => p.requestId !== requestId));
      setDismissedApprovalIds((prev) => {
        const next = new Set(prev);
        next.delete(requestId);
        return next;
      });
    },
    [pendingApprovals]
  );

  const dismissApproval = useCallback((requestId) => {
    setDismissedApprovalIds((prev) => new Set([...prev, requestId]));
  }, []);

  const reopenApproval = useCallback((requestId) => {
    setDismissedApprovalIds((prev) => {
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
  }, []);

  const setPermissionMode = useCallback((sessionId, mode) => {
    if (!sessionId) return;
    sessionsService
      .patch(sessionId, { permission_mode: mode })
      .catch((err) => toastError('Failed to set permission mode', err));
  }, []);

  return (
    <SessionsContext.Provider
      value={{
        sessions,
        pendingApprovals,
        dismissedApprovalIds,
        handleApproval,
        dismissApproval,
        reopenApproval,
        setPermissionMode,
        refetch,
        loading,
        hasMore,
        loadMore,
        requestNotificationPermission,
      }}
    >
      {children}
    </SessionsContext.Provider>
  );
}

export function useSessionsContext() {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error('useSessionsContext must be used within SessionsProvider');
  return ctx;
}
