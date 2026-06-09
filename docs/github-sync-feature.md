# 🔄 GitHub Sync — Feature Documentation

> **Scope:** 64 files changed, ~4,650 lines across `app/`, `agents/`, `dev-runner/`

Push your Airo-built app code to a GitHub repository — automatically on every commit, on publish, or manually on demand.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [OAuth 2.0 Authorization Flow](#oauth-20-authorization-flow)
- [Token Lifecycle Management](#token-lifecycle-management)
- [Proactive Token Refresh](#proactive-token-refresh)
- [Feature Gating](#feature-gating)
- [Credential Storage & Isolation](#credential-storage--isolation)
- [Disconnect & Cleanup](#disconnect--cleanup)
- [Push Flow — Filtered Allowlist](#push-flow--filtered-allowlist)
- [Sync Strategy Configuration](#sync-strategy-configuration)
- [API Surface](#api-surface)
- [Data Model Changes](#data-model-changes)
- [GitHub App Permissions](#github-app-permissions)
- [Input Validation & Boundary Enforcement](#input-validation--boundary-enforcement)
- [Test Coverage](#test-coverage)
- [Local Development](#local-development)
- [Production Deployment](#production-deployment)

---

## Architecture Overview

```
┌─────────────┐       ┌──────────────────┐       ┌───────────────────────┐
│  Browser UI  │──────▶│  Next.js BFF     │──────▶│  Agents Service       │
│  (React)     │       │  (app/)          │       │  (agents/)            │
│              │       │                  │       │                       │
│  OAuth flow  │       │  Token mgmt      │       │  GitTool              │
│  Settings UI │       │  Feature gate    │       │  GitOpsService        │
│  Push/Config │       │  Proxy to agent  │       │  GitRemoteTokenMgr    │
└─────────────┘       └──────────────────┘       └───────┬───────────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  Preview         │
                                                │  Container       │
                                                │  (git push)      │
                                                └────────┬────────┘
                                                         │
                                                         ▼
                                                ┌─────────────────┐
                                                │  GitHub API      │
                                                └─────────────────┘
```

**Key design decisions:**

- The **BFF is the only component that talks to GitHub's OAuth/API** — the agents service never contacts GitHub directly for auth
- **Tokens never leave the server side** — the browser never sees a GitHub access token
- Git operations execute **inside the preview container**, not on the host
- **Token refresh is frontend-mediated** — the browser proactively checks token expiry and triggers BFF-side refresh before agent operations, avoiding reactive strategy downgrades

---

## OAuth 2.0 Authorization Flow

### 🛡️ PKCE + CSRF Protection

The implementation uses **OAuth 2.0 with Proof Key for Code Exchange (PKCE)** and a server-side CSRF nonce, matching GitHub's recommended flow for confidential web clients.

**Authorization request** (`app/src/app/api/github/auth/route.ts`):

1. Generate a cryptographic `codeVerifier` (random 64 bytes, base64url-encoded)
2. Derive `codeChallenge` = SHA-256 hash of `codeVerifier` (base64url-encoded)
3. Generate a random `nonce` (32 random bytes, hex-encoded) for CSRF protection
4. Encode `state` = base64url(`{ appId, returnTo, nonce }`)
5. Store `nonce` and `codeVerifier` in **`HttpOnly`, `SameSite=Lax`** cookies (`Secure` added in production)
6. Redirect to `https://github.com/login/oauth/authorize` with `code_challenge_method=S256`

**Callback validation** (`app/src/app/api/github/callback/route.ts`):

1. ✅ Verify `state.nonce` matches the cookie nonce → **CSRF check**
2. ✅ Verify `gh_pkce_verifier` cookie is present → **PKCE verifier**
3. Exchange `code` + `codeVerifier` for tokens via server-to-server POST
4. Store tokens via secrets API (never exposed to browser)
5. 🧹 Clear all OAuth cookies immediately after use

**Cookie configuration:**


| Attribute  | Value         | Purpose                                 |
| ---------- | ------------- | --------------------------------------- |
| `HttpOnly` | `true`        | Not accessible via JavaScript           |
| `Secure`   | `true` (prod) | HTTPS only in production                |
| `SameSite` | `Lax`         | Cross-site redirect protection          |
| `Path`     | `/api/github` | Scoped to OAuth routes only             |
| `Max-Age`  | `300` (5 min) | Auto-expire if callback never completes |


### 🔒 `returnTo` Validation

The `returnTo` parameter is validated server-side to prevent open-redirect attacks:

- Must start with `/` (relative path only)
- Rejects protocol-relative URLs (`//evil.com`)
- Parsed via `URL` constructor to verify the pathname matches the input — blocks encoded characters, backslash tricks, and host injection
- **Validated at every redirect site** — the `safeReturnTo()` helper in the callback route re-validates `returnTo` before every redirect (install branch, error branch, success branch), falling back to `/` if invalid. This ensures that even if state is tampered with, the redirect target is always safe.
- Dedicated test cases validate PKCE generation, state round-trips, cookie attributes, `validateReturnTo` open-redirect protection, and token exchange/refresh response validation

---

## Token Lifecycle Management

### Storage

Tokens are stored via the platform's existing **secrets management API** (`updateSecrets`), which provides:

- Encrypted-at-rest storage in the control plane
- Per-app, per-variant isolation (tokens go to `preview` variant only)
- Delivery to containers via `/alloc/config.json` in production

Three secrets are stored per app:


| Secret Key                | Content                  |
| ------------------------- | ------------------------ |
| `GITHUB_TOKEN`            | OAuth access token       |
| `GITHUB_REFRESH_TOKEN`    | OAuth refresh token      |
| `GITHUB_TOKEN_EXPIRES_AT` | Unix timestamp (seconds) |


### 🔄 Automatic Token Refresh

GitHub App user tokens expire (typically 8 hours). The `resolve` function in `tokens.ts` (used by every BFF route that needs a token) **transparently refreshes** expired tokens:

1. Load token data from secrets API
2. Check expiry against current time (with a **300-second buffer** via `TOKEN_REFRESH_BUFFER_SECONDS`)
3. If expired and refresh token available → exchange for new token pair via server-to-server call to GitHub
4. Persist the refreshed tokens back to secrets API via `updateSecrets` (which asynchronously updates `/alloc/config.json` in production containers)
5. Return the fresh access token

The `isExpired()` function is exported for use by BFF status endpoints, enabling the frontend to check token validity without triggering a refresh.

This means the user never needs to re-authorize unless the refresh token itself is revoked.

---

## Proactive Token Refresh

### Problem

Auto-sync operations (`on_commit`, `on_publish`) execute agent-side without BFF involvement. The agent cannot refresh GitHub tokens — it only reads them from `/alloc/config.json`. If a token expires between refreshes, the push would fail silently.

### Solution: Frontend-Mediated Proactive Refresh

Rather than reactively downgrading the sync strategy to `manual` on auth failure, the system **proactively checks and refreshes tokens before the agent needs them**.

```
┌──────────────┐    status/refresh    ┌──────────────┐    updateSecrets    ┌──────────────┐
│   Frontend   │ ──────────────────▶  │   BFF        │ ────────────────▶  │ Control Plane │
│   (browser)  │                      │   (Next.js)  │                    │ (secrets API) │
│              │  ◀── { valid }       │              │                    │               │
│  ensureFresh │  ◀── { refreshed }   │  tokens.ts   │                    │    ↓ async    │
│  Token()     │                      │  resolve()   │                    │               │
└──────────────┘                      └──────────────┘                    └───────┬───────┘
                                                                                 │
                                                                    /alloc/config.json
                                                                                 │
                                                                         ┌───────▼───────┐
                                                                         │    Agent       │
                                                                         │ clearCache()   │
                                                                         │ + retry loop   │
                                                                         │ → git push     │
                                                                         └───────────────┘
```

### Frontend Layer (`ensureFreshToken`)

A plain async function (not a hook) in `useGitHubTokenHealth.ts` that can be called from both React components and non-React contexts (WebSocket handlers, action executors):

1. **Reads sync strategy** from a module-level `strategyCache` Map — skips if `manual` or absent. The cache is populated by `cacheSyncStrategy()`, called from `useGitRemoteConfig`'s fetch function and the develop page prefetch. A module-level Map is used instead of the React Query cache because `getQueryClient()` can return a different `QueryClient` instance than the React tree uses (React 18 Strict Mode creates the initializer twice).
2. **Matches trigger to strategy** — each call site passes a `RefreshTrigger` (`'commit'` or `'publish'`). The function only proceeds when the cached strategy matches the trigger (`on_commit` ↔ `commit`, `on_publish` ↔ `publish`), preventing redundant status checks when the event doesn't apply.
3. **Calls `GET /api/apps/:id/github/token/status`** — returns `{ valid, expiresAt }`
4. If valid → done. If expired → **calls `POST /api/apps/:id/github/token/refresh`**
5. **Deduplicates concurrent calls** per `appId` via a module-level `Map<string, Promise>` — WebSocket/SSE handlers that fire-and-forget don't create duplicate network requests
6. **Swallows errors silently** — agent-side retries provide the fallback

**Cache lifecycle:** The `strategyCache` is kept in sync at every point the strategy can change:

- **Initial hydration:** The develop page prefetches `GET /api/apps/:id/git/remote/status` when `loadingPhase === 'ready'` via `prefetchGitRemoteConfig()`. The fetch function calls `cacheSyncStrategy()` on success, ensuring the strategy is available before any `validation_message` or publish event fires.
- **Configure** (`useGitHubConfigure` POST): updates cache in `onSuccess` with the new strategy.
- **Update strategy** (`useGitHubUpdateStrategy` PATCH): updates cache in `onSuccess` — switching to `manual` immediately stops status checks without a page refresh.
- **Disconnect** (`useGitHubDisconnect`): clears cache (`undefined`) in `onSuccess`.

**Trigger points:**

| Strategy     | Trigger Event              | Integration Point                               | Behavior      |
| ------------ | -------------------------- | ----------------------------------------------- | ------------- |
| `on_commit`  | Terminal `validation_message` | `ValidationMessageHandler` (WS) + `useSSEChat` (SSE) | Fire-and-forget |
| `on_publish` | Before publish API call    | `usePublishApp` (UI) + `publishAction` (agent)  | Awaited       |

### BFF Layer (Two New Endpoints)

| Method | Route                                   | Auth Level | Purpose                                              |
| ------ | --------------------------------------- | ---------- | ---------------------------------------------------- |
| GET    | `/api/apps/:id/github/token/status`     | Standard   | Load token from secrets, check expiry with 300s buffer |
| POST   | `/api/apps/:id/github/token/refresh`    | Level 3    | Refresh expired token via `tokens.resolve()` + `updateSecrets` |

Both routes are gated by `enforce()` (Switchboard) and `withCustomerAuth`. The refresh endpoint calls `tokens.resolve()`, which handles the GitHub API call and persists the new token via `updateSecrets` in a single step. `updateSecrets` asynchronously updates `/alloc/config.json` in the running container.

### Agent Layer (Cache Invalidation + Retry)

Since `updateSecrets` updates `/alloc/config.json` asynchronously, the agent implements a retry loop with exponential backoff:

1. **`GitRemoteTokenManager.isTokenExpired(appId)`** — static method that reads `GITHUB_TOKEN_EXPIRES_AT` from `getNomadAllocConfig()` (production) or local dev config, applies the 300-second buffer
2. **`clearNomadConfigCache()`** — resets the permanent memoization in `nomad-config.ts`, forcing re-read from disk
3. **`waitForFreshToken(appId)`** — called by `triggerAutoSync` before executing push:
   - If token is valid → proceeds immediately
   - If expired → enters retry loop at **0s, 5s, 15s, 30s** intervals
   - Each retry clears the config cache and re-checks expiry
   - If still expired after all retries → logs error and proceeds (push will likely fail with `AUTH_FAILED`)

**No strategy downgrade:** Auth failures are logged at `error` level but the sync strategy is **never automatically changed**. The proactive refresh mechanism handles token lifecycle; manual intervention is only needed if the refresh token itself is revoked.

---

## Feature Gating

The feature is gated at **multiple independent levels** to ensure it can be disabled at any layer:


| Layer     | Gate                                         | Type                | Fail Behavior  |
| --------- | -------------------------------------------- | ------------------- | -------------- |
| **UI**    | `appbuilder-github-sync` Switchboard flag    | Navigation + render | Hidden         |
| **BFF**   | `enforce()` on every API route               | Request rejection   | 403 response   |
| **Agent** | `requireGitRemoteSync` middleware            | Capability check    | 403 response   |
| **Agent** | `ENABLE_GIT_REMOTE_SYNC` env var (local dev) | Env-based fallback  | Route rejected |
| **Agent** | `CODE_SYNC_GIT_PUSH` capability (production) | Alloc config        | Route rejected |


Every BFF route calls `enforce(request)` as its **first action** before any processing. The gate **fails closed** — if Switchboard throws an error, the feature is treated as disabled (returns `false`).

The agent middleware checks capabilities per-route:

- `/git/push` → requires `CODE_SYNC_GIT_PUSH`
- `/git/pull` → requires `CODE_SYNC_GIT_PULL`
- `/git/remote/status`, `/git/remote/configure` → requires either

---

## Credential Storage & Isolation

### 🔒 Tokens Never Stored in Application Database

A deliberate architectural decision: **GitHub tokens are NOT stored in the agents SQLite database**. They flow through the platform's secrets infrastructure:

```
BFF (saveTokens) → Control Plane (secrets API) → /alloc/config.json → Agent reads at push time
```

The `git_remote_config` table stores **only metadata**: repo URL, branch, remote name, sync strategy, sync status. No credentials.

### 🔐 Ephemeral Credential Injection

When a push/pull operation executes, credentials are:

1. Written to `/tmp/.git-credentials` inside the container (ephemeral filesystem)
2. File permissions set to `600` (owner-only read/write)
3. Configured via `git config --local credential.helper "store --file=/tmp/.git-credentials"`
4. **Cleaned up in a `finally` block** immediately after the operation — `rm -f /tmp/.git-credentials` + `git config --local --unset credential.helper`

This ensures credentials exist in the container only for the duration of the git operation.

### Path Traversal Protection

The `readLocalDevToken` function (used in local dev) includes path-traversal protection on the `appId` parameter:

```typescript
if (/[/\\]|\.\./.test(appId)) return undefined;
```

This prevents directory-escape attacks when constructing the config file path. Dedicated test cases cover slash, backslash, and double-dot variants.

---

## Disconnect & Cleanup

When a user disconnects (`POST /api/github/disconnect`), a **three-phase cleanup** executes:

1. 🔑 **Revoke the grant on GitHub** — server-to-server `DELETE` to `/applications/{clientId}/grant` using Basic auth (client credentials). This invalidates all tokens for this user-app pair on GitHub's side.
2. 🗑️ **Delete all three secrets** from the control plane via `removeTokens`
3. 🧹 **Remove `git_remote_config` from agent database** — BFF calls `DELETE /apps/:id/git/remote/configure` on the agent, which runs `deleteByAppId` to remove all remote configurations for the app

Phases 1 and 3 are **best-effort** — failures are logged as warnings but don't block the disconnect response. The user can always revoke manually in GitHub settings.

The frontend hook (`useGitHubDisconnect`) invalidates three query caches on success — `connection`, `repos`, and `remote-config` — so the UI immediately reflects the disconnected state.

---

## Push Flow — Filtered Allowlist

### 🛡️ Allowlist-Only Push

The push does **not** do a naive `git push` of the entire working tree. Instead, it uses a **filtered allowlist approach** that ensures only user-facing source files reach the remote:

1. Clear the git index completely (`git rm -r --cached .`)
2. Stage only allowed directories: `src/`, `public/`
3. Stage only allowed config files: `package.json`, `vite.config.*`, `tsconfig.json`, etc.
4. Create a tree object from the filtered index
5. Create an orphan commit from that tree
6. Force push the orphan commit to `refs/heads/<branch>`

**What is excluded (never pushed):**

- `.env` files and any secrets
- `.airo/` infrastructure directory
- `node_modules/`
- Deploy scripts and CI configuration
- Any file not in the explicit allowlist

### Refspec Format

The push uses the fully-qualified refspec `commitHash:refs/heads/<branch>` (not shorthand `commitHash:<branch>`). This is the canonical git format that works correctly for both existing branches and empty repositories.

---

## Sync Strategy Configuration

Three strategies are available, stored in `git_remote_config.sync_strategy`:


| Strategy     | Trigger                            | Implementation                                                |
| ------------ | ---------------------------------- | ------------------------------------------------------------- |
| `on_commit`  | Every successful AI agent message  | `message-lifecycle.ts` → `triggerAutoSync('on_commit')`       |
| `on_publish` | Every publish operation            | `DefaultPublishStrategy.ts` → `triggerAutoSync('on_publish')` |
| `manual`     | User clicks "Push Now" in settings | BFF `POST /api/apps/:id/git/push`                             |


Auto-sync is **fire-and-forget**: failures are logged but never surface to the user or block the triggering operation.

### 🛡️ Auto-Sync Token Expiry Protection

GitHub App user tokens expire (~8 hours). The system uses a **proactive, multi-layer approach** to ensure tokens are fresh before push operations:

1. **Frontend proactive check** — `ensureFreshToken()` runs before the agent even attempts a push (see [Proactive Token Refresh](#proactive-token-refresh))
2. **Agent-side retry with cache invalidation** — `waitForFreshToken()` checks `GITHUB_TOKEN_EXPIRES_AT` from config, and if expired, retries with exponential backoff (0s, 5s, 15s, 30s) while clearing the memoized config cache to pick up the refreshed token from disk
3. **Structured error reporting** — if the push still fails with `AUTH_FAILED`, it is logged at `error` level but the **sync strategy is never automatically changed**

This ensures expired tokens are handled proactively rather than reactively, avoiding silent repeated failures without degrading the user's configured sync strategy.

Dedicated test cases verify the fire-and-forget behavior, strategy matching, retry loop, cache invalidation, and error resilience.

### Strategy Validation

The `sync_strategy` column has a **database-level CHECK constraint**:

```sql
CHECK(sync_strategy IN ('on_commit', 'on_publish', 'manual'))
```

The BFF and agent route handlers also validate the value server-side before any database write — triple-layer validation (BFF → agent route → DB constraint).

---

## API Surface

### BFF Routes (Next.js `app/src/app/api/`)

All routes are wrapped in `withCustomerAuth` and gated by `enforce()`.


| Method | Route                                   | Auth Level | Purpose                                              |
| ------ | --------------------------------------- | ---------- | ---------------------------------------------------- |
| GET    | `/api/github/auth`                      | Standard   | Initiate OAuth + PKCE flow                           |
| GET    | `/api/github/callback`                  | Level 3    | Handle OAuth callback + token exchange               |
| GET    | `/api/github/status`                    | Standard   | Check connection + install status                    |
| GET    | `/api/github/repos`                     | Standard   | List user's repositories                             |
| GET    | `/api/github/branches`                  | Standard   | List branches for a repository                       |
| POST   | `/api/github/disconnect`                | Level 3    | Revoke grant + delete tokens + remove agent config   |
| POST   | `/api/apps/:id/github/configure`        | Standard   | Configure remote + strategy                          |
| PATCH  | `/api/apps/:id/github/configure`        | Standard   | Update sync strategy only                            |
| GET    | `/api/apps/:id/github/token/status`     | Standard   | Check token expiry (300s buffer) without refreshing  |
| POST   | `/api/apps/:id/github/token/refresh`    | Level 3    | Refresh expired token via GitHub API + updateSecrets |
| POST   | `/api/apps/:id/git/push`                | Level 3    | Trigger manual push                                  |
| GET    | `/api/apps/:id/git/remote/status`       | Standard   | Get configured remote status                         |


> **Level 3 auth** (`withCustomerAuth(handler, { level: 3 })`) is reserved for routes that directly handle GitHub secrets: OAuth callback (token exchange), disconnect (grant revocation + secret deletion), token refresh (GitHub API call with `client_secret`), and git push (resolves token from secrets). All other routes use standard auth — they either proxy to the agent (which has its own middleware), return non-sensitive metadata, or read secrets server-side without exposing them in the response.

### Agent Routes (`agents/src/server/routes/git-remote.ts`)

All routes go through `requireGitRemoteSync` (capability gate) and `validateAppOwnership` middleware.


| Method | Route                            | Additional Middleware | Purpose                    |
| ------ | -------------------------------- | --------------------- | -------------------------- |
| POST   | `/apps/:id/git/remote/configure` | —                     | Configure or update remote |
| DELETE | `/apps/:id/git/remote/configure` | —                     | Remove remote config       |
| GET    | `/apps/:id/git/remote/status`    | —                     | Get remote config status   |
| POST   | `/apps/:id/git/push`             | `validateGitSync`     | Start async push job       |


### GitHub API Proxying

The BFF proxies GitHub API calls (`/repos`, `/user/repos`, `/user/installations`) through a dedicated `proxy()` function that:

- Forwards requests through `https://api.github.com` only
- Sets `Authorization: Bearer <token>` and `Accept: application/vnd.github+json` headers
- Returns `Cache-Control: no-store, private` on all responses — prevents caching of repository lists, branch lists, or connection status in CDNs or browser caches
- **Strips response data to only necessary fields** — no forwarding of raw GitHub payloads to the browser

### 🛡️ Resilient Error Handling

**Status route resilience:** `GET /api/github/status` wraps the entire `checkStatus` call in `try/catch`, returning a safe `{ connected: false }` response on any transient failure. The underlying `check()` function in `status.ts` guards each GitHub API proxy call (`/user`, `/user/installations`) individually — a network failure or bad response from GitHub degrades gracefully to `connected: false` or `appInstalled: false` rather than throwing an unhandled 500. Since this route is polled every 5 seconds by the frontend, it must never crash.

**Agent-down vs. no-config distinction:** The BFF routes for `GET /apps/:id/git/remote/status` and `POST /apps/:id/git/push` distinguish between:
- **Agent unreachable** (network/transport failure) → returns `502` with `{ agentError: true }` so the frontend can show "Agent unavailable" rather than misleading "no remote configured"
- **No remote configured** (agent responds but has empty config) → returns `200` with `{ remotes: [] }` or `400` with a clear "No repository URL configured" message

This prevents a configured user whose agent is temporarily down from seeing the panel revert to "select a repository."

---

## Data Model Changes

### New Column: `git_remote_config.sync_strategy`

```sql
ALTER TABLE git_remote_config
  ADD COLUMN sync_strategy TEXT NOT NULL DEFAULT 'manual'
  CHECK(sync_strategy IN ('on_commit', 'on_publish', 'manual'));
```

- Applied via `migrateGitRemoteConfigSyncStrategy()` — idempotent (catches "column already exists")
- Default: `'manual'` — existing rows are unaffected
- Backward compatible: PaaS flows that don't set `syncStrategy` get `'manual'`

### New Field: `GitToolOptions.appId`

Added optional `appId` field to `GitToolOptions` interface. When provided, this is used instead of path-based extraction (`extractAppIdFromPath`). This resolves an issue where the preview container's workspace path (`/customer-data/preview/app`) would incorrectly extract `"preview"` as the app ID, causing foreign key constraint violations.

PaaS flows that don't pass `appId` continue to use path-based extraction unchanged. Dedicated test cases verify the priority and fallback behavior.

---

## GitHub App Permissions

The GitHub App requires these minimal scopes:


| Permission   | Access       | Purpose                                      |
| ------------ | ------------ | -------------------------------------------- |
| **Contents** | Read & Write | Push code to repositories, read branch list  |
| **Metadata** | Read-only    | List repositories, check installation status |


No additional scopes (issues, pull requests, admin, etc.) are requested.

---

## Input Validation & Boundary Enforcement

### Server-Side Validation Summary


| Input               | Validation                                                  | Layer            |
| ------------------- | ----------------------------------------------------------- | ---------------- |
| `returnTo`          | Relative path only, parsed via `URL` constructor, re-validated at every redirect | BFF |
| `syncStrategy`      | Enum: `on_commit`, `on_publish`, `manual` (shared `SYNC_STRATEGIES` const) | BFF + Agent + DB |
| `appId`             | Path traversal guard: rejects `/`, `\`, `..`                | Agent            |
| `repo` query param  | Format-validated against `^[\w.-]+/[\w.-]+$` (owner/name)   | BFF              |
| `repoUrl`           | HTTPS-only, supported providers via `validateGitSync`       | Agent middleware |
| `state` parameter   | Base64url-decoded, nonce-verified against `HttpOnly` cookie | BFF              |
| OAuth `code`        | Single-use, exchanged server-side with PKCE verifier        | BFF              |
| `token` + `repoUrl` | `validateGitSync` middleware: must provide both or neither  | Agent middleware |
| Token exchange resp | `res.ok` checked, `access_token` + `expires_in` validated before cast | BFF |


### GitHub App Install Callback

The install callback branch (`setup_action=install`) is **not auth-gated** because GitHub App installations are cross-site redirects from `github.com` that may not carry session cookies. Only the state parameter is used for redirect — the `returnTo` within is validated before redirect.

---

## Test Coverage


| Area            | File                                | Key Coverage                                                                                          |
| --------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| OAuth helpers   | `oauth.test.ts`                     | PKCE generation, state round-trip, cookie attributes, `validateReturnTo`, token exchange/refresh validation |
| Token lifecycle | `tokens.test.ts`                    | Load/save/remove secrets, auto-refresh with fake timers, null sentinels, refresh failure, expiry edges |
| Feature gate    | `gate.test.ts`                      | Switchboard on/off/error, fail-closed behavior, 403 response                                          |
| Config helpers  | `config.test.ts`                    | `publicOrigin` header extraction, `callbackUrl` composition                                           |
| Token manager   | `GitRemoteTokenManager.test.ts`     | Local dev fallback, path traversal rejection, NOMAD_ALLOC_DIR skip, malformed config, `isTokenExpired` (NaN, valid, within buffer, local dev fallback) |
| Auto-sync       | `GitOpsService.test.ts`             | Strategy matching, fire-and-forget, error resilience, no-downgrade on auth failure, token retry with cache invalidation |
| Route handlers  | `git-remote.test.ts`                | Strategy-only update, invalid strategy rejection, status response                                     |
| GitTool         | `git-tool.unit.test.ts`             | `appId` option priority, path extraction fallback                                                     |
| Filtered push   | `git-tool.filtered-push.test.ts`    | Refspec `refs/heads/` format                                                                          |
| Config cache    | `nomad-config.test.ts`              | `clearNomadConfigCache` forces re-read from filesystem after cache reset                              |
| Token health    | `useGitHubTokenHealth.test.ts`      | Skip manual strategy, skip uncached strategy, skip trigger-strategy mismatch (both directions), skip valid token, trigger refresh on expired, on_publish+publish match, deduplication of concurrent calls, silent error swallowing |


---

## Local Development

### Environment Configuration


| File          | Variable                   | Purpose                                                     |
| ------------- | -------------------------- | ----------------------------------------------------------- |
| `app/.env`    | `GITHUB_APP_CLIENT_ID`     | GitHub App OAuth client ID                                  |
| `app/.env`    | `GITHUB_APP_CLIENT_SECRET` | GitHub App OAuth client secret                              |
| `app/.env`    | `GITHUB_APP_SLUG`          | GitHub App slug (for install URL)                           |
| `agents/.env` | `ENABLE_GIT_REMOTE_SYNC`   | Enables git-remote routes (local substitute for capability) |


### Preflight Check

A new **dev-runner preflight check** (`GitHubAppCheck`) warns if GitHub App credentials or the agent sync flag are missing. It's a soft warning — the feature is optional and gated behind Switchboard.

### Token Resolution in Local Dev

In local development (no Nomad alloc config), the `GitRemoteTokenManager` reads tokens and expiry from:

```
APPS_BASE_DIR/<appId>/local/preview/config.json
```

This file is written by the local control plane when `updateSecrets` is called during the OAuth flow. The same pattern is used by `stripe-mcp-client.ts`. Both `configureGitCredentials` (for `GITHUB_TOKEN`) and `isTokenExpired` (for `GITHUB_TOKEN_EXPIRES_AT`) use the shared `readLocalDevConfigValue` static helper. Access is guarded by:

- **`NOMAD_ALLOC_DIR` check** — if set (production), this fallback is skipped entirely
- **Path traversal guard** — `appId` validated against `/`, `\`, and `..`
- **Graceful failure** — missing or malformed config returns `undefined`, never throws

---

## Production Deployment

### Token Flow

```
BFF (tokens.resolve) → Control Plane (updateSecrets) → Nomad alloc → /alloc/config.json
```

The `GitRemoteTokenManager.configureGitCredentials` reads `GITHUB_TOKEN.VALUE` from the alloc config at push time — no database storage of credentials. The three-tier resolution order ensures the right token source is used per environment:

1. **Directly provided** (PaaS pattern / BFF manual push) — highest priority
2. **`/alloc/config.json`** (Nomad production) — read via `getNomadAllocConfig()`
3. **Local dev config** (only when `NOMAD_ALLOC_DIR` is unset) — lowest priority fallback

### Config Cache Lifecycle

`getNomadAllocConfig()` permanently memoizes its first successful read. When `updateSecrets` refreshes a token in the background, the on-disk `config.json` updates but the agent's in-memory cache is stale. The `clearNomadConfigCache()` function resets both the memoized config and the negative-cache timer, forcing the next read to go to disk. The agent's `waitForFreshToken` retry loop calls this before each re-check, ensuring the refreshed token is picked up within the retry window (0–30 seconds).

---

## File Index

📁 Key files changed

**OAuth & Token Management (`app/src/lib/github/`)**

- `config.ts` — GitHub App configuration, public origin resolver
- `constants.ts` — Secret key names, Switchboard flag
- `gate.ts` — Switchboard feature gate enforcement (fail-closed)
- `index.ts` — Barrel exports
- `oauth.ts` — PKCE, CSRF nonce, state encoding, token exchange, cookie helpers, `returnTo` validation
- `proxy.ts` — GitHub API proxy with field stripping
- `status.ts` — Connection & installation status checker
- `tokens.ts` — Token load/save/remove/resolve with auto-refresh

**BFF API Routes (`app/src/app/api/`)**

- `github/auth/route.ts` — OAuth initiation with PKCE + CSRF
- `github/callback/route.ts` — OAuth callback + install callback (separate auth paths)
- `github/repos/route.ts` — Repository listing proxy (field-stripped)
- `github/branches/route.ts` — Branch listing proxy (field-stripped)
- `github/status/route.ts` — Connection status
- `github/disconnect/route.ts` — Token revocation + secret deletion + agent config cleanup
- `apps/[id]/github/configure/route.ts` — Remote configuration (POST + PATCH)
- `apps/[id]/github/token/status/route.ts` — Token expiry check (proactive refresh)
- `apps/[id]/github/token/refresh/route.ts` — Token refresh via GitHub API + updateSecrets
- `apps/[id]/git/push/route.ts` — Manual push trigger
- `apps/[id]/git/remote/status/route.ts` — Remote config status

**Frontend (`app/src/app/[market]/develop/components/settings/GitHubPanel/`)**

- `index.tsx` — Panel orchestrator with config hydration
- `ConnectionStatus.tsx` — OAuth connection display with avatar fallback
- `RepoSelector.tsx` — Repository and branch selection with search
- `SyncSettings.tsx` — Strategy management, push trigger, disconnect
- `DropdownSelect.tsx` — Shared popover dropdown component

**React Hooks (`app/src/hooks/github/`)**

- `useGitHubConnection.ts` — Connection status polling
- `useGitHubRepos.ts` — Repository listing
- `useGitHubBranches.ts` — Branch listing
- `useGitHubSync.ts` — Configure, update strategy, push mutations + `cacheSyncStrategy()` on configure/update success
- `useGitHubDisconnect.ts` — Disconnect mutation with cache invalidation + `cacheSyncStrategy(appId, undefined)` on success
- `useGitRemoteConfig.ts` — Saved remote config hydration + `prefetchGitRemoteConfig()` for develop page preload + `cacheSyncStrategy()` call on fetch
- `useGitHubTokenHealth.ts` — Proactive token refresh: `ensureFreshToken(appId, trigger)` (plain async) + `cacheSyncStrategy()` (module-level Map) with trigger-to-strategy matching and deduplication guard

**Proactive Token Refresh Wiring (`app/src/hooks/`)**

- `websocket/handlers/ValidationMessageHandler.ts` — Fires `ensureFreshToken` on terminal validation events (WS transport, `on_commit`)
- `useSSEChat.ts` — Fires `ensureFreshToken` on terminal validation events (SSE transport, `on_commit`); reads `store.currentAppId` from Zustand (not closure-captured) for freshness
- `usePublishApp.ts` — Awaits `ensureFreshToken` before publish API call (UI-driven, `on_publish`)
- `websocket/actions/publishAction.ts` — Awaits `ensureFreshToken` before publish API call (agent-driven, `on_publish`)

**Agent Service (`agents/src/`)**

- `database/schema.ts` — `sync_strategy` column + migration
- `database/repositories/GitRemoteConfigRepository.ts` — `syncStrategy` CRUD
- `types/git-remote.ts` — `SyncStrategy` type + interface updates
- `server/routes/git-remote.ts` — Configure (POST/DELETE), status (GET) with strategy support
- `services/GitOpsService.ts` — `triggerAutoSync` with `waitForFreshToken` retry loop (no strategy downgrade)
- `services/GitRemoteTokenManager.ts` — Local dev token fallback, path traversal guard, static `isTokenExpired` with 300s buffer
- `tools/git-tool.ts` — `appId` option, `refs/heads/` refspec fix, structured `AUTH_FAILED` errorCode
- `utils/nomad-config.ts` — `clearNomadConfigCache()` for proactive token refresh
- `server/message-lifecycle.ts` — on_commit hook
- `server/routes/publish/strategies/DefaultPublishStrategy.ts` — on_publish hook

**Tests (`app/src/lib/github/__tests__/` + `agents/src/*/__tests__/`)**

- `oauth.test.ts` — PKCE, CSRF, cookies, returnTo validation, token exchange/refresh response validation
- `tokens.test.ts` — secret operations, auto-refresh, null sentinels, refresh failure
- `gate.test.ts` — Switchboard gate, fail-closed
- `config.test.ts` — origin/callback URL construction
- `GitRemoteTokenManager.test.ts` — local dev fallback, path traversal, `isTokenExpired` (NaN/valid/buffer/local dev)
- `GitOpsService.test.ts` — auto-sync strategy matching, no-downgrade on auth failure, token retry with cache invalidation
- `git-remote.test.ts` — strategy routes, status response
- `git-tool.unit.test.ts` — appId priority
- `git-tool.filtered-push.test.ts` — refspec format
- `nomad-config.test.ts` — `clearNomadConfigCache` re-read
- `useGitHubTokenHealth.test.ts` — dedup, skip manual, skip valid, trigger refresh, error swallowing

**Dev Runner (`dev-runner/`)**

- `internal/preflight/checks/github_app.go` — Preflight check
- `internal/tui/model.go` — Register preflight check

**Settings Integration**

- `app/src/app/[market]/develop/[id]/page.tsx` — Prefetches `prefetchGitRemoteConfig` on `loadingPhase === 'ready'` to hydrate `strategyCache`
- `app/src/app/[market]/develop/components/types.ts` — `GITHUB` enum
- `SettingsView.tsx` — Dynamic panel import
- `useSettingsNavItems.tsx` — Navigation entry
