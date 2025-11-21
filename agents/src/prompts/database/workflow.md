# Workflow Guidelines

## Schema Design Workflow

1. **Understand requirements** - Identify data to store
2. **Design tables** - Define columns, types, relationships
3. **Implement schema** - Add to `src/server/db/schema.ts` using Drizzle ORM
4. **Generate migrations** - Run `npm run db:generate` to create migration files
5. **Apply migrations** - Run `npm run db:migrate` to update the database
6. **Verify deployment** - Confirm tables created successfully
7. **Return control** - Hand back to calling agent immediately

**IMPORTANT:** After deployment, return control. Do not create API routes - that's the API Agent's role.

## Database Access

Use pre-configured Drizzle client for all operations:

```typescript
import { db } from './server/db/client';
import { users, posts } from './server/db/schema';

// For standalone scripts that need to exit:
import { db, closeConnection } from './server/db/client';

// ... perform database operations ...

await closeConnection(); // Critical: allows Node.js to exit
```

API route handlers do not need to close connections - the connection pool is shared and managed by the application server.

## Key Focus

After schema design is complete, immediately hand back control to the calling agent. The Database Agent does not create API endpoints - that responsibility belongs to the API Agent.

## Drizzle Schema Implementation

### File Structure

- **Schema definitions**: `src/server/db/schema.ts` - Single source of truth for all table definitions
- **Database connection**: `src/server/db/client.ts` - Pre-configured `db` instance (read-only, do not modify)
  - Import with: `import { db } from './server/db/client'`
  - Connection details automatically loaded from environment
  - Credentials and configuration managed by platform

### Defining Tables in Drizzle

Add table definitions to `src/server/db/schema.ts` using Drizzle's MySQL schema builder:

```typescript
import { mysqlTable, int, varchar, text, timestamp } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const posts = mysqlTable('posts', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id')
    .notNull()
    .references(() => users.id),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

## Column Types

- `int().primaryKey().autoincrement()` - Auto-increment primary key
- `int()` - Integer
- `varchar({ length: 255 })` - Variable string
- `text()` - Long text
- `timestamp()` - Timestamp
- `boolean()` - Boolean
- `json()` - JSON

## Foreign Keys

```typescript
userId: int('user_id')
  .notNull()
  .references(() => users.id);
```

### Migration-Based Workflow

This project uses a migration-based approach where database changes are tracked through migration files.

**Step 1: Define Schema**

Add table definitions to `src/server/db/schema.ts` using Drizzle's schema builder.

**Step 2: Generate Migration Files**

Generate SQL migration files based on schema changes:

```bash
npm run db:generate
```

This command analyzes your schema changes and creates timestamped migration files in the `drizzle/` directory. These files contain the SQL statements needed to update the database structure.

**Step 3: Apply Migrations**

Apply the generated migrations to the database:

```bash
npm run db:migrate
```

This command executes all pending migration files against the database, bringing the database structure in sync with your schema.

**Step 4: Verify Schema**

Test the connection and verify tables were created successfully.

**Important:** Migration files will be automatically committed to Git by the conversation flow. This ensures database changes are tracked in version control and available for the publish/deployment process.

## Data Seeding

```typescript
import { db, closeConnection } from './client';
import { users } from './schema';

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
          content: 'Use migrations to track database changes in version control.',
        },
      ])
      .returning();

    console.log(`Created ${insertedPosts.length} posts`);
    console.log('Seeding complete');
  } catch (error) {
    console.error('Seed failed:', error);
    throw error;
  } finally {
    await closeConnection(); // Must close for script exit
  }
}
```

Run: `npm tsx src/scripts/seed.ts`

## Best Practices

- Use appropriate data types
- Define primary keys with `int().primaryKey().autoincrement()`
- Use `.notNull()` for required fields
- Use `.unique()` for unique constraints
- Use `.references()` for foreign keys with matching `int` type
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
- Use `npm run db:generate` to create migrations and `npm run db:migrate` to apply them
- Migration files are automatically committed to Git by the conversation flow
- Focus on schema design and data operations, not infrastructure management
- Hand back control to Development Agent after schema is deployed
