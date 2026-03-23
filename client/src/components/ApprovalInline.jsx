import ToolApproval from './ToolApproval.jsx';
import PlanApproval from './PlanApproval.jsx';
import AskUserQuestionForm from './AskUserQuestionForm.jsx';

function ApprovalInlineFrame({ title, subtitle, children }) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-950/10 p-4 space-y-3">
      <div>
        <p className="text-xs text-zinc-500 mb-0.5">{title}</p>
        <p className="text-sm text-zinc-200">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

export default function ApprovalInline({ request, onRespond, session }) {
  const { toolName } = request;
  if (toolName === 'ExitPlanMode') {
    return (
      <ApprovalInlineFrame title={PlanApproval.title} subtitle={PlanApproval.subtitle(request)}>
        <PlanApproval request={request} onRespond={onRespond} session={session} />
      </ApprovalInlineFrame>
    );
  }
  if (toolName === 'AskUserQuestion') {
    return (
      <ApprovalInlineFrame
        title={AskUserQuestionForm.title}
        subtitle={AskUserQuestionForm.subtitle(request)}
      >
        <AskUserQuestionForm request={request} onRespond={onRespond} session={session} />
      </ApprovalInlineFrame>
    );
  }
  return (
    <ApprovalInlineFrame title={ToolApproval.title} subtitle={ToolApproval.subtitle(request)}>
      <ToolApproval request={request} onRespond={onRespond} session={session} />
    </ApprovalInlineFrame>
  );
}
