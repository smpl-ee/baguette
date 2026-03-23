import MarkdownContent from './MarkdownContent.jsx';
import ThinkingBlock from './chat/ThinkingBlock.jsx';
import BaguetteBlock from './chat/BaguetteBlock.jsx';
import ToolUseBlock from './chat/ToolUseBlock.jsx';

export default function ChatMessage({ message, isLatestMessage, worktreePath, sessionId }) {
  if (message.type === 'assistant' && message.message?.content) {
    return (
      <div className="space-y-2">
        {message.message.content.map((block, i) => {
          if (block.type === 'text') {
            return (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 sm:p-4 border border-zinc-800">
                <div className="text-xs text-indigo-400 mb-1 font-medium">Claude</div>
                <MarkdownContent>{block.text}</MarkdownContent>
              </div>
            );
          }
          if (block.type === 'tool_use') {
            if (block._hidden) return null;
            return (
              <ToolUseBlock
                key={i}
                block={block}
                worktreePath={worktreePath}
                sessionId={sessionId}
              />
            );
          }
          if (block.type === 'thinking') {
            return <ThinkingBlock key={i} block={block} isLatestMessage={isLatestMessage} />;
          }
          return null;
        })}
      </div>
    );
  }

  if (message.type === 'user' && message.source === 'baguette') {
    return <BaguetteBlock message={message} />;
  }

  if (message.type === 'user') {
    const content = message.message?.content;
    return (
      <div className="bg-zinc-800 rounded-lg p-3 sm:p-4 border border-zinc-700 ml-4 sm:ml-8">
        <div className="text-xs text-emerald-400 mb-1 font-medium flex items-center gap-2">
          You
          {message.created_at && (
            <span className="text-zinc-500 font-normal">
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
        {Array.isArray(content) ? (
          <div className="space-y-2">
            {content.map((block, i) => {
              if (block.type === 'text') {
                return <MarkdownContent key={i}>{block.text}</MarkdownContent>;
              }
              if (block.type === 'image') {
                const { media_type, data } = block.source || {};
                return (
                  <img
                    key={i}
                    src={`data:${media_type};base64,${data}`}
                    alt={block.name || 'attached image'}
                    className="max-w-xs rounded border border-zinc-700"
                  />
                );
              }
              if (block.type === 'document') {
                return (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-700/50 rounded px-2 py-1 w-fit"
                  >
                    <span>📄</span>
                    <span>{block.name || 'document'}</span>
                  </div>
                );
              }
              return null;
            })}
          </div>
        ) : (
          <MarkdownContent>{typeof content === 'string' ? content : ''}</MarkdownContent>
        )}
      </div>
    );
  }

  if (message.type === 'result') {
    const isError = message.is_error || message.subtype === 'error';
    return (
      <>
        <div
          className={`text-center text-xs opacity-70 ${
            isError ? 'text-red-300' : 'text-emerald-300'
          }`}
        >
          <span className="font-medium">{isError ? 'Error' : 'Completed'}</span>
          {message.total_cost_usd != null && (
            <span className="ml-2 text-zinc-500">(${message.total_cost_usd.toFixed(4)})</span>
          )}
        </div>
        {message.result && isError && (
          <div className="mt-1 text-zinc-400 text-xs">
            <MarkdownContent>{message.result}</MarkdownContent>
          </div>
        )}
      </>
    );
  }

  if (message.type === 'system') {
    let label;
    if (message.subtype === 'init') label = 'Session started';
    else if (message.subtype === 'status' && message.status) label = message.status;
    else label = message.subtype;
    return <div className="text-xs text-zinc-600 text-center py-1">{label}</div>;
  }

  return null;
}
