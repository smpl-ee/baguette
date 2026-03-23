import BaseApproval from './BaseApproval.jsx';
import ToolApproval from './ToolApproval.jsx';
import PlanApproval from './PlanApproval.jsx';
import AskUserQuestionForm from './AskUserQuestionForm.jsx';

export default function ApprovalModal({ request, onRespond, session, onModeChange, onClose }) {
  const { toolName } = request;
  if (toolName === 'ExitPlanMode') {
    return (
      <BaseApproval
        session={session}
        onModeChange={onModeChange}
        onClose={onClose}
        title={PlanApproval.title}
        subtitle={PlanApproval.subtitle(request)}
        maxWidth={PlanApproval.maxWidth}
      >
        <PlanApproval request={request} onRespond={onRespond} session={session} onClose={onClose} />
      </BaseApproval>
    );
  }
  if (toolName === 'AskUserQuestion') {
    return (
      <BaseApproval
        session={session}
        onModeChange={onModeChange}
        onClose={onClose}
        title={AskUserQuestionForm.title}
        subtitle={AskUserQuestionForm.subtitle(request)}
      >
        <AskUserQuestionForm
          request={request}
          onRespond={onRespond}
          session={session}
          onClose={onClose}
        />
      </BaseApproval>
    );
  }
  return (
    <BaseApproval
      session={session}
      onModeChange={onModeChange}
      onClose={onClose}
      title={ToolApproval.title}
      subtitle={ToolApproval.subtitle(request)}
    >
      <ToolApproval request={request} onRespond={onRespond} session={session} onClose={onClose} />
    </BaseApproval>
  );
}
