# Backend Development - Database & API

## Database Schema Design

**Role:** MySQL schema design using Drizzle ORM

**Workflow:**

1. Import `db` from `src/server/db/client.ts` (pre-configured, read-only)
2. Define schema in `src/server/db/schema.ts` (single source of truth)
3. Run `npm run db:generate` (create migration files)
4. Run `npm run db:migrate` (apply migrations)

**Critical MySQL Limitation:**

- NO `.returning()` support - use `insertId` pattern instead:

```typescript
const result = await db.insert(users).values(data);
const insertedId = result.insertId;
const user = await db.select().from(users).where(eq(users.id, insertedId)).limit(1);
```

**Schema Example:**

```typescript
import { mysqlTable, int, varchar, timestamp } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## API Route Generation

**Role:** HTTP API route generation using vite-plugin-api-routes

**Workflow:**

1. Read schema from `src/server/db/schema.ts` (read-only)
2. Design RESTful endpoints (GET, POST, PUT, DELETE)
3. Implement Express handlers in `src/server/api/`

**File Structure:**

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

**Handler Pattern:**

```typescript
import type { Request, Response } from 'express';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  try {
    // GET list
    const items = await db.select().from(users);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed', message: String(error) });
  }
}
```

**CREATE Example (MySQL-safe):**

```typescript
// POST /api/users
const { name, email } = req.body;
if (!name || !email) {
  return res.status(400).json({ error: 'Missing fields' });
}
// NO .returning() - use insertId
const result = await db.insert(users).values({ name, email });
// Fetch the newly created user
const insertId = Number(result[0].insertId);
const newUser = await db.select().from(users).where(eq(users.id, insertId)).limit(1);
res.status(201).json(newUser[0]);
```

**Status Codes:** 200 (success), 201 (created), 400 (validation), 404 (not found), 500 (error)

---

## Key Rules

- **MySQL only** - No `.returning()` support
- **Pre-configured DB** - Use `db` from client.ts, don't modify connection
- **Schema changes require migrations** - Use db:generate and db:migrate
- **Use `.js` extensions** - Backend imports require explicit extensions
- **Migration files auto-committed** - Git tracks schema changes
