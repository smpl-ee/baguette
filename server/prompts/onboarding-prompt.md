Check if `.baguette.yaml` already exists at the project root. If it does, review it and update it as needed. If it does not exist, create it from scratch.

## .baguette.yaml Format

```yaml
config:
  session:
    env:
      # Environment variables injected into every session.
      # Use ${{ baguette.secrets.SECRET_NAME }} to reference secrets stored in Settings > Secrets.
      # Use ${{ baguette.session.shortId }} to get a unique per-session identifier (useful for DB isolation).
      # Use ${{ baguette.session.public_uri }} to get the public URL where baguette proxies this session's dev server.
      DATABASE_URL: 'postgres://user:${{ baguette.secrets.DB_PASSWORD }}@localhost:5432/app_${{ baguette.session.shortId }}'
      NEXT_PUBLIC_APP_URL: '${{ baguette.session.public_uri }}'
      PUBLIC_HOST: '${{ baguette.session.public_uri }}'
    init: |
      # Commands run when a session starts (after worktree creation).
      # Use this to install dependencies, create databases, run migrations, seeds, etc.
      # Prefer pnpm over npm/yarn to preserve disk storage via its global content-addressable cache.
      pnpm install
      pnpm run db:create
      pnpm run db:migrate
      pnpm run db:seed
    cleanup: |
      # Command run when a session is closed. Use to tear down per-session resources.
      pnpm run db:drop
    commands:
      # Quick-launch commands available in the session UI.
      - label: Run tests
        run: pnpm test
  webserver:
    # Command to start the dev server. Must read ports from the env vars listed in ports.
    command: pnpm dev --port $VITE_PORT
    # List of env var names that baguette will assign free ports to before launching.
    # The command must use these env vars instead of hardcoded ports.
    ports: [VITE_PORT, RAILS_PORT]
    # Which port env var is the one users access in the browser.
    expose: VITE_PORT
```

## webserver block fields

- **command**: the shell command to start the dev server. It **must** read the port from an env var (e.g., `--port $VITE_PORT`) rather than a hardcoded port number, because baguette assigns a free port dynamically.
- **ports**: list of env variable names that baguette will set to free ports before launching the command. Include all ports the server needs (e.g., both a frontend port and an API port). Baguette waits until **all** listed ports are listening before marking the dev server ready.
- **expose**: which port env var is the one users reach in the browser. Only one port can be exposed.

## Your Task

0. **Set up mise** (tool version manager):
   - Check if `.mise.toml` or `.tool-versions` exists at the project root
   - If neither exists, detect the required tool versions from the project (e.g. `.nvmrc`, `.ruby-version`, `.python-version`, `package.json` `engines` field, etc.) and create a `.mise.toml` with the appropriate major versions (e.g. `[tools]\nnode = "20"`)
   - Run `mise install` to activate and install the declared tools

1. **Inspect the project** to understand its setup:
   - Read `README.md` for setup instructions
   - Check `package.json` (or `Gemfile`, `requirements.txt`, `go.mod`, etc.) for dependencies and scripts
   - Look at `.env.example`, `.env.sample`, or any `.env.*` files for required environment variables
   - Check for `Makefile`, `docker-compose.yml`, `Procfile`, or similar orchestration files
   - Look at the project structure to identify the tech stack

2. **Configure the session block**:
   - Set `session.env` with all environment variables needed to run the app
   - Use `${{ baguette.session.shortId }}` in database names to isolate each session (e.g. `myapp_${{ baguette.session.shortId }}`)
   - Use `${{ baguette.session.public_uri }}` when the app needs to know its own public URL (e.g. `NEXT_PUBLIC_APP_URL: ${{ baguette.session.public_uri }}`)
   - Set `session.init` with commands to install deps, create per-session databases, run migrations, and run seeds (e.g., `rails db:seed`, `pnpm run db:seed`) if a seeding command exists in the project
   - **Prefer `pnpm install` over `npm install` or `yarn install`** to save storage space via pnpm's global content-addressable package cache. If the project uses npm or yarn, add `pnpm = "latest"` to `.mise.toml` to make pnpm available, then use `pnpm install` in the init script.
   - Set `session.cleanup` to tear down per-session databases
   - Add `session.commands` for running tests and other useful tasks. Always add a **`Reset database`** command that drops and recreates the session database (e.g. `rm -f .data/app.sqlite3 && pnpm run db:migrate` for SQLite, or `dropdb ... && createdb ... && pnpm run db:migrate` for Postgres). This lets Claude quickly reset state during debugging.

3. **Configure the webserver block**:
   - Identify how the dev server is started (e.g., `vite`, `next dev`, `rails server`, `python manage.py runserver`)
   - If the start command uses a hardcoded port (e.g., `vite --port 3000`), update it to read from an env var instead (e.g., `vite --port $VITE_PORT`)
   - Update any config files that hardcode the port (e.g., `vite.config.js`, `next.config.js`) to read from `process.env.VITE_PORT` or equivalent
   - List all port env vars in `ports` and set `expose` to the one users access in the browser. If multiple services must all be up before the app works (e.g., a Vite frontend and a Rails API), list all their ports — baguette waits until every listed port is listening before marking the dev server ready.
   - **Bind to `127.0.0.1`**: configure the dev server to listen on `127.0.0.1` explicitly, not just `localhost`. When baguette runs in Docker, `localhost` may resolve to `::1` (IPv6) but the proxy connects over IPv4. Pass the appropriate flag for the framework:
     - Vite: `vite --host 127.0.0.1 --port $PORT`
     - Next.js: `next dev -H 127.0.0.1 --port $PORT`
     - Rails: `rails server -b 127.0.0.1 -p $PORT`
     - Django: `python manage.py runserver 127.0.0.1:$PORT`
   - **Allow the baguette public URI as an allowed host**: the dev server will receive requests with the baguette public hostname, so configure it to accept that host. **Do not allow all hosts** (avoid `allowedHosts: 'all'`, `ALLOWED_HOSTS = ['*']`, `config.hosts.clear`, etc.). Instead, add `PUBLIC_HOST: "${{ baguette.session.public_uri }}"` to `session.env` and configure the dev server to read from it specifically:
     - Vite: `server: { allowedHosts: [new URL(process.env.PUBLIC_HOST).hostname] }` in `vite.config.js`
     - Next.js: `allowedDevOrigins: [process.env.PUBLIC_HOST]` in `next.config.js`
     - Rails: `config.hosts << URI.parse(ENV['PUBLIC_HOST']).host`
     - Django: `ALLOWED_HOSTS = [urlparse(os.environ['PUBLIC_HOST']).hostname]`

4. **Check the global docker-compose file** at `{{DOCKER_COMPOSE_PATH}}`:
   - Read the file to see what services already exist (postgres, redis, etc.)
   - If the project needs services not yet defined, add them to the global docker-compose file. It there is already a service defined let's just use it. We can be lose on service versions, just ask the user if they are ok with it. (For example if we have a postgres:16 already available in compose but the project is on postgres v8)
   - Start any newly added services with `docker compose -f {{DOCKER_COMPOSE_PATH}} up -d <service>`
   - Update the corresponding connection URLs in `session.env` to reference the docker service host. You can use the docker compose service name as host (e.g. after adding or finding a "postgres" service on the docker compose file, add `DATABASE_URL: "postgres://user:pass@postgres/..."`)

5. **Configure per-session database isolation**:
   - Each session gets a unique `shortId`. Use it in database names so sessions don't interfere
   - The `init` script should create the session-specific database
   - The `cleanup` script should drop it
   - You may need to modify the app's database config to read from an environment variable instead of a hardcoded name
   - For tests, ensure they also use a session-specific database (e.g. `myapp_test_${{ baguette.session.shortId }}`).
   - This does not apply to databases on disk relative to the project root (ex: sqlite databases with relative paths).

6. **Write (or update) the .baguette.yaml file** at the project root with the configuration.

7. **Validate the setup**:
   - Attempt to run the `session.init` commands you wrote to verify they succeed
   - Fix any missing dependencies, missing env vars, or errors that come up

## How to proceed after reading this prompt

You fetched this text with **`baguette-op config-repo-prompt`**. Use the technical sections above to create or update `.baguette.yaml` when appropriate.

**Decide** whether repository configuration is worth doing right now:

- A missing `.baguette.yaml` almost always warrants creating one.
- An outdated or incomplete file depends on scope — use judgment.

**If configuration should happen (or the user wants it):** use the **AskUserQuestion** tool with three options:

- **Configure in this session** — run through the onboarding steps from this prompt now, then **go back to the user’s original task** and finish it.
- **Start a new dedicated session** — run `baguette-op config-repo-start`, give the user the returned `sessionPath` link, then **resume the original task** in this session.
- **Skip for now** — continue the **original task** without configuring.

**CRITICAL:** Onboarding is supporting work. Whatever option the user picks, you must **return to and complete their original request** — do not leave the conversation stuck on setup alone unless they clearly asked to pause that work.
