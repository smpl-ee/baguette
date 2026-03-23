import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Plus, Github } from 'lucide-react';
import { useRepoContext } from '../context/RepoContext.jsx';

export default function RepoPicker({ className = '' }) {
  const { repos, selectedRepo, setSelectedRepo } = useRepoContext();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const label = selectedRepo ? selectedRepo.split('/')[1] : 'Select repo';

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-200 hover:text-white shadow-sm"
      >
        <Github className="w-4 h-4 shrink-0" />
        <span className="max-w-32 truncate">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
          {repos.map((r) => (
            <button
              key={r.full_name}
              onClick={() => {
                setSelectedRepo(r.full_name);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                selectedRepo === r.full_name
                  ? 'text-white bg-zinc-800'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
              }`}
            >
              {r.full_name.split('/')[1] ?? r.full_name}
            </button>
          ))}
          <div className={repos.length > 0 ? 'border-t border-zinc-700 mt-1 pt-1' : ''}>
            <Link
              to="/settings?tab=repos"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Manage repositories
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
