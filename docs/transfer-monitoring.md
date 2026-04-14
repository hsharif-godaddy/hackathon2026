# Transfer Operations - Monitoring Guide

Operational monitoring for the app ownership transfer flow. Covers Kibana queries,
Elasticsearch field mappings, and alerting guidance.

**Dashboard:** Import `kibana-dashboards/transfer-operations.ndjson` into Kibana.

## Prerequisites

Transfer logs from the BFF (Next.js app) land in the **Airo Builder ES cluster** on the
`logs-*` index pattern. Agent-side transfer validation logs land in the **Pioneer ES cluster**
on `airo-agents-prod` / `airo-agents-dev`.

For ESSP credentials:

```bash
./scripts/essp-creds.sh dev   # Profile: airobuild-dev-private-sso
./scripts/essp-creds.sh prod  # Profile: airobuild-prod-sso
```

## Field Mappings

| Code Field (logger call) | ES Field       | Notes                                 |
| ------------------------ | -------------- | ------------------------------------- |
| Event name (1st arg)     | `event`        | e.g. `transfer.initiate.success`      |
| `appId`                  | `data.appId`   | Nested under `data` in Katana logs    |
| `customerId`             | `data.customerId` | Available in BFF logs              |
| `error`                  | `data.error`   | Error message string                  |
| `status`                 | `data.status`  | HTTP status code on failure           |
| Log level                | `level`        | `info`, `warn`, `error`               |
| Trace ID                 | `trace.id`     | OpenTelemetry trace correlation       |

For agents logs (`airo-agents-*`), `appId` maps to `app_id` (underscore, not camelCase).

## Transfer Event Catalog

### Initiate Flow (BFF)

| Event                               | Level | Trigger                              |
| ----------------------------------- | ----- | ------------------------------------ |
| `transfer.initiate.success`         | info  | Transfer initiated via mgmt-airo     |
| `transfer.initiate.failed`          | error | mgmt-airo returned HTTP error        |
| `transfer.initiate.error`           | error | Unexpected exception during initiate |
| `transfer.initiate.blocked`         | warn  | App has GD Commerce (transfer gated) |

### Validate Flow

| Event                               | Level | Trigger                                  |
| ----------------------------------- | ----- | ---------------------------------------- |
| `transfer.validate.checked`         | info  | Agents validated GD Commerce status      |
| `transfer.validate.error`           | error | Agents validation threw exception        |
| `transfer.validate.preflight.error` | error | BFF preflight validation threw exception |
| `transfer.validate.preflight.failure`| error | BFF preflight got non-OK response       |
| `transfer.validate.proxy.error`     | error | BFF proxy to agents threw exception      |
| `transfer.validate.proxy.failure`   | error | BFF proxy got non-OK from agents         |
| `transfer.validate.ui.error`        | error | UI-side validation request failed        |
| `transfer.validate.ui.httpError`    | error | UI got non-OK from BFF validate          |

### Accept Flow (BFF)

| Event                          | Level | Trigger                             |
| ------------------------------ | ----- | ----------------------------------- |
| `transfer.accept.success`      | info  | Transfer accepted via mgmt-airo     |
| `transfer.accept.failed`       | error | mgmt-airo returned HTTP error       |
| `transfer.accept.error`        | error | Unexpected exception during accept  |
| `transfer.accept.ui.error`     | error | UI-side accept request failed       |

### Cancel Flow

| Event                          | Level | Trigger                             |
| ------------------------------ | ----- | ----------------------------------- |
| `transfer.cancel.success`      | info  | Transfer cancelled via mgmt-airo    |
| `transfer.cancel.failed`       | error | mgmt-airo returned HTTP error       |
| `transfer.cancel.error`        | error | Unexpected exception during cancel  |
| `transfer.cancel.ui.error`     | error | UI cancel request failed            |
| `transfer.cancel.ui.failed`    | error | UI got non-OK from BFF cancel       |
| `transfer.cancel.list.error`   | error | Listing transfers threw exception   |
| `transfer.cancel.list.failed`  | error | Listing transfers got non-OK        |

### Unpublish (Post-Transfer Side Effect)

| Event                                  | Level | Trigger                                    |
| -------------------------------------- | ----- | ------------------------------------------ |
| `transfer.unpublish.agents.success`    | info  | Agents unpublish succeeded                 |
| `transfer.unpublish.agents.failed`     | error | Agents unpublish returned non-OK           |
| `transfer.unpublish.agents.error`      | error | Agents unpublish threw exception           |
| `transfer.unpublish.controlPlane.success` | info | mgmt-airo unpublish succeeded           |
| `transfer.unpublish.controlPlane.error`| error | mgmt-airo unpublish failed                 |
| `transfer.unpublish.alreadyUnpublished`| info  | mgmt-airo returned 409 (already done)      |
| `transfer.unpublish.unexpected`        | error | Unexpected error in unpublish background   |

### Metadata & Polling

| Event                          | Level | Trigger                               |
| ------------------------------ | ----- | ------------------------------------- |
| `transfer.metadata.error`      | error | GET metadata threw exception          |
| `transfer.poll.error`          | error | Status polling threw exception (UI)   |
| `transfer.fetch.error`         | error | Fetching transfer list failed (UI)    |

## Kibana Discover Queries

### All transfer events

```
event: transfer.*
```

### Investigate a specific app

```
event: transfer.* AND data.appId: "your-app-id-here"
```

### All errors in the transfer flow

```
event: transfer.* AND level: error
```

### Initiate failures only

```
event: (transfer.initiate.error OR transfer.initiate.failed OR transfer.initiate.blocked)
```

### Unpublish failures after transfer

```
event: (transfer.unpublish.agents.failed OR transfer.unpublish.agents.error OR transfer.unpublish.controlPlane.error OR transfer.unpublish.unexpected)
```

### Transfers blocked by GD Commerce

```
event: transfer.initiate.blocked
```

### End-to-end transfer tracking (specific app)

```
event: transfer.* AND data.appId: "your-app-id"
```

Sort by `@timestamp` ascending to see the full lifecycle.

## Sample ES Queries (curl)

### Transfer error count by event (last 24h)

```bash
source /tmp/essp-creds-prod.env
curl -s -u "$ES_USER:$ES_PASSWORD" "$ES_ENDPOINT/logs-*/_search" \
  -H 'Content-Type: application/json' -d '{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "wildcard": { "event": "transfer.*" } },
        { "term": { "level": "error" } },
        { "range": { "@timestamp": { "gte": "now-24h" } } }
      ]
    }
  },
  "aggs": {
    "by_event": {
      "terms": { "field": "event.keyword", "size": 30 }
    }
  }
}'
```

### Transfer volume by outcome (last 7 days)

```bash
source /tmp/essp-creds-prod.env
curl -s -u "$ES_USER:$ES_PASSWORD" "$ES_ENDPOINT/logs-*/_search" \
  -H 'Content-Type: application/json' -d '{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "terms": { "event.keyword": [
          "transfer.initiate.success",
          "transfer.accept.success",
          "transfer.cancel.success",
          "transfer.initiate.failed",
          "transfer.accept.failed"
        ]}},
        { "range": { "@timestamp": { "gte": "now-7d" } } }
      ]
    }
  },
  "aggs": {
    "by_event": {
      "terms": { "field": "event.keyword", "size": 10 }
    }
  }
}'
```

### Unpublish success rate (last 30 days)

```bash
source /tmp/essp-creds-prod.env
curl -s -u "$ES_USER:$ES_PASSWORD" "$ES_ENDPOINT/logs-*/_search" \
  -H 'Content-Type: application/json' -d '{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        { "wildcard": { "event": "transfer.unpublish.*" } },
        { "range": { "@timestamp": { "gte": "now-30d" } } }
      ]
    }
  },
  "aggs": {
    "by_outcome": {
      "terms": { "field": "event.keyword", "size": 10 }
    }
  }
}'
```

## Alerting Guidance

### High error rate

Trigger when `transfer.*.error` OR `transfer.*.failed` count exceeds a threshold
(e.g., > 10 in 1 hour). This can indicate mgmt-airo API issues or auth problems.

### Unpublish failures

Trigger when `transfer.unpublish.agents.failed` OR `transfer.unpublish.controlPlane.error`
count is > 0 in 1 hour. Unpublish is best-effort but persistent failures leave transferred
apps in a published state under the wrong owner.

### Validation gate spike

Trigger when `transfer.initiate.blocked` count exceeds normal baseline. A sudden spike
may indicate a configuration issue or unexpected GD Commerce state changes.

### Transfer timeout (UI polling)

Monitor `transfer.poll.error` for consecutive errors per session. Repeated polling failures
suggest mgmt-airo latency or network issues between BFF and control plane.

## Analytics EIDs (CSP/FullStory)

Transfer UI components also emit CSP analytics events via `data-eid` attributes and
programmatic calls. These are tracked in FullStory, not Elasticsearch.

| EID Pattern                                    | Type       | Component                   |
| ---------------------------------------------- | ---------- | --------------------------- |
| `appbuilder.apps.transfer.initiate_dialog.impression` | Impression | TransferInitiateDialog open |
| `appbuilder.apps.transfer.accept_dialog.impression`   | Impression | AcceptTransferDialog open   |
| `appbuilder.apps.transfer.initiate_submit.click`      | Click      | Generate Code button        |
| `appbuilder.apps.transfer.accept_submit.click`        | Click      | Accept Transfer button      |
| `appbuilder.apps.transfer.initiate_success.click`     | Click      | Initiate succeeded          |
| `appbuilder.apps.transfer.initiate_error.click`       | Click      | Initiate failed             |
| `appbuilder.apps.transfer.accept_success.click`       | Click      | Accept succeeded            |
| `appbuilder.apps.transfer.accept_error.click`         | Click      | Accept failed               |
| `appbuilder.apps.transfer.cancel_success.click`       | Click      | Cancel succeeded            |
| `appbuilder.apps.transfer.cancel_error.click`         | Click      | Cancel failed               |
| `appbuilder.apps.transfer.cancel_confirm.click`       | Click      | Cancel confirmation button  |
| `appbuilder.apps.transfer.cancel_dismiss.click`       | Click      | Cancel dismissal button     |
| `appbuilder.apps.emptystate.accept_transfer.click`    | Click      | Empty card Accept Transfer  |
