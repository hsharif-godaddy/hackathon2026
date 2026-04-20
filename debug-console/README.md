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
pnpm install

# Port 443 requires sudo on macOS/Linux
sudo -E pnpm dev
```

Open <https://dev-console.airo-builder.godaddy.com/>.

To run on a non-privileged port instead, set `PORT`:

```bash
PORT=3443 pnpm dev   # https://dev-console.airo-builder.godaddy.com:3443/
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
