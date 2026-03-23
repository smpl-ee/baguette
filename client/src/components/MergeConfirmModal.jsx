import { X, AlertCircle } from 'lucide-react';

export default function MergeConfirmModal({
  prNumber,
  onConfirm,
  onCancel,
  loading,
  error,
  onFixConflicts,
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-white font-semibold">Merge Pull Request</h3>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 p-1 -m-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        {error ? (
          <div className="mb-4">
            <div className="flex items-start gap-2 text-red-400 text-sm mb-3">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            {onFixConflicts && (
              <button
                onClick={onFixConflicts}
                className="w-full px-3 py-2 text-xs text-left text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
              >
                Ask the agent to fix merge conflicts
              </button>
            )}
          </div>
        ) : (
          <>
            <p className="text-zinc-400 text-sm mb-1">
              Merge PR <span className="text-amber-400 font-medium">#{prNumber}</span> into the base
              branch?
            </p>
            <p className="text-zinc-500 text-xs mb-6">
              This will squash and merge the changes. This action cannot be undone.
            </p>
          </>
        )}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors disabled:opacity-50"
          >
            {error ? 'Close' : 'Cancel'}
          </button>
          {!error && (
            <button
              onClick={onConfirm}
              disabled={loading}
              className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2"
            >
              {loading && (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              Merge
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
