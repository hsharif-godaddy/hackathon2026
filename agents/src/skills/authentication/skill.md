---
name: authentication
description: Add BetterAuth authentication (Email/Password, OAuth, or both).
whenToUse: User wants login, signup, user accounts, authentication, or to restrict access to pages. Phrases like "add login", "user accounts", "sign up page", "authentication", "password protection", "password protect this site", "password protect a page", "require login", "restrict access", "lock down", "admin access", "members only", "private page", "secure this page", "OAuth", "Google login", "GitHub login", "social login", "SSO", "session management".
skill-deps:
  database:
    templates: true
    instructions: false
dependencies:
  # MAINTAINER: when bumping this pin, also update the fallback
  # `npm install` command in § Installation Flow → Step 1.
  # Pinned. Newer 1.6.12+ ships the kysely 0.29 upgrade which raises
  # Node floor to 22 and breaks Turbopack/strict-ESM builds. Hold until
  # better-auth/better-auth#9811 lands in a published release.
  - better-auth@1.6.15
  # Required peer of @better-auth/core (@opentelemetry/api ^1.9.0).
  # Without it, auth requests crash with `getTracer is not a function`.
  - '@opentelemetry/api@1.9.1'

post-install-notes: 'Auth API route files are included in the templates — do NOT create additional route files under src/server/api/auth/. Do NOT install better-call or other better-auth sub-dependencies. The installed template files are complete — configure auth.ts and create login/signup pages only.'
intents:
  - login/signup/user accounts/members-only/restrict access/admin
  - OAuth/Google login/social auth/password protect
---

# BetterAuth Authentication

Add authentication with Email/Password, OAuth providers (Google, GitHub, etc.), or both.

## Guardrails

These are the high-failure-rate mistakes for this skill. Each exists because the templates are designed as a complete, self-contained auth system:

- **Always install via `skill({ action: 'install' })` first** — the templates provide all route files, middleware, and client code. Manually creating auth files leads to duplicates and routing conflicts.
- **Call `requestSecrets` once, then move on** — secrets persist automatically. Re-requesting or verifying via terminal commands causes duplicate entries or blocks the flow.
- **No extra route files under `src/server/api/auth/`** — the dynamic `[action]` route files already forward every BetterAuth endpoint. Additional files shadow them.
- **No `better-call` or other BetterAuth sub-deps** — they're transitive. Explicit installs cause version conflicts with the pinned `better-auth@1.6.15`.
- **No custom auth context providers** — `useSession` and cookie-based sessions handle state internally. Adding a provider layer causes stale-state bugs.

## Prerequisite

The database skill must be installed first — BetterAuth stores users, sessions, and accounts there. If missing, auth API calls return a 503 with guidance.

## Discovery

Ask the user before proceeding:

> "What authentication method would you like: Email/Password, OAuth (Google/GitHub/etc.), or both?"

If OAuth: ask which provider(s).

---

## Installation Flow

### 1. Install Skill Templates

```typescript
skill({ action: 'install', skill: 'authentication' });
```

This copies all template files and installs dependencies:
- `auth.ts` — server-side BetterAuth configuration (lazy-initialized singleton)
- `auth-client.tsx` — client hooks and components (`useSession`, `ProtectedRoute`, `LogoutButton`)
- `auth-middleware.ts` — centralized handler called by the dynamic route files
- Dynamic route files under `src/server/api/auth/` — already complete, forward all requests to BetterAuth

The template route files handle all BetterAuth endpoints dynamically. Creating additional route files under that path would cause routing conflicts.

If package installation fails, fall back to: `npm install better-auth@1.6.15 @opentelemetry/api@1.9.1`. Do not install `better-call` or other BetterAuth sub-dependencies — they are transitive and adding them causes version conflicts.

### 2. Request Secrets

Call `requestSecrets` once. After it returns, secrets are persisted and available at runtime via `getSecret()` — no further verification or re-request is needed.

**Email/Password only:**

```typescript
requestSecrets({
  title: 'Authentication Secret',
  description: 'Session encryption key for secure authentication.',
  secrets: [
    { name: 'BETTER_AUTH_SECRET', description: 'Session encryption key (auto-generated)', required: true, defaultValue: 'auto:hex64' },
  ],
  mode: 'add',
  autoSubmit: true,
});
```

**OAuth (example: Google):**

```typescript
requestSecrets({
  title: 'Authentication Configuration',
  description: 'Session secret + OAuth credentials.\n\nSet authorized redirect URI in Google Console to:\n{your-app-url}/api/auth/callback/google',
  secrets: [
    { name: 'BETTER_AUTH_SECRET', description: 'Session encryption key (auto-generated)', required: true, defaultValue: 'auto:hex64' },
    { name: 'GOOGLE_CLIENT_ID', description: 'OAuth 2.0 Client ID (e.g. 1234567890-abcdef.apps.googleusercontent.com)', required: true },
    { name: 'GOOGLE_CLIENT_SECRET', description: 'OAuth 2.0 Client Secret (typically starts with GOCSPX-)', required: true },
  ],
  mode: 'add',
});
```

OAuth callback URL pattern: `{your-app-url}/api/auth/callback/{provider}`

### 3. Configure auth.ts

Uncomment and configure the relevant section in `src/lib/auth/auth.ts`:

```typescript
// Email/Password
emailAndPassword: { enabled: true },

// OAuth
socialProviders: {
  google: {
    clientId: getSecret('GOOGLE_CLIENT_ID')!,
    clientSecret: getSecret('GOOGLE_CLIENT_SECRET')!,
  },
},

// Both — combine the sections above
```

### 4. Set Up Routes

**If user wants to protect specific pages** (e.g., "password protect the admin dashboard"), protect only those — keep `/` and other pages public. Login is a standalone route, not the landing page.

**If user wants full site authentication** (login required everywhere), make login the landing page and protect all other routes.

Unauthenticated pages (login, signup) must render independently — they cannot be nested inside layouts that depend on session state. Components that render before authentication resolves should use optional chaining (`session?.user?.name`).

**Email-only (most common):**

```typescript
// Public auth pages
{ path: '/login', element: <AuthPage mode="login" /> },
{ path: '/signup', element: <AuthPage mode="signup" /> },

// Protected routes — ProtectedRoute auto-saves intended destination and restores it after login
{ path: '/dashboard', element: <ProtectedRoute><Dashboard /></ProtectedRoute> },
```

**OAuth:**

```typescript
{ path: '/login', element: <AuthPage mode="login" providers={['google']} /> },
{ path: '/signup', element: <AuthPage mode="signup" providers={['google']} /> },
```

Omit signup route for OAuth-only.

---

## Using the Auth Client

Import `signIn`, `signUp`, `signOut`, `useSession` from the auth-client. BetterAuth manages session state via cookies — no React context provider is needed.

```typescript
const { user, isAuthenticated, isPending } = useSession();
```

Logout:
```typescript
import { LogoutButton } from '@/lib/auth/auth-client';
<LogoutButton className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700">Sign Out</LogoutButton>
```

Do not create custom auth context providers — the provided `useSession` hook and cookie-based session management handle all state internally.

---

## Database Schema

Load the schema reference for the full Drizzle table definitions and migration command:

```typescript
skill({ action: 'loadReference', path: 'authentication/references/database-schema' })
```

---

## After Setup

Ask the user:

> "Authentication is set up! Which routes do you want to protect? By default, `/` is protected. Would you like to:
> 1. Protect additional routes (e.g., `/dashboard`, `/settings`)?
> 2. Add public routes that don't require login?
> 3. Place the logout button somewhere specific (header, sidebar)?"

---

## Verification

```typescript
httpCheck({ url: '/api/auth/session', expectStatus: 200 })
```

A 200 confirms the session route is live. If it fails, the response body contains a diagnostic.

---

## Custom Domains & Sessions

`auth.ts` trusts `.airoapp.ai` subdomains by default. For custom domains, add to the `trustedOrigins` function:

```typescript
if (hostname === 'their-custom-domain.com') return [origin];
```

Session defaults: 7-day expiration, refresh after 1 day of activity. Override with:

```typescript
session: {
  expiresIn: 60 * 60 * 24 * 7,
  updateAge: 60 * 60 * 24,
},
```

---

## Troubleshooting

| Symptom | Cause & Fix |
| --- | --- |
| 500 in publish but works in preview | Most common: `BETTER_AUTH_SECRET` not set in publish env. Also possible: `getAuth()` defers initialization — check publish build logs for init errors even if secret exists |
| 503 from auth endpoints | Secret missing — run `requestSecrets` during setup (once only) |
| OAuth redirect goes to wrong page | `callbackURL` is set automatically from intended destination — check route config |
| Session check times out (30s) | User sees retry button — verify route files exist and network is accessible |
| Custom domain auth fails | Add hostname to `trustedOrigins` in `auth.ts` |
| Need shorter sessions (e.g., banking) | Add `session.expiresIn` + `session.updateAge` to auth config |
| Access OAuth token post-login | `authClient.getAccessToken({ providerId: 'google' })` |
