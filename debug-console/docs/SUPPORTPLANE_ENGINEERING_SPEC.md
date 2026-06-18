# SupportPlane — Engineering Specification

**Version:** 1.0  
**Date:** 2026-06-16  
**Authors:** SupportPlane team  
**Status:** Active development

---

## 1. Overview

SupportPlane is an internal support intelligence platform embedded in the `debug-console` Next.js 14 app. It consolidates three data sources — L1 call transcripts, customer feedback (S3/Athena), and Jira support tickets — into a single authenticated dashboard with AI-powered NLP interfaces.

---

## 2. Architecture

### 2.1 Technology Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 App Router (`src/app/`) |
| Auth | GoDaddy SSO via `gd-auth` library; `validateApiAuth` / `withAuth` wrapper |
| Transcript DB | better-sqlite3 (synchronous) at `data/l1_transcripts.db` |
| Feedback DB | better-sqlite3 (synchronous) at `data/feedback_analytics.db` |
| Feedback ingest | AWS S3 (hyparquet) + Athena — hybrid two-phase |
| Tickets | Jira Cloud REST API v3 |
| Styling | CSS Modules (`sp.module.css`) with CSS variables; light/dark theme toggle |
| Charts | Inline SVG (no external chart library dependency in SupportPlane) |

### 2.2 Two-Database Design

#### L1 Transcripts DB — `data/l1_transcripts.db`

Managed by `src/lib/l1-transcript-db.ts`.

| Table | Purpose |
|---|---|
| `l1_transcripts` | One row per call transcript (interaction_id PK) |
| `l1_transcript_uploads` | Upload provenance tracking |

Key columns: `interaction_id`, `app_id`, `shopper_id`, `category`, `subcategory`, `sentiment_score`, `created_at`, `tags` (JSON), `full_transcript`, `resolution_time_seconds`.

Data arrives via:
- Manual XLSX upload through the `/api/supportplane/transcripts/upload` route
- Automatic SharePoint sync via `/api/supportplane/transcripts/sync-sharepoint`

#### Feedback Analytics DB — `data/feedback_analytics.db`

Managed by `src/lib/feedback-db.ts`.

| Table | Purpose |
|---|---|
| `feedback_raw` | One row per feedback submission (feedback_id PK) |
| `ingestion_log` | Tracks ingested S3 URLs and Athena months to prevent re-ingestion |
| `daily_stats` | Pre-computed daily aggregates for fast dashboard queries |

Key columns: `feedback_id`, `env`, `app_id`, `feedback_utc_ts`, `feedback_text`, `rating` (1-7), `feedback_category`, `feedback_topic_list` (comma-separated), `plan_type_name`, `feedback_origin_name`, `full_story_url`, `s3_url`.

### 2.3 Feedback Ingest — Two-Phase Hybrid

Managed by `src/lib/feedback-ingest.ts`.

**Phase 1 — Athena (complete months):**
- Queries `airo_builder_cln.airo_builder_feedback_cln` via AWS Athena
- Covers complete calendar months from `FEEDBACK_START_DATE` to start of current month
- Month keys stored in `ingestion_log` as `athena:{db}.{table}:{YYYY-MM}` for deduplication

**Phase 2 — S3 Parquet (recent/current days):**
- Lists S3 objects under Hive partition prefix: `s3://<bucket>/<table_prefix>/year=YYYY/month=MM/day=DD/hour=HH/appId=<id>/`
- Parses parquet files using `hyparquet` + `hyparquet-compressors`
- Individual S3 URLs stored in `ingestion_log` to skip already-processed files
- Both phases use `ON CONFLICT(feedback_id) DO NOTHING` for row-level dedup

**S3 Bucket Config:**

| Env | Bucket | Table Prefix |
|---|---|---|
| prod | `airo-builder-feedback-prod` | `airo_builder_feedback_cln` |
| dev | `airo-builder-feedback-dev` | `airo_builder_feedback_cln_laketest` |

**Athena Config:**

| Setting | Value |
|---|---|
| Database | `airo_builder_cln` |
| Table | `airo_builder_feedback_cln` |
| Output S3 | `S3_ATHENA_OUTPUT_BUCKET` env var |
| Workgroup | `primary` (default) |

---

## 3. Navigation Structure

```
SupportPlane
├── 📊 Dashboards
│   ├── L1 Transcripts Dashboard     (dash-transcripts)
│   ├── Feedback Intelligence        (dash-feedback)
│   └── Support Tickets              (dash-tickets)
│
├── 🎙 L1 Transcripts
│   ├── Browse                       (transcripts)
│   ├── Upload / Sync                (upload)
│   ├── Deep Dive Analysis           (analysis)
│   └── AI Chat                      (transcript-chat)
│
├── ⭐ Feedback (S3/Athena)
│   ├── Overview                     (feedback-overview)
│   ├── Trends (WoW/MoM)             (feedback-trends)
│   ├── Rating Analysis              (feedback-ratings)
│   ├── Topic Analysis               (feedback-topics)
│   ├── Browse Records               (feedback-browse)
│   └── AI Chat                      (feedback-chat)
│
├── 🎫 Support Tickets
│   ├── CIEC Board                   (ciec)
│   └── AABSP Board                  (aabsp)
│
└── 🔬 Deep Dives
    ├── Cannibalization              (cannibalization)
    └── Refund Audit                 (refund)
```

---

## 4. API Routes

### 4.1 Feedback Routes (`/api/supportplane/feedback/`)

| Route | Method | Description |
|---|---|---|
| `/summary` | GET | Total count, avg rating, sentiment split, ingestion status |
| `/trends` | GET | Time-series bucketed by `day\|week\|month` |
| `/ratings` | GET | Rating distribution (1-7) + category breakdown |
| `/topics` | GET | Top N topics + app leaderboard |
| `/heatmap` | GET | Hour-of-day or day-of-week patterns |
| `/comparison` | GET | Week-over-week and month-over-month deltas |
| `/browse` | GET | Paginated raw feedback with filters |
| `/sync` | POST | Trigger full S3+Athena ingestion |
| `/sync` | GET | Current ingestion status |

**Common Query Params:**
- `env` — `dev` or `prod` (defaults to `FEEDBACK_ENV` env var)
- `days` — lookback window (default varies by route)
- `app_id` — filter by specific app

### 4.2 Transcript Routes (`/api/supportplane/transcripts/`)

| Route | Method | Description |
|---|---|---|
| `/stats` | GET | KPIs, daily volume, top categories |
| `/browse` | GET | Paginated transcripts with filters |
| `/upload` | POST | Upload XLSX file |
| `/analytics` | GET | Analysis panels data |
| `/heatmap` | GET | Activity heatmap |
| `/flow` | GET | Issue flow/funnel data |
| `/filters` | GET | Available filter options |
| `/sharepoint` | GET | SharePoint file listing |
| `/sync-sharepoint` | POST | Trigger SharePoint sync |

### 4.3 Other Routes

| Route | Description |
|---|---|
| `/api/supportplane/jira?board=ciec\|aabsp` | Jira board tickets |
| `/api/supportplane/chat` | AI chat completions |

---

## 5. Authentication

All API routes use the `withAuth` wrapper from `src/lib/api-auth.ts`.

In production: validates GoDaddy SSO JWT via `gd-auth` library, checks `auth_jomax` cookie.

In development: set `DEV_AUTH_BYPASS=your@email.com` in `.env.local` to bypass SSO. The `validateApiAuth` function checks this at module load time and returns a synthetic user record, so no token extraction is attempted.

---

## 6. Environment Variables

### Required for Feedback Ingest

```bash
# Feedback database
FEEDBACK_DB_PATH=./data/feedback_analytics.db
FEEDBACK_ENV=dev                    # dev | prod
FEEDBACK_START_DATE=2026-04-01      # ISO date, ingestion cutoff

# AWS credentials (use one strategy)
AWS_PROFILE=your-sso-profile        # Named SSO profile (recommended)
# OR explicit keys:
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...               # If using temporary credentials
AWS_DEFAULT_REGION=us-west-2

# S3 feedback buckets
S3_FEEDBACK_BUCKET_PROD=airo-builder-feedback-prod
S3_FEEDBACK_BUCKET_DEV=airo-builder-feedback-dev
S3_FEEDBACK_TABLE_PREFIX_PROD=airo_builder_feedback_cln
S3_FEEDBACK_TABLE_PREFIX_DEV=airo_builder_feedback_cln_laketest

# Athena
ATHENA_DB=airo_builder_cln
ATHENA_TABLE=airo_builder_feedback_cln
ATHENA_OUTPUT_BUCKET=s3://your-athena-results-bucket/output/
```

### Required for L1 Transcripts

```bash
L1_TRANSCRIPTS_DB_PATH=./data/l1_transcripts.db   # Optional, defaults shown
```

### Required for Jira Integration

```bash
JIRA_BASE_URL=https://godaddy-corp.atlassian.net
JIRA_EMAIL=your@godaddy.com
JIRA_API_TOKEN=your-jira-api-token
```

### Development

```bash
DEV_AUTH_BYPASS=your@email.com     # Bypasses GoDaddy SSO in local dev
```

---

## 7. File Structure

```
debug-console/src/
├── app/
│   ├── supportplane/page.tsx               # Main SupportPlane page
│   └── api/supportplane/
│       ├── feedback/
│       │   ├── summary/route.ts
│       │   ├── trends/route.ts
│       │   ├── ratings/route.ts
│       │   ├── topics/route.ts
│       │   ├── heatmap/route.ts
│       │   ├── comparison/route.ts
│       │   ├── browse/route.ts
│       │   └── sync/route.ts
│       ├── transcripts/
│       │   ├── stats/route.ts
│       │   ├── browse/route.ts
│       │   ├── upload/route.ts
│       │   ├── analytics/route.ts
│       │   ├── heatmap/route.ts
│       │   ├── flow/route.ts
│       │   ├── filters/route.ts
│       │   ├── sharepoint/route.ts
│       │   └── sync-sharepoint/route.ts
│       └── jira/route.ts
│
├── components/supportplane/
│   ├── sp.module.css                        # All SupportPlane styles (CSS vars)
│   ├── types.ts                             # PanelId union, NavGroup, PANEL_LABELS
│   ├── Sidebar.tsx                          # Collapsible 5-section nav
│   ├── Header.tsx                           # Top bar with breadcrumb + theme toggle
│   ├── SPIcon.tsx                           # Brand icon
│   │
│   ├── # ── Dashboards ──────────────────────────────────
│   ├── TranscriptsDashboard.tsx
│   ├── FeedbackDashboard.tsx
│   ├── TicketsDashboard.tsx
│   │
│   ├── # ── L1 Transcripts ──────────────────────────────
│   ├── TranscriptsBrowsePanel.tsx
│   ├── UploadPanel.tsx
│   ├── AnalysisPanel.tsx
│   ├── TranscriptChatPanel.tsx
│   │
│   ├── # ── Feedback ─────────────────────────────────────
│   ├── FeedbackOverviewPanel.tsx
│   ├── FeedbackTrendsPanel.tsx
│   ├── FeedbackRatingsPanel.tsx
│   ├── FeedbackTopicsPanel.tsx
│   ├── FeedbackBrowsePanel.tsx
│   ├── FeedbackChatPanel.tsx
│   │
│   ├── # ── Support Tickets ─────────────────────────────
│   ├── CIECPanel.tsx
│   ├── AABSPPanel.tsx
│   │
│   └── # ── Deep Dives ──────────────────────────────────
│       ├── CannibalizationPanel.tsx
│       └── RefundAuditPanel.tsx
│
└── lib/
    ├── l1-transcript-db.ts                  # Transcript SQLite wrapper
    ├── feedback-db.ts                       # Feedback SQLite wrapper
    ├── feedback-ingest.ts                   # S3/Athena hybrid ingest
    ├── jira-client.ts                       # Jira REST client
    ├── api-auth.ts                          # Auth middleware (validateApiAuth, withAuth)
    └── logger.ts                            # Structured logger
```

---

## 8. Data Flows

### Feedback Ingestion Flow

```
[User clicks "Sync S3"]
  → POST /api/supportplane/feedback/sync
  → dynamic import feedback-ingest.ts (avoids loading AWS SDK on every request)
  → runFeedbackIngestion()
      ├── Phase 1: Athena
      │     ├── StartQueryExecution (monthly SQL)
      │     ├── Poll GetQueryExecution until SUCCEEDED
      │     └── Paginate GetQueryResults → INSERT INTO feedback_raw ON CONFLICT DO NOTHING
      │
      └── Phase 2: S3 Parquet
            ├── ListObjectsV2 with Hive prefix
            ├── Skip URLs already in ingestion_log
            ├── GetObject → buffer
            ├── asyncBufferFromBytes → parquetRead (hyparquet)
            └── INSERT INTO feedback_raw ON CONFLICT DO NOTHING
  → recomputeDailyStats()
  → return { newRows, errors, phases }
```

### Auth Flow (Local Dev)

```
[Browser request with DEV_AUTH_BYPASS set]
  → withAuth(handler)
  → validateApiAuth(request)
  → DEV_BYPASS_EMAIL != '' → return { authenticated: true, user: { email: DEV_BYPASS_EMAIL } }
  → handler called with synthetic user
```

### Auth Flow (Production)

```
[Browser request with auth_jomax cookie]
  → withAuth(handler)
  → validateApiAuth(request)
  → gdAuthService.extractTokenFromRequest → JWT
  → gdAuthService.verifyToken → claims
  → check AD group membership (if options.requireGroups set)
  → handler called with real user
```

---

## 9. Adding a New Panel

1. Add the panel ID to `PanelId` union in `types.ts`
2. Add a label to `PANEL_LABELS` in `types.ts`
3. Add a nav item to the appropriate `NAV_GROUPS` section in `Sidebar.tsx`
4. Create the component in `src/components/supportplane/`
5. Import and wire it in `src/app/supportplane/page.tsx`
6. (Optional) Add API routes under `src/app/api/supportplane/`

---

## 10. Known Limitations & Future Work

| Area | Current State | Future |
|---|---|---|
| AI Chat | Calls `/api/supportplane/chat` which must be configured | Wire to GoCaaS / Claude API |
| Feedback topics | String split on comma from `feedback_topic_list` column | NLP topic extraction pipeline |
| Transcript AI tagging | Async background tagging via `l1-transcript-ai-tagging.ts` | Auto-tag on upload completion |
| Real-time refresh | Manual "Refresh" button | WebSocket or SSE push |
| Feedback sentiment | Derived from rating (1-2=neg, 3-4=neu, 5-7=pos) | NLP sentiment scoring of free text |
| AABSP Jira board | Uses `AABSP` project key | Configure actual project key/filter |

---

## 11. Running Locally

```bash
# 1. Install dependencies
cd debug-console
pnpm install

# 2. Configure environment
cp .env.local.example .env.local
# Edit .env.local: set DEV_AUTH_BYPASS, AWS credentials, DB paths

# 3. Start dev server
pnpm dev   # Starts on :3443

# 4. Open SupportPlane
# http://localhost:3443/supportplane
```

**First-time feedback setup:**
1. Ensure AWS SSO is logged in: `aws sso login --profile your-profile`
2. Set `FEEDBACK_ENV`, `FEEDBACK_START_DATE`, and S3/Athena env vars
3. Navigate to Feedback > Overview and click **Sync S3**
4. Monitor progress in server logs; check `/api/supportplane/feedback/sync` (GET) for status

---

*Document maintained by the SupportPlane team. Update when architectural changes are made.*
