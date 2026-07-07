General on call operational info

- ServiceNow oncall group: **DEV-Airo-Builders**
- Contact information: Slack: **#airo-ai-builder-dev**
- Alerts:
  - Dev + Test: **#airo-app-builder-dev-alerts**
  - Prod: **#airo-app-builder-prod-alerts**
- Service Tier: **Tier 1**

### Quick Reference

**CloudWatch Monitoring:**

- Dashboard: CloudWatch → Dashboards → `{env}-airo-builder-overview`
- Alarms: CloudWatch → Alarms → All Alarms
- Lambda Logs: CloudWatch Logs → `/aws/lambda/gd-sns-notify`

**Lambda Configuration:**

- Function: `gd-sns-notify`
- Environment Variable: `SLACK_WEBHOOK` (contains webhook URL)
- Logs: CloudWatch Logs → `/aws/lambda/gd-sns-notify`

**SNS Topics:**

- Dev: `airobuilde-dev-private-sns-to-slack-topic`
- Test: `airobuilde-test-private-sns-to-slack-topic`
- Prod: `airobuilde-prod-sns-to-slack-topic`

**CDK Deployment:**

```bash
cd cdk
ENV_NAME={env} cdk deploy MonitoringStack
```

---

### Environments

https://pcp.int.gdcorp.tools/projects/8606/accounts

---

### CICD workflows

| Workflow            |                                    Description                                     |                                            Triggers |
| ------------------- | :--------------------------------------------------------------------------------: | --------------------------------------------------: |
| Deploy Infra        | Deploys main branch to the Dev-Private, Test or Prod environment from input choice |                                              manual |
| `aws-deploy-*.yaml` |      builds the binary and deploys the container to the required aws account.      | PRs to main, opened, synchronize, reopened, labeled |

---

### Change Management

Airo Client App is hosted on AWS using Katana which automatically (out of the box) creates and closes a change order every time an artifact is deployed in production environment.

CDK/Infra changes before production deployment need manual CHG with lead approval. The change orders are closed when the deployment completes successfully. Deployments to production will be performed manually after functional verification in the test environment.

Approval of the new functionality or bugfixes occur at the time the GitHub pull request is merged to the main branch.

---

### DR/BCP

Hot/Warm pattern, that allows us to meet the target of 99.99% Uptime.

- Always deploy to 2 regions (us-west-2, us-east-1)
- Hot - primary region - us-west-2
- Warm - fallback region - us-east-1
- Aurora Serverless V2 Global Database (MySQL 8 engine) - a fully managed, multi-region database that automatically scales compute resources based on demand

Katana supports regional failover automatically. When you deploy to a multi-region environment, your application runs in all configured regions simultaneously. If one region experiences an outage, traffic is automatically routed to healthy regions through Katana's networking infrastructure.

Manual fault injections to test the failover to be performed as quarterly activity

---

### Monitoring

#### Alert Channels

- Dev + Test environments: **#airo-app-builder-dev-alerts**
- Prod environment: **#airo-app-builder-prod-alerts**
- All P0 alerts(Prod Env) route to: **Slack + BigPanda** (oncall pager)

#### CloudWatch Monitoring

**Overview Dashboard:** Login using ops role → CloudWatch → Dashboards → `{env}-airo-builder-overview`

- RDS usage, scaling activity, ALB traffic (5xx, 4xx), ECS metrics

**CloudWatch Alarms:** Login using ops role → CloudWatch → Alarms → All Alarms

**Alarm Infrastructure:**

- Alarms created using CDK `AlarmUtil` abstraction
- SNS topic ARN retrieved from AWS Systems Manager Parameter Store:
  - Parameter: `/AdminParams/SNS/AlarmNotificationTopic`
  - Contains environment-specific SNS topic ARN
  - Dev: `airobuilde-dev-private-sns-to-slack-topic`
  - Test: `airobuilde-test-private-sns-to-slack-topic`
  - Prod: `airobuilde-prod-sns-to-slack-topic`
- Lambda function: `gd-sns-notify` (managed externally, handles Slack notification formatting)
- Slack webhook URLs configured directly in Lambda environment variables

**Note:** SNS topics and Lambda function are **not** managed by CDK. They are pre-existing resources configured manually.

##### ALB (Application Load Balancer) Alarms

- **5xx Errors (P0)** - Backend service issues
  - Dev: >10 errors/5min | Test: >15/5min | Prod: >20/5min
  - Routes to: Slack, BigPanda
- **4xx Errors (P0)** - Client request issues
  - Dev: >50 errors/5min | Test: >75/5min | Prod: >100/5min
  - Routes to: Slack, BigPanda
- **High TPS (P0)** - Unusual traffic spike
  - Dev: >1000 req/min | Test: >1500/min | Prod: >5000/min
  - Routes to: Slack, BigPanda

##### ECS (Container Service) Alarms

- **High CPU (P0)** - CPU utilization >90% (1-minute check)
  - Routes to: Slack
- **High Memory (P0)** - Memory utilization >90% (1-minute check)
  - Routes to: Slack
- **Low Task Count (P0)** - Tasks running <2 (1-minute check)
  - Routes to: Slack

##### RDS (Database) Alarms

- **High ACU (P0)** - Serverless capacity >80% utilization for 15 mins
  - Routes to: Slack
- **High Connections (P0)** - Connection count exceeds threshold
  - Dev: >100 | Test: >200 | Prod: >300
  - Routes to: Slack
- **High CPU (P0)** - CPU utilization >80%
  - Routes to: Slack

Note: Storage monitoring not included as Aurora Serverless v2 auto-scales storage from 10GB to 128TB.

**Alert Flow:**

```
CloudWatch Alarm
  ↓
SNS Topic (environment-specific)
  ↓
gd-sns-notify Lambda Function (reads SLACK_WEBHOOK env var)
  ↓
Slack Channel (#airo-app-builder-{env}-alerts)
```

**Managing Slack Integration:**

- Webhook URL configured directly in Lambda environment variable
- To update webhook: Update Lambda environment variable `SLACK_WEBHOOK`
- No Secrets Manager involved

**Lambda Environment Variables (configured manually):**

```
SLACK_WEBHOOK=https://hooks.slack.com/services/T02BHKTRC/B09JPUFU5L3/...
SNS_BUCKET_NAME=sns-airobuilde-{env}-private-logs-us-west-2-{suffix}
```

**Managing SNS Topic Parameter Store:**

To update the SNS topic ARN used by CloudWatch alarms:

1. **View current value:**

   ```bash
   aws ssm get-parameter --name "/AdminParams/SNS/AlarmNotificationTopic" --region us-west-2
   ```

2. **Update SNS topic ARN:**

   ```bash
   aws ssm put-parameter \
     --name "/AdminParams/SNS/AlarmNotificationTopic" \
     --value "arn:aws:sns:us-west-2:{account-id}:your-topic-name" \
     --type "String" \
     --overwrite \
     --region us-west-2
   ```

3. **Redeploy monitoring stack** to pick up the new parameter value:
   ```bash
   cd cdk
   npx cdk deploy MonitoringStack --require-approval never
   ```

**Note:** Parameter Store values are looked up at CDK synthesis time. Changes require redeployment.

#### Site 24x7 Monitoring

**Heartbeat Monitoring** - Site availability checks

- Monitors application endpoint availability
- Checks service uptime and response
- Routes to: **Slack, BigPanda**
- Severity: **P0** (impacts uptime SLA)

#### ESSP APM + Grafana Loki Monitoring

Two observability stacks cover the platform:

- **APM metrics** live in the airobuilde ESSP cluster (Kibana APM dashboards).
  Access via AD group `GD-AWS-USA-CPO-AiroBuilde-ES-prod-ReadOnly` at
  https://airobuilde-prod-usw2.kb.us-west-2.aws.found.io:9243.
- **Customer app / agent / preview / publish logs** live in **Grafana Loki** (V2).
  The legacy pioneerc1 Elasticsearch cluster is deprecated. Direct links per
  service/env are in [Airo Builder Logs (Confluence)](https://godaddy-corp.atlassian.net/wiki/spaces/PAR/pages/3975512110/Airo+Builder+Logs).
  Required AD groups: `JOMAX\okta_lgtm-grafana_mwpv2_viewer`,
  `JOMAX\okta_observability_grafana`.

**Alert Rules (APM):**

- **APM Anomaly (P0)** - Detects anomalous behavior patterns
  - Routes to: Slack, BigPanda
- **APM Availability Burn Rate (P0)** - SLO burn rate monitoring
  - Routes to: Slack, BigPanda
- **Failed Transaction Rate Threshold - Overall (P0)** - Overall transaction failures
  - Routes to: Slack, BigPanda
- **Failed Transaction Rate Threshold - Per Transaction (P0)** - Individual transaction failures
  - Routes to: Slack, BigPanda
- **Error Counts (P0)** - Token limits, tools operations errors
  - Routes to: Slack, BigPanda
- **Response Time Increase (P0)** - Anomaly detection for latency
  - Routes to: Slack, BigPanda

**ESSP Dashboards:**

- Application Performance Monitoring (APM)
- Error tracking and analysis
- Transaction success/failure rates
- Response time metrics

---

### CloudWatch Alarm Management

#### Adding New Alarms

Alarms are managed via CDK using the `AlarmUtil` abstraction:

```typescript
import { AlarmUtil } from "./AlarmUtil";

AlarmUtil.createCloudWatchAlarm(
  this,
  "MyNewAlarm",
  myMetric,
  threshold,
  "P0: Description of what triggers this alarm",
);
```

Deploy changes:

```bash
cd cdk
ENV_NAME=dev cdk deploy MonitoringStack
```

#### Updating Slack Webhooks

To change Slack notification destinations:

1. **Update Lambda Environment Variable:**
   - Console: Lambda → `gd-sns-notify` → Configuration → Environment variables → Edit
   - Update the `SLACK_WEBHOOK` value with new webhook URL
   - CLI:
     ```bash
     aws lambda update-function-configuration \
       --function-name gd-sns-notify \
       --environment "Variables={
         SLACK_WEBHOOK=https://hooks.slack.com/services/NEW/WEBHOOK/URL,
         SNS_BUCKET_NAME=sns-airobuilde-{env}-private-logs-us-west-2-{suffix}
       }" \
       --region us-west-2
     ```

2. **No Lambda code changes or CDK deployments needed**

#### Troubleshooting Alerts

**Alarms not triggering:**

1. Check CloudWatch Alarm state (OK/ALARM/INSUFFICIENT_DATA)
2. Verify metric is publishing data
3. Check alarm threshold and evaluation periods

**Slack notifications not received:**

1. Check Lambda `gd-sns-notify` logs in CloudWatch Logs → `/aws/lambda/gd-sns-notify`
2. Verify SNS topic subscription is active (SNS Console → Topics → Subscriptions tab)
3. Check Lambda environment variable `SLACK_WEBHOOK` is set correctly:
   ```bash
   aws lambda get-function-configuration --function-name gd-sns-notify --region us-west-2
   ```
4. Test webhook URL manually:
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test message"}' \
     YOUR_WEBHOOK_URL
   ```
5. Verify Lambda has permission to be invoked by SNS (check Lambda resource policy)

**Lambda errors:**

1. CloudWatch Logs → `/aws/lambda/gd-sns-notify`
2. Common issues:
   - Environment variable missing: Check `SLACK_WEBHOOK` is set on Lambda
   - Invalid webhook URL: Verify the webhook URL format is correct
   - Webhook revoked: Check if Slack webhook has been disabled or deleted
   - SNS message format: Ensure Lambda code correctly parses SNS event structure
   - Network issues: Check VPC configuration if Lambda is in a VPC

---

### Alert Priority Definitions

- **P0 (Critical)** - Production impacting, requires immediate response
  - Routes to: Slack + BigPanda (pages oncall)
  - Response time: Immediate
- **P1 (Warning)** - Performance degradation, requires monitoring
  - Routes to: Slack only
  - Response time: Within 30 minutes

---

### Deployment Remediations

Deployment status is recorded via GitHub action workflows. All of the deployment workflows provide the option for manual deployment.

Should any deployment workflows fail, the logs are viewable using GitHub

To ensure the platform is functioning as intended, we have implemented the following monitoring mechanisms:

#### Monitoring Strategy

- **System Health Checks:** CloudWatch dashboards + ESSP APM monitor API response times, service availability, and error rates.
- **Operational Alerts:** Alarms are configured in CloudWatch using CDK + ESSP APM / Grafana (with BigPanda) to detect failures.
- **Log Aggregation:** AWS CloudWatch (infra) + Grafana Loki (customer app / agent / preview / publish containers) + airobuilde ESSP (Katana FOS) store system events for debugging. The pioneerc1 ES cluster is deprecated.
- **Metric Thresholds:** Key performance indicators (KPIs) such as request latency, error rates, and uptime are continuously monitored.
- **Alert Routing:** CloudWatch alarms → SNS topics → Lambda (`gd-sns-notify`) → Slack channels (webhook from env var)

#### Remediation Process

- **Alert Triggered:** If a predefined threshold is breached (e.g., Request failures), an alert is sent to #airo-app-builder-dev-alerts.
- **Triage & Diagnosis:** On-call engineers investigate logs and dashboards to determine root causes.
- **Automated Recovery (if applicable):** Auto-scaling and self-healing mechanisms attempt to resolve common failures.
- **Manual Intervention:** If automation fails, engineers manually restart services, roll back deployments, or apply patches.
- **Post-Mortem Review:** A review is conducted to identify gaps and improve future monitoring and remediation.
