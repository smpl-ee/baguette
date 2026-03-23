import { useState } from 'react';
import { stripWorktreePath } from '../utils/paths.js';

function ToolApproval({ request, onRespond, session, onClose }) {
  const [reason, setReason] = useState('');
  const { requestId, toolName, input } = request;
  const worktreePath = session?.absolute_worktree_path;

  return (
    <div className="space-y-3">
      <div className="space-y-3 overflow-auto max-h-[50vh]">
        {input?.description && (
          <div className="mb-3">
            <div className="text-xs text-zinc-500 mb-1">Description</div>
            <p className="text-sm text-zinc-300">{input.description}</p>
          </div>
        )}
        {toolName === 'Bash' && input?.command && (
          <div className="mb-3">
            <div className="text-xs text-zinc-500 mb-1">Command</div>
            <code className="block bg-zinc-800 rounded-lg p-2.5 sm:p-3 text-sm text-zinc-200 whitespace-pre-wrap break-all">
              {input.command}
            </code>
          </div>
        )}
        {(toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') &&
          input?.file_path && (
            <div className="mb-3">
              <div className="text-xs text-zinc-500 mb-1">File</div>
              <code className="text-sm text-zinc-200 break-all">
                {stripWorktreePath(input.file_path, worktreePath)}
              </code>
            </div>
          )}
        {toolName === 'Glob' && (
          <div className="mb-3">
            {input?.pattern && (
              <>
                <div className="text-xs text-zinc-500 mb-1">Pattern</div>
                <code className="block bg-zinc-800 rounded-lg p-2.5 sm:p-3 text-sm text-zinc-200 break-all">
                  {input.pattern}
                </code>
              </>
            )}
            {input?.path && (
              <div className="mt-2">
                <div className="text-xs text-zinc-500 mb-1">Path</div>
                <code className="text-sm text-zinc-200 break-all">
                  {stripWorktreePath(input.path, worktreePath)}
                </code>
              </div>
            )}
          </div>
        )}
        <details className="mt-3">
          <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-400">
            Full input
          </summary>
          <pre className="mt-2 text-xs text-zinc-400 whitespace-pre-wrap overflow-auto max-h-40 bg-zinc-800 rounded-lg p-2.5 sm:p-3">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      </div>

      <div className="space-y-3 pt-1">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for denying (optional)"
          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
        />
        <div className="flex gap-3">
          <button
            onClick={() => onRespond(requestId, true)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Approve
          </button>
          <button
            onClick={() => onRespond(requestId, false, reason)}
            className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Deny
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
      </div>
    </div>
  );
}

ToolApproval.title = 'Permission Required';
ToolApproval.subtitle = (request) => `Claude wants to use ${request.toolName}`;

export default ToolApproval;
