# Debug Console

A React-based debug console application for debugging apps.

## Development

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

## Configuration

### Loki Log Backend

The debug console supports Loki as an alternative log backend. Configure via environment variables:

```bash
# Loki endpoint (via Grafana proxy)
LOKI_ENDPOINT=https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd

# Grafana API key (create at: https://grafana.monitoring.gd3p.tools/org/serviceaccounts)
LOKI_API_KEY=glsa_...

# Comma-separated list of sources to query via Loki (leave empty for Elasticsearch)
LOKI_ENABLED_SOURCES=airo-agents,airo-preview,airo-publish
```

**Create a Grafana service account token:** https://grafana.monitoring.gd3p.tools/org/serviceaccounts

When `LOKI_ENABLED_SOURCES` is empty, all sources use Elasticsearch (default behavior).
