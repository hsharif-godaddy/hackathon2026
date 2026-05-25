# DKIM Provisioning Flow

**Status:** Implemented in `airo-app-builder` BFF. Lives behind switchboard flag `appbuilder-dkim-onboarding`. Currently INTERNAL (GoDaddy-DNS-hosted) domains only; EXTERNAL will be implemented later.

**Last updated:** 2026-05-22.

This doc covers the **provisioning** side of the email-authentication story: what happens when a customer attaches a domain, how Vox onboards it, how DKIM CNAMEs land in DNS, and how status is reported back to the UI.

For the **signing** side (per-message JWS injection by `dev-supervisor`, relay verification, applied DKIM signature on the wire), see [`jws-email-signing.md`](./jws-email-signing.md). Both docs together describe the full email-auth lifecycle.

---

## 1. Why This Exists

DKIM is a per-domain trust signal: receivers (Gmail, Outlook, etc.) verify that a message claiming `From: noreply@acme.com` was actually sent by something authorised for `acme.com`, by checking the `DKIM-Signature` header against a public key published in DNS at `<selector>._domainkey.acme.com`.

For platform mail to arrive DKIM-signed, two things must be true:

1. **DNS records exist** for the customer's domain pointing at GoDaddy's selectors. ← This doc.
2. **The relay applies a `DKIM-Signature` at send time** using the keys behind those selectors. ← `jws-email-signing.md`.

The provisioning flow is what makes (1) true. It runs **once per (app, domain) pair** at attach time, then quiesces. Subsequent sends use the published records without further provisioning calls.

---

## 2. The Lifecycle, End to End

```
Customer attaches domain in builder UI
  │
  ▼
BFF triggers domain workflow (domain-attach jobs in mgmt-airo)
  │
  ▼
After validation (DNS pointing at platform LB, DCC ownership confirmed):
  │
  ▼
BFF calls POST /api/apps/[id]/dkim/onboard
  ├─ getSite(appId)                   ← fetch site metadata
  ├─ mgmtClient.getDomainDnsOwnership ← classify domain (DCC)
  ├─ deriveDomainOrigin(ownership)    ← INTERNAL or EXTERNAL?
  ├─ if !INTERNAL: skip + log         ← v1 doesn't support EXTERNAL
  ├─ DkimService.activate
  │    ├─ checkSwitchboardFlag('appbuilder-dkim-onboarding')
  │    ├─ if !flagOn: skip + log      ← master kill switch
  │    ├─ getNextRotationDate()       ← 6 months ± 14 days jitter
  │    └─ DkimClient.activateDkim(domain, INTERNAL, nextRotation)
  │         ├─ getDkimServiceToken()  ← mTLS cert → SSO JWT
  │         └─ POST <vox>/onboard
  │              { domain, shopperId, nextRotation, domainOrigin }
  │              ← returns { executionArn }
  │
  ▼
Vox runs its onboarding state machine:
  ├─ generates DKIM keys for the domain
  ├─ writes secureserver1/2._domainkey.<domain> CNAMEs
  │    in GoDaddy DNS for INTERNAL domains
  └─ surfaces status via mail-flow API
  │
  ▼
Builder UI polls GET /api/apps/[id]/dkim/status?domain=<d>
  └─ MailFlowClient.getDkimStatus
       └─ GET <mailflow>/domains/<d>/dkim
            ← { dkimValid: bool, dkimResult, dkimRecordDetected, ... }
  │
  ▼
Once dkimValid: true → DNS propagated → ready
  │
  ▼
[Crossover to jws-email-signing.md]
  Sends from <d> get DKIM-Signature applied by relay
  using the keys behind the published selectors
```

---

## 3. The Trigger — Auto-Onboard Hook

The DKIM provisioning is **not** automatic on every BFF action. It fires from exactly one place: the `POST /api/apps/[id]/dkim/onboard` endpoint, which is invoked by the domain-attach completion path.

```typescript
// app/src/app/api/apps/[id]/dkim/onboard/route.ts (excerpted)

export const POST = withCustomerAuth(async (request, authContext, { params }) => {
  const { id: appId } = await params;
  const { domain } = await request.json();

  // 1. Validate the site
  const site = await adapter.getSite(appId, authContext.jwt!);
  if (!site || !site.subscription_id || !site.system_id) { /* 400/404 */ }

  // 2. Classify the domain via DCC
  const mgmtClient = new AiroMgmtClient({ ... });
  const ownership = await mgmtClient.getDomainDnsOwnership(
    site.subscription_id, site.system_id, appId,
    { fqdns: domain, customerId, shopperId },
  );

  // 3. INTERNAL only in v1
  const origin = deriveDomainOrigin(ownership);
  if (origin !== DomainOrigin.INTERNAL) {
    return NextResponse.json({ result: 'skipped', reason: 'not_internal' });
  }

  // 4. Hand off to DkimService
  const service = new DkimService();
  const outcome = await service.activate({ appId, domain, shopperId, origin });
  return NextResponse.json(outcome);
}, { level: 3 });
```

The endpoint itself is idempotent — calling it again for an already-onboarded domain is safe (Vox's onboarding state machine treats it as a no-op or refresh). The BFF doesn't dedupe; it just fires the call.

### 3.1 What's NOT this endpoint's job

- **DNS validation** — handled upstream by mgmt-airo's domain-attach workflow before this hook fires.
- **DCC ownership lookup retries** — the `getDomainDnsOwnership` call is single-shot. If DCC is flaky, the operator retries the whole onboard call.
- **Polling for completion** — the response returns immediately with `{ executionArn }`. The caller (UI) polls `/api/apps/[id]/dkim/status` to track propagation.

---

## 4. DCC Ownership Classification

Before onboarding, the BFF asks DCC (Domain Control Console) whether the customer's domain is GoDaddy-managed.

### 4.1 The lookup

```typescript
const ownership = await mgmtClient.getDomainDnsOwnership(
  subscriptionId, systemId, appId,
  { fqdns: domain, customerId, shopperId },
);
// returns AiroDomainDnsOwnershipResponse
```

Response shape (`app/src/lib/mgmt-airo/types.ts:498-509`):

```typescript
interface AiroDomainDnsOwnershipResponse {
  isGdDomain: boolean;          // domain registered through GoDaddy
  isGDDomainOwner: boolean;     // current shopper owns the registration
  isGoDaddyDns: boolean;        // domain is using GoDaddy nameservers
  pendingNsPropagation: boolean;
  domainCreatedAt: string | null;
  zoneMatchedAt: string | null;
  nameserverType: string;
  nameservers: string[];
  dnsApiResponseCode: number | null;
  domainsApiResponseCode: number | null;
}
```

### 4.2 Origin derivation

```typescript
// app/src/lib/dkim/utils.ts
export function deriveDomainOrigin(ownership: AiroDomainDnsOwnershipResponse): DomainOrigin {
  return ownership.isGoDaddyDns ? DomainOrigin.INTERNAL : DomainOrigin.EXTERNAL;
}
```

**Only `isGoDaddyDns` matters for DKIM provisioning.** The other flags (`isGdDomain`, `isGDDomainOwner`) are useful for billing/ownership tracking elsewhere but don't decide whether DKIM CNAMEs can be published.

### 4.3 INTERNAL vs EXTERNAL

| Origin | What it means | DKIM auto-onboard? |
|---|---|---|
| `INTERNAL` | Domain uses GoDaddy nameservers; we can write CNAMEs into the customer's DNS zone directly | **Yes** — Vox publishes records, DKIM works without customer action |
| `EXTERNAL` | Domain is on third-party nameservers (Cloudflare, Route53, etc.); we can't write to the zone | **No (v1)** — skipped with `reason: 'unsupported_origin'`. The customer would have to publish CNAMEs manually in their DNS provider; this UX is v2 |

When EXTERNAL is later supported, the flow will return CNAME values for the customer to add manually, then poll mail-flow to detect when they've propagated.

---

## 5. The DkimService Orchestrator

`app/src/lib/dkim/dkim-service.ts` is the single entry point for activate/deactivate. It enforces the switchboard gate, derives rotation timing, calls the Vox client, ships analytics, and returns a typed outcome.

### 5.1 `activate` — what it does in order

```typescript
async activate(input: ActivateInput): Promise<DkimActivateOutcome> {
  // Gate 1: switchboard flag
  const flagOn = await checkSwitchboardFlag('appbuilder-dkim-onboarding', { headers: {} });
  if (!flagOn) {
    return { result: 'skipped', reason: 'feature_flag_off' };
  }

  // Gate 2: origin must be INTERNAL
  if (origin !== DomainOrigin.INTERNAL) {
    return { result: 'skipped', reason: 'unsupported_origin' };
  }

  // Compute next rotation timing
  const nextRotation = getNextRotationDate();

  // Call Vox
  try {
    const client = new DkimClient(shopperId);
    const { executionArn } = await client.activateDkim(domain, origin, nextRotation);
    return { result: 'accepted', executionArn };
  } catch (err) {
    return { result: 'failed', error: err.message };
  }
}
```

### 5.2 Outcomes

```typescript
type DkimActivateOutcome =
  | { result: 'accepted'; executionArn: string }                    // happy path
  | { result: 'skipped'; reason: 'feature_flag_off' | 'unsupported_origin' }
  | { result: 'failed'; error: string };                            // Vox call threw
```

The endpoint passes the outcome through verbatim to the caller. The UI / mgmt-airo workflow inspects `result` to decide what to surface — accepted means "we kicked off; poll status," skipped means "nothing to do here," failed means "retry or surface to operator."

### 5.3 Rotation timing

`getNextRotationDate()` returns a timestamp **6 months from now ± 14 days jitter**. The jitter keeps the platform from rotating every customer's keys at the same moment — Vox's downstream rotation queue stays even.

```typescript
const DKIM_ROTATION_MONTHS = 6;
export function getNextRotationDate(months = 6, jitterDays = 14): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  const jitterMs = (Math.random() * 2 - 1) * jitterDays * 24 * 60 * 60 * 1000;
  return new Date(date.getTime() + jitterMs).toISOString();
}
```

The `nextRotation` value is passed to Vox; Vox's rotation state machine drives the actual key replacement at that timestamp. The BFF doesn't poll for or trigger rotation directly.

---

## 6. The Vox Client

`app/src/lib/dkim/dkim-client.ts` wraps the Vox onboarding API. Two methods: `activateDkim` (POST /onboard) and `deactivateDkim` (POST /offboard).

### 6.1 Authentication chain

Vox uses bearer-token auth (`Authorization: sso-jwt <token>`). The BFF doesn't have an SSO token directly; it derives one from a service mTLS certificate.

```
DKIM client cert (mTLS, mounted on the BFF deploy)
           │
           ▼
POST <sso-host>/v1/secure/api/token   (with cert + key as TLS client auth)
           │
           ▼
SSO JWT (~1h validity, cached in process)
           │
           ▼
POST <vox-base>/onboard
   Authorization: sso-jwt <jwt>
   X-App-Key: airo-builder-bff
   X-XSRF-TOKEN: 1
   User-Agent: airo-builder-bff
```

The token is cached in process memory by `app/src/lib/dkim/dkim-cert-token.ts`. Cache TTL is derived from the JWT's `exp` claim minus a 60s buffer; refresh is single-flight (concurrent `getDkimServiceToken()` calls share the in-flight refresh).

Cert source priority:
1. `DKIM_CLIENT_CERT` + `DKIM_CLIENT_KEY` env vars (PEM contents inline)
2. `DKIM_CLIENT_CERT_PATH` + `DKIM_CLIENT_KEY_PATH` env vars (file paths)
3. Default fallback paths: `/workspace/app/certs/dkim-client.crt` and `/workspace/app/certs/dkim-client.key`

### 6.2 Activate request

```http
POST {VOX_DKIM_API_URL}/onboard
Authorization: sso-jwt <jwt>
Content-Type: application/json

{
  "domain": "acme.com",
  "shopperId": "8222738",
  "nextRotation": "2026-11-22T14:46:00.000Z",
  "domainOrigin": "INTERNAL"
}
```

Response (zod-validated):

```json
{ "executionArn": "arn:aws:states:us-west-2:...:execution:..." }
```

### 6.3 Deactivate request

```http
POST {VOX_DKIM_API_URL}/offboard
Authorization: sso-jwt <jwt>
Content-Type: application/json

{
  "domain": "acme.com",
  "shopperId": "8222738"
}
```

Response: same `{ executionArn }` shape.

### 6.4 Vox base URL

Default test: `https://dkim.int.dev-gdcorp.tools/v1`. Override via env var `VOX_DKIM_API_URL` (e.g. for local dev pointing at a mock or for prod's URL).

---

## 7. The Mail-Flow Status Client

`app/src/lib/dkim/mail-flow-client.ts` polls Vox's mail-flow API to learn whether DKIM/DMARC records are visible in DNS.

### 7.1 Status request

```http
GET {VOX_MAIL_FLOW_API_URL}/domains/<domain>/dkim
User-Agent: airo-builder-bff
```

Response (zod-validated):

```typescript
interface DkimStatusResponse {
  dkimValid: boolean;
  dkimResult: string;                       // human-readable status
  dkimRecordDetected?: { cnames: string[]; txts?: string[] };
  dkimRecordExpected?: { cnames: string[] };
  dmarcValid?: boolean;
  dmarcResult?: string;
  dmarcRecordDetected?: string;
  dmarcRecordExpected?: string;
}
```

### 7.2 Caching

`app/src/lib/dkim/dkim-cache.ts` wraps the client with a stale-while-revalidate cache:

| Layer | TTL |
|---|---|
| Soft TTL (return cached, revalidate in background) | 5 seconds |
| Hard miss (block until fetched) | first request |
| Max stale (drop entry if revalidate fails) | 15 minutes |

This protects the mail-flow API from being hammered when the UI polls aggressively (e.g. once per second during the post-attach "DKIM verifying..." spinner). Concurrent requests for the same domain share one in-flight fetch.

### 7.3 Mail-flow base URL

Default test: `https://dev.email-record.myprofessionalmail.com/v1`. Override via env var `VOX_MAIL_FLOW_API_URL`.

---

## 8. BFF API Surface

| Endpoint | Method | Auth | Switchboard | Purpose |
|---|---|---|---|---|
| `/api/apps/[id]/dkim/onboard` | POST | level 3 (HBI ≤ 12h) | `appbuilder-dkim-onboarding` | Trigger DKIM provisioning for a domain |
| `/api/apps/[id]/dkim/offboard` | POST | level 3 | `appbuilder-dkim-onboarding` | Tear down DKIM provisioning when domain is detached |
| `/api/apps/[id]/dkim/status` | GET | customer auth | none | Poll DKIM/DMARC validation status (cached) |

### 8.1 `POST /api/apps/[id]/dkim/onboard`

Request:

```json
{ "domain": "acme.com" }
```

Response (varies by outcome):

```json
{ "result": "accepted", "executionArn": "arn:..." }
{ "result": "skipped", "reason": "feature_flag_off" | "unsupported_origin" | "not_internal" }
{ "result": "failed", "error": "..." }
```

Note: `'not_internal'` is returned by the route itself before calling DkimService; `'unsupported_origin'` is returned by DkimService. Same root cause (EXTERNAL domain) but they emerge from different layers — the route catches it earlier so we don't waste the switchboard call.

### 8.2 `POST /api/apps/[id]/dkim/offboard`

Request:

```json
{ "domain": "acme.com" }
```

Response:

```json
{ "result": "deactivated", "executionArn": "arn:..." }
{ "result": "skipped", "reason": "feature_flag_off" }
{ "result": "failed", "error": "..." }
```

Triggered when a customer detaches a domain. The corresponding Vox call removes the DKIM key references; the CNAMEs in DNS are also cleaned up by Vox's offboarding state machine. The customer's domain is no longer authorised for platform mail signing after offboard completes.

### 8.3 `GET /api/apps/[id]/dkim/status?domain=<d>`

Response: `DkimStatusResponse` JSON (see §7.1). 503 on mail-flow API failure (transient, the cache-layer handles short-term flakiness).

The UI polls this during the post-attach "verifying DKIM" state. Recommended cadence: **1× per 2–5 seconds**, capped at 5 minutes. After that, if `dkimValid: false`, surface a "verification taking longer than expected" message — the records may have been created but DNS propagation hit a slow resolver.

---

## 9. Switchboard Flag — `appbuilder-dkim-onboarding`

### 9.1 What it gates

- Both `DkimService.activate` and `DkimService.deactivate` check this flag at the top.
- Off → no Vox calls fire. The endpoint returns `{ result: 'skipped', reason: 'feature_flag_off' }`.
- The status endpoint (`/api/apps/[id]/dkim/status`) is **NOT** flag-gated — it just polls mail-flow, which is safe regardless.

### 9.2 What it does NOT do

- Doesn't gate domain attach itself — domains can still be added/removed even with the flag off; just no DKIM calls fire.
- Doesn't tear down existing DKIM records — turning the flag off when domains are already onboarded is safe; their existing CNAMEs stay published, the relay continues applying DKIM signatures via the keys behind those records, but no new domains get onboarded.

### 9.3 Operational use

| Action | Effect |
|---|---|
| Flip ON in test env | Enables auto-onboarding for new domain attaches in test |
| Flip OFF in test env | Stops auto-onboarding; existing records keep working |
| Flip ON in production | Production rollout — every new INTERNAL domain attach fires Vox onboarding |
| Flip OFF in production | Master kill switch — instantly stops new provisioning calls if Vox is having issues |

The flag is the safest rollback knob. Flipping it off is faster and lower-blast-radius than rolling back code.

---

## 10. State Machine — From Attach to dkim=pass

This is what happens in time order, from the customer's perspective:

| t | Event | Where | What changes |
|---|---|---|---|
| 0 | Customer types `acme.com` in builder UI, clicks Attach | UI → BFF | Domain validation kicks off |
| ~5s | DNS validation (NS records pointing at platform LB) succeeds | mgmt-airo | Domain marked "verified" in builder UI |
| ~6s | DCC ownership lookup → `isGoDaddyDns: true` | BFF route | `origin = INTERNAL` |
| ~7s | `DkimService.activate(domain, INTERNAL)` | DkimService → Vox | `executionArn` returned; UI shows "DKIM verifying..." |
| ~10s | Vox state machine writes `secureserver1._domainkey.acme.com` and `secureserver2._domainkey.acme.com` CNAMEs to GoDaddy DNS | Vox internal | Records created, may not yet be visible to all resolvers |
| 30s–5min | DNS propagation across resolvers | DNS infrastructure | Records become globally visible |
| 30s+ | UI polls `/api/apps/[id]/dkim/status` every few seconds | BFF → mail-flow | `dkimValid` transitions from `false` → `true` |
| 30s–5min | Once `dkimValid: true`, builder UI shows "DKIM active" | UI | Domain ready for signed sends |
| Later | Customer's app sends mail with `from: noreply@acme.com` | dev-supervisor → Sable | JWS signing fires (see jws-email-signing.md), relay applies real DKIM signature |
| +receiver | Recipient inbox shows `dkim=pass d=acme.com` | receiver MTA | End-to-end success |

### 10.1 What "ready" means

Two checks needed for "the customer can send signed mail from this domain":

1. **DKIM provisioning complete** — `dkim/status` returns `dkimValid: true` (records published + DNS propagated). ← This doc.
2. **JWS signing active on the alloc** — `signing_enabled: true` from the debug API. ← `jws-email-signing.md`.

Both must hold. The first is per-domain; the second is per-cell. A cell with no signing keys can have many DKIM-onboarded domains, but actual sends will arrive unsigned because the relay rejects unsigned mail (or accepts and doesn't apply DKIM, depending on policy). Conversely, a cell with signing on but a domain that's not DKIM-onboarded sends successfully (the relay verifies the JWS) but with a `DKIM-Signature: d=airoapp.ai` instead of the customer's domain — the receiver sees `dkim=pass` but for the platform default, not the custom brand.

---

## 11. Rotation

### 11.1 Why rotate

DKIM keys, like any signing keys, should rotate periodically — both as a hygiene measure (limits damage from a compromise that goes unnoticed) and as DMARC hygiene (some receivers downgrade trust in long-lived selectors).

### 11.2 The rotation timing

`getNextRotationDate()` returns 6 months ± 14 days jitter. The BFF passes this value to Vox at onboard time as the `nextRotation` field. Vox's onboarding state machine schedules the rotation internally and triggers the key replacement at that timestamp.

### 11.3 What the BFF doesn't do

- The BFF does NOT call Vox at rotation time. Rotation is fully Vox-side.
- The BFF doesn't know when rotation has actually completed; it surfaces what mail-flow returns.
- There's no BFF-driven "force rotate" today. If you need to force rotation (e.g. suspected key compromise), that's a Vox-side action coordinated through the mail-flow team.

### 11.4 Operator concern: are rotations actually happening?

Mail-flow's status response includes the currently-detected DKIM record. If you re-onboard the same domain twice with different `nextRotation` values, Vox treats it as a refresh of the rotation schedule, not as "create a new selector now." Each domain has its own rotation cadence based on the `nextRotation` from its first successful onboard call.

---

## 12. Verification

### 12.1 Did onboard fire and succeed?

```bash
# In BFF logs (Katana log shipper, or local tail):
grep "dkim.activate" /var/log/airo-builder-bff.log | tail -10
```

You'll see one of:

| Log line | Meaning |
|---|---|
| `dkim.activate.start` then `dkim.activate.success` with `executionArn=...` | Vox accepted; provisioning underway |
| `dkim.activate.skipped reason=feature_flag_off` | Switchboard flag is off |
| `dkim.activate.skipped reason=external_not_supported_v1` | Domain is EXTERNAL |
| `dkim.activate.failed error=...` | Vox call threw — check error for cause (auth, network, Vox 5xx) |

### 12.2 Did the CNAMEs land?

```bash
dig +short CNAME secureserver1._domainkey.acme.com
dig +short CNAME secureserver2._domainkey.acme.com
# Expect two CNAMEs pointing at GoDaddy's DKIM key infrastructure.
# If empty → either DNS hasn't propagated (try in a minute) OR Vox didn't write
# (check BFF logs for the executionArn, then ask mail-flow team to inspect).
```

### 12.3 Does mail-flow see them as valid?

```bash
TOKEN='<sso-jwt-from-browser>'
curl -s "https://app-builder.test-godaddy.com/api/apps/<appId>/dkim/status?domain=acme.com" \
    -H "Cookie: auth_idp=$TOKEN" | jq .
# Expect: { "dkimValid": true, "dkimResult": "...", "dkimRecordDetected": { "cnames": [...] } }
```

If `dkimValid: false` but the CNAMEs are visible via `dig`, mail-flow's resolver is lagging — wait a few minutes and retry.

### 12.4 End-to-end — does a real send arrive `dkim=pass`?

This is the load-bearing check. After §12.3 returns `dkimValid: true`:

1. Trigger an email send from the customer app (or via the JWS debug API — see `jws-email-signing.md` §8).
2. Open the message at the recipient inbox.
3. "Show original" / "View source."
4. Confirm `Authentication-Results` header includes `dkim=pass header.d=acme.com`.

`dkim=pass` confirms the receiver's resolver fetched the DKIM key, the relay's signature verified, and the domain claim is trusted. **This is the only signal that proves end-to-end works** — passing every preceding check but failing this one means something subtle (key/cert mismatch, body canonicalisation drift, etc.) — see the runbook in `jws-email-signing.md` §10.5.

---

## 13. Operational Runbook

### 13.1 Onboard a domain manually (e.g. for backfill)

Used when a domain was attached before the flag flipped on, and the auto-onboard never fired:

```bash
TOKEN='<sso-jwt>'
curl -X POST "https://app-builder.test-godaddy.com/api/apps/<appId>/dkim/onboard" \
    -H 'Content-Type: application/json' \
    -H "Cookie: auth_idp=$TOKEN" \
    -d '{ "domain": "acme.com" }' | jq .
```

The endpoint is idempotent — calling it for an already-onboarded domain is a no-op refresh on Vox's side.

### 13.2 Offboard a domain

Triggered automatically by domain detach. To run manually (e.g. cleanup after a botched onboard):

```bash
curl -X POST "https://app-builder.test-godaddy.com/api/apps/<appId>/dkim/offboard" \
    -H 'Content-Type: application/json' \
    -H "Cookie: auth_idp=$TOKEN" \
    -d '{ "domain": "acme.com" }' | jq .
```

### 13.3 Check switchboard flag state

The flag `appbuilder-dkim-onboarding` is the master kill switch. Before debugging anything else, verify it's actually on for the environment in question — easy to forget after an env-specific switch.

### 13.4 Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `result: 'skipped', reason: 'feature_flag_off'` | Switchboard flag off for environment | Flip flag on in switchboard config |
| `result: 'skipped', reason: 'unsupported_origin'` (or `'not_internal'`) | Domain is EXTERNAL — third-party nameservers | Wait for v2 EXTERNAL support, or instruct customer to switch to GoDaddy DNS |
| `result: 'failed', error: 'DkimClient: POST /onboard returned 401'` | mTLS cert auth to SSO failed (cert expired, wrong path, key mismatch) | Check `DKIM_CLIENT_CERT_PATH`/`DKIM_CLIENT_KEY_PATH` on BFF deploy; verify cert is valid |
| `result: 'failed', error: 'DkimClient: POST /onboard returned 5xx'` | Vox upstream issue | Check Vox / mail-flow team's status; retry later |
| `dkim.activate.success` logged but `dkim/status` returns `dkimValid: false` indefinitely | DNS propagation slow OR Vox internal state machine stuck | Run `dig CNAME secureserver1._domainkey.<domain>` — if empty after 15min, check with mail-flow team using the `executionArn` from the success log |
| `dkim/status` returns 503 | mail-flow API transient outage | Cache layer should recover in ≤15min; retry |
| Domain detach doesn't tear down DKIM | offboard endpoint not called by domain-detach workflow | Check mgmt-airo's domain-detach jobs; manually call offboard if needed |

---

## 14. Limitations & Future Work

### 14.1 EXTERNAL domains (v1 limitation)

Today only INTERNAL (GoDaddy DNS) domains auto-onboard. EXTERNAL domains attached to apps will skip with `unsupported_origin` and customers can't send DKIM-signed mail from them via the platform.

Path forward (v2):
- BFF returns expected CNAMEs to the customer
- Customer publishes them in their own DNS provider
- BFF polls mail-flow for `dkimValid: true`; once true, treat as INTERNAL going forward

Not currently scheduled; depends on Vox supporting the "wait for customer-published records" state machine.

### 14.2 No bulk operations

Current endpoints are per-domain. If a customer has many domains, the UI calls onboard once per domain. Bulk-onboard would be a Vox-side change first, then a BFF passthrough.

### 14.3 No self-service rotation force

If a customer (or operator) wants to force rotation (e.g. compromised key), there's no BFF endpoint for it. Rotation is Vox-internal at the `nextRotation` timestamp set at onboard time. Force-rotate is a manual coordination with the mail-flow team.

### 14.4 DMARC is observed, not provisioned

The `dkim/status` response includes DMARC fields (`dmarcValid`, `dmarcRecordDetected`, etc.) but the BFF does not provision DMARC records — those are customer-managed. Mail-flow surfaces them so the UI can show a complete picture, but absence of a DMARC record does not block DKIM from working.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **DKIM** | DomainKeys Identified Mail. RFC 6376. Cryptographic message authentication using DNS-published public keys per domain. |
| **DKIM selector** | A label distinguishing one DKIM key from others on the same domain. Platform uses `secureserver1` and `secureserver2`. |
| **`secureserver1._domainkey.<d>`** | The DNS record name where the platform publishes its DKIM CNAME. The CNAME points at GoDaddy DKIM infrastructure that holds the actual key. |
| **Vox** | The DKIM provisioning service. `POST /onboard` + `POST /offboard` are the two API entry points the BFF uses. |
| **Mail-flow** | The DKIM/DMARC validation-status API. `GET /domains/<d>/dkim` returns whether records are published + valid. Polled by BFF. |
| **DCC** | Domain Control Console. Determines whether a customer's typed domain is GoDaddy-managed. Drives the INTERNAL/EXTERNAL classification. |
| **INTERNAL** | Domain uses GoDaddy nameservers. Platform can auto-publish DKIM CNAMEs. |
| **EXTERNAL** | Domain uses third-party nameservers. Customer must publish DKIM CNAMEs themselves (v2 path). |
| **`executionArn`** | AWS Step Functions execution ARN returned by Vox. The BFF doesn't introspect it but logs it for cross-referencing with mail-flow team if onboarding goes sideways. |
| **`appbuilder-dkim-onboarding`** | Switchboard flag gating the entire flow. Master kill switch. |
| **`getDkimServiceToken()`** | The mTLS-cert→SSO-JWT bridge. Caches the JWT in BFF process memory between requests. |

---

## 16. References

- **Per-repo source map**: `app/src/lib/dkim/*.ts`, `app/src/app/api/apps/[id]/dkim/{onboard,offboard,status}/route.ts`. See file paths in §3, §5, §6, §7, §8.
- **Companion doc — JWS signing**: [`jws-email-signing.md`](./jws-email-signing.md) covers the per-message side that this provisioning flow enables.
- **mgmt-airo types**: `app/src/lib/mgmt-airo/types.ts` defines the DCC ownership response.
- **switchboard client**: `app/src/lib/switchboard/server.ts`.

---

*This is the operational reference for DKIM provisioning. If something here disagrees with `app/src/lib/dkim/`, the source is truth — submit a PR fixing this doc.*
