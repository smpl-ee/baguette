import { GitBranch } from 'lucide-react';

const PERMISSION_MODES = [
  { value: 'default', label: 'Ask for approval' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'bypassPermissions', label: 'Bypass All' },
];

/**
 * Shared approval modal shell.
 *
 * Props:
 *  session      - session object from SessionsContext (optional)
 *  onModeChange - (sessionId, mode) => void
 *  title        - modal heading
 *  subtitle     - subheading (string or ReactNode)
 *  maxWidth     - Tailwind max-w class, default 'max-w-lg'
 *  children     - body content (should include its own scrollable area + buttons)
 */
export default function BaseApproval({
  session,
  onModeChange,
  onClose,
  title,
  subtitle,
  maxWidth = 'max-w-lg',
  children,
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4"
      onClick={onClose}
    >
      <div
        className={`bg-zinc-900 border border-zinc-700 rounded-t-xl sm:rounded-xl ${maxWidth} w-full shadow-2xl max-h-[85vh] flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 border-b border-zinc-800 shrink-0">
          {session && (
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-zinc-300 truncate">
                    {session.repo_full_name}
                  </span>
                  {session.label && (
                    <span className="text-xs text-zinc-500 truncate">{session.label}</span>
                  )}
                </div>
                <span className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                  <GitBranch size={11} />
                  {session.base_branch}
                </span>
              </div>
              <select
                value={session.permission_mode || 'default'}
                onChange={(e) => onModeChange(session.id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:ring-1 focus:ring-amber-500/50 shrink-0"
              >
                {PERMISSION_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <h3 className="text-base sm:text-lg font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
        </div>

        <div className="p-4 sm:p-5 overflow-auto flex-1">{children}</div>
      </div>
    </div>
  );
}
