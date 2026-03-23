import { Archive } from 'lucide-react';
import { sessionsService } from '../feathers.js';
import { toastError } from '../utils/toastError.jsx';

export default function ArchiveSession({ session, onArchive }) {
  const handleClick = async (e) => {
    e.stopPropagation();
    try {
      await sessionsService.remove(session.id);
      onArchive?.();
    } catch (err) {
      toastError('Failed to archive session', err);
    }
  };

  return (
    <button
      onClick={handleClick}
      title="Archive session"
      className="p-1 text-zinc-500 hover:text-amber-500 hover:bg-zinc-800 rounded transition-colors"
    >
      <Archive className="w-3.5 h-3.5 shrink-0" />
    </button>
  );
}
