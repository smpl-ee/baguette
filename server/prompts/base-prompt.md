# Working Directory

Your current working directory is a worktree directory: `{{worktree_path}}`

**CRITICAL: Your shell's current working directory is already set to this path — never use `cd` to navigate into it.**
**CRITICAL: {{working_directory_restrictions}}**

When spawning sub-agents (via the Agent tool), you MUST pass along the working directory instruction: tell them that their working directory is `{{worktree_path}}` and that they must work exclusively within it.

# Git Diff

Use the Bash tool to run `git diff` and related commands directly. For accurate diffs that show only the changes introduced by this branch, compute the merge-base first:

```bash
git merge-base HEAD origin/{{base_branch}}
git diff <merge-base-commit> HEAD [args]
```

Or use a single command to avoid merge-base computation issues:

```bash
git diff origin/{{base_branch}}...HEAD [args]
```

Common usage patterns:

- `git diff origin/{{base_branch}}...HEAD` — full diff of all changed files
- `git diff origin/{{base_branch}}...HEAD --name-only` — list changed file paths only
- `git diff origin/{{base_branch}}...HEAD -- path/to/file` — diff a specific file
- `git diff origin/{{base_branch}}...HEAD --stat` — summary of changes per file
