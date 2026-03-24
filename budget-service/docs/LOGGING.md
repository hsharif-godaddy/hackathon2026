# Logging

The budget service produces structured JSON logs via Go's `slog` package. All logs use camelCase field names for consistency.

## Log Categories

### HTTP Access Logs

Every HTTP request produces an access log entry with event name `http.request`.

| Field | Type | Description |
|-------|------|-------------|
| `requestId` | string | UUID for request correlation (also in `X-Request-ID` response header) |
| `method` | string | HTTP method (GET, POST, PUT, DELETE) |
| `path` | string | Request path (e.g., `/api/v1/subscriptions/sub-123/spend`) |
| `status` | int | HTTP status code |
| `durationMs` | int | Request duration in milliseconds |
| `bytesWritten` | int | Response body size in bytes |
| `clientIp` | string | Client IP address (checks X-Forwarded-For, X-Real-IP, then RemoteAddr) |
| `userAgent` | string | Client user agent string |
| `subscriptionId` | string | Subscription ID from auth context (empty if not authenticated) |

**Example:**
```json
{
  "time": "2026-02-20T12:00:00.000Z",
  "level": "INFO",
  "msg": "http.request",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/v1/subscriptions/sub-123/spend",
  "status": 200,
  "durationMs": 45,
  "bytesWritten": 256,
  "clientIp": "10.0.0.1",
  "userAgent": "MyApp/1.0",
  "subscriptionId": "sub-123"
}
```

### Server Lifecycle Logs

| Event | Level | Fields | Description |
|-------|-------|--------|-------------|
| `server.starting` | INFO | `port` | Server is starting on specified port |
| `server.shutdown.start` | INFO | - | Graceful shutdown initiated |
| `server.shutdown.complete` | INFO | - | Shutdown completed successfully |

### Authentication Logs

| Event | Level | Fields | Description |
|-------|-------|--------|-------------|
| `auth.middleware.init.failed` | ERROR | `error` | Auth middleware failed to initialize |
| `auth.subscription.mismatch` | WARN | `tokenSubscriptionId`, `urlSubscriptionId` | JWT subscription doesn't match URL |
| `auth.admin.not_allowed` | WARN | `identity` | Admin identity not in allowlist |
| `auth.writeError.failed` | ERROR | `error` | Failed to write auth error response |

### Audit Log Failures

| Event | Level | Fields | Description |
|-------|-------|--------|-------------|
| `audit.log.failed` | ERROR | `event`, `error` | Failed to write audit log entry |

### Other Errors

| Event | Level | Fields | Description |
|-------|-------|--------|-------------|
| `json.encode.failed` | ERROR | `error` | Failed to encode JSON response |

## Audit Logs

In addition to structured application logs, the service writes business event audit logs to a separate file (configured via `AUDIT_LOG_PATH`). These are JSON-lines format for compliance and debugging.

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 timestamp |
| `event` | string | Event type (see below) |
| `subscriptionId` | string | Subscription identifier |
| `budgetId` | string | Budget UUID (if applicable) |
| `amount` | string | Credit amount as decimal string (if applicable) |
| `balanceAfter` | int | Rounded balance after operation (if applicable) |
| `operationType` | string | Client-provided operation type |
| `operationId` | string | Client-provided operation ID for idempotency |
| `metadata` | object | Additional context (varies by event) |

### Audit Event Types

| Event | Description | Key Fields |
|-------|-------------|------------|
| `budget.created` | New budget created | subscriptionId, budgetId, metadata (full request) |
| `budget.updated` | Budget modified | subscriptionId, budgetId, metadata (update fields) |
| `budget.deleted` | Budget deleted | subscriptionId, budgetId |
| `credits.spent` | Credits deducted | subscriptionId, budgetId, amount, balanceAfter, operationType, operationId |
| `credits.released` | Credits returned | subscriptionId, budgetId, amount, balanceAfter, operationType, operationId |

**Example audit entry:**
```json
{
  "timestamp": "2026-02-20T12:00:00.000Z",
  "event": "credits.spent",
  "subscriptionId": "sub-123",
  "budgetId": "550e8400-e29b-41d4-a716-446655440000",
  "amount": "100.000000",
  "balanceAfter": 9900,
  "operationType": "ai_generation",
  "operationId": "gen-abc-123"
}
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level (debug, info, warn, error) | `info` |
| `AUDIT_LOG_PATH` | Path to audit log file | `./audit.log` |
| `AUDIT_LOG_SYNC` | Sync to disk after each entry (true/false) | `true` |

## Best Practices

### Request Correlation

Use the `requestId` field (also available as `X-Request-ID` response header) to correlate:
- Client requests with server logs
- Multiple log entries for the same request
- Distributed tracing across services

### Log Aggregation

The structured JSON format is designed for aggregation tools like:
- Elasticsearch / Kibana
- Splunk
- Datadog
- CloudWatch Logs Insights

### Querying Examples

**Find slow requests:**
```
msg:"http.request" AND durationMs:>1000
```

**Find errors for a subscription:**
```
subscriptionId:"sub-123" AND status:>=400
```

**Find all spend operations:**
```
event:"credits.spent"
```

**Trace a specific request:**
```
requestId:"550e8400-e29b-41d4-a716-446655440000"
```
