import { GitPullRequest, GitPullRequestDraft, GitMerge, GitPullRequestClosed } from 'lucide-react';

const STATUS_CONFIG = {
  open: {
    icon: GitPullRequest,
    className: 'text-emerald-400 border-emerald-800 bg-emerald-950/40',
  },
  draft: { icon: GitPullRequestDraft, className: 'text-zinc-400 border-zinc-700 bg-zinc-800/40' },
  merged: { icon: GitMerge, className: 'text-purple-400 border-purple-800 bg-purple-950/40' },
  closed: { icon: GitPullRequestClosed, className: 'text-red-400 border-red-800 bg-red-950/40' },
};

const FALLBACK = STATUS_CONFIG.open;

export default function PrStatusBadge({ status, prNumber, prUrl }) {
  if (!status && !prNumber) return null;

  const { icon: Icon, className } = STATUS_CONFIG[status] ?? FALLBACK;

  const content = (
    <span
      className={`inline-flex items-center gap-1 text-xs border rounded px-1.5 py-0.5 ${className}`}
    >
      <Icon className="w-3 h-3 shrink-0" />
      {prNumber && <span>#{prNumber}</span>}
    </span>
  );

  if (prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="shrink-0"
      >
        {content}
      </a>
    );
  }

  return content;
}
