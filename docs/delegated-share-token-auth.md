# Delegated Share-Token Auth (cert2s)

How a non-user service caller — specifically mhp-core hosting — can obtain a share token bound to an app it does not own a session for, and use that token to render the preview via the existing `?airoShareToken=…` rail.

This is a delegation path: hosting holds a GoDaddy SSO `cert2s` JWT minted on behalf of the app's *owning shopper*, and exchanges that for a normal airo-app share token. The preview / dev-supervisor side does not change — it still sees a share token in the URL and validates it the way it always has.

The user-driven share flow is unaffected; that flow is still documented in [preview-app-authentication.md](./preview-app-authentication.md).

## Why this exists

The pre-archive screenshot-capture flow needs to render a preview URL after the archive job has started. The state machine has no user JWT to forward, and dev-supervisor's preview-domain validators do not accept arbitrary GoDaddy SSO tokens — only:

- the airo-app-issued JWT (`iss=airo-app, aud=agents-service`, RS256), or
- a share token via `?airoShareToken=…`.

We did not want to add a third auth path on the preview side. Instead, hosting walks the existing user-share-token path on behalf of the owner, gated so the privilege only unlocks for a specific delegation form.

## The two changes

### 1. `/api/auth/token` accepts `Authorization: sso-jwt <cert2s>`

`app/src/app/api/auth/token/route.ts` already minted an airo-app JWT for cookie-authenticated users. It now also accepts the sso-jwt header form, with one extra branch:

- A caller presenting an `sso-jwt` token whose `authType === 'cert2s'` is treated as a hosting delegation.
- The cert2s `shopperId` claim is run through the same control-plane ownership check the cookie path uses (`getControlPlaneAdapter().getSite(siteId, jwt, …)`) — no bypass.
- The minted airo-app JWT is capped at **15 minutes** (vs. 12h for normal users) and carries `authType: 'cert2s'` forward.
- Any other sso-jwt authType (basic, e2s, s2s, …) on this endpoint is **rejected with 403**. The header form and the cert2s authType must both be present, or both absent — half-matches log `auth.token.cert2s.gateMismatch` (security tag) and 403. This makes the cert2s privilege un-spoofable by ordinary user callers who happen to send a header.

The cookie path is unchanged.

```
Hosting cert (mTLS)
  ↓ GoDaddy SSO secondary-token request (cert + owner shopperId)
cert2s SSO JWT  (authType=cert2s, shopperId=<owner>)
  ↓ GET /api/auth/token?siteId=<appId>   Authorization: sso-jwt <cert2s>
airo-app JWT    (authType=cert2s, siteId=<appId>, ttl=15m)
```

### 2. `POST /apps/:id/share` accepts `purpose`

`agents/src/server/routes/share.ts` adds an optional `purpose` field on the create-share-token body. Two values:

| purpose            | TTL bounds        | Default | Caller authType    | One-active scope                  |
| ------------------ | ----------------- | ------- | ------------------ | --------------------------------- |
| `user` (default)   | 1h – 7d           | 7d      | any owner          | `(appId, purpose='user')`         |
| `archive_snapshot` | 60s – 15min       | 15min   | **`cert2s` only**  | bypassed (always re-mintable)     |

`archive_snapshot` returns 403 unless `agentContext.authType === 'cert2s'`. The 15-min ceiling matches the airo-app JWT cap above, so the total credential lifetime from cert2s mint to share-token expiry is bounded at 15 minutes regardless of which step a leak happens at.

The one-active-token-per-app guard is now scoped per `(appId, purpose)`. A user-issued share link and an archive-snapshot token can coexist for the same app. `archive_snapshot` bypasses the guard entirely so the archive state machine can re-mint freely on retry; the previous token simply expires on its TTL.

Schema: `share_tokens.purpose TEXT NOT NULL DEFAULT 'user'`. The migration backfills existing rows via the column DEFAULT. Dev-supervisor's `/api/share/validate/:token` is unchanged — it returns `{valid, appId, expiresAt}` and is purpose-agnostic.

## Full delegation chain

```
cert2s SSO JWT
  ↓ POST /api/auth/token?siteId=X
  ↓   Authorization: sso-jwt <cert2s>
airo-app JWT  (authType=cert2s, ttl=15m)
  ↓ POST /apps/X/share
  ↓   Authorization: Bearer <airo-app-jwt>
  ↓   { expiresIn: 900, purpose: 'archive_snapshot' }
share token  (purpose=archive_snapshot, ttl=15m)
  ↓ <previewUrl>?airoShareToken=<token>
dev-supervisor share validator → preview renders
```

## Security model

The privilege chain has three independent gates. Compromising one does not unlock the next:

1. **cert2s minting** is gated by GoDaddy SSO. Hosting must hold a valid mTLS client cert and request a secondary token bound to the owner's shopperId. No airo-app code is involved.
2. **`/api/auth/token` cert2s branch** requires `Authorization: sso-jwt` AND `authType=cert2s` together. A leaked basic/e2s/s2s sso-jwt cannot reach this branch. The site-ownership re-check still runs against the control plane.
3. **`POST /apps/:id/share` purpose gate** requires the airo-app JWT's `authType` claim to be `cert2s` for any non-default purpose. A normal user's airo-app JWT cannot mint `archive_snapshot` tokens.

Both TTL caps stack: a leaked cert2s token, a leaked airo-app cert2s JWT, and a leaked archive-snapshot share token are all individually bounded at 15 minutes. There is no path that produces a long-lived owner-scoped credential through this delegation.

## Logging

| Event                           | When                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `auth.token.cert2s.minted`      | airo-app JWT issued for a cert2s caller (security tag)     |
| `auth.token.cert2s.gateMismatch`| sso-jwt header / authType half-match — 403 (security tag)  |
| `share.create.purposeNotAllowed`| non-cert2s caller requested `archive_snapshot` — 403       |
| `share.create.invalidPurpose`   | unknown purpose value — 400                                |
| `share.create.success`          | includes `purpose` field for filtering                     |

## Code map

| Concern                              | File                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| cert2s branch + 15m cap              | `app/src/app/api/auth/token/route.ts`                                             |
| cert2s `cid` fallback to `shopperId` | `app/src/lib/customer-auth.ts`                                                    |
| `purpose` validation + cert2s gate   | `agents/src/server/routes/share.ts`                                               |
| `share_tokens.purpose` column        | `agents/src/database/schema.ts` (`migrateShareTokensPurpose`)                     |
| `purpose` threading                  | `agents/src/database/repositories/ShareTokenRepository.ts`                        |
| `cert2s` in the AuthType union       | `packages/shared/src/auth/types.ts`                                               |

## Manual smoke (cookie-substitute for cert2s)

The post-`/api/auth/token` portion can be exercised today with a real browser cookie — useful for validating the share-mint and dev-supervisor sides without a cert2s issuer:

```bash
# 1. log into the builder, copy SSO cookies (auth_idp, cust_idp, info_idp, info_cust_idp)
# 2. exchange for an airo-app JWT
curl -s -H "Cookie: …" \
  "https://airo-builder.test-godaddy.com/api/auth/token?siteId=<appId>"

# 3. mint a share token (purpose='user' — cert2s gate blocks archive_snapshot from a cookie caller).
#    expiresIn is omitted so the default 7d TTL rides; purpose='user' enforces minSec=3600,
#    so any explicit expiresIn must be >= 3600.
curl -s -X POST \
  -H "Authorization: Bearer <airo-app-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"purpose":"user"}' \
  "<agents-url>/apps/<appId>/share"

# 4. confirm preview renders with the token
curl -I "<previewUrl>?airoShareToken=<token>"
```

To exercise the cert2s branch end-to-end you need a real cert2s SSO JWT for the owning shopper; that lives outside this repo.
