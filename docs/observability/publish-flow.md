# Publish Flow Observability

This document provides a comprehensive guide to monitoring and troubleshooting the Airo Builder publish flow using structured logs, dashboards, and alerts.

## Overview

The publish flow observability system monitors the end-to-end journey of publishing an app, from initial authorization through final deployment. It tracks:

- **Publish success/failure rates**
- **Paywall eligibility checks**
- **Subscription API health**
- **Performance metrics (latency, duration)**
- **Error patterns and root causes**

## Architecture

The publish flow spans two main services:

### BFF Layer (app/)
- Agent token creation (`POST /api/auth/agent-token`)
- Paywall eligibility checks (`app/src/lib/paywall/core.ts`)
- Subscription API (`GET /api/subscriptions`)

### Agents Service (agents/)
- Publish execution (`POST /apps/:id/publish`)
- Archive creation and deployment
- Git operations and build processes

## Structured Logging Events

All publish-related events follow the `{domain}.{operation}.{lifecycle}` naming convention.

### Publish Flow Events (Agents Service)

| Event | Level | Description | Key Fields |
|-------|-------|-------------|----------|
| `publish.flow.start` | info | Publish request received | appId, deploymentStrategy, publishAttemptId, customerId |
| `publish.flow.success` | info | Publish completed successfully | appId, commitHash, archivePath, strategy, durationMs |
| `publish.flow.failure` | error | Publish failed | appId, error, errorType, deploymentStrategy, durationMs |

### Paywall Events (BFF)

| Event | Level | Description | Key Fields |
|-------|-------|-------------|----------|
| `agent-token.paywall-check.start` | info | Paywall check initiated | siteId, customerId, cacheHit |
| `agent-token.paywall-check.success` | info | Paywall check passed | siteId, canPublish, canDownload, subscriptionId |
| `agent-token.paywall-check.denied` | warn | Paywall check denied | siteId, reason, hasSubscription |
| `agent-token.paywall-check.rejected` | error | Paywall check failed | siteId, error, errorType |

### Paywall Eligibility Events

| Event | Level | Description | Key Fields |
|-------|-------|-------------|----------|
| `paywall.eligibility.check.start` | info | Eligibility check started | appId, action |
| `paywall.eligibility.subscription.fetch.start` | info | Fetching subscription | appId |
| `paywall.eligibility.subscription.fetch.success` | info | Subscription fetched | appId, plan, status, subscriptionId |
| `paywall.eligibility.no-subscription` | warn | No subscription found | appId, durationMs |
| `paywall.eligibility.plan-tier-check` | info | Plan tier evaluated | appId, plan, isPaidPlan |
| `paywall.eligibility.publish-limit-check.start` | info | Checking publish limits | appId, plan |
| `paywall.eligibility.published-apps.fetch.success` | info | Published app count retrieved | appId, count |
| `paywall.eligibility.publish-limit-evaluated` | info | Limit check completed | appId, currentCount, limit, canPublish |
| `paywall.eligibility.publish-limit-reached` | warn | Limit exceeded | appId, currentCount, limit, durationMs |
| `paywall.eligibility.access-granted` | info | Access granted | appId, reason, plan, durationMs |
| `paywall.eligibility.denied` | warn | Access denied | appId, reason, durationMs |
| `paywall.eligibility.check-failed` | error | Check errored | appId, error, errorType, durationMs |

### Subscription API Events

| Event | Level | Description | Key Fields |
|-------|-------|-------------|----------|
| `subscriptions.api.start` | info | Subscription fetch started | customerId |
| `subscriptions.api.fetched` | info | Subscriptions retrieved | count, customerId |
| `subscriptions.api.selection` | info | Subscription selection logic | totalSubscriptions, aabSubscriptions |
| `subscriptions.api.best-subscription-selected` | info | Best subscription chosen | subscriptionId, plan, status |
| `subscriptions.api.no-aab-subscription` | warn | No AAB subscription found | totalSubscriptions, customerId |
| `subscriptions.api.success` | info | Subscription fetch succeeded | count, bestPlan, customerId |
| `subscriptions.api.not-registered` | info | Subscription not found (404) | customerId, statusCode |
| `subscriptions.api.error` | error | Subscription fetch failed | customerId, error |

## Dashboard Access

`publish.flow.*` events are emitted by the **agents service** which ships logs to **Grafana Loki**. BFF events (`paywall.eligibility.*`, `agent-token.*`, `subscriptions.api.*`) ship to the **Elastic ESSP cluster**. The two dashboards below follow this split.

### Kibana — BFF Events (Paywall & Subscription)

Import `kibana-dashboards/publish-flow.ndjson` into:
- **Production**: `https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io`
- **Non-prod**: `https://airobuilde-non-prod-usw2.kb.us-west-2.aws.found.io`

Index pattern: `.ds-logs-gdelastic.katana.app-*-ecs*`

### Grafana — Agents Events (Publish Execution)

Access: `https://grafana.monitoring.gd3p.tools/`

Data source: Loki, job label `{job="airo-agents"}`

See the LogQL panel queries in [publish-flow-alerts.md](../alerts/publish-flow-alerts.md).

## Dashboard Panels

### Kibana Panels (BFF / Paywall & Subscription)

1. **Paywall Denials Over Time**
   - Visualization: Line chart
   - Events: All `paywall.eligibility.denied` and `agent-token.paywall-check.denied`
   - Use: Track false positive incidents

2. **Paywall Denial Reasons**
   - Visualization: Donut chart
   - Split by: `event` field
   - Use: Understand denial patterns

3. **Subscription API Health**
   - Visualization: Line chart with two series
   - Events: `subscriptions.api.success` vs `subscriptions.api.error`
   - Use: mgmt-airo service health

4. **Subscription 404 Responses**
   - Visualization: Bar chart
   - Event: `subscriptions.api.not-registered`
   - Use: Track provisioning gaps (new accounts without a subscription yet)

### Grafana Panels (Agents / Publish Execution)

Build these panels in Grafana using the LogQL queries from the alerts doc:

1. **Publish Success Rate** — ratio of `publish.flow.success` to `publish.flow.start`
2. **Publish Success vs Failure Over Time** — stacked bar, split by event type
3. **Failure Breakdown by Error Type** — donut on `data.errorType` from `publish.flow.failure`
4. **Publish Duration (p50 / p95 / p99)** — quantile_over_time on `data.durationMs`
5. **Slow Publishes (>60s)** — bar chart filtered to `data.durationMs > 60000`
6. **Recent Publish Events** — log panel for `publish.flow.*`

## Key Metrics Definitions

### Success Rate
**Target**: >95%
**Calculation**: `(successful publishes) / (total publish attempts)`
**Warning Threshold**: <90%
**Critical Threshold**: <85%

### Average Publish Duration
**Target**: <30 seconds (p95)
**Baseline**: 15-25 seconds typical
**Warning Threshold**: p95 >45s
**Critical Threshold**: p95 >60s

### Paywall False Positive Rate
**Target**: 0 per hour
**Critical**: >5 in 5 minutes
**Definition**: Denials for users with `hasSubscription:true` and `subscriptionStatus:active`

### Subscription API Error Rate
**Target**: <1%
**Warning Threshold**: >2%
**Critical Threshold**: >5%

## Troubleshooting Guide

### Scenario 1: High Publish Failure Rate

**Symptoms**: Success rate drops below 90%

**Investigation Steps** (Grafana Loki):
1. Check the "Publish Success vs Failure Over Time" Grafana panel
2. Look at "Failure Breakdown by Error Type" — is it BuildError, SupervisorUnavailable, etc.?
3. Query for recent failures:
   ```logql
   {job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.failure\"" | json
   | line_format "{{.data_errorType}} | {{.app_id}} | {{.data_durationMs}}ms"
   ```
4. Check `data.errorType` to identify the failure category
5. Look for patterns:
   - Same error type across multiple apps?
   - Specific time window?
   - Infrastructure issues (CPU, memory, disk)?

**Common Causes**:
- Build failures (npm install, npm build errors)
- Git operation failures (merge conflicts, permission issues)
- Supervisor communication failures
- Out of memory errors
- Disk space exhaustion

**Resolution**:
- For build failures: Check npm package registry availability
- For git errors: Verify git operations in affected app repos
- For supervisor issues: Check dev-supervisor health
- For resource issues: Scale infrastructure

### Scenario 2: Paywall False Positives

**Symptoms**: Users with paid plans blocked from publishing

**Investigation Steps**:
1. Query for false positives — denials for users with an active subscription:
   ```
   event:(agent-token.paywall-check.denied OR paywall.eligibility.denied) 
     AND data.hasSubscription:true 
     AND data.subscriptionStatus:active
   ```
2. Check `subscriptions.api.not-registered` events for unexpected 404 spikes
3. Review subscription fetch logs for the affected customer

**Common Causes**:
- Subscription status sync issues
- Control plane outage

**Resolution**:
- Check mgmt-airo service health
- For urgent customer impact, temporarily enable bypass flag
- Verify subscription provisioning for affected customer

### Scenario 3: Slow Publish Performance

**Symptoms**: p95 duration >60s

**Investigation Steps**:
1. Check the "Publish Duration (p50/p95/p99)" Grafana panel
2. Look at the "Slow Publishes (>60s)" Grafana panel for count
3. Query for slow publishes in Grafana Loki:
   ```logql
   {job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.success\""
   | json | data_durationMs > 60000
   | line_format "{{.app_id}} | {{.data_durationMs}}ms | {{.data_strategy}}"
   ```
4. Check if specific to deployment strategy
5. Review infrastructure metrics (CPU, memory, network I/O)

**Common Causes**:
- Large bundle sizes requiring long build times
- Network latency to npm registry
- Slow git operations (large repos)
- Resource contention (high load)
- Database migrations taking long

**Resolution**:
- For large builds: Optimize bundle size, cache dependencies
- For git slowness: Check git LFS performance
- For resource issues: Scale infrastructure
- For persistent slowness: Review build process optimization

### Scenario 4: Subscription API Errors

**Symptoms**: High error rate on subscription fetches

**Investigation Steps**:
1. Check "Subscription API Health" panel
2. Query for subscription errors:
   ```
   event:subscriptions.api.error | sort @timestamp desc
   ```
3. Check `data.error` field for error messages
4. Verify mgmt-airo service status
5. Check network connectivity

**Common Causes**:
- mgmt-airo service outage
- Network connectivity issues
- Authentication token issues (JWT expired)
- Rate limiting

**Resolution**:
- Check mgmt-airo service health dashboard
- Verify network connectivity between services
- Check authentication service status
- If rate-limited, investigate unusual traffic patterns

## Log Queries

### Kibana (BFF — Paywall & Subscription)

**Find paywall denials for a customer:**
```kql
event:(agent-token.paywall-check.denied OR paywall.eligibility.*)
  AND data.customerId:"<customer-id>"
```

**Find subscription API errors:**
```kql
event:subscriptions.api.error | sort @timestamp desc
```

**Find subscription 404 responses:**
```kql
event:subscriptions.api.not-registered | sort @timestamp desc
```

### Grafana Loki (Agents — Publish Execution)

**Find all publish attempts for an app:**
```logql
{job="airo-agents", env="prod"} |= "\"app_id\":\"<app-id>\"" |= "publish.flow."
```

**Find recent publish failures:**
```logql
{job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.failure\""
| json | line_format "{{.data_errorType}} | {{.app_id}} | {{.data_durationMs}}ms"
```

**Find slow publishes:**
```logql
{job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.success\""
| json | data_durationMs > 60000
| line_format "{{.app_id}} | {{.data_durationMs}}ms | strategy={{.data_strategy}}"
```

**Trace a complete publish attempt (both services):**
```
# Kibana — BFF side
event:(agent-token.paywall-check.* OR paywall.eligibility.*) AND data.appId:"<app-id>"
| sort @timestamp asc

# Grafana — agents side
{job="airo-agents", env="prod"} |= "\"app_id\":\"<app-id>\"" |= "publish.flow."
| json | line_format "{{.event}} | {{.data_durationMs}}ms"
```

## APM Labels

The following APM labels are set for tracing:

- `paywall.action`: "publish" or "download"
- `paywall.has_access`: true/false
- `paywall.denial_reason`: Reason code when denied
- `subscription.plan`: free, starter, professional, ultimate
- `subscription.status`: active, suspended, etc.

Use these in Elastic APM for service-level metrics and traces.

## Alert Configuration

Alerts are defined in [publish-flow-alerts.md](../alerts/publish-flow-alerts.md).

Active alerts:
- High Publish Failure Rate (>10% for 15min)
- Subscription API High Error Rate (>5% for 10min)
- Paywall False Positive Spike (>5 in 5min) **CRITICAL**
- Elevated Publish Latency (p95 >60s for 20min)
- Increased Paywall Denials (>50% increase)

## Related Documentation

- [Alert Definitions](../alerts/publish-flow-alerts.md)
- [LOGGING-GUIDE.md](../../LOGGING-GUIDE.md)
- [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs)
- [Budget Service Observability](../../budget-service/docs/observability.md) - Reference implementation

## Maintenance

### Dashboard Updates

When adding new metrics:
1. Update the Kibana dashboard definition in `kibana-dashboards/publish-flow.ndjson`
2. Test in non-prod Kibana
3. Deploy to production
4. Update this documentation

### Log Event Changes

When adding or modifying log events:
1. Follow the `{domain}.{operation}.{lifecycle}` naming convention
2. Include correlation IDs: `appId`, `customerId`, `publishAttemptId`
3. Include `durationMs` for timed operations
4. Update the event tables in this document
5. Update dashboard queries if needed

## Revision History

| Date | Changes | Author |
|------|---------|--------|
| 2026-06-22 | Initial observability guide | Shubham Singh Talan |
