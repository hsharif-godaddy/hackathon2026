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
Deployments to the production account will be manually created change orders in ServiceNow. The change orders are closed when the deployment completes successfully. Deployments to production will be performed manually after functional verification in the test environment.

Approval of the new functionality or bugfixes occur at the time the GitHub pull request is merged to the main branch.

---

### Monitoring
- Alerts channel: **#airo-app-builder-dev-alerts**
- CloudWatch overview dashboard: Login using ops role -> CloudWatch -> dashboard -> overview
- CloudWatch alerts: Login using ops role -> CloudWatch -> Alarms -> All Alarms
- Kibana ESSP: Login to ESSP through PCP Logging Cluster, see APM dashboards 

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

- **Alert Triggered:** If a predefined threshold is breached (e.g., Request failures), an alert is sent to #hfs-alerts.
- **Triage & Diagnosis:** On-call engineers investigate logs and dashboards to determine root causes.
- **Automated Recovery (if applicable):** Auto-scaling and self-healing mechanisms attempt to resolve common failures.
- **Manual Intervention:** If automation fails, engineers manually restart services, roll back deployments, or apply patches.
- **Post-Mortem Review:** A review is conducted to identify gaps and improve future monitoring and remediation.