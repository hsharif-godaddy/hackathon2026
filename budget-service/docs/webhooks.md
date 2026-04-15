# Webhooks

The budget-service delivers webhook notifications for lifecycle events. Webhooks are product-scoped and use an outbox pattern for reliable delivery with automatic retries.

## Registration

```http
POST /api/v1/webhooks
Content-Type: application/json
Authorization: sso-jwt <token>

{
  "eventType": "budget-item.reset",
  "productKey": "airo",
  "url": "https://your-service.gdcorp.tools/webhooks/budget"
}
```

**URL requirements:**

- Production: HTTPS only, must be `*.gdcorp.tools`, `*.godaddy.com`, or `*.nstk.net` domain
- Local dev (`LOCAL_AUTH_DISABLE=true`): HTTP allowed for loopback addresses

## Event Types

| Event                   | Trigger                                    | Source                   |
| ----------------------- | ------------------------------------------ | ------------------------ |
| `report.created`        | Session report created (reconciliation)    | API handler (via outbox) |
| `budget-item.reset`     | Credits reset to zero (periodic renewal)   | Background worker        |
| `budget-item.expired`   | Item's `expiresAt` timestamp passed        | Background worker        |
| `budget-item.exhausted` | Item's `creditsUsed` equals `creditsTotal` | API handler (via outbox) |

## Payload Structure

Webhooks share a common envelope:

```json
{
  "eventType": "<event-type>",
  "productKey": "<product-key>",
  "timestamp": "2026-04-15T12:00:00.000000000Z",
  "data": { ... }
}
```

## Event Payloads

### `report.created`

Fired after a session report is created and credits are allocated.

```json
{
  "eventType": "report.created",
  "productKey": "airo",
  "timestamp": "2026-04-15T12:00:00.000000000Z",
  "data": {
    "productKey": "airo",
    "budgetId": "550e8400-e29b-41d4-a716-446655440000",
    "sessionId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "reportId": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    "budgetCostTotal": "25.500000",
    "productCostTotal": "30.000000",
    "creditsAvailable": "74.500000",
    "reportItems": [
      {
        "reportItemId": "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
        "budgetCost": "25.500000",
        "productCost": "30.000000",
        "label": "AI generation",
        "createdAt": "2026-04-15T12:00:00Z",
        "budgetItems": [
          {
            "budgetItemId": "6ba7b813-9dad-11d1-80b4-00c04fd430c8",
            "creditsUsed": "25.500000"
          }
        ]
      }
    ]
  }
}
```

### `budget-item.reset`

Fired when a budget item's credits are reset due to periodic renewal (`resetInterval`).

```json
{
  "eventType": "budget-item.reset",
  "productKey": "airo",
  "timestamp": "2026-04-15T12:00:00.000000000Z",
  "data": {
    "budgetItemId": "550e8400-e29b-41d4-a716-446655440000",
    "budgetId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "creditsReset": "75.000000",
    "creditsTotal": "100.000000",
    "nextResetsAt": "2026-05-15T12:00:00.000000000Z",
    "resetInterval": "1mo"
  }
}
```

**Fields:**

- `creditsReset` — Credits that were zeroed (previous `creditsUsed` value)
- `creditsTotal` — Total credit pool size
- `nextResetsAt` — When the next reset will occur
- `resetInterval` — Reset cadence (`1d`, `2w`, `1mo`, `1y`)

**Note:** Only fired when `creditsReset > 0`. Items with no usage skip webhook delivery.

### `budget-item.expired`

Fired when a budget item's `expiresAt` timestamp passes.

```json
{
  "eventType": "budget-item.expired",
  "productKey": "airo",
  "timestamp": "2026-04-15T12:00:00.000000000Z",
  "data": {
    "budgetItemId": "550e8400-e29b-41d4-a716-446655440000",
    "budgetId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "expiredAt": "2026-04-15T00:00:00.000000000Z",
    "creditsRemaining": "25.000000",
    "creditsTotal": "100.000000"
  }
}
```

**Fields:**

- `expiredAt` — The item's expiration timestamp
- `creditsRemaining` — Credits that were not used (`creditsTotal - creditsUsed`)
- `creditsTotal` — Total credit pool size

### `budget-item.exhausted`

Fired when a budget item is fully consumed (`creditsUsed = creditsTotal`).

```json
{
  "eventType": "budget-item.exhausted",
  "productKey": "airo",
  "timestamp": "2026-04-15T12:00:00.000000000Z",
  "data": {
    "budgetItemId": "550e8400-e29b-41d4-a716-446655440000",
    "budgetId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "sessionId": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    "reportId": "6ba7b812-9dad-11d1-80b4-00c04fd430c8",
    "creditsTotal": "100.000000"
  }
}
```

**Trigger:** Fired during `CreateSessionReport` when a budget item transitions from non-exhausted to exhausted (i.e., `creditsUsed` reaches `creditsTotal`).

## Delivery

- **Authentication:** `Authorization: sso-jwt <token>` header (s2s JWT)
- **Timeout:** 15 seconds per delivery attempt
- **Retries:** Automatic with exponential backoff (see Retry Strategy below)
- **Concurrency:** Webhooks are drained from the outbox and delivered sequentially within each worker tick

## Transactional Outbox Pattern

The budget-service uses a transactional outbox pattern for reliable webhook delivery:

1. **Atomic writes:** When a reset or expiration occurs, the webhook event is written to the `webhook_outbox` table within the same database transaction as the business operation
2. **Guaranteed delivery:** Events are never lost even if the worker crashes or misses cycles
3. **Idempotency:** Each event has a unique idempotency key to prevent duplicate deliveries
4. **Retry with backoff:** Failed deliveries are retried with exponential backoff

### Retry Strategy

| Attempt | Backoff                           |
| ------- | --------------------------------- |
| 1       | Immediate                         |
| 2       | 2 minutes                         |
| 3       | 4 minutes                         |
| 4       | 8 minutes                         |
| 5       | 16 minutes                        |
| 6       | 32 minutes                        |
| 7       | Marked `failed` (no more retries) |

Failed events remain in the outbox table for debugging and manual retry.

### Outbox Configuration

| Variable                  | Default | Description                          |
| ------------------------- | ------- | ------------------------------------ |
| `OUTBOX_MAX_ATTEMPTS`     | `7`     | Maximum delivery attempts            |
| `OUTBOX_DRAIN_BATCH_SIZE` | `100`   | Events processed per drain cycle     |
| `OUTBOX_RETENTION_DAYS`   | `7`     | Days to keep completed/failed events |

## Background Worker

The background worker runs on a configurable interval (default: 1 minute) and processes:

1. **Resets:** Items with `resets_at <= now()` and `reset_interval` set
2. **Expirations:** Items with `expires_at <= now()` not yet notified
3. **Outbox drain:** Delivers pending webhook events with retry logic
4. **Cleanup:** Removes old completed/failed events (hourly)

### Configuration

| Variable            | Default | Description                          |
| ------------------- | ------- | ------------------------------------ |
| `WORKER_ENABLED`    | `true`  | Enable/disable the background worker |
| `WORKER_INTERVAL`   | `1m`    | Processing interval                  |
| `WORKER_BATCH_SIZE` | `500`   | Max items per processing cycle       |

### Processing Order

1. Resets are processed first (events written to outbox)
2. Expirations are processed second (events written to outbox)
3. Outbox is drained (webhooks delivered with retries)
4. Cleanup runs hourly to remove old events

## Receiving Webhooks

Example handler:

```go
func handleWebhook(w http.ResponseWriter, r *http.Request) {
    // Validate auth header
    token := strings.TrimPrefix(r.Header.Get("Authorization"), "sso-jwt ")
    if !validateToken(token) {
        http.Error(w, "Unauthorized", http.StatusUnauthorized)
        return
    }

    var payload struct {
        EventType  string         `json:"eventType"`
        ProductKey string         `json:"productKey"`
        Timestamp  string         `json:"timestamp"`
        Data       map[string]any `json:"data"`
    }
    if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
        http.Error(w, "Bad request", http.StatusBadRequest)
        return
    }

    switch payload.EventType {
    case "budget-item.reset":
        handleReset(payload.Data)
    case "budget-item.expired":
        handleExpiration(payload.Data)
    case "report.created":
        handleReportCreated(payload.Data)
    }

    w.WriteHeader(http.StatusOK)
}
```

## Idempotency

The outbox pattern uses idempotency keys to prevent duplicate webhook creation. Keys follow the format `{event-type}:{entity-id}:{discriminator}`:

- `report.created:{reportId}` — reportId is unique, no discriminator needed
- `budget-item.reset:{budgetItemId}:{resetsAt}` — resetsAt prevents duplicates for same reset cycle
- `budget-item.expired:{budgetItemId}:{expiresAt}` — expiresAt prevents duplicates for same item
- `budget-item.exhausted:{budgetItemId}:{reportId}` — reportId prevents duplicates for same exhaustion event

The key prefix matches the event type for easier debugging and querying.

Even with these guarantees, receivers should still handle duplicates gracefully as network issues can cause the same webhook to be delivered more than once. Receivers should:

1. Use a stable idempotency key derived from intrinsic event fields (not the delivery `timestamp`, which changes per delivery):
   - `budget-item.reset`: `budgetItemId` + `eventType` + `nextResetsAt`
   - `budget-item.expired`: `budgetItemId` + `eventType` + `expiredAt`
   - `budget-item.exhausted`: `budgetItemId` + `eventType` + `reportId`
   - `report.created`: `reportId`
2. Handle duplicate deliveries gracefully
3. Not rely on webhook ordering
