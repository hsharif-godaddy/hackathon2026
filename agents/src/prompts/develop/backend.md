# Backend Development

## Database with Drizzle ORM

### Workflow

1. Import `db` from `src/server/db/client.ts` (pre-configured, read-only)
2. Define schema in `src/server/db/schema.ts` (single source of truth)
3. Run `npm run db:generate` (create migration files)
4. Run `npm run db:migrate` (apply migrations)

### MySQL Limitation - No .returning()

MySQL doesn't support `.returning()`. Use `insertId` pattern:

```typescript
// Create record
const result = await db.insert(users).values(data);
const insertedId = result.insertId;

// Fetch the created record
const user = await db.select().from(users).where(eq(users.id, insertedId)).limit(1);
```

### Schema Example

```typescript
import { mysqlTable, int, varchar, timestamp } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

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
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  try {
    const items = await db.select().from(users);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed', message: String(error) });
  }
}
```

### Create Example (MySQL-safe)

```typescript
// POST /api/users
const { name, email } = req.body;
if (!name || !email) {
  return res.status(400).json({ error: 'Missing fields' });
}

// NO .returning() - use insertId
const result = await db.insert(users).values({ name, email });
const insertId = Number(result[0].insertId);
const newUser = await db.select().from(users).where(eq(users.id, insertId)).limit(1);

res.status(201).json(newUser[0]);
```

### Status Codes

- **200** - Success
- **201** - Created
- **400** - Validation error
- **404** - Not found
- **500** - Server error

## Server Restarts

**Rarely needed** - Vite HMR automatically reloads code changes.

**ONLY restart when:**

- Applying database schema migrations
- Installing NEW backend dependencies (not frontend)
- Modifying server configuration files
- Server becomes unresponsive

**DO NOT restart for:**

- Code changes (Vite HMR handles this)
- Frontend dependency installations
- Typical development work

## Key Rules

- MySQL only - No `.returning()` support
- Pre-configured DB - Use `db` from client.ts, don't modify connection
- Schema changes require migrations - Use db:generate and db:migrate
- Use `.js` extensions - Backend imports require explicit extensions
- Migration files auto-committed - Git tracks schema changes
