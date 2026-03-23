import { useState } from 'react';

export default function ThinkingBlock({ block, isLatestMessage }) {
  const [forceExpanded, setForceExpanded] = useState(null);
  const expanded = forceExpanded !== null ? forceExpanded : isLatestMessage;

  return (
    <div
      onClick={() => setForceExpanded((e) => !e)}
      className="text-xs text-zinc-600 overflow-hidden"
    >
      <div className="px-3 py-2 font-medium">Thinking...</div>
      {expanded && (
        <div className="px-3 py-2 text-zinc-500 whitespace-pre-wrap max-h-64 overflow-auto">
          {block.thinking}
        </div>
      )}
    </div>
  );
}
