# Configuration

## Data directory

All persistent data lives under a single data directory, configurable via **`DATA_DIR`** (default: `~/.baguette`). This keeps the project directory clean and makes backups and deployment predictable.

| Path                                                            | Contents                                       |
| --------------------------------------------------------------- | ---------------------------------------------- |
| `<DATA_DIR>/baguette.sqlite3`                                   | SQLite database                                |
| `<DATA_DIR>/repos/<stripped_name>/main/`                        | Bare clone for each repo (shared object store) |
| `<DATA_DIR>/repos/<stripped_name>/sessions/<session_short_id>/` | One worktree per session                       |

`<stripped_name>` is derived from the repo's full name (e.g. `owner/repo-name` → `owner-repo-name`, alphanumeric and dashes only) and stored on the repo record so paths stay stable.

## Git worktree strategy

Repositories are cloned once as bare repos under `<DATA_DIR>/repos/<stripped_name>/main/`. Each session gets a git worktree under `.../sessions/<session_short_id>/`, sharing the object store to save disk space and fetch time. Before creating a worktree, the server runs `git fetch origin` to ensure it starts from the latest remote branch. When all sessions for a repo are closed, the bare clone is removed.

## Session config (`.baguette.yaml`)

You can place a `.baguette.yaml` config file in a repository's root to define per-session environment variables, initialization commands, cleanup, quick-launch commands, and a dev-server proxy. This is useful for per-session setup like creating databases, seeding data, or cleaning up resources.

### YAML schema

```yaml
config:
  session:
    env: # Env vars injected into Claude and tasks (supports placeholders)
      KEY: value
    init: | # Commands run when a session starts (one per line)
      command1
      command2
    cleanup: | # Command run when a session is closed
      command
    commands: # Quick-launch commands shown in the session UI
      - label: Run tests
        run: yarn test
  webserver: # Optional: expose a dev server through Baguette's proxy
    command: yarn dev --port $PORT # Must read port from an env var, not a hardcoded value
    ports: [PORT] # Env var names Baguette will set to free ports before launch
    expose: PORT # Which port users access in the browser
```

### Placeholders

Placeholders are interpolated at injection time (when starting Claude or tasks). Unknown placeholders are replaced with an empty string.

| Placeholder                          | Description                                                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `${{ baguette.secrets.KEY }}`        | Value of the secret named `KEY` from Settings → Secrets                                  |
| `${{ baguette.session.short_id }}`    | The session's 4-character hex identifier                                                 |
| `${{ baguette.session.public_uri }}` | Public URL where Baguette proxies this session's dev server (requires `webserver` block) |

### `webserver` block

Baguette can proxy a dev server running inside the session, making it accessible from the browser via a signed preview link.

- **`command`**: shell command to start the dev server. Must read the port from an env var (e.g. `--port $VITE_PORT`) — Baguette assigns a free port dynamically.
- **`ports`**: list of env var names that Baguette sets to free ports before launching the command.
- **`expose`**: which port env var users access in the browser. Only one port can be exposed.

[➡️ See Web Server Preview section](#web-server-preview)

### Example

```yaml
config:
  session:
    env:
      DB_DEV_URL: postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@localhost:5432/app_${{ baguette.session.short_id }}_dev
      DB_TEST_URL: postgres://postgres:${{ baguette.secrets.PG_PASSWORD }}@localhost:5432/app_${{ baguette.session.short_id }}_test
      NEXT_PUBLIC_APP_URL: ${{ baguette.session.public_uri }}
    init: |
      npm install
      npm run db:create db:migrate db:seed
    cleanup: |
      npm run db:drop
    commands:
      - label: Run tests
        run: npm test
  webserver:
    command: npm run dev -- --port $APP_PORT
    ports: [APP_PORT]
    expose: APP_PORT
```

- `session.env` is stored as a template (with placeholders) on the session. Values are interpolated only when injecting into Claude or spawned tasks.
- `session.init` runs after the worktree is created and before the Claude query starts. Each line is executed as a separate command. If any command fails, session creation fails.
- `session.cleanup` runs when a session is closed, before the worktree is removed. Errors are logged but do not prevent cleanup.

## Web Server Preview

Baguette proxies session dev servers via subdomain routing. Each session's preview is served at `session-<session_short_id>.<host>`.

### Development - Localhost

`*.localhost` must resolve to `127.0.0.1`. Most systems do not support wildcard `.localhost` subdomains by default — use `dnsmasq`:

**macOS (Homebrew):**

```bash
brew install dnsmasq
echo "address=/.localhost/127.0.0.1" | tee -a $(brew --prefix)/etc/dnsmasq.conf
sudo brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo "nameserver 127.0.0.1" | sudo tee /etc/resolver/localhost
```

**Linux (systemd-resolved or dnsmasq):**

```bash
# dnsmasq
echo "address=/.localhost/127.0.0.1" | sudo tee -a /etc/dnsmasq.conf
sudo systemctl restart dnsmasq
```

Once configured, the Baguette UI is at `www.localhost:5173` and previews at `session-<id>.localhost:5173`.

### Production

For production setup including wildcard DNS, TLS, and deployment configuration, see **[deployment.md](deployment.md)**.
