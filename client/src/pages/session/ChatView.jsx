import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  AlertCircle,
  GitPullRequest,
  GitMerge,
  CircleCheck,
  MessageSquare,
  GitCompare,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { messagesService, sessionsService } from '../../feathers.js';
import { toastError } from '../../utils/toastError.jsx';
import ChatMessage from '../../components/ChatMessage.jsx';
import FileAttachmentPicker from '../../components/FileAttachmentPicker.jsx';
import { fileToContentBlock } from '../../utils/fileToContentBlock.js';
import { isMobile } from '../../utils/isMobile.js';
import { usePersistentState } from '../../hooks/usePersistentState.js';
import ApprovalInline from '../../components/ApprovalInline.jsx';
import MergeConfirmModal from '../../components/MergeConfirmModal.jsx';

export default function ChatView({
  messages,
  loadMore,
  loadingMore,
  session,
  dismissedApproval,
  reopenApproval,
  inlineApproval,
  onApproval,
  onModeChange,
  onViewChange,
  readonly,
}) {
  const persistentState = usePersistentState(
    session?.id ? `session-chat-${session.id}` : undefined
  );
  const [input, setInput] = persistentState.useState('input', '');
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState(null);

  const isRunning = session?.status === 'running';

  const handleStop = async () => {
    if (!session?.id || stopping) return;
    setStopping(true);
    try {
      await sessionsService.stop(session.id);
    } finally {
      setStopping(false);
    }
  };

  const handleQuickSend = (text) => {
    if (!session?.id) return;
    messagesService.create({
      session_id: session.id,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content: text } }),
    });
  };

  const handleMerge = async () => {
    if (!session?.id) return;
    setMerging(true);
    setMergeError(null);
    try {
      await sessionsService.merge(session.id);
      setShowMergeModal(false);
      toast.success('PR merged successfully');
    } catch (err) {
      toastError('Failed to merge PR', err);
      setMergeError(err.message || 'Failed to merge PR');
    } finally {
      setMerging(false);
    }
  };

  const chatInputRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const topSentinelRef = useRef(null);
  const messagesEndRef = useRef(null);
  const scrollAnchor = useRef(null);
  const isLoadingMoreRef = useRef(false);
  const isAtBottomRef = useRef(true);

  useLayoutEffect(() => {
    if (scrollAnchor.current && scrollContainerRef.current) {
      const { scrollTop, scrollHeight } = scrollAnchor.current;
      const newScrollHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
      scrollAnchor.current = null;
    }
  }, [messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      isAtBottomRef.current = scrollTop + clientHeight >= scrollHeight - 80;
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!isLoadingMoreRef.current && isAtBottomRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
    isLoadingMoreRef.current = false;
  }, [messages]);

  const handleLoadMore = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollAnchor.current = {
        scrollTop: scrollContainerRef.current.scrollTop,
        scrollHeight: scrollContainerRef.current.scrollHeight,
      };
    }
    isLoadingMoreRef.current = true;
    loadMore();
  }, [loadMore]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !topSentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) handleLoadMore();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(topSentinelRef.current);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  const handleChatInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 88) + 'px';
  };

  const handleChatKeyDown = (e) => {
    if (!isMobile() && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = async (e) => {
    e?.preventDefault();
    if ((!input.trim() && !files.length) || !session?.id || sending) return;
    const text = input.trim();
    setError(null);
    setFileError(null);
    persistentState.clear();
    setFiles([]);
    if (chatInputRef.current) chatInputRef.current.style.height = 'auto';

    let content;
    if (files.length) {
      setSending(true);
      try {
        const fileBlocks = await Promise.all(files.map(fileToContentBlock));
        content = text ? [{ type: 'text', text }, ...fileBlocks] : fileBlocks;
      } catch (err) {
        setFileError(err?.message ?? 'Failed to read attached files');
        setInput(text);
        setSending(false);
        return;
      }
      setSending(false);
    } else {
      content = text;
    }

    messagesService.create({
      session_id: session.id,
      type: 'user',
      message_json: JSON.stringify({ type: 'user', message: { role: 'user', content } }),
    });
  };

  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex-1 min-h-0 overflow-auto p-3 sm:p-4 space-y-3" ref={scrollContainerRef}>
          <div ref={topSentinelRef} className="h-px" />
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="w-4 h-4 border-2 border-zinc-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              message={msg}
              isLatestMessage={i === messages.length - 1}
              worktreePath={session.absolute_worktree_path}
              sessionId={session.id}
            />
          ))}
          {inlineApproval && (
            <ApprovalInline
              request={inlineApproval}
              onRespond={onApproval}
              session={session}
              onModeChange={onModeChange}
            />
          )}
          {!inlineApproval && dismissedApproval && (
            <div className="flex flex-col items-center gap-2 py-4">
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                <span>Waiting for your approval</span>
              </div>
              <button
                onClick={() => reopenApproval(dismissedApproval.requestId)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-sm font-medium rounded-lg transition-colors"
              >
                Open
              </button>
            </div>
          )}
          {!readonly &&
            session?.pr_number &&
            session?.status === 'completed' &&
            session?.pr_status !== 'merged' && (
              <div className="flex gap-2 flex-wrap py-2">
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickSend(
                        'Please run GitPull to sync with the latest changes from the remote branch. Merge the base branch. If there are any merge conflicts, resolve them.'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <GitPullRequest className="w-3.5 h-3.5" />
                    Git sync
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-700 text-zinc-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Pull latest from the remote and base branch. Fix conflicts if any.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMergeModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                >
                  <GitMerge className="w-3.5 h-3.5" />
                  Merge
                </button>
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickSend(
                        'Please check the CI workflow status using PrWorkflows. Fix any failing workflows.'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <CircleCheck className="w-3.5 h-3.5" />
                    Check CI
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-700 text-zinc-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Check all PR workflow statuses and fix problems.
                  </div>
                </div>
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickSend(
                        'Please check for unread PR comments using PrComments. Address and fix any open issues.'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Check comments
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-700 text-zinc-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    Check all unread comments and fix problems.
                  </div>
                </div>
                {onViewChange && (
                  <button
                    type="button"
                    onClick={() => onViewChange('diff')}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <GitCompare className="w-3.5 h-3.5" />
                    Diff
                  </button>
                )}
              </div>
            )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="shrink-0 px-3 py-2 bg-red-950/80 border-t border-red-800 text-red-200 text-xs">
            {error}
          </div>
        )}

        {!readonly && (
          <form
            onSubmit={handleSend}
            className="p-3 sm:p-4 border-t flex-row items-end border-zinc-800 shrink-0"
          >
            <div className="flex gap-2 sm:gap-3 items-end">
              <FileAttachmentPicker
                className="flex-1"
                files={files}
                onAdd={(picked) => {
                  setFileError(null);
                  setFiles((prev) => [...prev, ...picked]);
                }}
                onRemove={(i) => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                error={fileError}
              >
                <textarea
                  ref={chatInputRef}
                  id="chat-input"
                  rows={1}
                  value={input}
                  onChange={handleChatInputChange}
                  onKeyDown={handleChatKeyDown}
                  placeholder="Message Claude..."
                  className="block w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 sm:px-4 py-2.5 pr-6 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50 disabled:cursor-not-allowed resize-none overflow-y-auto"
                  style={{ maxHeight: '88px' }}
                />
              </FileAttachmentPicker>
              <div className="flex gap-2 shrink-0 self-end">
                {isRunning && (
                  <button
                    type="button"
                    onClick={handleStop}
                    disabled={stopping}
                    title="Stop"
                    className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-zinc-300 border border-transparent px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    ■
                  </button>
                )}
                <button
                  type="submit"
                  disabled={(!input.trim() && !files.length) || sending}
                  className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 border border-transparent px-4 sm:px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                >
                  {sending ? '...' : 'Send'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
      {showMergeModal && (
        <MergeConfirmModal
          prNumber={session?.pr_number}
          onConfirm={handleMerge}
          onCancel={() => {
            setShowMergeModal(false);
            setMergeError(null);
          }}
          loading={merging}
          error={mergeError}
          onFixConflicts={() => {
            setShowMergeModal(false);
            setMergeError(null);
            handleQuickSend(
              'Please run GitPull to sync with the latest changes from the remote branch. Merge the base branch. If there are any merge conflicts, resolve them.'
            );
          }}
        />
      )}
    </>
  );
}
