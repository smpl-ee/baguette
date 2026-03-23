# Baguette – Claude Code Notes

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
