# Workflow Guidelines

## Database Schema Design Workflow

1. **Understand application requirements** - What data needs to be stored?
2. **Design table structures** - Define columns, types, and relationships
3. **Implement schema using Drizzle ORM** - Define tables in `src/server/db/schema.ts`
4. **Push schema to database** - Use `pnpm run db:push` to sync schema changes directly
5. **Create API endpoints** - Build backend routes for data access in `src/server/api/`
6. **Hand back control** to Development Agent for frontend integration

## Drizzle Schema Implementation

### File Structure

- **Schema definitions**: `src/server/db/schema.ts` - Define all tables here (single source of truth)
- **Database connection**: `src/server/db/index.ts` - Exports ready-to-use `db` instance (DO NOT modify)
  - Import with: `import { db } from '@/server/db'`
  - Connection details are automatically loaded from environment
  - No need to handle credentials or configuration

### Defining Tables in Drizzle

Use Drizzle's MySQL schema builder in `src/server/db/schema.ts`:

```typescript
import { mysqlTable, serial, varchar, text, timestamp, int } from 'drizzle-orm/mysql-core';

// Define tables using mysqlTable
export const users = mysqlTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const posts = mysqlTable('posts', {
  id: serial('id').primaryKey(),
  userId: int('user_id')
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Codebase-First Workflow

This project uses a **codebase-first approach** for rapid prototyping where the TypeScript schema is the source of truth.

**Step 1: Define Schema**

Add table definitions to `src/server/db/schema.ts` using Drizzle's schema builder.

**Step 2: Push Schema to Database**

Push the schema directly to the database:

```bash
pnpm run db:push
```

This command:

- Syncs your TypeScript schema directly to the database
- Automatically detects changes and updates tables
- No migration files are generated
- Perfect for rapid prototyping and iterative development

**Step 3: Verify Schema**

Test the connection and verify tables were created successfully.

**Important Notes:**

- The schema file (`src/server/db/schema.ts`) is your single source of truth
- Changes to the schema are immediately reflected in the database
- No need to manage migration files for rapid prototyping
- Use `pnpm run db:push` every time you modify the schema

### Common Drizzle Column Types

- `serial('id')` - Auto-incrementing integer primary key
- `int('column_name')` - Integer field
- `varchar('column_name', { length: 255 })` - Variable-length string
- `text('column_name')` - Long text field
- `timestamp('column_name')` - Timestamp field
- `boolean('column_name')` - Boolean field
- `json('column_name')` - JSON field

### Relationships

Define foreign keys using `.references()`:

```typescript
userId: int('user_id')
  .notNull()
  .references(() => users.id);
```

### Using the Database Connection

The database connection is ready to use in your API routes. The project uses **Express-style handlers** with the `vite-plugin-api-routes` plugin.

**API Route Structure:**

- Routes are organized by HTTP method: `GET.ts`, `POST.ts`, `PUT.ts`, `DELETE.ts`
- Each file exports a default async function handler
- Uses Express `Request` and `Response` types

**Example API Routes:**

```typescript
// In src/server/api/users/GET.ts - Get all users
import type { Request, Response } from 'express';
import { db } from '@/db';
import { users } from '@/db/schema';

export default async function handler(_req: Request, res: Response) {
  const allUsers = await db.select().from(users);
  res.json(allUsers);
}
```

```typescript
// In src/server/api/users/POST.ts - Create a new user
import type { Request, Response } from 'express';
import { db } from '@/db';
import { users } from '@/db/schema';

export default async function handler(req: Request, res: Response) {
  const userData = req.body;
  const newUser = await db.insert(users).values(userData).returning();
  res.json(newUser[0]);
}
```

```typescript
// In src/server/api/users/[id]/GET.ts - Get user by ID
import type { Request, Response } from 'express';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  const userId = parseInt(req.params.id);
  const user = await db.select().from(users).where(eq(users.id, userId));

  if (user.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(user[0]);
}
```

**Key Points:**

- Use Express-style handlers: `export default async function handler(req, res)`
- Import types from `express`: `import type { Request, Response } from 'express'`
- Import `db` from `@/db` (alias for `src/server/db`)
- Use `res.json()` to send responses
- Use `req.body` for POST/PUT data
- Use `req.params` for URL parameters (e.g., `[id]` in folder structure)
- Connection is pre-configured and ready to use
- No need to handle credentials or connection strings
- Environment automatically provides all connection details
- Focus on schema design and queries, not infrastructure

## Schema Design Best Practices

- Use appropriate data types for each column
- Define primary keys (use `serial('id').primaryKey()`)
- Define foreign key relationships with `.references()`
- Add `.notNull()` for required fields
- Add `.unique()` for unique constraints
- Use `.defaultNow()` for timestamps
- Consider data normalization and performance
- Document table purposes and relationships in comments

## Error Handling

- Always validate schema definitions before pushing to database
- Provide clear error messages for failed operations
- Check that schema push completed successfully
- Suggest solutions for common database issues
- Gracefully handle connection failures

## Key Reminders

- **Database infrastructure is pre-configured** - Focus on schema design
- **Use Drizzle ORM for type-safe database operations**
- **Schema file**: `src/server/db/schema.ts` (single source of truth)
- **Connection file**: `src/server/db/index.ts` (pre-configured, DO NOT modify)
- **Codebase-first approach**: Use `pnpm run db:push` to sync schema changes directly
- **No migration files needed** for rapid prototyping
- **Hand back control to Development Agent after schema is ready**
