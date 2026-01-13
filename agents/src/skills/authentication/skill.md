---
name: authentication
description: Add BetterAuth authentication (Email/Password, OAuth, or both).
---

# BetterAuth Authentication Skill

## Ask User First

> "What authentication method: Email/Password, OAuth (Google/GitHub/etc.), or both?"

If OAuth: "Which provider?"

---

## Installation

### Step 1: Install Package

```typescript
terminalCommand({ command: 'npm install better-auth' });
```

### Step 2: Install Skill Templates

```typescript
skill({ action: 'install', skill: 'authentication' });
```

### Step 3: Configure Secrets

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
    { name: 'GOOGLE_CLIENT_ID', description: 'OAuth 2.0 Client ID', required: true },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'OAuth 2.0 Client Secret', required: true },
  ],
  mode: 'add',
});
```

**OAuth Callback URL:** `{your-app-url}/api/auth/callback/{provider}`

Configure `auth.ts` based on user's choice.

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

---

## Configure Routes

**Important:** Login should be the landing page. Home and other routes should be protected.

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
