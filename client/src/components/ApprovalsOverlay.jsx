import { useSessionsContext } from '../context/SessionsContext.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import ApprovalModal from './ApprovalModal.jsx';

export default function ApprovalsOverlay() {
  const { user } = useAuth();
  const {
    pendingApprovals,
    dismissedApprovalIds,
    handleApproval,
    dismissApproval,
    setPermissionMode,
    sessions,
  } = useSessionsContext();

  const approval = pendingApprovals.find((p) => !dismissedApprovalIds.has(p.requestId));
  if (!approval) return null;

  const session = sessions.find((s) => s.id === approval.sessionId) ?? null;
  const isModalMode =
    session?.agent_type === 'reviewer' ? !!user?.reviewer_modal_mode : !!user?.builder_modal_mode;
  if (!isModalMode) return null;

  return (
    <ApprovalModal
      request={approval}
      onRespond={handleApproval}
      session={session}
      onModeChange={setPermissionMode}
      onClose={() => dismissApproval(approval.requestId)}
    />
  );
}
