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
# Install dependencies (from repo root)
pnpm install && pnpm build

# Configure AWS credentials (required for SQLite database S3 sync)
aws configure  # or use IAM role / AWS_PROFILE

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

### SQLite Database Backups

The debug console uses SQLite databases that **sync with S3** — databases are never committed to git. On startup, the app downloads the latest backup from S3 if available. After any write operation, changes are uploaded back to S3 (debounced 30 seconds).

**Databases:**
- `data/support.db` — Jira AABSP/CIEC tickets
- `data/l1_transcripts.db` — Care team transcripts + AI tags
- `data/feedback_analytics.db` — Customer feedback aggregations

**Required environment variables:**

```bash
# S3 bucket for database backups (uses existing L1 transcripts bucket)
L1_TRANSCRIPTS_S3_BUCKET=airo-builder-l1-transcripts-dev

# AWS credentials (from IAM role or env vars)
AWS_REGION=us-west-2
L1_TRANSCRIPTS_S3_REGION=us-west-2
AWS_ACCESS_KEY_ID=...     # Only needed locally if not using IAM
AWS_SECRET_ACCESS_KEY=... # Only needed locally if not using IAM
```

**S3 structure:**
```
s3://airo-builder-l1-transcripts-dev/
  backups/
    └── support-plane/              # All support-plane databases
        ├── l1_transcripts/
        │   ├── 2026-06-17T04-33-25-764Z.db  # Timestamped backups
        │   ├── 2026-06-17T05-10-30-123Z.db
        │   └── 2026-06-17T06-45-15-456Z.db  # Latest used on restore
        ├── support/
        │   ├── 2026-06-17T04-33-25-764Z.db
        │   └── 2026-06-17T05-10-30-123Z.db
        └── feedback_analytics/
            ├── 2026-06-17T04-33-25-764Z.db
            └── 2026-06-17T05-10-30-123Z.db
```

**Backup behavior:**
- Every write → 30s debounce → new timestamped backup created
- Restore always downloads the **latest timestamped backup** for each database
- Version history preserved (cleanup can be automated with S3 lifecycle rules)

**Local development flow:**
1. Start app → `syncDb()` checks S3 for latest backup
2. Downloads if S3 is newer or local is missing
3. Opens SQLite connection with downloaded/existing database
4. Any write operation → schedules S3 upload (debounced 30s)

**Production deployment flow:**
1. New pod starts with empty `data/` directory
2. App initialization downloads latest backup from S3
3. Pod serves traffic with restored database
4. Write operations sync back to S3

**IAM permissions needed (production):**

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:PutObject",
    "s3:HeadObject"
  ],
  "Resource": "arn:aws:s3:::airo-builder-l1-transcripts-dev/backups/*"
}
```

**Testing the sync locally:**

```bash
# 1. Ensure AWS credentials configured
aws configure  # or use IAM role

# 2. Start debug console
pnpm --filter debug-console dev

# 3. Check logs for sync events
# Look for: db.backup.download.*, db.backup.upload.*

# 4. Verify S3 after making writes (wait 30s for debounce)
aws s3 ls s3://airo-builder-l1-transcripts-dev/backups/
```

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
