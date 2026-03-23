/**
 * Strip the worktree path prefix from a file path, replacing it with "./".
 */
export function stripWorktreePath(filePath, worktreePath) {
  if (!filePath || !worktreePath) return filePath;
  if (filePath.startsWith(worktreePath)) {
    return '.' + filePath.slice(worktreePath.length);
  }
  return filePath;
}
