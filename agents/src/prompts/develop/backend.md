# Backend Development

## API Routes

### File Structure

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

### Handler Pattern

```typescript
import type { Request, Response } from 'express';

export default async function handler(req: Request, res: Response) {
  try {
    // Handler logic here
    const items = [{ id: 1, name: 'Example' }];
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed', message: String(error) });
  }
}
```

### Status Codes

- **200** - Success
- **201** - Created
- **400** - Validation error
- **404** - Not found
- **500** - Server error

## Server Restarts

**Rarely needed** - Vite HMR automatically reloads code changes, and `vite-plugin-api-routes` automatically detects new API endpoint files and restarts the dev server.

**ONLY restart when:**

- Applying database schema migrations
- Installing NEW backend dependencies (not frontend)
- Server becomes unresponsive

**DO NOT restart for:**

- Code changes (Vite HMR handles this)
- Creating new API endpoint files (the Vite plugin auto-detects and restarts)
- Frontend dependency installations
- Typical development work

## Key Rules

- Use `.js` extensions - Backend imports require explicit extensions
- No native addons - Production runs Alpine (musl). Use pure-JS packages only
