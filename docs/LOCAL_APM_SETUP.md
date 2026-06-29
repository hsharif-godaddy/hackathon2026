# Local Elastic APM Setup

This guide explains how to run a local Elastic APM stack for development and testing.

## Prerequisites

- Docker and Docker Compose installed

## Quick Start

### 1. Start the Elastic Stack

**Using pnpm:**

```bash
pnpm apm:start
```

**Or manually:**

```bash
docker compose -f docker-compose.apm.yml up -d
```

### 2. Verify Services

**Using pnpm:**

```bash
pnpm apm:status
```

**Or manually:**

```bash
docker compose -f docker-compose.apm.yml ps
```

Services available at:

- **Elasticsearch**: http://localhost:9200
- **Kibana**: http://localhost:5601
- **APM Server**: http://localhost:8200

### 3. Configure Environment Variables

Add to your `.env` file (in `agents/` directory):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8200
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <apm-secret-token>
OTEL_SERVICE_NAME=airo-agents
```

> **Note: Auth header format depends on which credentials you use.**
> The ESS/Elastic team provides two sets of credentials and the format differs:
>
> | Credential | Header format |
> |---|---|
> | `essp_apm_deployment` secret token | `Authorization=Bearer <secret-token>` |
> | `elastic_otel_credentials` | `Authorization=ApiKey <base64-value>` (use the full value as-is) |
>
> We currently use the APM secret token (`Bearer`), which matches production.
> If you use the OTel credentials instead and set `Bearer`, auth will fail — use the full
> `ApiKey ...` value from the credential exactly as supplied.
> See [this Slack thread](https://godaddy.slack.com/archives/C0B03JKRX09/p1782161392820439?thread_ts=1780613495.448979&cid=C0B03JKRX09) for background.

### 4. Start the Agents Server

```bash
pnpm dev
```

## Managing the Stack

### Stop the Stack

**Using pnpm:**

```bash
pnpm apm:stop
```

**Or manually:**

```bash
docker compose -f docker-compose.apm.yml down
```

### View Logs

**Using pnpm:**

```bash
pnpm apm:logs
```

**Or manually:**

```bash
docker compose -f docker-compose.apm.yml logs -f
```

### Remove All Data (Fresh Start)

> **Warning:** This will permanently delete all local APM data including traces, metrics, and logs.

**Using pnpm:**

```bash
pnpm apm:clean
```

**Or manually:**

```bash
docker compose -f docker-compose.apm.yml down -v
```

## Commands Reference

| pnpm Command      | Script Command                  | Description                 |
| ----------------- | ------------------------------- | --------------------------- |
| `pnpm apm:start`  | `./scripts/local-apm.sh start`  | Start the Elastic APM stack |
| `pnpm apm:stop`   | `./scripts/local-apm.sh stop`   | Stop the stack              |
| `pnpm apm:status` | `./scripts/local-apm.sh status` | Show container status       |
| `pnpm apm:logs`   | `./scripts/local-apm.sh logs`   | Follow all logs             |
| `pnpm apm:clean`  | `./scripts/local-apm.sh clean`  | Stop and remove all data    |

## Viewing APM Data in Kibana

1. Open Kibana at http://localhost:5601
2. Navigate to **Observability** → **APM** → **Services**
3. Select your service (e.g., `airo-agents`)

## Troubleshooting

### Container Won't Start on Apple Silicon

Ensure Rosetta 2 is installed:

```bash
softwareupdate --install-rosetta
```

### No Data in Kibana

1. Check APM server is receiving data:

   ```bash
   curl http://localhost:8200
   ```

2. Verify environment variables are set in `agents/.env`

3. Check agents server logs for APM initialization messages

### Connection Refused

Check container status and logs for errors.

## Architecture Notes

- Uses Elastic Stack **7.17.0** (standalone APM mode, no Fleet required)
  - This version was chosen for stability and simpler configuration (8.x requires Fleet/Agent which adds complexity)
- **Apple Silicon Note:** Runs via Rosetta 2 emulation (`linux/amd64`), which may have slight performance overhead
- APM Server configured with:
  - Secret token: `local-dev-token`
  - RUM (Real User Monitoring) enabled
  - CORS allows all origins for local development
- Data persists in Docker volume `elasticsearch-data`
