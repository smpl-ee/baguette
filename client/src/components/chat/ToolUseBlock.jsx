import { useState, useMemo, useEffect } from 'react';
import { sessionsService } from '../../feathers.js';
import { diffLines } from 'diff';
import { Bot, CheckSquare2, Square, Loader2 } from 'lucide-react';
import MarkdownContent from '../MarkdownContent.jsx';
import { stripWorktreePath } from '../../utils/paths.js';
import { ansiToHtml } from '../../utils/ansi.js';

function EditDiffPreview({ oldString, newString, maxLines = 5, onExpand }) {
  const parts = diffLines(oldString ?? '', newString ?? '');
  const lines = [];
  for (const part of parts) {
    if (part.added || part.removed) {
      const prefix = part.added ? '+' : '-';
      const cls = part.added ? 'text-green-400' : 'text-red-400';
      const raw = part.value.split('\n');
      if (raw[raw.length - 1] === '') raw.pop();
      for (const line of raw) {
        lines.push({ prefix, cls, line });
        if (lines.length >= maxLines) break;
      }
    }
    if (lines.length >= maxLines) break;
  }
  const totalChanged = parts.reduce((acc, p) => {
    if (!p.added && !p.removed) return acc;
    const raw = p.value.split('\n');
    if (raw[raw.length - 1] === '') raw.pop();
    return acc + raw.length;
  }, 0);
  const remaining = totalChanged - maxLines;

  return (
    <pre className="px-3 sm:px-4 pb-2 text-xs font-mono bg-transparent overflow-hidden">
      {lines.map((l, i) => (
        <div key={i} className={l.cls}>
          {l.prefix}
          {l.line}
        </div>
      ))}
      {remaining > 0 && (
        <button
          onClick={onExpand}
          className="text-zinc-600 hover:text-zinc-400 transition-colors text-left"
        >
          &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
        </button>
      )}
    </pre>
  );
}

const QUIET_TOOLS = new Set(['Glob', 'Read', 'Grep']);

function parseQuotedArgs(str) {
  const result = [];
  let i = 0;
  while (i < str.length) {
    const q = str[i];
    if (q !== '"' && q !== "'") {
      i++;
      continue;
    }
    let end = i + 1;
    while (end < str.length && (str[end] !== q || str[end - 1] === '\\')) end++;
    result.push(
      str
        .slice(i + 1, end)
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
    );
    i = end + 1;
  }
  return result;
}

function parseBaguetteOp(command) {
  if (!command?.startsWith('baguette-op ')) return null;
  const rest = command.slice('baguette-op '.length).trim();
  const spaceIdx = rest.indexOf(' ');
  const op = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const argStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
  let arg = null;
  if (argStr) {
    if (op === 'pr-upsert') {
      const quoted = parseQuotedArgs(argStr);
      arg = {
        title: quoted[0] ?? argStr.trim(),
        body: quoted[1] ?? '',
      };
    } else if (op === 'command') {
      const quoted = parseQuotedArgs(argStr);
      const [label, ...restArgs] = quoted.length > 0 ? quoted : [argStr];
      arg = {
        label: label ?? '',
        args: restArgs,
      };
    } else {
      try {
        arg = JSON.parse(argStr.replace(/^'([\s\S]*)'$/, '$1').replace(/^"([\s\S])*"$/, '$1'));
      } catch {
        arg = { raw: argStr };
      }
    }
  }
  return { op, arg };
}

const QUIET_BAGUETTE_OPS = new Set([
  'git-push',
  'git-pull',
  'pr-read',
  'list-commands',
  'git-fetch',
]);

function TodoBlock({ todos }) {
  return (
    <div className="py-0.5 pl-1 space-y-0.5">
      {(todos || []).map((todo, i) => {
        const isCompleted = todo.status === 'completed';
        const isInProgress = todo.status === 'in_progress';
        return (
          <div
            key={i}
            className={`flex items-center gap-1.5 text-xs ${isCompleted ? 'text-zinc-600' : isInProgress ? 'text-zinc-300' : 'text-zinc-500'}`}
          >
            {isCompleted ? (
              <CheckSquare2 className="w-3 h-3 shrink-0 text-emerald-700" />
            ) : isInProgress ? (
              <Loader2 className="w-3 h-3 shrink-0 text-amber-500 animate-spin" />
            ) : (
              <Square className="w-3 h-3 shrink-0 text-zinc-700" />
            )}
            <span className={isCompleted ? 'line-through' : ''}>{todo.content}</span>
          </div>
        );
      })}
    </div>
  );
}

function QuietToolBlock({ icon, label, detail, isError, result }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      className="text-xs font-mono py-0.5 pl-1 cursor-pointer overflow-hidden"
    >
      <div className="flex items-center gap-1.5 text-zinc-700">
        <span>{icon ?? '↳'}</span>
        <span className={isError ? 'text-red-700' : ''}>{label}</span>
        {detail && <span className="truncate text-zinc-800">{detail}</span>}
        {isError && <span className="text-red-700 ml-0.5">[error]</span>}
        {isRunning && !isError && (
          <div className="w-2.5 h-2.5 border border-zinc-700 border-t-zinc-500 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {expanded && result != null && (
        <pre className="mt-1 pl-3 text-zinc-700 whitespace-pre-wrap overflow-auto max-h-48">
          {result}
        </pre>
      )}
    </div>
  );
}

function CommandBlock({ baguetteOp, block }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.result == null;
  let parsed = null;
  if (typeof block.result === 'string') {
    try {
      parsed = JSON.parse(block.result);
    } catch {
      parsed = null;
    }
  } else if (block.result && typeof block.result === 'object') {
    parsed = block.result;
  }

  const exitCode = parsed?.exitCode;
  const stdout = parsed?.stdout ?? '';
  const stderr = parsed?.stderr ?? '';
  const ok = parsed?.ok;
  const stdoutHtml = useMemo(() => (stdout ? ansiToHtml(stdout) : ''), [stdout]);
  const stderrHtml = useMemo(() => (stderr ? ansiToHtml(stderr) : ''), [stderr]);

  const hasError =
    block.isError || ok === false || (typeof exitCode === 'number' && exitCode !== 0);

  return (
    <div
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${hasError ? 'border-red-800/60' : 'border-zinc-800'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">command</span>
          {hasError && (
            <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              {typeof exitCode === 'number' ? `exit ${exitCode}` : 'error'}
            </span>
          )}
          <span className="text-xs text-zinc-300 truncate">
            {baguetteOp.arg?.label || '(no label)'}
          </span>
          {Array.isArray(baguetteOp.arg?.args) && baguetteOp.arg.args.length > 0 && (
            <code className="text-[10px] text-zinc-500 truncate">
              {baguetteOp.arg.args.join(' ')}
            </code>
          )}
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
          {stdout && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">stdout</div>
              <pre
                className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-zinc-300 bg-zinc-950/50"
                dangerouslySetInnerHTML={{ __html: stdoutHtml }}
              />
            </div>
          )}
          {stderr && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">stderr</div>
              <pre
                className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-red-300 bg-red-950/30"
                dangerouslySetInnerHTML={{ __html: stderrHtml }}
              />
            </div>
          )}
          {!stdout && !stderr && block.result != null && (
            <div>
              <div className="text-zinc-500 font-medium mb-1">Result</div>
              <pre className="whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 text-zinc-400 bg-zinc-950/50">
                {typeof block.result === 'string'
                  ? block.result
                  : JSON.stringify(block.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PrUpsertBlock({ title, body, result, isError }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = result == null;
  const PREVIEW_LINES = 4;
  const bodyLines = (body ?? '').split('\n');
  const previewBody = bodyLines.slice(0, PREVIEW_LINES).join('\n');
  const remaining = bodyLines.length - PREVIEW_LINES;

  return (
    <div
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${isError ? 'border-red-800/60' : 'border-indigo-900/50'}`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">Pull Request</span>
          {isError && (
            <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
              error
            </span>
          )}
          <span className="text-white text-xs font-semibold truncate">{title}</span>
        </div>
        {isRunning ? (
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {!expanded && body && (
        <div className="px-3 sm:px-4 pb-2 text-xs text-zinc-500">
          <MarkdownContent>{previewBody}</MarkdownContent>
          {remaining > 0 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors mt-1 font-mono"
            >
              &hellip; {remaining} more line{remaining !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
          <div className="text-zinc-400">
            <MarkdownContent>{body ?? ''}</MarkdownContent>
          </div>
          {result != null && (
            <div>
              <div className={`font-medium mb-1 ${isError ? 'text-red-400' : 'text-zinc-500'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <pre
                className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${isError ? 'text-red-300 bg-red-950/30' : 'text-zinc-400 bg-zinc-950/50'}`}
              >
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_PREVIEW = 8;

function AgentTaskBlock({ block }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = block.result != null;
  const description = block.input?.description || 'Task';
  const subagentType = block.input?.subagent_type;
  const activities = block.agentActivities || [];
  const hidden = !expanded && activities.length > ACTIVITY_PREVIEW;
  const displayLines = hidden ? activities.slice(-ACTIVITY_PREVIEW) : activities;

  const hasContent = activities.length > 0 || hasResult;

  if (!hasContent) {
    return (
      <div className="flex items-center gap-2 py-0.5 pl-1 text-xs text-zinc-500">
        <Bot className="w-3.5 h-3.5 shrink-0 text-zinc-600" />
        <span className="truncate">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
      </div>
    );
  }

  return (
    <div className="bg-zinc-900/50 rounded-lg border border-zinc-800 overflow-hidden">
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2 text-xs text-zinc-400">
        <Bot className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
        <span className="truncate flex-1">
          {description}
          {subagentType ? ` (${subagentType})` : ''}
        </span>
        {!hasResult && (
          <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        )}
      </div>
      {activities.length > 0 && (
        <div className="border-t border-zinc-800/60 px-3 sm:px-4 py-2 font-mono text-[11px] text-zinc-600 space-y-0.5">
          {hidden && (
            <button
              onClick={() => setExpanded(true)}
              className="text-zinc-700 hover:text-zinc-500 transition-colors mb-1"
            >
              &hellip; {activities.length - ACTIVITY_PREVIEW} earlier
            </button>
          )}
          {displayLines.map((line, i) => (
            <div key={i} className="truncate">
              ↳ {line}
            </div>
          ))}
          {expanded && (
            <button
              onClick={() => setExpanded(false)}
              className="text-zinc-700 hover:text-zinc-500 transition-colors mt-1"
            >
              collapse
            </button>
          )}
        </div>
      )}
      {hasResult && block.result && (
        <div className="border-t border-zinc-800/60 px-3 sm:px-4 py-2 text-xs">
          <div className="text-zinc-500 font-medium mb-1">Result</div>
          <pre className="whitespace-pre-wrap overflow-auto max-h-48 text-zinc-400 bg-zinc-950/50 rounded p-2">
            {block.result}
          </pre>
        </div>
      )}
    </div>
  );
}

function ShowDiffBlock({ path: filePath, sessionId }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !filePath) return;
    sessionsService
      .showDiff({ id: sessionId, path: filePath })
      .then((res) => {
        if (res.error) setError(res.error);
        setDiff(res.diff ?? '');
      })
      .catch((err) => {
        setError(err?.message ?? 'Failed to load diff');
        setDiff('');
      });
  }, [sessionId, filePath]);

  if (diff === null && !error) {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-500">
        Loading diff for <span className="text-zinc-400 font-mono">{filePath}</span>…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-800/50 bg-zinc-900 p-3 text-xs">
        <span className="text-zinc-400 font-mono">{filePath}</span>
        <span className="ml-2 text-red-400">{error}</span>
      </div>
    );
  }

  const lines = (diff || '').split('\n');
  const hunks = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);

  const PREVIEW_LINES = 12;
  const allLines = hunks.flatMap((h) => [
    { type: 'hunk', text: h.header },
    ...h.lines.map((l) => ({ type: 'line', text: l })),
  ]);
  const preview = allLines.slice(0, PREVIEW_LINES);
  const shown = expanded ? allLines : preview;
  const hasMore = allLines.length > PREVIEW_LINES;

  if (!diff || diff === '(no diff)') {
    return (
      <div className="rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-mono overflow-hidden">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/50">
          <span className="text-zinc-400">diff</span>
          <span className="text-white">{filePath}</span>
        </div>
        <div className="px-3 py-2 text-zinc-500 italic">No changes</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 text-xs font-mono overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-700 bg-zinc-800/50">
        <span className="text-zinc-400">diff</span>
        <span className="text-white truncate">{filePath}</span>
      </div>
      <div className="overflow-x-auto">
        <pre className="px-3 py-2 leading-5">
          {shown.map((l, i) => {
            if (l.type === 'hunk') {
              return (
                <div key={i} className="text-cyan-500/80">
                  {l.text}
                </div>
              );
            }
            const ch = l.text[0];
            const cls =
              ch === '+'
                ? 'text-green-400 bg-green-950/30'
                : ch === '-'
                  ? 'text-red-400 bg-red-950/30'
                  : 'text-zinc-400';
            return (
              <div key={i} className={`${cls} min-w-0`}>
                {l.text || ' '}
              </div>
            );
          })}
        </pre>
      </div>
      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-t border-zinc-700 transition-colors text-left"
        >
          {expanded ? '↑ Show less' : `↓ Show all ${allLines.length} lines`}
        </button>
      )}
    </div>
  );
}

export default function ToolUseBlock({ block, worktreePath, sessionId }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = block.result != null;
  const bashResultHtml = useMemo(() => {
    if (block.name !== 'Bash' || typeof block.result !== 'string') return null;
    return ansiToHtml(block.result);
  }, [block.name, block.result]);

  const filePath = block.input?.file_path
    ? stripWorktreePath(block.input.file_path, worktreePath)
    : null;

  // TodoWrite tool: render a todo list
  if (block.name === 'TodoWrite') {
    return <TodoBlock todos={block.input?.todos} />;
  }

  // Task / Agent tool: agent icon + spinner + collapsible activity log + final result
  if (block.name === 'Task' || block.name === 'Agent') {
    return <AgentTaskBlock block={block} />;
  }

  // Quiet tools: Glob, Read, Grep
  if (QUIET_TOOLS.has(block.name)) {
    let detail;
    if (block.name === 'Glob') {
      detail = block.input?.pattern;
    } else if (block.name === 'Grep') {
      detail = [
        block.input?.pattern,
        block.input?.path ? stripWorktreePath(block.input.path, worktreePath) : null,
      ]
        .filter(Boolean)
        .join(' ');
    } else {
      detail = filePath ?? block.input?.file_path;
    }
    return (
      <QuietToolBlock
        label={block.name}
        detail={detail}
        isError={block.isError}
        result={block.result}
      />
    );
  }

  // Baguette MCP tools
  if (block.name?.startsWith('mcp__baguette__')) {
    const toolShortName = block.name.replace('mcp__baguette__', '');
    let mcpResult = null;
    try {
      mcpResult = JSON.parse(block.result);
    } catch {
      /* ignore */
    }

    if (toolShortName === 'ShowDiff') {
      return (
        <div>
          <QuietToolBlock
            icon="⚙"
            label="ShowDiff"
            detail={block.input?.path}
            isError={block.isError}
          />
          <ShowDiffBlock path={block.input?.path ?? ''} sessionId={sessionId} />
        </div>
      );
    }
    if (toolShortName === 'PrUpsert') {
      return (
        <PrUpsertBlock
          title={block.input?.title ?? '(no title)'}
          body={block.input?.description ?? ''}
          result={block.result}
          isError={block.isError}
        />
      );
    }
    if (toolShortName === 'RunProjectCommand') {
      return (
        <CommandBlock
          baguetteOp={{ arg: { label: block.input?.label ?? '', args: block.input?.args ?? [] } }}
          block={{ ...block, result: block.result }}
        />
      );
    }
    if (toolShortName === 'PrComment') {
      const body = block.input?.body ?? '';
      const path = block.input?.path;
      const line = block.input?.line;
      const preview = body.length > 60 ? body.slice(0, 57) + '…' : body;
      const detail = path && line ? `${path}:${line} — ${preview}` : preview;
      return (
        <QuietToolBlock
          icon="⚙"
          label={path && line ? 'PrComment (inline)' : 'PrComment'}
          detail={detail}
          isError={block.isError}
          result={block.result}
        />
      );
    }
    if (toolShortName === 'PrReview') {
      const commentCount = block.input?.comments?.length ?? 0;
      const detail = [
        block.input?.body?.slice(0, 60),
        commentCount > 0 ? `${commentCount} inline comment${commentCount > 1 ? 's' : ''}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return (
        <QuietToolBlock
          icon="⚙"
          label={`PrReview:${block.input?.event ?? ''}`}
          detail={detail}
          isError={block.isError}
          result={block.result}
        />
      );
    }
    // Quiet by default: GitPush, GitPull, GitFetch, PrRead, PrComments, PrWorkflows, PrWorkflowLogs, ListProjectCommands, etc.
    const detail =
      toolShortName === 'GitFetch'
        ? block.input?.branch
        : toolShortName === 'PrWorkflowLogs'
          ? `run ${block.input?.runId ?? ''}`
          : toolShortName === 'RunProjectCommand'
            ? block.input?.label
            : (mcpResult?.message ?? undefined);
    return (
      <QuietToolBlock
        icon="⚙"
        label={toolShortName}
        detail={detail}
        isError={block.isError}
        result={block.result}
      />
    );
  }

  // baguette-op commands (legacy — old sessions only)
  const baguetteOp = block.name === 'Bash' ? parseBaguetteOp(block.input?.command) : null;
  if (baguetteOp) {
    if (QUIET_BAGUETTE_OPS.has(baguetteOp.op)) {
      return (
        <QuietToolBlock
          icon="⚙"
          label={baguetteOp.op}
          isError={block.isError}
          result={block.result}
        />
      );
    }
    if (baguetteOp.op === 'pr-upsert') {
      return (
        <PrUpsertBlock
          title={baguetteOp.arg?.title ?? '(no title)'}
          body={baguetteOp.arg?.body ?? ''}
          result={block.result}
          isError={block.isError}
        />
      );
    }
    if (baguetteOp.op === 'command') {
      return <CommandBlock baguetteOp={baguetteOp} block={block} />;
    }
  }

  const isEditWithDiff = block.name === 'Edit' && block.input?.old_string != null;
  const isWriteWithContent = block.name === 'Write' && block.input?.content != null;

  // ExitPlanMode with feedback (isError) should show "continue" badge, not "error"
  const isContinuePlanning = block.name === 'ExitPlanMode' && block.isError;

  return (
    <div
      className={`bg-zinc-900/50 rounded-lg border overflow-hidden ${block.isError && !isContinuePlanning ? 'border-red-800/60' : 'border-zinc-800'}`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 sm:px-4 py-2 text-left hover:bg-zinc-800/50 transition-colors gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-amber-400 text-xs font-mono shrink-0">{block.name}</span>
          {isContinuePlanning ? (
            <span className="shrink-0 text-sky-400 text-xs font-medium bg-sky-950/40 px-1.5 py-0.5 rounded">
              continue
            </span>
          ) : (
            block.isError && (
              <span className="shrink-0 text-red-400 text-xs font-medium bg-red-950/40 px-1.5 py-0.5 rounded">
                error
              </span>
            )
          )}
          {block.name === 'Bash' && block.input?.command && (
            <code className="text-zinc-400 text-xs truncate">{block.input.command}</code>
          )}
          {(block.name === 'Write' || block.name === 'Edit') && filePath && (
            <code className="text-zinc-400 text-xs truncate">{filePath}</code>
          )}
          {block.name === 'Glob' && block.input?.pattern && (
            <code className="text-zinc-400 text-xs truncate">{block.input.pattern}</code>
          )}
          {block.name === 'Grep' && (block.input?.pattern || block.input?.path) && (
            <code className="text-zinc-400 text-xs truncate">
              {[
                block.input.pattern,
                block.input.path ? stripWorktreePath(block.input.path, worktreePath) : null,
              ]
                .filter(Boolean)
                .join(' ')}
            </code>
          )}
        </div>
        {!hasResult ? (
          <div className="w-3.5 h-3.5 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin shrink-0" />
        ) : (
          <svg
            className={`w-4 h-4 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {isEditWithDiff && !expanded && (
        <EditDiffPreview
          oldString={block.input.old_string}
          newString={block.input.new_string}
          onExpand={() => setExpanded(true)}
        />
      )}
      {isWriteWithContent && !expanded && (
        <EditDiffPreview
          oldString=""
          newString={block.input.content}
          onExpand={() => setExpanded(true)}
        />
      )}
      {expanded && (
        <div className="px-3 sm:px-4 py-3 border-t border-zinc-800 text-xs space-y-3">
          {block.name === 'Edit' && block.input?.old_string != null ? (
            <div>
              <div className="text-zinc-500 font-medium mb-1">Changes</div>
              <pre className="text-xs font-mono overflow-auto max-h-96 rounded bg-zinc-950/50">
                {diffLines(block.input.old_string ?? '', block.input.new_string ?? '').flatMap(
                  (part, i) => {
                    const prefix = part.added ? '+' : part.removed ? '-' : ' ';
                    const cls = part.added
                      ? 'bg-green-950/60 text-green-300'
                      : part.removed
                        ? 'bg-red-950/60 text-red-300'
                        : 'text-zinc-600';
                    const lines = part.value.split('\n');
                    if (lines[lines.length - 1] === '') lines.pop();
                    return lines.map((line, li) => (
                      <div key={`${i}-${li}`} className={`px-2 ${cls}`}>
                        {prefix}
                        {line}
                      </div>
                    ));
                  }
                )}
              </pre>
            </div>
          ) : block.name === 'Write' && block.input?.content != null ? (
            <div>
              <div className="text-zinc-500 font-medium mb-1">Content</div>
              <pre className="text-xs font-mono overflow-auto max-h-96 rounded bg-zinc-950/50">
                {(block.input.content ?? '').split('\n').map((line, i) => (
                  <div key={i} className="px-2 bg-green-950/60 text-green-300">
                    +{line}
                  </div>
                ))}
              </pre>
            </div>
          ) : (
            <div>
              <div className="text-zinc-500 font-medium mb-1">Input</div>
              <pre className="text-zinc-400 whitespace-pre-wrap overflow-auto max-h-64 bg-zinc-950/50 rounded p-2">
                {JSON.stringify(block.input, null, 2)}
              </pre>
            </div>
          )}
          {block.result != null && (
            <div>
              <div
                className={`font-medium mb-1 ${isContinuePlanning ? 'text-sky-400' : block.isError ? 'text-red-400' : 'text-zinc-500'}`}
              >
                {isContinuePlanning ? 'Feedback' : block.isError ? 'Error' : 'Result'}
              </div>
              {bashResultHtml != null ? (
                <pre
                  className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${
                    block.isError && !isContinuePlanning
                      ? 'text-red-300 bg-red-950/30'
                      : 'text-zinc-300 bg-zinc-950/50'
                  }`}
                  dangerouslySetInnerHTML={{ __html: bashResultHtml }}
                />
              ) : (
                <pre
                  className={`whitespace-pre-wrap overflow-auto max-h-80 rounded p-2 ${
                    block.isError && !isContinuePlanning
                      ? 'text-red-300 bg-red-950/30'
                      : 'text-zinc-400 bg-zinc-950/50'
                  }`}
                >
                  {block.result}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
