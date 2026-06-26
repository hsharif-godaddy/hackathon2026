# Publish Flow Alerts

Alerting rules and investigation guides for the Airo Builder publish flow. Covers publish success rates, subscription API health, paywall issues, and performance.

## Where Alerts Live

| Service | Tool | URL |
|---|---|---|
| App/BFF (paywall, subscriptions) | Kibana | [prod](https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io/app/observability/alerts/rules) · [non-prod](https://airobuilde-non-prod-usw2.kb.us-west-2.aws.found.io/app/observability/alerts/rules) |
| Agents (publish execution) | Grafana | https://grafana.monitoring.gd3p.tools/alerting/list |

---

## Critical Alerts

### 1. Subscription API High Error Rate

**Service**: App/BFF (Kibana)
**Rule type**: Custom threshold
**Data view**: `.ds-logs-gdelastic.katana.app-*-ecs*`
**KQL**: `event:subscriptions.api.error`
**Threshold**: count > 10 over 10 min
**Actions**: Slack `#airo-builder-alerts` + PagerDuty

#### Investigation Guide

**What it means**: The BFF failed to fetch subscription data from mgmt-airo more than 10 times in 10 minutes. Any publish attempt during this window may be incorrectly paywalled (fail-open logic in `confirmCanPublish` protects against full block, but degraded experience).

**Step 1 — Confirm the alert is real**

Run in Kibana Discover (`.ds-logs-gdelastic.katana.app-*-ecs*`):
```
event:subscriptions.api.error
```
Check `data.error` field. If all errors share the same message (e.g. `Failed to fetch subscriptions: 500`) it's a real outage, not noise.

**Step 2 — Identify the scope**

```
event:subscriptions.api.error | stats count() by data.customerId
```
If > 20 distinct customers are affected it's systemic. If 1–2, it may be account-specific.

**Step 3 — Check mgmt-airo health**

- Check mgmt-airo service status in the control plane dashboard
- Look for 5xx responses: `event:subscriptions.api.error AND data.error:*500*`
- Check if the error correlates with a recent deploy of mgmt-airo or control plane

**Step 4 — Check network / auth**

```
event:subscriptions.api.error AND data.error:*401*
```
A spike of 401s means JWT validation is failing — check SSO key rotation.

**Step 5 — Mitigate**

If mgmt-airo is down and paying customers are being blocked:
1. Enable the bypass flag in Switchboard: `app-builder-bypass-publish-limit = true` for affected accounts
2. File incident with mgmt-airo team
3. Disable bypass flag once mgmt-airo recovers

---

### 2. Paywall False Positive Spike

**Service**: App/BFF (Kibana)
**Rule type**: Custom threshold
**Data view**: `.ds-logs-gdelastic.katana.app-*-ecs*`
**KQL**: `event:(agent-token.paywall-check.denied OR paywall.eligibility.denied) AND data.hasSubscription:true`
**Threshold**: count > 5 over 5 min
**Actions**: Slack `#airo-builder-alerts` + PagerDuty + **Call Out**

#### Investigation Guide

**What it means**: Users who have an active subscription are being denied publish access. This is a paying-customer impact — they see an upgrade modal they should never see.

**Step 1 — Identify affected customers**

```
event:(agent-token.paywall-check.denied OR paywall.eligibility.denied)
  AND data.hasSubscription:true
| stats count() by data.customerId, data.reason
```
Note the `data.reason` field — it tells you which branch of the paywall denied them.

**Step 2 — Check denial reason**

| `data.reason` | What it means | Next step |
|---|---|---|
| `PublishLimitReached` | User hit their plan limit | Check `data.publishLimit` vs `data.publishedCount` — might be a limit miscalculation |
| `no_subscription` | Active subscription came back null | Subscription fetch issue → go to Step 3 |
| `check_failed` | Eligibility check threw an error | Go to Step 3 |
| `upgrade_required` | Plan check returned false for paid plan | Check `data.plan` — might be a plan mapping bug |

**Step 3 — Trace the subscription fetch**

Find subscription fetches for an affected customer:
```
event:subscriptions.api.* AND data.customerId:"<customer-id>"
| sort @timestamp asc
```
Look for `subscriptions.api.not-registered` (404) — if present right before the denial, mgmt-airo returned an unexpected 404 for a paid user.

**Step 4 — Check confirmCanPublish path**

The `confirmCanPublish` force-refetch should have protected against false positives. If it didn't, check:
```
event:paywall.eligibility.subscription.fetch.success AND data.plan:"free" AND data.customerId:"<customer-id>"
```
If a paid user's subscription is being fetched as `free`, the issue is in mgmt-airo's response.

**Step 5 — Immediate mitigation**

```
# Enable bypass for affected accounts in Switchboard
app-builder-bypass-publish-limit = true  (targeted override for affected shopper ID)
```
This lets the customer publish while the root cause is investigated.

---

### 3. High Publish Failure Rate (Agents)

**Service**: Agents (Grafana)
**LogQL**:
```logql
sum(count_over_time({job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.failure\"" [15m]))
/
sum(count_over_time({job="airo-agents", env="prod"} |= "\"event\":\"publish.flow.start\"" [15m]))
> 0.1
```
**Threshold**: > 10% failure rate over 15 min
**Actions**: Slack `#airo-builder-alerts` + PagerDuty

#### Investigation Guide

**What it means**: More than 1 in 10 publish attempts are failing in the agents service. Failing at this layer means the archive was never created — the user's publish button produces no output.

**Step 1 — Find the failing error types**

```logql
{job="airo-agents", env="prod"}
  |= "\"event\":\"publish.flow.failure\""
  | json
  | __error__=""
  | line_format "{{.data_errorType}} | {{.app_id}}"
```

| `data.errorType` | Root cause | Action |
|---|---|---|
| `BuildError` | `npm run build` failed | Check build logs for the app — likely a code issue in the user's app |
| `PreviewNotRunningError` | Preview container is down | Check dev-supervisor health for that Nomad alloc |
| `MissingStartCommandError` | No start script in package.json | User's app is misconfigured |
| `SupervisorUnavailable` | Publish supervisor socket missing | Check Nomad job health — may need restart |
| `DeployError` | Supervisor rejected the archive | Check supervisor logs for the specific alloc |
| `TokenStale` | JWT was > 30s old when publish was triggered | Client-side timing issue, usually self-resolving |

**Step 2 — Determine if it's one app or many**

```logql
{job="airo-agents", env="prod"}
  |= "\"event\":\"publish.flow.failure\""
  | json
  | line_format "{{.app_id}}"
  | uniq
```
If it's one app → user's app issue. If many apps → infrastructure issue.

**Step 3 — For BuildError (most common)**

BuildErrors are usually not infrastructure problems — they mean the user's app won't compile. Verify:
```logql
{job="airo-agents", env="prod"}
  |= "\"app_id\":\"<app-id>\""
  |= "route.publish.default.build"
```
Look for the build output in the surrounding log context. No action needed unless the same app builds fail for all users (indicates a template regression).

**Step 4 — For infrastructure errors (Supervisor/Deploy/Preview)**

1. Check Nomad job status for affected app alloc
2. Look at dev-supervisor logs for the alloc
3. If multiple allocs are failing → check Nomad cluster health, disk space, memory
4. Restart affected Nomad jobs if isolated

**Step 5 — Check for recent deploys**

If failure spike correlates with a deploy time, check what shipped and consider rollback:
```bash
git log --oneline main..HEAD -- agents/src/server/routes/publish.ts
```

---

## Warning Alerts

### 4. Elevated Publish Latency

**Service**: Agents (Grafana)
**LogQL**:
```logql
quantile_over_time(0.95,
  {job="airo-agents", env="prod"}
  |= "\"event\":\"publish.flow.success\""
  | json
  | unwrap data_durationMs [20m]
) > 60000
```
**Threshold**: p95 > 60s over 20 min
**Actions**: Slack `#airo-builder-alerts`

#### Investigation Guide

**What it means**: Most publishes complete normally but the slowest 5% are taking over a minute. Not an outage — but a degraded experience for some users.

**Step 1 — Find the slow publishes**

```logql
{job="airo-agents", env="prod"}
  |= "\"event\":\"publish.flow.success\""
  | json
  | data_durationMs > 60000
  | line_format "{{.app_id}} | {{.data_durationMs}}ms | strategy={{.data_strategy}}"
```

**Step 2 — Check which phase is slow**

Look at the funnel logs between `publish.flow.start` and `publish.flow.success` for a slow app:
```logql
{job="airo-agents", env="prod"}
  |= "\"app_id\":\"<slow-app-id>\""
  |= "route.publish.default"
| json
| line_format "{{.event}} {{.__timestamp__}}"
```

Compare timestamps between `prepare_build.start` → `prepare_build.complete` vs `supervisor.begin` → `supervisor.success`. The gap identifies the slow phase.

**Step 3 — Common causes**

| Slow phase | Likely cause | Action |
|---|---|---|
| Build (prepare_build) | Large node_modules, slow npm install | Check bundle size, check npm registry latency |
| Archive creation | Large app codebase | No action — expected for large apps |
| Supervisor deploy | Health check timeout | Check if published app starts correctly |
| Git operations | Large git history | Check repo size for affected app |

**Step 4 — Check infrastructure resources**

If many apps are slow simultaneously:
- Check CPU/memory on Nomad nodes
- Check disk I/O on the alloc
- Check network latency between agents and publish supervisor socket

---

### 5. Increased Paywall Denials

**Service**: App/BFF (Kibana)
**KQL**: `event:(agent-token.paywall-check.denied OR paywall.eligibility.denied)`
**Threshold**: count > baseline × 1.5 over 15 min
**Actions**: Slack `#airo-builder-alerts`

#### Investigation Guide

**What it means**: More users are hitting the paywall than usual. May be normal (marketing campaign brought in free users) or a signal of a misconfiguration.

**Step 1 — Check denial reason distribution**

```
event:paywall.eligibility.denied OR event:paywall.eligibility.no-subscription
| stats count() by event
```

- Mostly `paywall.eligibility.no-subscription` → new user influx, normal
- Mostly `paywall.eligibility.denied` with `upgrade_required` → free tier users, normal
- Mostly `paywall.eligibility.denied` with `check_failed` → **technical issue**, investigate further

**Step 2 — If check_failed is dominant**

```
event:paywall.eligibility.check-failed
| stats count(), values(data.errorType) by @timestamp
```
A spike of `check_failed` means the paywall eligibility check itself is throwing — likely a downstream dependency issue. Check subscription API health (→ see Alert 1 guide).

**Step 3 — If publish limit denials are spiking**

```
event:paywall.eligibility.publish-limit-reached
| stats count() by data.plan, data.limit
```
If Starter users (limit=1) are all hitting their limit it may be normal saturation. If Ultimate users (limit=50) are hitting it, that's unexpected — check for a publish limit configuration issue.

**Step 4 — Cross-reference with subscriptions**

Check if affected users actually have paid subscriptions:
```
event:agent-token.paywall-check.denied AND NOT data.hasSubscription:true
```
If `hasSubscription:false` for all denials → these are free users, the alert is a false positive. Tune the threshold upward.

---

## Kibana Alert Setup (Step-by-step)

For each app/BFF alert above:

1. **Observability → Alerts → Create rule**
2. **Rule type**: Custom threshold
3. **Data view**: `.ds-logs-gdelastic.katana.app-*-ecs*`
4. Paste the KQL filter
5. Set threshold and time window
6. **Actions**: Add Slack connector → channel `#airo-builder-alerts` (non-prod: `#airo-builder-alerts-test`)
7. **Test query** before saving — confirm count returns a number (even 0 is fine)
8. Save to **non-prod first**, verify a test notification, then repeat for prod

---

## Grafana Alert Setup (Step-by-step)

For each agents alert above:

1. **Alerting → Alert rules → New alert rule**
2. **Data source**: Loki
3. Paste the LogQL expression
4. **Threshold**: set the `> value` condition
5. **Evaluation**: every 1m, for 5m (prevents flapping)
6. **Labels**: `env=prod`, `service=airo-agents`, `severity=critical`
7. **Contact point**: Slack `#airo-builder-alerts`
8. Save and test with **Evaluate now**

---

## Related Documentation

- [Publish Flow Observability](../observability/publish-flow.md) — Dashboard panels and log query reference
- [LOGGING-GUIDE.md](../../LOGGING-GUIDE.md) — Structured logging patterns
- [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs) — Direct Grafana/Kibana links per environment

## Revision History

| Date | Changes | Author |
|------|---------|--------|
| 2026-06-25 | Add investigation guides for each alert | Shubham Singh Talan |
| 2026-06-22 | Initial alert definitions | Shubham Singh Talan |
