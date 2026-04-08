import { X, Upload, Pencil } from 'lucide-react';

export default function PushConfirmModal({ commitsToPush, onConfirm, onCancel, onEditDetails }) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-white font-semibold">Push commits</h3>
          <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 p-1 -m-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-zinc-400 text-sm mb-1">
          Push{' '}
          {commitsToPush > 0 ? (
            <span className="text-amber-400 font-medium">{commitsToPush} commit{commitsToPush !== 1 ? 's' : ''}</span>
          ) : (
            'changes'
          )}{' '}
          to GitHub and create/update the PR.
        </p>
        <p className="text-zinc-500 text-xs mb-6">
          Would you like to review the PR title and description before pushing?
        </p>

        <div className="flex flex-col gap-2">
          <button
            onClick={onEditDetails}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 shrink-0" />
            Review PR details first
          </button>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 text-sm text-zinc-300 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Push
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
