# Workflow Guidelines

## Database Access Policy

Use Drizzle ORM exclusively for all database operations. The platform provides a pre-configured database client that ensures type safety, maintains consistency across the codebase, and integrates seamlessly with the application infrastructure. This approach prevents connection leaks, eliminates credential management issues, and provides compile-time safety for all database queries.

**For every database operation:**

1. Import the pre-configured client: `import { db } from '@/db/client'`
2. Import required table schemas: `import { users, posts } from '@/db/schema'`
3. Use Drizzle's type-safe query methods for all operations
4. For standalone scripts, import and call `closeConnection` to properly close the connection pool

**This applies to:**

- API route handlers in `src/server/api/`
- Seed scripts for data population
- Utility scripts that read or modify data
- Any backend code that interacts with the database

**Connection Management:**

The database connection details, credentials, and configuration are managed automatically by the platform. Focus on schema design and data operations using the provided Drizzle client.

For standalone scripts that need to exit after completion, always close the connection pool:

```typescript
import { db, closeConnection } from '@/db/client';

// ... perform database operations ...

await closeConnection(); // Critical: allows Node.js to exit
```

API route handlers do not need to close connections - the connection pool is shared and managed by the application server.

## Database Schema Design Workflow

1. **Understand application requirements** - Identify what data needs to be stored
2. **Design table structures** - Define columns, data types, and relationships
3. **Implement schema using Drizzle ORM** - Add table definitions to `src/server/db/schema.ts`
4. **Push schema to database** - Run `pnpm run db:push` to sync changes directly
5. **Create API endpoints** - Build backend routes for data access in `src/server/api/`
   - New API route files are automatically detected by Vite's hot module replacement
   - Endpoints are available immediately after file creation without server restart
6. **Hand back control** to Development Agent for frontend integration

## Drizzle Schema Implementation

### File Structure

- **Schema definitions**: `src/server/db/schema.ts` - Single source of truth for all table definitions
- **Database connection**: `src/server/db/client.ts` - Pre-configured `db` instance (read-only, do not modify)
  - Import with: `import { db } from '@/db/client'`
  - Connection details automatically loaded from environment
  - Credentials and configuration managed by platform

### Defining Tables in Drizzle

Add table definitions to `src/server/db/schema.ts` using Drizzle's MySQL schema builder:

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

### Codebase-First Workflow

This project uses a codebase-first approach for rapid prototyping where the TypeScript schema is the source of truth.

**Step 1: Define Schema**

Add table definitions to `src/server/db/schema.ts` using Drizzle's schema builder.

**Step 2: Push Schema to Database**

Sync the schema directly to the database:

```bash
pnpm run db:push
```

This command syncs your TypeScript schema directly to the database, automatically detects changes, updates tables, and requires no migration files. Run this command every time you modify the schema.

**Step 3: Verify Schema**

Test the connection and verify tables were created successfully.

## API Route Implementation

The project uses Express-style handlers with the `vite-plugin-api-routes` plugin.

**Route Organization:**

- Routes organized by HTTP method: `GET.ts`, `POST.ts`, `PUT.ts`, `DELETE.ts`
- Each file exports a default async function handler
- Uses Express `Request` and `Response` types

**Example: Get All Users** (`src/server/api/users/GET.ts`):

```typescript
import type { Request, Response } from 'express';
import { db } from '@/db/client';
import { users } from '@/db/schema';

export default async function handler(_req: Request, res: Response) {
  const allUsers = await db.select().from(users);
  res.json(allUsers);
}
```

**Example: Create User** (`src/server/api/users/POST.ts`):

```typescript
import type { Request, Response } from 'express';
import { db } from '@/db/client';
import { users } from '@/db/schema';

export default async function handler(req: Request, res: Response) {
  const userData = req.body;
  const newUser = await db.insert(users).values(userData).returning();
  res.json(newUser[0]);
}
```

**Example: Get User by ID** (`src/server/api/users/[id]/GET.ts`):

```typescript
import type { Request, Response } from 'express';
import { db } from '@/db/client';
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

**Example: Update User** (`src/server/api/users/[id]/PUT.ts`):

```typescript
import type { Request, Response } from 'express';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  const userId = parseInt(req.params.id);
  const userData = req.body;

  const updatedUser = await db.update(users).set(userData).where(eq(users.id, userId)).returning();

  if (updatedUser.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(updatedUser[0]);
}
```

**Example: Delete User** (`src/server/api/users/[id]/DELETE.ts`):

```typescript
import type { Request, Response } from 'express';
import { db } from '@/db/client';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  const userId = parseInt(req.params.id);

  const deletedUser = await db.delete(users).where(eq(users.id, userId)).returning();

  if (deletedUser.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ success: true, user: deletedUser[0] });
}
```

**Key Implementation Details:**

- Export default async function: `export default async function handler(req, res)`
- Import types: `import type { Request, Response } from 'express'`
- Import database client: `import { db } from '@/db/client'`
- Import schemas: `import { users } from '@/db/schema'`
- Use `res.json()` for responses
- Access POST/PUT data via `req.body`
- Access URL parameters via `req.params`

**Testing API Endpoints:**

Sites are always available over HTTPS. Use the Preview URL from your context when testing:

```bash
curl -s ${PREVIEW_URL}/api/users
```

## Data Seeding

Use Drizzle for populating initial data or creating seed scripts.

**Critical: Always close the connection pool in seed scripts.** The database client creates a connection pool that keeps the Node.js event loop alive. Seed scripts must explicitly close the connection pool to allow the process to exit properly.

**Example Seed Script** (`src/scripts/seed.ts`):

```typescript
import { db, closeConnection } from '@/db/client';
import { users, posts } from '@/db/schema';

async function seed() {
  try {
    console.log('Seeding database...');

    // Insert sample users
    const insertedUsers = await db
      .insert(users)
      .values([
        { name: 'Alice Johnson', email: 'alice@example.com' },
        { name: 'Bob Smith', email: 'bob@example.com' },
        { name: 'Carol White', email: 'carol@example.com' },
      ])
      .returning();

    console.log(`Created ${insertedUsers.length} users`);

    // Insert sample posts
    const insertedPosts = await db
      .insert(posts)
      .values([
        {
          userId: insertedUsers[0].id,
          title: 'Getting Started with Drizzle',
          content: 'Drizzle ORM makes database operations type-safe and intuitive.',
        },
        {
          userId: insertedUsers[1].id,
          title: 'Building APIs with Express',
          content: 'Express-style handlers provide a familiar pattern for API development.',
        },
        {
          userId: insertedUsers[0].id,
          title: 'Rapid Prototyping Tips',
          content: 'Use db:push for quick iteration without managing migrations.',
        },
      ])
      .returning();

    console.log(`Created ${insertedPosts.length} posts`);
    console.log('Seeding complete');
  } catch (error) {
    console.error('Seed failed:', error);
    throw error;
  } finally {
    // Always close the connection pool to allow the process to exit
    await closeConnection();
  }
}

seed().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

Run the seed script:

```bash
pnpm tsx src/scripts/seed.ts
```

**Key points for seed scripts:**

- Import `closeConnection` from `@/db/client`
- Use try-catch-finally pattern to ensure cleanup happens
- Call `await closeConnection()` in the finally block
- The connection pool must be closed to allow Node.js to exit properly

## Schema Design Best Practices

- Use appropriate data types for each column
- Define primary keys with `serial('id').primaryKey()`
- Define foreign key relationships with `.references()`
- Add `.notNull()` for required fields
- Add `.unique()` for unique constraints
- Use `.defaultNow()` for timestamps
- Consider data normalization and performance implications
- Document table purposes and relationships in comments

## Error Handling

- Validate schema definitions before pushing to database
- Provide clear error messages for failed operations
- Verify schema push completed successfully
- Include appropriate HTTP status codes in API responses
- Handle edge cases like missing records or constraint violations
- Use try-catch blocks for database operations in API handlers

## Key Reminders

- Use Drizzle ORM for all database operations through the pre-configured client
- Schema file `src/server/db/schema.ts` is the single source of truth
- Connection file `src/server/db/client.ts` is read-only and pre-configured
- Use `pnpm run db:push` to sync schema changes directly
- Focus on schema design and data operations, not infrastructure management
- Hand back control to Development Agent after schema is ready for frontend integration
