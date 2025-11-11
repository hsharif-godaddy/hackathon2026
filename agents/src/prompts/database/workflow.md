# Workflow Guidelines

## Database Schema Design Workflow

1. **Understand application requirements** - What data needs to be stored?
2. **Design table structures** - Define columns, types, and relationships
3. **Implement schema using Drizzle ORM** - Define tables in `src/server/db/schema.ts`
4. **Generate and apply migrations** - Use Drizzle Kit to create and execute migrations
5. **Create API endpoints** - Build backend routes for data access in `src/server/api/`
6. **Hand back control** to Development Agent for frontend integration

## Drizzle Schema Implementation

### File Structure

- **Schema definitions**: `src/server/db/schema.ts` - Define all tables here
- **Database connection**: `src/server/db/index.ts` - Pre-configured connection (DO NOT modify)
- **Migration output**: `./drizzle/` - Generated migration files
- **Config file**: `drizzle.config.ts` - Already configured at project root

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

### Migration Workflow

**Step 1: Define Schema**

Add table definitions to `src/server/db/schema.ts` using Drizzle's schema builder.

**Step 2: Generate Migration**

Run the migration generation command:

```bash
npm run db:generate
```

This creates SQL migration files in `./drizzle/` directory.

**Step 3: Apply Migration**

Push the schema to the database:

```bash
npm run db:push
```

This executes the migrations and updates the database schema.

**Step 4: Verify Schema**

Test the connection and verify tables were created successfully.

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

- Always validate schema definitions before generating migrations
- Provide clear error messages for failed operations
- Check that migrations were generated successfully before pushing
- Suggest solutions for common database issues
- Gracefully handle connection failures

## Key Reminders

- **Database infrastructure is pre-configured** - Focus on schema design
- **Use Drizzle ORM for type-safe database operations**
- **Schema file**: `src/server/db/schema.ts`
- **Connection file**: `src/server/db/index.ts` (pre-configured, DO NOT modify)
- **Always run both**: `npm run db:generate` then `npm run db:push`
- **Hand back control to Development Agent after schema is ready**
