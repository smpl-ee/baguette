import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  AlertCircle,
  GitPullRequest,
  GitMerge,
  CircleCheck,
  MessageSquare,
  GitCompare,
  RotateCcw,
  ChevronRight,
  ChevronDown,
  Terminal,
  Upload,
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
import Tooltip from '../../components/Tooltip.jsx';

/** "Check comments" quick message for builder sessions — must stay aligned with `## Responding to PR feedback` in `server/prompts/build-prompt.md` (injected via session prompt; do not duplicate that section here). */
const CHECK_COMMENTS_PROMPT_BUILDER =
  'Address open PR feedback by following the **Responding to PR feedback** section in your system instructions.';

/** Reviewer sessions use `reviewer-prompt.md`, not the build prompt; nudge PrComments + review workflow only. */
const CHECK_COMMENTS_PROMPT_REVIEWER =
  'Call PrComments to load existing PR conversation and inline review comments, then summarize and continue per your review workflow.';

const CHECK_COMMENTS_TOOLTIP_BUILDER =
  'Check review comments and fix problems.';
const CHECK_COMMENTS_TOOLTIP_REVIEWER =
  'Check review comments.';

function SystemPromptEntry({ content }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <Terminal className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        <span className="text-xs font-medium text-zinc-500">System prompt</span>
        <span className="text-zinc-600 text-xs truncate flex-1 min-w-0">{content.slice(0, 80)}</span>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-zinc-800 bg-zinc-900/50">
          <pre className="text-zinc-500 text-xs font-mono leading-5 whitespace-pre-wrap overflow-auto max-h-96">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ChatView({
  messages,
  loadMore,
  loadingMore,
  session,
  systemPrompt,
  dismissedApproval,
  reopenApproval,
  inlineApproval,
  onApproval,
  onModeChange,
  onViewChange,
  readonly,
  hasUncommitted,
  commitsToPush,
  onCommitsPushed,
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
  const [pushing, setPushing] = useState(false);

  const isRunning = session?.status === 'running';
  const isReviewerSession = session?.agent_type === 'reviewer';

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

  const handlePush = async () => {
    if (!session?.id || pushing) return;
    setPushing(true);
    try {
      await sessionsService.push(session.id);
      onCommitsPushed?.();
      toast.success('Pushed successfully');
    } catch (err) {
      if (err.data?.conflict) {
        toastError('Push failed — use Git Sync to resolve conflicts first', err);
      } else {
        toastError('Push failed', err);
      }
    } finally {
      setPushing(false);
    }
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
          {systemPrompt && <SystemPromptEntry content={systemPrompt} />}
          {messages.map((msg, i) => (
            <ChatMessage
              key={i}
              message={msg}
              isLatestMessage={i === messages.length - 1}
              worktreePath={session.absolute_worktree_path}
              sessionId={session.id}
            />
          ))}
          {!readonly &&
            messages.at(-1)?.type === 'system' &&
            messages.at(-1)?.subtype === 'status' &&
            messages.at(-1)?.status === 'Server restarted — session was stopped' && (
              <div className="flex gap-2 flex-wrap py-2">
                <button
                  type="button"
                  onClick={() => handleQuickSend('continue')}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Continue
                </button>
              </div>
            )}
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
          {!readonly && session?.status === 'completed' && session?.pr_status !== 'merged' && (commitsToPush > 0 || hasUncommitted) && (
            <div className="flex gap-2 flex-wrap items-center py-2">
              <Tooltip content="Push commits to GitHub and create/update the PR">
                <button
                  type="button"
                  onClick={handlePush}
                  disabled={pushing}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 border border-amber-500 rounded-lg text-xs text-white transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Push
                  {commitsToPush > 0 && (
                    <span className="ml-0.5 flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-white text-amber-700 text-[10px] font-bold leading-none">
                      {commitsToPush}
                    </span>
                  )}
                </button>
              </Tooltip>
            </div>
          )}
          {!readonly &&
            session?.status === 'completed' &&
            session?.pr_status !== 'merged' && (
              <div className="flex gap-2 flex-wrap py-2">
                <Tooltip content="Pull latest from the remote and base branch. Fix conflicts if any.">
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
                </Tooltip>
                <Tooltip content="Merge the pull request into the base branch.">
                  <button
                    type="button"
                    onClick={() => setShowMergeModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <GitMerge className="w-3.5 h-3.5" />
                    Merge
                  </button>
                </Tooltip>
                <Tooltip content="Check all PR workflow statuses and fix problems.">
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
                </Tooltip>
                <Tooltip
                  content={
                    isReviewerSession ? CHECK_COMMENTS_TOOLTIP_REVIEWER : CHECK_COMMENTS_TOOLTIP_BUILDER
                  }
                >
                  <button
                    type="button"
                    onClick={() =>
                      handleQuickSend(
                        isReviewerSession ? CHECK_COMMENTS_PROMPT_REVIEWER : CHECK_COMMENTS_PROMPT_BUILDER
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Check comments
                  </button>
                </Tooltip>
                {onViewChange && (
                  <Tooltip content="View a diff of all changes in this session.">
                    <button
                      type="button"
                      onClick={() => onViewChange('diff')}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
                    >
                      <GitCompare className="w-3.5 h-3.5" />
                      Diff
                    </button>
                  </Tooltip>
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
