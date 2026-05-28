---
name: authentication
description: Add BetterAuth authentication (Email/Password, OAuth, or both).
whenToUse: User wants login, signup, user accounts, authentication, or to restrict access to pages. Phrases like "add login", "user accounts", "sign up page", "authentication", "password protection", "password protect this site", "password protect a page", "require login", "restrict access", "lock down", "admin access", "members only", "private page", "secure this page".
dependencies:
  - better-auth
post-install-notes: 'Auth API route files are included in the templates — do NOT create additional route files under src/server/api/auth/. Do NOT install better-call or other better-auth sub-dependencies. The installed template files are complete — configure auth.ts and create login/signup pages only.'
intents:
  - login/signup/user accounts/members-only/restrict access/admin
---

# BetterAuth Authentication Skill

**Purpose:** Add BetterAuth authentication system with Email/Password, OAuth providers, or both.

> **Note:** This skill provides authentication setup instructions. Some skills may also provide specialized tools that are automatically loaded when you activate the skill. Tools are prefixed with the skill name (e.g., `skillname__toolname`) to prevent naming conflicts. You can unload a skill's tools with `skill({ action: 'unload', skill: 'name' })` when no longer needed.

---

## CRITICAL — Read Before Doing Anything

- **ALWAYS run `skill({ action: 'install', skill: 'authentication' })` first** — even when re-applying or changing auth. Never manually create auth files.
- **Do NOT create additional API route files** under `src/server/api/auth/`. The skill templates include dynamic route files that forward all requests to BetterAuth automatically.
- **Do NOT install `better-call` or other better-auth sub-dependencies** — they are transitive dependencies installed automatically.
- **Do NOT create custom auth context providers** — use the provided auth-client imports directly.

---

## Ask User First

> "What authentication method: Email/Password, OAuth (Google/GitHub/etc.), or both?"

If OAuth: "Which provider?"

---

## Prerequisites

**The database skill must be installed before authentication.** BetterAuth uses the database for users, sessions, and accounts. If the database skill is not installed, auth API calls will return a clear 503 error explaining what to do.

## Installation

### Step 1: Install Skill Templates (includes dependencies)

```typescript
skill({ action: 'install', skill: 'authentication' });
```

This automatically:

- Installs the `better-auth` package
- Copies all template files (auth library, dynamic route files, pages)

No manual server-side route setup is needed — all BetterAuth API routes (sign-in, sign-up, sign-out, session, CSRF, OAuth callbacks, etc.) are handled automatically by the dynamic route files under `src/server/api/auth/`.

**CRITICAL:** The skill templates include dynamic route files under `src/server/api/auth/[action]/` that handle all BetterAuth requests. Do NOT create additional API route files, catch-all routes (`[...all]`), or endpoint-specific route files (`sign-in/POST.ts`, `get-session/GET.ts`, etc.) — these will conflict with the existing dynamic routes. Do NOT install `better-call` or any other better-auth sub-dependencies manually — they are installed automatically as transitive dependencies of `better-auth`.

**Note**: If package installation fails (e.g., network issues), the skill templates are still installed. You can manually install the package with `npm install better-auth` if needed.

### Step 2: Configure Secrets

**IMPORTANT:** Always request the auth secret first, regardless of auth method chosen.

#### For Email/Password Only:

```typescript
requestSecrets({
  title: 'Authentication Secret',
  description: 'Session encryption key for secure authentication.',
  secrets: [
    {
      name: 'BETTER_AUTH_SECRET',
      description: 'Session encryption key (auto-generated)',
      required: true,
      defaultValue: 'auto:hex64',
    },
  ],
  mode: 'add',
  autoSubmit: true,
});
```

#### For OAuth (Google, GitHub, etc.):

```typescript
requestSecrets({
  title: 'Authentication Configuration',
  description:
    'Session secret + OAuth credentials.\n\nSet authorized redirect URI in Google Console to:\n{your-app-url}/api/auth/callback/google',
  secrets: [
    {
      name: 'BETTER_AUTH_SECRET',
      description: 'Session encryption key (auto-generated)',
      required: true,
      defaultValue: 'auto:hex64',
    },
    {
      name: 'GOOGLE_CLIENT_ID',
      description:
        'OAuth 2.0 Client ID (no https://; e.g. 1234567890-abcdef.apps.googleusercontent.com)',
      required: true,
    },
    {
      name: 'GOOGLE_CLIENT_SECRET',
      description: 'OAuth 2.0 Client Secret (typically starts with GOCSPX-)',
      required: true,
    },
  ],
  mode: 'add',
});
```

**OAuth Callback URL:** `{your-app-url}/api/auth/callback/{provider}`

Configure `auth.ts` based on user's choice.

**IMPORTANT:** Do NOT create custom auth context providers, auth wrappers, or auth-context.tsx files. The skill templates provide everything needed:

- `auth-client.tsx` (or `auth-core.ts` + `auth-hooks.ts`) — client-side auth functions and hooks
- `auth.ts` — server-side BetterAuth configuration
- `auth-middleware.ts` — centralized BetterAuth handler called by the dynamic route files

Use `signIn`, `signUp`, `signOut`, `useSession` directly from the auth-client imports. BetterAuth handles session context internally via cookies — no React context provider is needed.

`useSession()` returns `{ user, isAuthenticated, isPending }` — use `isAuthenticated` for conditional rendering and `user?.name` for display. Example for a header:

```typescript
const { user, isAuthenticated, isPending } = useSession();
// In JSX: isAuthenticated ? <span>{user?.name}</span> : <a href="/login">Sign In</a>
```

---

## Configure auth.ts

### Email Only

```typescript
emailAndPassword: { enabled: true },
```

### OAuth Only

```typescript
socialProviders: {
  google: {
    clientId: getSecret('GOOGLE_CLIENT_ID')!,
    clientSecret: getSecret('GOOGLE_CLIENT_SECRET')!,
  },
},
```

### Both

```typescript
emailAndPassword: { enabled: true },
socialProviders: {
  google: { clientId: getSecret('GOOGLE_CLIENT_ID')!, clientSecret: getSecret('GOOGLE_CLIENT_SECRET')! },
},
```

### Optional: Session Lifetime

BetterAuth defaults: sessions expire after **7 days**, refresh window resets after **1 day** of activity. Override if the user needs shorter/longer sessions:

```typescript
session: {
  expiresIn: 60 * 60 * 24 * 7, // 7 days
  updateAge: 60 * 60 * 24,      // extend on activity after 1 day
},
```

### Custom Domains

`auth.ts` trusts `.airoapp.ai` subdomains by default. If the user connects a custom domain, add it to `trustedOrigins`:

```typescript
if (hostname === 'their-custom-domain.com') return [origin];
```

---

## Configure Routes

**Important:** Login should be the landing page. Home and other routes should be protected.

**Unauthenticated pages (login, signup) must render independently** — never nest them inside layouts or components that depend on session state. Session data is null until loaded; any component that renders before authentication must handle that gracefully with optional chaining (`session?.user?.name`).

**Built-in redirect preservation:** `ProtectedRoute` automatically saves the page a user tried to visit and restores it after login — no extra code needed. OAuth sign-in also uses this destination as the `callbackURL`.

```typescript
// Login as default landing page (redirect unauthenticated users here)
{ path: '/login', element: <AuthPage mode="login" /> },
{ path: '/signup', element: <AuthPage mode="signup" /> },

// Home and all other routes are PROTECTED (require authentication)
{ path: '/', element: <ProtectedRoute><Home /></ProtectedRoute> },
{ path: '/dashboard', element: <ProtectedRoute><Dashboard /></ProtectedRoute> },
// ... wrap all app routes with ProtectedRoute
```

### Route Examples by Auth Type

**Email only:**

```typescript
{ path: '/login', element: <AuthPage mode="login" /> },
{ path: '/signup', element: <AuthPage mode="signup" /> },
{ path: '/', element: <ProtectedRoute><Home /></ProtectedRoute> },
```

**OAuth only:**

```typescript
{ path: '/login', element: <AuthPage providers={['google']} /> },
{ path: '/', element: <ProtectedRoute><Home /></ProtectedRoute> },
```

**Both Email + OAuth:**

```typescript
{ path: '/login', element: <AuthPage mode="login" providers={['google']} /> },
{ path: '/signup', element: <AuthPage mode="signup" providers={['google']} /> },
{ path: '/', element: <ProtectedRoute><Home /></ProtectedRoute> },
```

---

## Database Schema

Add to `src/server/db/schema.ts`:

```typescript
export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').default(false),
  image: text('image'),
  isAdmin: boolean('is_admin').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const session = mysqlTable('session', {
  id: varchar('id', { length: 36 }).primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const account = mysqlTable('account', {
  id: varchar('id', { length: 36 }).primaryKey(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(), // 'credential' for email/password, or OAuth provider name
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // OAuth tokens (only used for OAuth providers)
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  // Hashed password (only used when providerId='credential' for email/password auth)
  // BetterAuth handles hashing automatically - never store plaintext
  password: varchar('password', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});

export const verification = mysqlTable('verification', {
  id: varchar('id', { length: 36 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: varchar('value', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow(),
});
```

Run: `npm run db:generate && npm run db:migrate`

---

## Logout Button

Add a logout button to any protected page using the `LogoutButton` component:

```typescript
import { LogoutButton } from '@/lib/auth/auth-client';

// Basic usage
<LogoutButton />

// With custom styling
<LogoutButton className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">
  Sign Out
</LogoutButton>

// In a header/navbar
<header className="flex justify-between items-center p-4">
  <h1>My App</h1>
  <LogoutButton />
</header>
```

---

## After Setup: Ask User

Once authentication is configured, ask the user:

> "Authentication is set up! Which routes do you want to protect? By default, the home page (`/`) is protected. Do you want to:
>
> 1. Protect additional routes (e.g., `/dashboard`, `/settings`, `/profile`)?
> 2. Add public routes that don't require login?
> 3. Add the logout button to a specific location (header, sidebar, etc.)?"

Based on user response, wrap routes with `ProtectedRoute`:

```typescript
// Protected routes - require authentication
{ path: '/dashboard', element: <ProtectedRoute><Dashboard /></ProtectedRoute> },
{ path: '/settings', element: <ProtectedRoute><Settings /></ProtectedRoute> },
{ path: '/profile', element: <ProtectedRoute><Profile /></ProtectedRoute> },

// Public routes - accessible without login
{ path: '/about', element: <About /> },
{ path: '/pricing', element: <Pricing /> },
```

---

## Verification
```typescript
httpCheck({ url: '/api/auth/session', expectStatus: 200 })
```

A 200 confirms the session route is registered. If it fails, the response body contains a diagnostic message — follow its instructions to resolve.

---

## Known Behaviors & Edge Cases

| Situation                                | What to do                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth works in preview but 500 in publish | `getAuth()` defers `betterAuth()` construction to the first request so secrets are available — verify `BETTER_AUTH_SECRET` is set and the publish build completed successfully |
| `BETTER_AUTH_SECRET` not set             | Failure happens on the first auth request, and the middleware returns a 503 diagnostic — always run `requestSecrets` before starting                                           |
| OAuth redirect goes to wrong page        | `callbackURL` is set automatically by the template from the user's intended destination                                                                                        |
| Session check times out (30s)            | User sees a retry button — check network and that `src/server/api/auth/` route files exist                                                                                     |
| User connects a custom domain            | Add hostname to `trustedOrigins` in `auth.ts` — BetterAuth blocks cross-origin requests by default                                                                             |
| Want shorter sessions (e.g. banking)     | Add `session.expiresIn` + `session.updateAge` to `auth.ts` (see Configure auth.ts above)                                                                                       |
| OAuth token access after login           | Use `authClient.getAccessToken({ providerId: 'google' })` — handles refresh automatically                                                                                      |

---
