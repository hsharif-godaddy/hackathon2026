# Backend Development

## API Routes

### File Structure (Convention)

```
src/server/api/
├── users/
│   ├── GET.ts              → GET /api/users
│   ├── POST.ts             → POST /api/users
│   └── [userId]/
│       ├── GET.ts          → GET /api/users/:userId
│       ├── PUT.ts          → PUT /api/users/:userId
│       └── DELETE.ts       → DELETE /api/users/:userId
```

This layout is convention only. Nothing auto-discovers these files - routes must be registered explicitly (see below).

### Handler Pattern

```typescript
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    const items = [{ id: 1, name: 'Example' }];
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed', message: String(error) });
  }
}
```

### Adding a New Route (Two Steps Required)

Every new route requires BOTH a handler file AND a registration line in `src/server/entry.ts`. Forgetting either step means the route will not work.

**Step 1 - Create the handler file:**

```typescript
// src/server/api/contact/POST.ts
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  const { name, email, message } = req.body;
  // Handle submission
  res.status(201).json({ ok: true });
}
```

**Step 2 - Register the handler in `src/server/entry.ts`:**

```typescript
// src/server/entry.ts (add these two lines)
import contactPost from './api/contact/POST';
app.post('/api/contact', contactPost);
```

Route methods map directly: `GET.ts` → `app.get(...)`, `POST.ts` → `app.post(...)`, `PUT.ts` → `app.put(...)`, `DELETE.ts` → `app.delete(...)`, `PATCH.ts` → `app.patch(...)`.

### Status Codes

- **200** - Success
- **201** - Created
- **400** - Validation error
- **404** - Not found
- **500** - Server error

## Server Restarts

**Rarely needed** - In development, Vite reloads server modules on file change via `ssrLoadModule`, so edits to handler files and to `src/server/entry.ts` take effect without a full restart. In production the app runs as a pre-built bundle and a restart is required to pick up code changes.

**ONLY restart when:**

- Applying database schema migrations
- Installing NEW backend dependencies (not frontend)
- Server becomes unresponsive

**DO NOT restart for:**

- Code changes to handlers or `entry.ts`
- Frontend dependency installations
- Typical development work

## Key Rules

- Use `.js` extensions - Backend imports require explicit extensions
- No native addons - Production runs Alpine (musl). Use pure-JS packages only (bcryptjs not bcrypt, jimp not sharp/canvas)
- Never skip the registration step in `src/server/entry.ts` - there is no filesystem-based auto-discovery
