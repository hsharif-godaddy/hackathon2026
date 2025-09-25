General on call operational info

- ServiceNow oncall group: **DEV-Airo-Builders**
- Contact information: Slack: **#airo-app-builder-dev**
- Alerts: **#airo-app-builder-dev-alerts**
- Service Tier: **Tier 1**

---
### Environments
https://pcp.int.gdcorp.tools/projects/8606/accounts

---
### Architecture overview

[Architecture](../ARCHITECTURE_DOCUMENTATION.md) 

---
### CICD workflows

| Workflow |Description | Triggers | 
| ------------- |:-------------:| -----:|
| Deploy Infra | Deploys main branch to the Dev-Private, Test or Prod environment from input choice| manual
|`aws-deploy-*.yaml` | builds the binary and deploys the container to the required aws account. | PRs to main, opened, synchronize, reopened, labeled

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
- Alerts channel: **#airo-app-builder-dev-alerts**
- CloudWatch overview dashboard: Login using ops role -> CloudWatch -> dashboard -> overview
  - RDS usage, scaling activity, ALB traffic (5xx, 4xx), Bedrock LLM usage
- CloudWatch alerts: Login using ops role -> CloudWatch -> Alarms -> All Alarms
  - HTTP status (5xx, 4xx, TPS) ALB alerts (missing data) (P0)
  - ECS Max autoscaling >90% utilization (P0) - Slack, BigPanda
  - Aurora RDS >80% capacity (ACU) utilized for 15 mins (P0)
  - Bedrock - 80% of max tokens per min utilization reached (P0)
- Kibana ESSP: Login to ESSP through PCP Logging Cluster, see APM dashboards 
  - Error counts - Token limits, tools operations errors alerts (P0)
  - Response time increase (Anomaly detection) alerts (P0)

NOTE : P0 alerts trigger Slack and BigPanda (oncall pager)

---
### Deployment Remediations
Deployment status is recorded via GitHub action workflows. All of the deployment workflows provide the option for manual deployment.

Should any deployment workflows fail, the logs are viewable using GitHub

To ensure the platform is functioning as intended, we have implemented the following monitoring mechanisms:

#### Monitoring Strategy

- **System Health Checks:** CloudWatch dashboards + ESSP APM monitor API response times, service availability, and error rates.
- **Operational Alerts:** Alarms are configured in CloudWatch + ESSP (with BigPanda) to detect failures.
- **Log Aggregation:** AWS CloudWatch + ESSP logs store all scan results, API interactions, and system events for debugging.
- **Metric Thresholds:** Key performance indicators (KPIs) such as request latency, error rates, and uptime are continuously monitored.

#### Remediation Process

- **Alert Triggered:** If a predefined threshold is breached (e.g., Request failures), an alert is sent to #airo-app-builder-dev-alerts.
- **Triage & Diagnosis:** On-call engineers investigate logs and dashboards to determine root causes.
- **Automated Recovery (if applicable):** Auto-scaling and self-healing mechanisms attempt to resolve common failures.
- **Manual Intervention:** If automation fails, engineers manually restart services, roll back deployments, or apply patches.
- **Post-Mortem Review:** A review is conducted to identify gaps and improve future monitoring and remediation.