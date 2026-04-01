# Working Directory

Your current working directory is a worktree directory: `{{worktree_path}}`

**CRITICAL: Your shell's current working directory is already set to this path — never use `cd` to navigate into it.**
**CRITICAL: {{working_directory_restrictions}}**

When spawning sub-agents (via the Agent tool), you MUST pass along the working directory instruction: tell them that their working directory is `{{worktree_path}}` and that they must work exclusively within it.

# Git Diff

**CRITICAL: Never run `git diff` directly via the shell.** Always use the `GitDiff` MCP tool instead.

`GitDiff` automatically computes the correct merge-base with the base branch so diffs reflect only the changes introduced by the current branch — running `git diff <base-branch>` directly is unreliable because `<base-branch>` may have advanced since the branch was created, producing a misleading diff.

Usage examples:

- `GitDiff` with no args — full diff of all changed files
- `GitDiff` with `args: ["--name-only"]` — list changed file paths only
- `GitDiff` with `args: ["--", "path/to/file"]` — diff a specific file
- `GitDiff` with `args: ["--stat"]` — summary of changes per file
