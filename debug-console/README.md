# Debug Console

A React-based debug console application for debugging apps.

## Development

The dev server runs on `https://dev-console.airo-builder.godaddy.com/` (port 443) using a
self-signed cert. You only need to do the host + cert setup once.

> **Note:** There is no NO-AUTH / auth-bypass mode. Even local dev requires a valid
> GoDaddy SSO session — the server validates the `auth_jomax` JWT via `gd-auth` and will
> redirect to SSO when no session is present. The HTTPS hostname above is required because
> SSO will only set `auth_jomax` on a `*.godaddy.com` domain.

### 1. Map the hostname to localhost

Add the following line to `/etc/hosts`:

```
127.0.0.1 dev-console.airo-builder.godaddy.com
```

Quick one-liner (requires sudo):

```bash
echo "127.0.0.1 dev-console.airo-builder.godaddy.com" | sudo tee -a /etc/hosts
```

### 2. Generate a local self-signed certificate

The server reads `certs/server.key` and `certs/server.crt` (override with
`SERVER_KEY_PATH` / `SERVER_CERT_PATH`). Generate them with:

```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout certs/server.key \
  -out certs/server.crt \
  -subj "/CN=dev-console.airo-builder.godaddy.com" \
  -addext "subjectAltName=DNS:dev-console.airo-builder.godaddy.com,DNS:localhost,IP:127.0.0.1"
```

(Optional) Trust the cert in macOS Keychain so the browser stops warning:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain certs/server.crt
```

### 3. Install + run

```bash
# probably has to be run from the top-level repo since pnpm workspaces don't always filter env vars correctly when run from a package
pnpm install && pnpm build

# Port 443 requires sudo on macOS/Linux
sudo -E pnpm dev
```

Open <https://dev-console.airo-builder.godaddy.com/>.

To run on a non-privileged port instead, set `PORT`:

```bash
PORT=3443 pnpm dev   # https://dev-console.airo-builder.godaddy.com:3443/
```

To run with Budget Service features (requires additional config):

```bash
# Will require AWS SSO login
aws sso login --profile airobuild-dev-private-sso

# Set these env vars (or set in .env.local for persistence)
export AWS_PROFILE=airobuild-dev-private-sso
export BUDGET_SERVICE_URL=https://budget-service.api.int.test-godaddy.com

# OR just set them inline for the dev server
AWS_PROFILE=airobuild-dev-private-sso BUDGET_SERVICE_URL=https://budget-service.api.int.test-godaddy.com pnpm dev

````

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
