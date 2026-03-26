# Baguette – Claude Code Notes

## SQLite migrations (Knex + `better-sqlite3`)

Baguette uses SQLite only. Knex’s SQLite dialect does **not** implement most `ALTER TABLE` variants natively: it often **rebuilds** a table by creating a temp table, copying rows, then running **`DROP TABLE "<name>"`**, then renaming the temp table back. If another table has a foreign key **to** that table, `DROP TABLE` fails with `FOREIGN KEY constraint failed` (for example dropping or altering `users` while `sessions`, `usage`, or `user_repos` reference `users`).

### What actually runs `DROP TABLE` (besides obvious drops)

- **Explicit:** `knex.schema.dropTable(...)` / `dropTableIfExists(...)` (including `down` migrations that chain these).

- **Implicit (table rebuild — same failure mode as above):** schema-builder calls that route through Knex’s `SQLite3_DDL` helper, including:
  - `table.dropColumn(...)` / `t.dropColumn(...)`
  - `table.dropForeign(...)` / `t.dropForeign(...)`
  - `table.dropPrimary(...)` / `t.dropPrimary(...)`
  - `table.primary(...)` / `t.primary(...)` when altering an existing table
  - `table.foreign(...)` / `t.foreign(...)` when adding a foreign key to an existing table
  - Changing an existing column’s type, nullability, or default in an `alterTable` (e.g. `.alter()` / nullable flips) when Knex cannot do it with a simple `ADD COLUMN`

Prefer **native SQLite DDL** when the bundled SQLite supports it (e.g. **`ALTER TABLE … DROP COLUMN`** since 3.35.0) so the table is not dropped and FKs to it are not stressed. See `server/migrations/003_encrypt_access_token.js` for an example.

**Usually safe (no full rebuild in Knex’s SQLite compiler):** adding a column with `alterTable` / `table.*` where SQLite can use `ALTER TABLE … ADD COLUMN`, and `renameColumn` (uses `ALTER TABLE … RENAME …` rather than the DDL rebuild path).

## Frontend Error Handling

### Rule: every user-triggered or data-critical failure must surface to the user

Use `toastError(label, err)` from `client/src/utils/toastError.jsx` for all error notifications. Do **not** use `toast.error()` directly for API/service errors — `toastError` renders a collapsible "Show details" section with `err.message` so users and developers can see the underlying error without cluttering the UI.

```js
import { toastError } from '../utils/toastError.jsx';

// Good
.catch((err) => toastError('Failed to delete session', err));

// Bad — swallows the error silently
.catch(() => {});

// Bad — logs to console only, invisible in production
.catch(console.error);

// Bad — use toastError instead, which includes collapsible details
.catch((err) => toast.error(err.message || 'Failed to delete session'));
```

### What to toast vs. what to leave silent

| Category                                                                            | Behavior                                                |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| User-triggered mutations (create, delete, patch, approve…)                          | Always `toastError`                                     |
| Data loads that block a feature (secrets list, repos list, branches)                | `toastError`                                            |
| Background reads that degrade gracefully (usage graph, model list, config commands) | Silent `.catch(() => {})` — UI still works without them |

### Pattern for event handlers

```js
const handleDelete = async (id) => {
  try {
    await service.remove(id);
    reload();
  } catch (err) {
    toastError('Failed to delete item', err);
  }
};
```

### Pattern for promise chains

```js
service
  .find()
  .then((d) => setData(d.data))
  .catch((err) => toastError('Failed to load items', err));
```
