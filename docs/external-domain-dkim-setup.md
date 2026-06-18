# External Domain DKIM Setup

This document covers how `airo-app-builder` handles DNS record display for external (non-GoDaddy-managed) domains, including the DKIM CNAME cards that are shown once the ACME/DCV challenge is provisioned.

---

## 1. Overview

When a customer attaches a domain to their Airo site, one of two paths is taken:

| Domain type | DNS managed by | Verification mechanism |
|---|---|---|
| **GoDaddy-managed** | GoDaddy (domaincontrol.com NS) | `airo-builder-www` Product DNS template applied via GoDaddy API — ownership is implicit |
| **External** | Third-party provider (Cloudflare, Route53, Namecheap, etc.) | User manually adds A, CNAME, and DCV CNAME records to their zone |

Ownership for external domains is proven via the ACME/DCV CNAME record (`_acme-challenge`). Once the DCV CNAME is provisioned by the platform (`certificateValidationCname` is set on the `AppDomain`), DKIM records are also provisioned and surfaced alongside the other DNS cards so the user can set up email signing in the same step.

---

## 2. DNS Record Cards — What Is Shown

The `DomainDNS` component renders cards for each record the user must add to their DNS zone.

### Provisioning gate

If `anycastIp` is missing, or `isDCVEnabled && !certificateValidationCname`, the component shows a provisioning spinner rather than DNS cards — the platform hasn't finished setting up the required infrastructure yet.

### Record cards (once provisioning is complete)

| Card | Condition | DNS name | Value |
|---|---|---|---|
| A record | Always | `@` or `<subdomain>` | `<anycastIp>` |
| www CNAME | Root domains only | `www` | `<fqdn>` |
| DCV CNAME | `isDCVEnabled && certificateValidationCname` | `_acme-challenge` (or `_acme-challenge.<subdomain>`) | `<certificateValidationCname>` |
| DKIM CNAMEs | `isDCVEnabled && certificateValidationCname && dkimCnames?.length` | `{selector}._domainkey.{apexDomain}` | CNAME target from mail-flow |

**DKIM records are gated on the DCV CNAME being available.** This ensures the domain connect flow is already underway (ownership is being proven via ACME) before asking the user to also add DKIM records.

---

## 3. Data Flow

```
useDomainDnsOwnership({ siteId, fqdn })
  → GET /api/sites/[id]/domain-dns-ownership?fqdns=<fqdn>
  ← { isGdDomain, isGoDaddyDns, ... }

DomainAttach / DomainAttachWidget
  treatAsExternal = !data ? isError : data.isGdDomain !== true

  // Trigger DKIM onboarding for both GoDaddy and external domains
  useDkimAutoOnboard({ domain: customerDomainForDkim, enabled: dkimUiEnabled })
  useDkimAutoOnboard({ domain: pendingDomain, enabled: dkimUiEnabled && treatAsExternal })

  // Poll for DKIM record expectations
  useDkimStatusQuery(appId, pendingDomain)
  ← { dkimRecordExpected: { cnames: string[] }, ... }

  renders:
    <DomainDNS
      domainDetails={pendingDomainDetails}
      dkimCnames={dkimStatusData?.dkimRecordExpected?.cnames}
    />

DomainDNS component
  getDnsRecords(fqdn, anycastIp, dcvCname)
  → renders DnsRecordCard for each non-null record
  → also renders DKIM CNAME cards when DCV is ready and dkimCnames provided
```

### DKIM CNAME record format

Mail-flow returns CNAME targets in the form `{selector}.dkim.{domain_escaped}.{hash}.onsecureserver.net.`. The selector is the first dot-segment (e.g. `s1`). `DomainDNS` constructs the DNS record name as `{selector}._domainkey.{apexDomain}` where `apexDomain` is the registrable domain (e.g. `example.com` for both `example.com` and `blog.example.com`).

---

## 4. DKIM Onboarding for External Domains

DKIM provisioning is triggered automatically via `useDkimAutoOnboard` and the `/api/apps/[id]/dkim/onboard` route. The client-side hook fires for all domains when the `appbuilder-dkim-onboarding` flag is on; the server enforces its own deduplication. The `DkimService` calls the Vox provisioning API for all origins (the previous `unsupported_origin` skip for external domains has been removed).

DKIM provisioning is asynchronous. `useDkimStatusQuery` polls every 30 seconds and the DKIM CNAME cards appear in `DomainDNS` once `dkimRecordExpected.cnames` is populated.

---

## 5. Files Changed in This Repo

| File | Change |
|---|---|
| `app/src/utils/domain.ts` | `getDnsRecords()` no longer accepts `verificationToken`; removed `ownershipRecord` from return type |
| `app/src/utils/domain.test.ts` | Removed `ownershipRecord` / `verificationToken` tests |
| `app/src/lib/mgmt-airo/types.ts` | Removed `verificationToken` from `AiroDomainDnsOwnershipResponse` |
| `app/src/app/.../DomainDNS.tsx` | Replaced `verificationToken`/`isVerificationTokenPending` props with `dkimCnames?`; renders DKIM CNAME cards gated on DCV |
| `app/src/app/.../DomainDNS.test.tsx` | Updated component tests: removed TXT/ownership cases, added DKIM CNAME cases |
| `app/src/app/.../DomainAttach.tsx` | Removed TXT token plumbing; added `useDkimStatusQuery` + second `useDkimAutoOnboard` for external domains |
| `app/src/app/.../DomainAttachWidget.tsx` | Same for the widget variant |
| `app/src/hooks/useDkimAutoOnboard.ts` | Removed `ownership`/`isGoDaddyDns` gate; fires for all domains |
| `app/src/hooks/__tests__/useDkimAutoOnboard.test.tsx` | Updated tests to match new hook signature |
| `app/src/lib/dkim/dkim-service.ts` | Removed `unsupported_origin` skip so Vox is called for external domains |
| `app/src/app/api/apps/[id]/dkim/onboard/route.ts` | Removed `not_internal` early-exit; origin check is advisory only |

---

## 6. Related Docs

- [`dkim-provisioning-flow.md`](./dkim-provisioning-flow.md) — DKIM CNAME provisioning flow details.
- [`jws-email-signing.md`](./jws-email-signing.md) — Per-message JWS signing applied at the relay.
