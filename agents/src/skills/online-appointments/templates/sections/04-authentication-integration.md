## § Authentication Integration

**Required for:** Class credits system (customers need accounts to track credits)  
**Optional for:** Fixed/variable pricing (can work anonymously)

**PREREQUISITE: Install authentication skill**

```typescript
skill({ action: 'install', skill: 'authentication' });
```

This provides:
- Better Auth setup with email/password authentication
- User tables and session management
- Auth routes at `/api/auth/*`

**You must call `requestSecrets({ ... BETTER_AUTH_SECRET ... })` after install.** The auth
skill does not provision the session secret automatically — see `agents/src/skills/authentication/skill.md`
for the exact `requestSecrets` payload (use `defaultValue: 'auto:hex64'`). Skipping this
step leaves auth misconfigured at runtime.

### 4.1 Authentication is Already Set Up

The authentication skill installs:
- Database tables (`user`, `session`, `account`, `verification` — Better Auth singular convention)
- Auth routes and middleware
- Client utilities for login/signup

The one thing you still own: requesting `BETTER_AUTH_SECRET` (and any OAuth credentials) via
`requestSecrets` immediately after install.

### 4.2 Using Authentication in Your App

The authentication skill provides ready-to-use utilities and components:

**Client authentication** — Import from `src/lib/auth-client.ts`:

```typescript
import { authClient } from '@/lib/auth-client';

// Check if logged in
const session = await authClient.getSession();

// Sign in
await authClient.signIn.email({ email, password });

// Sign out
await authClient.signOut();
```

**Protected routes** — Import middleware from `src/server/middleware/auth.ts`:

```typescript
import { requireAuth } from '../middleware/auth';

app.post('/api/appointments', requireAuth, async (req, res) => {
  const userId = req.user.id;
  // ... check credits, deduct, create booking
});
```

**Auth pages** — Already created by authentication skill:
- `/login` — Sign-in form
- `/signup` — Registration form
- Customize styling to match your site design
