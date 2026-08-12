import ToolUseBlock from './ToolUseBlock.jsx';

/**
 * Cursor routes custom tool calls through its own `mcp` meta-tool.
 * This component unwraps the nested toolName + result and delegates
 * to ToolUseBlock as if it were an `mcp__baguette__<toolName>` call.
 */
export default function CursorMcpToolBlock({ block, worktreePath, sessionId }) {
  const toolName = block.input?.toolName ?? 'mcp';
  const toolArgs = block.input?.args ?? {};

  let resultText = null;
  let isResultError = block.isError ?? false;

  if (block.result != null) {
    try {
      const r = typeof block.result === 'string' ? JSON.parse(block.result) : block.result;
      isResultError = isResultError || r?.status === 'error' || r?.value?.isError === true;
      const content = r?.value?.content;
      if (Array.isArray(content) && content.length > 0) {
        const item = content[0];
        resultText =
          typeof item?.text === 'string'
            ? item.text
            : typeof item?.text?.text === 'string'
              ? item.text.text
              : JSON.stringify(r, null, 2);
      } else {
        resultText = JSON.stringify(r, null, 2);
      }
    } catch {
      resultText =
        typeof block.result === 'string' ? block.result : JSON.stringify(block.result, null, 2);
    }
  }

  return (
    <ToolUseBlock
      block={{
        name: `mcp__baguette__${toolName}`,
        input: toolArgs,
        result: resultText,
        isError: isResultError,
      }}
      worktreePath={worktreePath}
      sessionId={sessionId}
    />
  );
}
