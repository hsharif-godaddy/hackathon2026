## § Admin User Seed

**For class credits or admin dashboard:** Admin needs an account to test the system.

**Prerequisite:** the authentication skill must already be installed — it owns the
`user` table (singular, Better Auth convention). The database skill exports `db` from
`src/server/db/client`.

**Create: `src/server/db/seed-admin.ts`**

```typescript
import { db } from './client';
import { user } from './schema';
import { eq } from 'drizzle-orm';

const ADMIN_EMAIL = 'admin@example.com';

async function seedAdmin() {
  const existing = await db.select().from(user).where(eq(user.email, ADMIN_EMAIL));

  if (existing.length === 0) {
    await db.insert(user).values({
      id: 'admin-' + Date.now(),
      email: ADMIN_EMAIL,
      name: 'Admin User',
      // If you added a `credits` column on the user table for class-credit support,
      // initialize it here. Otherwise omit the field.
      // credits: 0,
      createdAt: new Date(),
    });
    console.log('✅ Admin user created:', ADMIN_EMAIL);
  } else {
    console.log('ℹ️  Admin user already exists');
  }
}

seedAdmin().catch(console.error);
```

**Run once:**

```bash
tsx src/server/db/seed-admin.ts
```
