# SSO Sign-in: Modal vs Redirect

## Single source of truth

All client-triggered sign-in flows go through `useSsoSignIn()` in
`app/src/hooks/useSsoSignIn.ts`. It is the **only** place that decides between:

- SSO Deck modal (`openSsoLogin()`), or
- Full-page redirect to `/login` (`handleSignIn()`), or
- Mock login dialog (`onShowMockLogin` callback).

Do not call `openSsoLogin()` or `handleSignIn()` directly from components.
Call `useSsoSignIn().signIn()`. If you need a non-hook caller (e.g. from a
store subscription or an effect cleanup), add a helper there that re-uses the
same logic rather than inlining a second decision point.

## Decision matrix

| Environment                             | `NODE_ENV`    | `getRootDomain()`  | Path used      |
| --------------------------------------- | ------------- | ------------------ | -------------- |
| `AUTH_TYPE=mock` (local dev)            | any           | any                | Mock dialog    |
| Local dev (`local.gasket.dev-...`)      | `development` | `dev-godaddy.com`  | SSO Deck modal |
| Production (`airo-builder.godaddy.com`) | `production`  | `godaddy.com`      | SSO Deck modal |
| Test (`airo-builder.test-godaddy.com`)  | `production`  | `test-godaddy.com` | **Redirect**   |
| Dev (`airo-builder.dev-godaddy.com`)    | `production`  | `dev-godaddy.com`  | **Redirect**   |

## Why test and dev redirect instead of embedding

Short version: Chrome's Private Network Access (PNA) checks block the SSO Deck
iframe in deployed non-prod envs.

Long version:

- SSO Deck renders `<iframe src="https://sso.<root-domain>/login?iframe=true">`.
- In prod, both `airo-builder.godaddy.com` and `sso.godaddy.com` are served
  over the public internet (Google edge, fully routable). Chrome classifies
  both as "public". A public → public subresource is unrestricted.
- In test and dev, `airo-builder.test-godaddy.com` / `airo-builder.dev-godaddy.com`
  are also served from the public edge, but `sso.test-godaddy.com` /
  `sso.dev-godaddy.com` resolve to **GoDaddy internal IPs** reachable only via
  VPN or the corporate network. Chrome classifies the SSO host as "private".
- Chrome's PNA gate blocks **public → private** subresources unless the target
  sends an `Access-Control-Allow-Private-Network: true` preflight header. The
  SSO hosts do not. The iframe fails with
  `net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`.
- Local dev is unaffected because its origin is `localhost` / `127.0.0.1`,
  classified as "local" (most trusted). Local → private is allowed.

There is no workaround in app code. Fixing this properly requires the
identity/infra teams to either (a) serve `sso.test-godaddy.com` from the same
public edge as prod, or (b) add the PNA allow header to SSO responses. Until
then, test and dev must redirect.

## Incident history

- PR #871 (Dec 2025) enabled the SSO Deck modal unconditionally for non-mock
  auth, based on an identity-team statement that a CORS issue was fixed in a
  "lower environment". That fix covered `dev-godaddy.com` CORS but did not
  cover the separate PNA issue in `test-godaddy.com`. It also did not fix
  `dev-godaddy.com` PNA.
- PR #3089 (Apr 2026) removed the env gate, assuming the modal now worked
  everywhere. Net-reverted by #3123 after E2E smoke tests failed in test env
  with the PNA error above. The env gate was restored and this document was
  added to prevent a third attempt.

If you are considering removing the env gate again: first confirm via a
request to `https://sso.test-godaddy.com/login?iframe=true` from a public
Chrome context that it returns `Access-Control-Allow-Private-Network: true`.
If it does not, do not remove the gate.

## Debugging SSO locally

A console API is available for reproducing SSO expiry and stuck-modal scenarios
without waiting for a real session to expire.

**Enable it** (one-time, persists across reloads):

```js
localStorage.setItem("__airo_debug", "1");
// then reload — you'll see a help message in the console confirming it's active
```

**API** (`window.__airo.sso`):

| Command                           | Effect                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `__airo.sso.expire()`             | Open SSO modal (level 1 — password re-entry)                                                                                       |
| `__airo.sso.expire({ level: 3 })` | Open SSO modal with `authReason: HBI` — modal renders `/hbi` (2FA); use `preflight(3)` to exercise the actual auth-check code path |
| `__airo.sso.expireIn(ms, opts?)`  | Open SSO modal after a delay                                                                                                       |
| `__airo.sso.succeed()`            | Close modal → success path (⚠ fires analytics events)                                                                             |
| `__airo.sso.dismiss()`            | Close modal → dismiss path (⚠ fires analytics events; redirects on `/create?initialPrompt=…`)                                     |
| `__airo.sso.timeout(ms)`          | Override auth preflight wait (1000–300000 ms, persists)                                                                            |
| `__airo.sso.clearTimeout()`       | Restore default preflight timeout                                                                                                  |
| `__airo.sso.token()`              | Print decoded token claims (iat, hbi, exp, per, authType) with time deltas                                                         |
| `__airo.sso.preflight(level?)`    | Run `authPreflight()` directly — tests the pending-SSO locking behaviour                                                           |
| `__airo.sso.status()`             | Print full token + modal state                                                                                                     |

**Disable**:

```js
localStorage.removeItem("__airo_debug");
```

## Related code

- `app/src/hooks/useSsoSignIn.ts` — the gate
- `app/src/hooks/useAuth.ts` — `handleSignIn()` full-page redirect
- `app/src/stores/useAuthUIStore.ts` — `openSsoLogin()` modal state
- `app/src/components/auth/SsoLogin.tsx` — SSO Deck modal renderer
- `app/src/lib/sso-debug.ts` — `window.__airo.sso` console API
- `tests/helpers/auth.ts` — E2E helper that races iframe vs redirect detection
