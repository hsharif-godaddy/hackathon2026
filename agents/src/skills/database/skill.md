---
name: database
description: MySQL database with Drizzle ORM for data persistence
whenToUse: User needs to store data, create tables, query data, or build data-driven features. Phrases like "save data", "database", "store information", "persist", "tables", "queries", "CRUD operations".
dependencies:
  - drizzle-orm
  - drizzle-kit
  - mysql2
intents:
  - save data/database/CRUD/persist records
---

# MySQL Database Skill

**Purpose:** Add MySQL database with Drizzle ORM for data persistence and querying.

> **Note:** This skill provides custom tools that are automatically loaded when you activate the skill. Tools are prefixed with `database__` (e.g., `database__listTables`, `database__getSchema`). Unload with `skill({ action: 'unload', skill: 'database' })` when no longer needed.

---

## When to Use This Skill

Load when users need to:

- Store persistent data
- Create database tables
- Query or manage data
- Build data-driven features

---

## Installation

### Step 1: Install Skill Templates

```typescript
skill({ action: 'install', skill: 'database' });
```

This installs:

- Database client (`src/server/db/client.ts`) - IMMUTABLE
- Config loader (`src/server/db/config.ts`) - IMMUTABLE
- Schema file (`src/server/db/schema.ts`) - MODIFY THIS
- Drizzle config (`drizzle.config.ts`) - IMMUTABLE
- Dependencies: drizzle-orm, drizzle-kit, mysql2

---

## Available Tools

When you load this skill, the following tools become available:

### `database__listTables`

List all tables in the application's database (excludes system tables).

**Parameters:** None (uses app context)

**Returns:** `{ success: boolean, tables: string[] }`

**Example:**

```typescript
database__listTables();
// Returns: { success: true, tables: ["users", "products", "orders"] }
```

### `database__getSchema`

Get schema information for a specific table (column names, types, constraints).

**Parameters:**

- `tableName` (string): Name of the table

**Returns:** `{ success: boolean, tableName: string, columns: TableColumn[] }`

**Example:**

```typescript
database__getSchema({ tableName: 'users' });
// Returns: { success: true, tableName: "users", columns: [{ name: "id", type: "int", nullable: false, key: "PRI", ... }, ...] }
```

### `database__getTableData`

Get paginated data from a table.

**Parameters:**

- `tableName` (string): Name of the table
- `page` (number, optional): Page number (default: 1)
- `limit` (number, optional): Rows per page (default: 25, max: 1000)

**Returns:** `TableDataResult` - Paginated rows with metadata

**Example:**

```typescript
database__getTableData({ tableName: 'users', page: 1, limit: 10 });
// Returns: { rows: [...], total: 42, page: 1, limit: 10, hasMore: true }
```

### `database__insertRow`

Insert a new row into a table.

**Parameters:**

- `tableName` (string): Name of the table
- `data` (object): Column-value pairs for the new row

**Returns:** `{ success: boolean }`

**Example:**

```typescript
database__insertRow({
  tableName: 'users',
  data: { name: 'John Doe', email: 'john@example.com' },
});
```

### `database__updateRow`

Update an existing row in a table.

**Parameters:**

- `tableName` (string): Name of the table
- `primaryKey` (object): Primary key column-value pairs for WHERE clause
- `data` (object): Column-value pairs to update

**Returns:** `{ success: boolean }`

**Example:**

```typescript
database__updateRow({
  tableName: 'users',
  primaryKey: { id: 1 },
  data: { name: 'Jane Doe' },
});
```

### `database__deleteRow`

Delete a row from a table.

**Parameters:**

- `tableName` (string): Name of the table
- `primaryKey` (object): Primary key column-value pairs for WHERE clause

**Returns:** `{ success: boolean }`

**Example:**

```typescript
database__deleteRow({
  tableName: 'users',
  primaryKey: { id: 1 },
});
```

---

## Workflow

1. Import `db` from `src/server/db/client.ts` (pre-configured, read-only)
2. Define schema in `src/server/db/schema.ts` (single source of truth)
3. Run `npx drizzle-kit generate` (create migration files)
4. Run `npx drizzle-kit migrate` (apply migrations)

---

## MySQL Limitation - No .returning()

MySQL doesn't support `.returning()`. Use `insertId` pattern:

```typescript
// Create record
const result = await db.insert(users).values(data);
const insertedId = Number(result[0].insertId);

// Fetch the created record
const user = await db.select().from(users).where(eq(users.id, insertedId)).limit(1);
```

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

**ONLY restart when:**

- Applying database schema migrations
- Installing NEW backend dependencies
- Modifying server configuration files

**DO NOT restart for:**

- Code changes (Vite HMR handles this)
- Frontend dependency installations

---

## Key Rules

- MySQL only - No `.returning()` support
- Pre-configured DB - Use `db` from client.ts, don't modify connection
- Schema changes require migrations - Use `npx drizzle-kit generate` and `npx drizzle-kit migrate`
- Use `.js` extensions - Backend imports in API routes require explicit extensions (e.g., `import { db } from '../../db/client.js'`). Template files use TypeScript imports without extensions (handled by Vite bundler).
- Migration files auto-committed - Git tracks schema changes
