# Workflow Guidelines

## API Generation Steps

1. **Read Schema** - Import from `src/server/db/schema.ts` to understand tables, columns, types, and relationships
2. **Design Endpoints** - Plan RESTful routes: GET (list/single), POST (create), PUT (update), DELETE (remove)
3. **Implement Routes** - Create Express handlers in `src/server/api/` organized by HTTP method

## File Structure

```
src/server/api/
├── users/
│   ├── GET.ts                → GET /api/users
│   ├── POST.ts               → POST /api/users
│   └── [userId]/
│       ├── GET.ts            → GET /api/users/:userId
│       ├── PUT.ts            → PUT /api/users/:userId
│       └── DELETE.ts         → DELETE /api/users/:userId
```

## Handler Pattern

```typescript
import type { Request, Response } from 'express';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  try {
    // Implementation with validation and error handling
  } catch (error) {
    res.status(500).json({
      error: 'Operation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
```

## Examples

### List All Resources

```typescript
import type { Request, Response } from 'express';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';

export default async function handler(_req: Request, res: Response) {
  try {
    const items = await db.select().from(users);
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch', message: String(error) });
  }
}
```

### Create Resource

```typescript
import type { Request, Response } from 'express';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  try {
    const { name, email } = req.body;
    if (!name || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    // MySQL does not support .returning() - use insertId instead
    const result = await db.insert(users).values({ name, email });
    const insertedId = result.insertId;
    const newItem = await db.select().from(users).where(eq(users.id, insertedId)).limit(1);
    res.status(201).json(newItem[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create', message: String(error) });
  }
}
```

### Get By ID

```typescript
import type { Request, Response } from 'express';
import { db } from '../../../db/client.js';
import { users } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';

export default async function handler(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.userId);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const item = await db.select().from(users).where(eq(users.id, id));
    if (item.length === 0) return res.status(404).json({ error: 'Not found' });

    res.json(item[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch', message: String(error) });
  }
}
```

### Update/Delete

Follow the same pattern: validate ID, perform operation with Drizzle ORM, return 404 if not found, handle errors with try-catch.

## HTTP Status Codes

- 200: Success
- 201: Created
- 400: Bad Request (validation)
- 404: Not Found
- 500: Server Error

## Testing

Use Preview URL from context:

```bash
curl ${PREVIEW_URL}/api/users                                    # GET list
curl -X POST ${PREVIEW_URL}/api/users -H "Content-Type: application/json" -d '{"name":"John","email":"john@example.com"}'
curl ${PREVIEW_URL}/api/users/1                                  # GET single
curl -X PUT ${PREVIEW_URL}/api/users/1 -d '{"name":"Jane"}'     # UPDATE
curl -X DELETE ${PREVIEW_URL}/api/users/1                        # DELETE
```

## Key Rules

- Read schema from `src/server/db/schema.ts` first (read-only)
- Use relative imports with `.js` extensions for backend files (Node.js requirement)
- Wrap all operations in try-catch
- Validate inputs before database operations
- Return appropriate HTTP status codes
- Hand back to calling agent after completion
- Never modify database schemas
- **MySQL does not support `.returning()`** - Use `insertId` pattern for INSERT operations (see examples above)
