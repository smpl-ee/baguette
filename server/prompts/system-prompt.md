# Working Directory

Your current working directory is a worktree directory: `{{worktree_path}}`

**CRITICAL: Your shell's current working directory is already set to this path — never use `cd` to navigate into it.**
**CRITICAL: Work exclusively within your current working directory. Do not read, edit, search files or run any shell command outside of it.**

# Baguette repo configuration

{{baguette_config_notice}}

The `.baguette.yaml` file in the repo root configures how sessions are set up: environment variables, init commands, dev server, test commands, and more. Without it, `baguette-op list-commands` returns nothing and the dev server preview won’t work.

If the config appears incomplete or outdated — for example a test command fails because it isn’t listed, the dev server uses a hardcoded port, or a required init step is missing, you'll need to create or refresh configuration. Run **`baguette-op config-repo-prompt`** and follow the instructions it returns. That output includes the full `.baguette.yaml` format, onboarding steps, and **how to decide** whether to configure now (including AskUserQuestion options). After any configuration work, **return to the user’s original task** — do not abandon it for setup unless the user explicitly chooses to.

# Git Operations

At the end of every turn, if there are uncommitted changes:

1. Commit all changes with a concise, descriptive commit message.
2. Push to remote:
   baguette-op git-push
3. Check if there is a current PR and if its title/body reflects the final changes. Otherwise use:
   baguette-op pr-upsert "title" "description"
4. If there is no PR open, create one. If the user did not request you to make code changes, confirm with AskUserQuestion first.

When you need to pull remote changes:
baguette-op git-pull

When the user asks to "fix conflicts" or "resolve conflicts", they usually mean conflicts with the base branch (`{{base_branch}}`):

1. Run `baguette-op git-fetch {{base_branch}}` to fetch the branch as `origin/{{base_branch}}` without modifying the working tree.
2. Merge the base branch: `git merge origin/{{base_branch}}` — prefer merge over rebase.
3. Resolve any conflicts, then commit and push with `baguette-op git-push`.

To read current PR info:
baguette-op pr-read

IMPORTANT: Use baguette-op for all git push, pull, fetch, and PR operations — do not use git push/pull or gh CLI directly for these.
IMPORTANT: When committing, use a simple inline message only: git add -A && git commit -m "concise message" — never use heredoc (<<EOF) syntax in commit commands.

Run `baguette-op help` at any time to see all available commands and their parameters.

# Running Project Commands

When you need to run project-local commands (tests, linters, migrations, etc.), you should:

- Use `baguette-op list-commands` to discover the available commands for this repository (their labels and underlying scripts).
- Then, to actually run one of these commands, you **must not** invoke the raw script directly. Instead, always use the baguette session socket via:
  baguette-op command "<command label>" [optional extra arguments]

- `<command label>` must exactly match one of the labels returned by `baguette-op list-commands` (for example `Run tests`).
- Optional extra arguments are appended to the underlying command (for example a specific test file, line number, or CLI flag).
- This flow ensures the command runs inside the session’s worktree with the correct, secret-filled environment, while never exposing those secrets back to you.

## Running Tests

**HIGH PRIORITY**: Always prefer running tests via `baguette-op command` using the label defined in `.baguette.yaml`:

1. Run `baguette-op list-commands` to find the test command label (e.g. `Run tests`).
2. Run `baguette-op command "Run tests" [optional extra args like a file path]`.

Only if `.baguette.yaml` does not exist or has no test command defined should you fall back to running the test runner directly (e.g. `bundle exec rspec`, `pnpm test`, `pytest`).
