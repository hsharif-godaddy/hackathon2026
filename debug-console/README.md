# Debug Console

A React-based debug console application for debugging apps.

## Development

The dev server runs on `https://local.console.airo-builder.dev-gdcorp.tools:3443/`
using a self-signed cert. You only need to do the host + cert setup once.

> **Note:** Local dev requires a valid GoDaddy SSO session — there is no
> auth-bypass mode. The `local.` prefix lets a future deployed
> `console.airo-builder.dev-gdcorp.tools` coexist with this `/etc/hosts` entry.

### 1. Map the hostname to localhost

Add the following line to `/etc/hosts`:

```
127.0.0.1 local.console.airo-builder.dev-gdcorp.tools
```

Quick one-liner (requires sudo):

```bash
echo "127.0.0.1 local.console.airo-builder.dev-gdcorp.tools" | sudo tee -a /etc/hosts
```

### 2. (Automatic) Local self-signed certificate

In local dev the server **self-generates** `certs/server.key` and
`certs/server.crt` on first run (via `openssl`), so you normally don't need to
do anything here. Override the paths with `SERVER_KEY_PATH` / `SERVER_CERT_PATH`,
or generate them by hand if `openssl` isn't on your `PATH`:

> Auto-generation only triggers when the files are **absent**. If you have an
> older cert that produces a browser warning (wrong hostname after a host
> migration, or expired), `rm -rf certs/` to force a fresh one on next start.

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout certs/server.key \
  -out certs/server.crt \
  -subj "/CN=local.console.airo-builder.dev-gdcorp.tools" \
  -addext "subjectAltName=DNS:local.console.airo-builder.dev-gdcorp.tools,DNS:localhost,IP:127.0.0.1"
```

(Optional) Trust the cert in macOS Keychain so the browser stops warning
(re-run after the cert is regenerated):

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain certs/server.crt
```

### 3. Install + run

```bash
# probably has to be run from the top-level repo since pnpm workspaces don't always filter env vars correctly when run from a package
pnpm install && pnpm build

# `pnpm dev` defaults to PORT=3443 (non-privileged) so no sudo is needed.
pnpm dev
```

Open <https://local.console.airo-builder.dev-gdcorp.tools:3443/>.

To run with Budget Service features (requires additional config):

```bash
# Will require AWS SSO login
aws sso login --profile airobuild-dev-private-sso

# Set these env vars (or set in .env.local for persistence)
export AWS_PROFILE=airobuild-dev-private-sso
export BUDGET_SERVICE_URL=https://budget-service.api.int.test-godaddy.com

# OR just set them inline for the dev server
AWS_PROFILE=airobuild-dev-private-sso BUDGET_SERVICE_URL=https://budget-service.api.int.test-godaddy.com pnpm dev
```

## Configuration

### Log Backends

Loki is the backend for the `airo-agents`, `airo-preview`, and `airo-publish` log sources and the analytics scheduler. Elasticsearch is still used for `airo-app` (Katana) and `control_plane` logs.

```bash
# Loki endpoint (via Grafana proxy) — REQUIRED
LOKI_ENDPOINT=https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd

# Grafana API key (create at: https://grafana.monitoring.gd3p.tools/org/serviceaccounts)
LOKI_API_KEY=glsa_...
```

If `LOKI_ENDPOINT` is missing, the Logs tab and analytics scheduler fail fast rather than silently returning empty results. Configure Loki before deploying.

**Create a Grafana service account token:** https://grafana.monitoring.gd3p.tools/org/serviceaccounts
