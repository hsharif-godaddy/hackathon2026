# App Transfer (Token-Based) — Security Document

## Overview

The App Transfer feature allows WDD designers (initiators) to hand off app ownership to clients (recipients) via a short-lived token. The initiator enters the client's email address and receives a 6-character alphanumeric token; the client accepts by entering that token after signing in.

All transfer state lives in mgmt-airo. No system-sent email is involved — the token is shared out-of-band by the initiator.

## Architecture

```
Initiator Browser                     Recipient Browser
      |                                      |
      |  POST /api/apps/:id/transfer         |
      |  (targetEmail)                       |
      |-----> Next.js BFF -----> mgmt-airo   |
      |        (sso-jwt)         (JWT auth)  |
      |<----- { transferToken }              |
      |                                      |
      |  -- out-of-band token delivery -->   |
      |                                      |
      |                POST /api/transfer    |
      |                (transferToken)       |
      |       mgmt-airo <---- Next.js BFF <--|
      |       (JWT auth)       (sso-jwt)     |
```

### Request Flow

1. **Initiator** authenticates via GoDaddy SSO, calls BFF, BFF proxies to mgmt-airo with `sso-jwt`
2. **mgmt-airo** validates ownership, checks eligibility, creates transfer record, returns token
3. **Initiator** shares the token with the recipient out-of-band (chat, email, etc.)
4. **Recipient** authenticates via GoDaddy SSO, enters token in the Accept Transfer dialog
5. **BFF** proxies the accept request to mgmt-airo with the recipient's JWT
6. **mgmt-airo** validates the recipient's identity, starts the transfer workflow

## Authentication and Authorization (BFF)

- All transfer BFF routes use `withCustomerAuth` middleware
- Requests to mgmt-airo use `sso-jwt` authorization scheme
- The BFF never trusts client-supplied customer IDs — identity comes from the JWT
- Base URL configured via `MGMT_AIRO_BASE_URL` (default: `https://mgmt.nstk.net`)
- BFF communicates with mgmt-airo via `AiroMgmtClient` which handles auth, retries, timeouts, and error transformation

## Token Handling (BFF + Client)

- Token **never appears in URL paths** — BFF passes it in request body (accept) or query string (metadata lookup only)
- Token is displayed once to the initiator and can be copied via clipboard
- Client-side input filtering strips non-alphanumeric characters in real-time
- Client validates token format (6-char alphanumeric) before submitting to BFF
- Token is not persisted to localStorage or sessionStorage — held in React component state only

## Threat Model

### 1. CDN Method Restrictions

**Threat**: CDN (Akamai) blocks HTTP `DELETE` method for cancel requests.

**BFF Mitigation**: Cancel uses a `POST /api/apps/:id/transfer/cancel` BFF route that internally calls mgmt-airo's `DELETE` endpoint. The BFF-to-mgmt-airo communication is not subject to CDN restrictions.

### 2. Cross-Site Request Forgery (CSRF)

**Threat**: Attacker tricks an authenticated user into initiating or accepting a transfer.

**BFF Mitigation**: All BFF routes require valid SSO JWT authentication. Transfer initiation requires a specific `targetEmail` in the request body. Accept requires a valid token that the attacker would not possess.

### 3. Client-Side Token Exposure

**Threat**: Token leaks from the client via browser storage or URL history.

**Client Mitigation**: Token is held in component state only (never persisted). Token never appears in URL paths. Clipboard copy is the only export mechanism.

### 4. Polling Denial of Service

**Threat**: Infinite polling after accept keeps connections open or floods the BFF.

**Client Mitigation**: Polling is capped at 40 attempts (~2 minutes). Consecutive poll failures (5+) stop polling and surface an error. Polling is cleaned up on component unmount via effect cleanup.

## Client-Side Security Measures

### Input Sanitization

- **Email input**: Validated against standard email format before submission
- **Transfer token input**: Strips non-alphanumeric characters, preserving case (`value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6)`)

### State Management

- Transfer token is held in component state only; not persisted to localStorage or sessionStorage
- Polling stops on component unmount via cleanup effects
- `AbortController` used for all fetch calls to prevent state updates on unmounted components

### Error Handling

- API errors are surfaced to the user without exposing internal details
- Cancel failures show explicit error messages in `AppCard`
- Network errors during polling retry with a consecutive error limit (5 failures stops polling)
- `refreshSites()` is called after successful cancel and accept to keep UI in sync

## API Reference

All mgmt-airo endpoints are accessed via the `AiroMgmtClient` (`app/src/lib/mgmt-airo/client.ts`). Auth is `sso-jwt` (BFF attaches the customer's JWT).

### Endpoint Overview

| BFF Route                          | Method | mgmt-airo Endpoint                                     | Purpose                           |
| ---------------------------------- | ------ | ------------------------------------------------------ | --------------------------------- |
| `/api/apps/:id/transfer`           | POST   | `POST /api/airo/v1/apps/:appId/transfer/initiate`      | Initiate transfer                 |
| `/api/apps/:id/transfer`           | GET    | `GET /api/airo/v1/apps/:appId/transfer/metadata`       | Get transfer metadata (initiator) |
| `/api/apps/:id/transfer/cancel`    | POST   | `DELETE /api/airo/v1/apps/:appId/transfer`             | Cancel transfer                   |
| `/api/transfer`                    | POST   | `POST /api/airo/v1/transfer/accept`                    | Accept transfer                   |
| `/api/transfer?transferToken=xxx`  | GET    | `GET /api/airo/v1/transfer/metadata?transferToken=xxx` | Get transfer metadata (recipient) |

---

### 1. Initiate Transfer

**BFF**: `POST /api/apps/:id/transfer`
**mgmt-airo**: `POST /api/airo/v1/apps/:appId/transfer/initiate`

**Request Body**:

```json
{
  "targetEmail": "recipient@example.com"
}
```

**Response (201 Created)**:

```json
{
  "transferToken": "a1b2c3",
  "appId": "app_xxx",
  "status": "initiated",
  "createdAt": "2026-03-04T12:00:00.000Z",
  "expiresAt": "2026-03-07T12:00:00.000Z"
}
```

**Errors**: `400` (target email not found, validation failed, duplicate active transfer), `404` (app not found or not owned), `401` (unauthorized)

---

### 2. Get Transfer Metadata (Initiator)

**BFF**: `GET /api/apps/:id/transfer`
**mgmt-airo**: `GET /api/airo/v1/apps/:appId/transfer/metadata`

**Query Params** (optional): `transferToken`

**Response (200 OK)**:

```json
{
  "appId": "app_xxx",
  "transferToken": "a1b2c3",
  "status": "initiated",
  "createdAt": "2026-03-04T12:00:00.000Z",
  "expiresAt": "2026-03-07T12:00:00.000Z"
}
```

**Errors**: `401`, `403` (not a party to this transfer), `404`

---

### 3. Cancel Transfer

**BFF**: `POST /api/apps/:id/transfer/cancel` (POST to avoid CDN blocking DELETE)
**mgmt-airo**: `DELETE /api/airo/v1/apps/:appId/transfer`

**Request Body**: None

**Response (200 OK)**:

```json
{
  "status": "cancelled",
  "appId": "app_xxx",
  "message": "Transfer cancelled"
}
```

**Errors**: `400` (transfer not in `initiated` state), `403` (caller is not the initiator), `404` (no active transfer), `401`

---

### 4. Accept Transfer

**BFF**: `POST /api/transfer`
**mgmt-airo**: `POST /api/airo/v1/transfer/accept`

**Request Body**:

```json
{
  "transferToken": "a1b2c3"
}
```

**Response (200 OK)** — first accept (was `initiated`):

```json
{
  "requestId": "a1b2c3d4e5",
  "status": "processing",
  "hostingTransferId": "transfer-xxx",
  "message": "App transfer accepted and in progress",
  "appId": "app_xxx"
}
```

**Response (200 OK)** — idempotent (already `processing`):

```json
{
  "requestId": "a1b2c3d4e5",
  "status": "processing",
  "hostingTransferId": null,
  "message": "Transfer already in progress",
  "appId": "app_xxx"
}
```

**Response (200 OK)** — idempotent (already `completed`):

```json
{
  "requestId": "a1b2c3d4e5",
  "status": "completed",
  "hostingTransferId": "transfer-xxx",
  "message": "Transfer already completed",
  "appId": "app_xxx"
}
```

**Errors**: `400` (CUSTOMER_MISMATCH, TRANSFER_EXPIRED, TRANSFER_NOT_ACCEPTABLE), `404` (no transfer for token), `401`

---

### 5. Get Transfer Metadata (Recipient)

**BFF**: `GET /api/transfer?transferToken=xxx`
**mgmt-airo**: `GET /api/airo/v1/transfer/metadata?transferToken=xxx`

**Response (200 OK)**:

```json
{
  "appId": "app_xxx",
  "transferToken": "a1b2c3",
  "status": "processing",
  "createdAt": "2026-03-04T12:00:00.000Z",
  "expiresAt": "2026-03-07T12:00:00.000Z"
}
```

**Errors**: `401`, `403` (not a party to this transfer), `404`

---

## Out of Scope

- **Agents/BFF ownership updates**: Post-transfer cleanup (e.g., `PATCH /apps/:id/ownership`) is not part of this feature
- **Admin transfer**: Existing `POST /airo/admin/v1/subscriptions/:subscriptionId/apps/:appId/transfer` remains unchanged
- **Rate limiting**: Accept endpoint rate limiting is planned but deferred
