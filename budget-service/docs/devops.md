# DevOps

For logs, dashboards, OpenTelemetry signals, see [Observability](observability.md).

## Katana (continuous deployment)

The budget-service is deployed via [Katana](https://tdl.gdcorp.tools/docs/products/compute/managed/katana/), GoDaddy's managed continuous deployment platform.

| Resource              | Link                                                                                                              |
|-----------------------|-------------------------------------------------------------------------------------------------------------------|
| **App environments**  | [budget-service on Katana](https://katana.int.gdcorp.tools/apps/airobuilde/budget-service)                        |
| **Artifacts**         | [budget-service artifacts](https://katana.int.gdcorp.tools/traffic/airobuilde/artifacts?search=budget-service)    |

### Deployments and rollbacks

1. Open the [budget-service environments page](https://katana.int.gdcorp.tools/apps/airobuilde/budget-service).
2. Select the target environment (dev, test, prod).
3. **Deploy:** promote an artifact from the [artifacts list](https://katana.int.gdcorp.tools/traffic/airobuilde/artifacts?search=budget-service).
4. **Rollback:** select a previous artifact version and redeploy it to the environment.

Refer to the [Katana docs](https://tdl.gdcorp.tools/docs/products/compute/managed/katana/) for details on deployment pipelines, canary strategies, and approval gates.

## Health checks

The service exposes `GET /health` (no auth). Katana uses this endpoint for liveness and readiness probes. The response includes database connectivity status.

## Incident response checklist

1. **Check dashboards** — look for error-rate spikes or latency changes in [Kibana](observability.md#dashboards-kibana).
2. **Check logs** — filter by `status>=500` or `level=error` in the appropriate Kibana environment.
3. **Check Katana** — confirm which artifact version is deployed; compare with the last known-good version.
4. **Rollback** — if a bad deploy is identified, redeploy the previous artifact via Katana.
5. **Check database** — verify Postgres connectivity and migration status (`schema_migrations` table).

## Environment promotion flow

```
main branch merge → artifact built → dev → test → prod
```

Each promotion step is visible on the Katana environments page. Artifacts flow forward through environments; rollbacks redeploy an older artifact to the target environment.
