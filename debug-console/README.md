# Debug Console

Internal Next.js dashboard for the Airo Builder dev/support teams to inspect agent traces, app context, logs, and support intelligence.

## What is Debug Console?

**Debug Console** is an internal-only tool that provides:

1. **App Context Viewer** — Aggregates app metadata, subscriptions, Loki logs, Langfuse traces, and ES data
2. **Investigate Tool** — Triggered investigations that collect evidence and generate reports  
3. **SupportPlane** — Support intelligence platform for L1 transcripts, feedback analytics, and derived insights
4. **Logs** — Grafana Loki query interface for agent/preview/publish container logs
5. **Analytics** — Langfuse metrics, C1 data, feedback trends, and E2E test runs

## Audience & Operational Context

- **Users:** Airo Builder dev team (~100–200 engineers, 10-20 leaders)
- **Deployment:** Internal cluster behind GoDaddy SSO
- **SLAs:** 99% availability, Tier 3 service (no on-call, no PagerDuty)
- **Failure mode:** Support teams impacted when down

## SupportPlane Overview

**SupportPlane** is a real-time support intelligence platform that unifies:

- **L1 Transcripts** — Customer service call transcripts (uploaded XLSX or synced from SharePoint)
- **Feedback Intelligence** — Product ratings, bug reports, SOS requests from S3/Athena  
- **Derived Insights** — AI-generated bugs, features, and patterns from transcript analysis
- **Support Tickets** — CIEC + AABSP Jira board integration

### Key Capabilities

| Feature | Description |
|---|---|
| **Dashboard** | 30-second briefing: call volume, satisfaction scores, ticket counts, trends |
| **Browse** | Search and filter transcripts by date, category, agent, sentiment, tags |
| **Upload** | Manual XLSX upload or automatic SharePoint sync |
| **Analysis** | Tag clusters (2D visualization), derived insights (bugs/features/patterns) |
| **Chat** | Natural language queries over transcript data |
| **Feedback** | S3/Athena-powered feedback analytics with rating trends and topic analysis |

### Data Flow

```
L1 Transcripts (XLSX/SharePoint)
  └─> Upload API (/api/supportplane/transcripts/upload)
      └─> DynamoDB (l1_transcripts table)
          └─> Browse/Analysis/Chat panels

Feedback (S3 Parquet)
  └─> Sync API (/api/supportplane/feedback/sync)
      └─> DynamoDB (feedback table)
          └─> Feedback dashboard

AI Insights Generation  
  └─> Transcripts → Prompt-driven analysis (bugs/features/patterns)
      └─> DynamoDB (insights table)
          └─> Derived Insights panel
```

### L1 Transcript Column Mapping

CSV columns 3-18 (AI-generated tags already present) are combined into a structured JSON field:

```json
{
  "potential_preventative_action": "Clear in-product messaging...",
  "airo_product_line": "Airo AI Builder",
  "sub_intent": "Product Fit / Missing Feature",
  "friction_point": "Product bug or error",
  "customer_sentiment": "Neutral",
  "preventable_contact": "Yes"
}
```

Direct mappings: `interaction_id`, `shopper_id`, `customer_id`, `full_transcript`, `conversation_summary`

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for complete field mapping.

## Development

The dev server runs on `https://local.console.airo-builder.dev-gdcorp.tools:3443/` using a self-signed cert.

> **Note:** Local dev requires a valid GoDaddy SSO session — there is no auth-bypass mode.

### 1. Map the hostname to localhost

```bash
echo "127.0.0.1 local.console.airo-builder.dev-gdcorp.tools" | sudo tee -a /etc/hosts
```

### 2. Auto-generated self-signed certificate

The server **self-generates** `certs/server.key` and `certs/server.crt` on first run. To force regeneration:

```bash
rm -rf certs/
```

Optional: Trust the cert in macOS Keychain:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain certs/server.crt
```

### 3. Install + run

```bash
# From repo root
pnpm install && pnpm build

# Configure AWS credentials for DynamoDB
aws configure  # or use IAM role / AWS_PROFILE

# Start dev server
pnpm --filter debug-console dev
```

Open <https://local.console.airo-builder.dev-gdcorp.tools:3443/>

## Configuration

### DynamoDB Data Store

SupportPlane uses **DynamoDB** for persistent storage (deployed via `SupportplaneDynamoStack` in CDK).

**Tables:**
- `transcripts` — Care team transcripts + AI tags (GSI: `browseIndex`)
- `uploads` — Upload metadata
- `feedback` — Customer feedback from S3/Athena
- `feedbackIngest` — Ingestion tracking (prevents re-ingestion)
- `insights` — AI-generated insights (bugs/features/patterns)

**Required environment variables:**

```bash
AWS_REGION=us-west-2
NEXT_PUBLIC_DEPLOY_ENV=dev
SP_ENV=dev  # Table name suffix
```

**Deploy DynamoDB tables (local dev):**

```bash
cd cdk
pnpm cdk deploy SupportplaneDynamoStack --profile your-dev-profile
```

### Feedback Ingestion Pipeline

Two-phase hybrid pipeline:

1. **Phase 1 (Athena):** Complete calendar months from `airo_builder_feedback_cln` table
2. **Phase 2 (S3 Parquet):** Current month + recent days from S3 (bypasses Athena latency)
3. **Deduplication:** `feedbackIngest` table tracks processed files/months

**Required env vars:**

```bash
S3_FEEDBACK_BUCKET_DEV=airo-builder-feedback-dev
ATHENA_DATABASE=airo_builder_cln
ATHENA_TABLE=airo_builder_feedback_cln
ATHENA_OUTPUT_BUCKET=s3://your-athena-query-results/
```

### Log Backends

```bash
# Loki endpoint (via Grafana proxy) — REQUIRED
LOKI_ENDPOINT=https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd

# Grafana API key
LOKI_API_KEY=glsa_...
```

Create token at: <https://grafana.monitoring.gd3p.tools/org/serviceaccounts>

## Project Structure

```
debug-console/
├── src/
│   ├── app/
│   │   ├── api/                    # Next.js API routes
│   │   │   ├── supportplane/       # SupportPlane APIs
│   │   │   ├── app-context/        # App context aggregator
│   │   │   ├── investigate/        # Investigate tool
│   │   │   └── es-logs/            # Elasticsearch logs
│   │   ├── supportplane/           # SupportPlane UI
│   │   └── page.tsx                # Dashboard home
│   ├── components/
│   │   └── supportplane/           # SupportPlane components
│   │       ├── transcripts/        # L1 transcript panels
│   │       ├── analysis/           # Analysis & insights
│   │       └── feedback/           # Feedback intelligence
│   ├── lib/
│   │   ├── supportplane/           # SupportPlane business logic
│   │   │   ├── db/                 # SQLite clients (legacy)
│   │   │   ├── store/              # DynamoDB clients
│   │   │   └── ingest/             # Data ingestion
│   │   ├── loki-client.ts          # Loki query builder
│   │   └── api-auth.ts             # SSO auth wrapper
│   └── contexts/
│       └── SupportPlaneDataContext.tsx  # Client-side data cache
├── docs/                           # Architecture & technical docs
│   ├── ARCHITECTURE.md             # Architecture diagram & data flow
│   ├── SEQUENCE.md                 # Sequence diagrams
│   └── CACHING.md                  # Caching mechanisms
└── certs/                          # Auto-generated SSL certs
```

## Key Commands

```bash
pnpm --filter debug-console dev          # Local dev server
pnpm --filter debug-console typecheck    # Type checking
pnpm --filter debug-console test         # Unit tests
pnpm --filter debug-console lint         # Linting
```

## Architecture Highlights

- **Scalable cloud-native storage** — DynamoDB with GSIs for fast queries
- **Secure by default** — All routes require GoDaddy SSO; no customer PII leaves internal network
- **Hybrid data pipeline** — Athena for historical data + S3 parquet for recent data
- **Incremental sync** — Re-syncing only fetches new data
- **Multi-layer caching** — In-process caches (30-60s TTL) at API, client, and data layers

## Review Rigor

Apply pragmatic review per [CLAUDE.md](CLAUDE.md#review-rigor). Focus on correctness bugs, security issues, and genuinely confusing code. Skip nits on logger formats, exhaustive test coverage, and hypothetical-regression tests.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Service-specific conventions and review guidelines
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Architecture diagram and data flow
- [docs/SEQUENCE.md](docs/SEQUENCE.md) — Sequence diagrams for key flows  
- [docs/CACHING.md](docs/CACHING.md) — Caching strategy and mechanisms
- [docs/SUPPORT_PLANE_IMPLEMENTATION_TRACKER.md](docs/SUPPORT_PLANE_IMPLEMENTATION_TRACKER.md) — Implementation status

## Access

- **Local dev:** <https://local.console.airo-builder.dev-gdcorp.tools:3443/supportplane>
- **Deployed:** Internal Katana endpoint (SSO-protected)

## Tech Stack

- **Frontend:** Next.js 14 App Router, React, CSS Modules
- **Backend:** Next.js API routes, GoDaddy SSO auth
- **Storage:** DynamoDB (transcripts + insights), SQLite (legacy feedback analytics)
- **Data Sources:** AWS S3, Athena, Grafana Loki, Elasticsearch, Langfuse, Jira
- **Visualization:** Recharts, ECharts
