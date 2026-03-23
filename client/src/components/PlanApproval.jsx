import { useState } from 'react';
import MarkdownContent from './MarkdownContent.jsx';

export function inputToMarkdown(input) {
  if (!input) return null;

  const knownStringFields = ['plan', 'description', 'content', 'text', 'summary'];
  for (const key of knownStringFields) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key];
  }

  if (Array.isArray(input.allowedPrompts) && input.allowedPrompts.length > 0) {
    const lines = input.allowedPrompts.map((p) => `- ${p.prompt}`);
    return `**Allowed actions to implement the plan:**\n\n${lines.join('\n')}`;
  }

  return '```json\n' + JSON.stringify(input, null, 2) + '\n```';
}

function PlanApproval({ request, onRespond, onClose }) {
  const { requestId, input } = request;
  const planMarkdown = inputToMarkdown(input);
  const [continuePlanning, setContinuePlanning] = useState(false);
  const [feedback, setFeedback] = useState('');

  function handleContinueSubmit() {
    const message = feedback.trim() || 'Please continue planning and refine the plan further.';
    onRespond(requestId, false, message);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-auto max-h-[50vh]">
        {planMarkdown ? (
          <MarkdownContent>{planMarkdown}</MarkdownContent>
        ) : (
          <p className="text-sm text-zinc-500 italic">No plan content available.</p>
        )}
      </div>

      {continuePlanning && (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleContinueSubmit();
              if (e.key === 'Escape') {
                setContinuePlanning(false);
                setFeedback('');
              }
            }}
            placeholder="What should Claude refine? (optional)"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-600 text-zinc-100 rounded-lg text-sm resize-none focus:outline-none focus:border-zinc-400 placeholder-zinc-500"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              onClick={handleContinueSubmit}
              className="flex-1 sm:flex-none px-4 py-2 bg-zinc-600 hover:bg-zinc-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Send feedback
            </button>
            <button
              onClick={() => {
                setContinuePlanning(false);
                setFeedback('');
              }}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {!continuePlanning && (
        <div className="flex gap-3">
          <button
            onClick={() => onRespond(requestId, true)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Run
          </button>
          <button
            onClick={() => setContinuePlanning(true)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Continue planning
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-sm font-medium transition-colors"
            >
              Later
            </button>
          )}
        </div>
      )}
    </div>
  );
}

PlanApproval.title = 'Plan Ready for Review';
PlanApproval.subtitle = () => 'Review the plan before Claude begins implementation.';
PlanApproval.maxWidth = 'max-w-xl';

export default PlanApproval;
