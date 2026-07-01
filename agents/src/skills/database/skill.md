---
name: database
description: MySQL database with Drizzle ORM for data persistence
whenToUse: User needs to store, query, or manage persistent data. Triggers include database, MySQL, tables, rows, records, CRUD, persist, save data, data model, schema, Drizzle, ORM, relational data, foreign keys, migrations, seed data, query data, data-driven features.
dependencies:
  - drizzle-orm
  - drizzle-kit
  - mysql2
intents:
  - database/MySQL/save data/persist records/data model/schema/tables/CRUD/Drizzle/ORM/seed
templateMappings:
  drizzle.config.ts: ""
---

# MySQL Database Skill

Add MySQL with Drizzle ORM for persistent data storage and querying.

> Tools prefixed `database__` are auto-loaded with this skill (listTables, getSchema, getTableData, insertRow, updateRow, deleteRow). Unload with `skill({ action: 'unload', skill: 'database' })` when no longer needed.

---

## Installation

```typescript
skill({ action: 'install', skill: 'database' });
```

This installs:

| File | Role |
|------|------|
| `src/server/db/client.ts` | Connection pool — IMMUTABLE |
| `src/server/db/config.ts` | Credential loader — IMMUTABLE |
| `drizzle.config.ts` | Migration config — IMMUTABLE |
| `src/server/db/schema.ts` | Table definitions — MODIFY THIS |

Dependencies added: `drizzle-orm`, `drizzle-kit`, `mysql2`.

---

## Available Tools

| Tool | Purpose |
|------|---------|
| `database__listTables` | List all tables (excludes system tables) |
| `database__getSchema` | Get column names, types, constraints for a table |
| `database__getTableData` | Paginated rows (page, limit, hasMore) |
| `database__insertRow` | Insert row with column-value pairs |
| `database__updateRow` | Update row by primaryKey |
| `database__deleteRow` | Delete row by primaryKey |

All tools require app context (appId). Use `database__listTables` after migrations to verify tables exist.

---

## Workflow (repeat for every schema change)

1. Define or modify tables in `src/server/db/schema.ts`
2. Generate migration: `npx drizzle-kit generate`
3. Apply migration: `npx drizzle-kit migrate`
4. Verify: call `database__listTables` to confirm tables exist
5. If step 2 or 3 fails → read error, fix schema, go to step 2

Never skip verification. A migration that silently fails leaves the app in a broken state the user discovers later.

---

## Schema Definition

Define tables in `src/server/db/schema.ts`:

```typescript
import { mysqlTable, int, varchar, timestamp } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});
```

Common column types: `int`, `varchar(length)`, `text`, `boolean`, `timestamp`, `json`, `decimal(precision, scale)`.

### Relationships (Foreign Keys)

```typescript
export const posts = mysqlTable('posts', {
  id: int('id').primaryKey().autoincrement(),
  title: varchar('title', { length: 255 }).notNull(),
  authorId: int('author_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Schema Evolution

New columns on existing tables must be **nullable** or have a `.default()` value — existing rows cannot satisfy a NOT NULL constraint without a default.

---

## MySQL Constraints

**No `.returning()` support.** MySQL requires the `insertId` pattern:

```typescript
const result = await db.insert(users).values(data);
const insertedId = Number(result[0].insertId);
const user = await db.select().from(users).where(eq(users.id, insertedId)).limit(1);
```

**`.js` extensions required** in API route imports:

```typescript
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
```

Template files (handled by Vite) use extensionless imports.

---

## Common Patterns

### API Handler with Database

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

---

## Server Restarts

**Restart only when:**
- Applying database schema migrations
- Installing new backend dependencies
- Modifying server configuration files

**Do not restart for:**
- Code changes (Vite HMR handles this)
- Frontend dependency installations

---

## Key Rules

- MySQL only — no `.returning()` support, use insertId pattern
- Pre-configured DB — use `db` from client.ts, never modify the connection
- Schema changes require migrations — `npx drizzle-kit generate` then `npx drizzle-kit migrate`
- `.js` extensions in API routes — template files use extensionless (Vite handles it)
- Migration files are auto-committed — git tracks schema changes
