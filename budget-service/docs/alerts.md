# Alerts

This document lists the service's active alert rules in production environments and provides guidance on how to investigate and respond to them.

See the [Budget Service Alert Rules](<https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io/app/observability/alerts/rules?_a=(actionTypes:!(),lastResponse:!(),params:(),search:BMS,status:!(),tags:!(),type:!())>)
for the full list of active alerts and their configurations.


## Latency threshold
- **Type:** APM – Latency Threshold
- **Description:** Fires when the **average latency** of `request` transactions for `budget-service` (across all environments) exceeds **1,500 ms** over a **5-minute window**.
- **Schedule:** Every 1 minute
- **Notifications:** Slack + Incident
- **Investigation steps:**
  1. Reference the [Observability Docs](observability.md) for guidance on using Kibana and OTel to investigate latency issues.
  2. Drill down into slow transactions to identify bottlenecks or errors contributing to the latency.
  3. Reference the [DevOps Docs](devops.md) and identify any recent deploys or changes in Katana.


## GoDaddy cost attribution > 50%
- **Type:** Custom Threshold
- **Description:** Fires when the ratio of **`productCostTotalUsd` / `budgetCostTotalUsd`** (avg over 1 hour) exceeds **50%** in production. Monitors whether GoDaddy's product cost is consuming more than half of the total budget cost.
- **Schedule:** Every 30 minutes
- **Notifications:** Slack + Incident
- **Investigation steps:**
  1. This alert indicates a Session Reports concern, not a BMS bug — escalate to [#airo-builder-squad-paywall](https://godaddy.enterprise.slack.com/archives/C0AD2FPSF9D).
  2. Check the [Analytics Dashboard](observability.md#dashboards) for trends in `productCostTotalUsd` and `budgetCostTotalUsd`.
  3. Identify any recent changes in product costs or budget configurations that could contribute to the increase.


## GoDaddy cost attribution > 100%
- **Type:** Custom Threshold
- **Description:** Fires when the ratio of **`productCostTotalUsd` / `budgetCostTotalUsd`** (avg over 1 hour) exceeds **100%** in production. Indicates GoDaddy's product cost has fully exceeded the total budget cost.
- **Schedule:** Every 30 minutes
- **Notifications:** Slack + Incident + Call Out
- **Investigation steps:**
  1. This alert indicates a Session Reports concern, not a BMS bug — escalate to [#airo-builder-squad-paywall](https://godaddy.enterprise.slack.com/archives/C0AD2FPSF9D).
  2. Check the [Analytics Dashboard](observability.md#dashboards) for trends in `productCostTotalUsd` and `budgetCostTotalUsd`.
  3. Identify any recent changes in product costs or budget configurations that could contribute to the increase.


## Go memory usage > 95%
- **Type:** Custom Threshold
- **Description:** Fires when the ratio of **`go.memory.used` / `go.memory.limit`** (avg over 5 minutes) exceeds **95%** for the `budget-service` container in production. Monitors for near-OOM (out-of-memory) conditions.
- **Schedule:** Every 1 minute
- **Notifications:** Slack + Incident + Call Out
- **Investigation steps:**
  1. Check the [Observability Dashboard](observability.md#dashboards) for trends in `go.memory.used` and `go.memory.limit`.
  2. Identify any recent changes in traffic patterns, deploys, or code changes that could contribute to increased memory usage.
  3. If the issue is persistent, consider increasing the container memory limit and updating `GOMEMLIMIT` accordingly (see [Memory alerting and GOMEMLIMIT](observability.md#memory-alerting-and-gomemlimit)).


## DB wait duration > 50ms per acquire
- **Type:** Custom Threshold
- **Description:** Fires when the **average wait per connection acquire** — `rate(db.pool.wait_duration[5m]) / rate(db.pool.wait_count[5m])` — exceeds **50 ms** sustained over **10 minutes** in production. Indicates the connection pool is saturated: goroutines are blocking on `MaxOpenConns` and waiting non-trivially for a free connection.
- **Schedule:** Every 1 minute
- **Notifications:** Slack + Incident
- **Investigation steps:**
  1. Check `db.pool.open_connections` against the configured `MaxOpenConns` — sustained near-ceiling usage is the leading indicator that produced this alert.
  2. Look for slow queries holding connections: drill into recent transactions in the [Observability Dashboard](observability.md#dashboards) and correlate with the latency alert if it also fired.
  3. Identify any recent deploys, traffic spikes, or schema/index changes that could have increased per-request connection hold time.
  4. If the issue is persistent consider raising `DB_MAX_OPEN_CONNS` in Katana (see [DevOps Docs](devops.md)).
     - Verify Postgres `max_connections` available headroom  
