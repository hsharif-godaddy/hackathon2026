# SupportPlane Architecture

## Overview

Support Plane is a support intelligence platform built into debug-console that provides real-time analysis of L1 transcripts and customer feedback data through prompt-driven AI analysis.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client (Browser)                        │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Dashboard   │  │   Browse     │  │   Analysis   │         │
│  │              │  │              │  │              │         │
│  │ - KPIs       │  │ - Search     │  │ - Tag        │         │
│  │ - Trends     │  │ - Filter     │  │   Clusters   │         │
│  │ - Charts     │  │ - Pagination │  │ - Insights   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│                  SupportPlaneDataContext                        │
│                  (Client-side cache: 60s TTL)                   │
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Next.js API Routes (SSO Auth)                │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │   /transcripts   │  │    /insights     │  │   /feedback  │ │
│  │                  │  │                  │  │              │ │
│  │  - /browse       │  │  - /bugs         │  │  - /sync     │ │
│  │  - /upload       │  │  - /features     │  │  - /stats    │ │
│  │  - /stats        │  │  - /patterns     │  │  - /browse   │ │
│  │  - /tag-clusters │  │  - /generate     │  │              │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│              Route Cache (30s TTL per endpoint)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Business Logic Layer                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Prompt-Driven Analysis                  │   │
│  │                                                          │   │
│  │  Input: L1 transcripts (batch)                          │   │
│  │    ↓                                                     │   │
│  │  LLM Prompt Templates:                                  │   │
│  │    - Bug Detection Prompt                               │   │
│  │    - Feature Request Extraction                         │   │
│  │    - Pattern Analysis                                   │   │
│  │    ↓                                                     │   │
│  │  Claude API (via GoCode proxy)                          │   │
│  │    ↓                                                     │   │
│  │  Structured Output (JSON schema enforced)               │   │
│  │    ↓                                                     │   │
│  │  Post-processing:                                       │   │
│  │    - Cluster ID generation (dedupe)                     │   │
│  │    - Business impact scoring                            │   │
│  │    - Category assignment                                │   │
│  │    ↓                                                     │   │
│  │  Store in insights table                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │  DynamoDB Store  │  │  Insights Client │  │  Clustering  │ │
│  │  - dynamo-store  │  │  - insights-     │  │  - K-means   │ │
│  │  - Transaction   │  │    client        │  │  - PCA 2D    │ │
│  │    batching      │  │  - Query w/ GSI  │  │  - Tag co-   │ │
│  │                  │  │  - Dedup latest  │  │    occurrence│ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│                                                                 │
│              In-process cache (30s TTL, Map-based)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Data Layer (AWS)                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    DynamoDB Tables                        │  │
│  │                                                           │  │
│  │  transcripts (PK: interaction_id, SK: created_at)        │  │
│  │    └─ GSI: browseIndex (category, created_at)            │  │
│  │                                                           │  │
│  │  insights (PK: insight_key, SK: created_at)              │  │
│  │    └─ GSI1: insightTypeIndex (insight_type, last_seen)   │  │
│  │    └─ GSI2: productLineIndex (product_line, occur_count) │  │
│  │    └─ GSI3: impactScoreIndex (type, impact_score)        │  │
│  │                                                           │  │
│  │  feedback (PK: feedback_id)                              │  │
│  │    └─ GSI: feedbackByDate (date, rating)                 │  │
│  │                                                           │  │
│  │  feedbackIngest (PK: source_key)                         │  │
│  │    - Tracks processed S3 files/Athena months             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 S3 + Athena (Feedback)                    │  │
│  │                                                           │  │
│  │  Phase 1 (Historical):                                   │  │
│  │    Athena → airo_builder_feedback_cln                    │  │
│  │    (Complete months: 2024-01 through prev month)         │  │
│  │                                                           │  │
│  │  Phase 2 (Recent):                                       │  │
│  │    S3 Parquet → airo-builder-feedback-{env}              │  │
│  │    (Current month + recent days)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Prompt-Driven Analysis Pipeline

### 1. Data Ingestion

Transcripts enter the system through:
- **Manual XLSX upload** → `/api/supportplane/transcripts/upload`
- **SharePoint sync** → `/api/supportplane/transcripts/sync-sharepoint`

Each transcript is stored in DynamoDB with:
- Core fields: `interaction_id`, `shopper_id`, `customer_id`, `full_transcript`
- Metadata: `category`, `subcategory`, `agent_name`, `sentiment_score`
- AI-generated: `tags` (JSON), `conversation_summary`

### 2. Insights Generation (Prompt-Driven)

**Trigger:** User clicks "Generate Insights" or API call to `/api/supportplane/insights/generate`

**Process:**

```
1. Query transcripts from DynamoDB
   └─> Filter by date range (e.g., last 30 days)
   └─> Retrieve: interaction_id, full_transcript, tags, category

2. Batch transcripts (10-20 per batch for context efficiency)

3. For each batch:
   ┌─────────────────────────────────────────────┐
   │  Bug Detection Prompt                       │
   │  ─────────────────────────                  │
   │  "Analyze these transcripts and identify    │
   │   recurring bugs. For each bug:             │
   │   - Title: concise description              │
   │   - Description: detailed explanation       │
   │   - Occurrence count estimate               │
   │   - Severity (low/medium/high)              │
   │   - Product line affected                   │
   │   - Related tags from transcript            │
   │   - Sample transcript IDs                   │
   │   - Recommended action"                     │
   └─────────────────────────────────────────────┘
                    ↓
   ┌─────────────────────────────────────────────┐
   │  Claude API Call (via GoCode proxy)         │
   │  ─────────────────────────────              │
   │  Model: claude-sonnet-4-5                   │
   │  Structured output: JSON schema enforced    │
   │  Returns: { bugs: [...], features: [...],  │
   │           patterns: [...] }                 │
   └─────────────────────────────────────────────┘
                    ↓
   ┌─────────────────────────────────────────────┐
   │  Post-Processing                            │
   │  ─────────────────                          │
   │  - Generate cluster ID (hash of top 5      │
   │    keywords, sorted) for deduplication      │
   │  - Calculate business impact score:         │
   │    score = occurrence × (1-resolution_rate) │
   │           × preventable_rate × sentiment    │
   │  - Assign category based on tags            │
   │  - Set created_at = current timestamp       │
   └─────────────────────────────────────────────┘
                    ↓
4. Store insights in DynamoDB insights table
   └─> PK: insight_key = "BUG#<cluster_id>"
   └─> SK: created_at (ISO8601)
   └─> Each generation appends new row (history)

5. Deduplication on read:
   └─> Client fetches all rows for insight_type
   └─> Collapse to latest created_at per insight_key
   └─> Display only current aggregate per cluster
```

**Prompt Templates** (Simplified):

```javascript
// Bug Detection
const bugPrompt = `
Analyze these customer support transcripts and identify recurring bugs.

For each bug pattern found, return:
- insight_title: Concise bug description (50 chars)
- insight_description: Detailed explanation
- occurrence_count: Estimated frequency
- product_line: Which product is affected
- severity: low | medium | high
- recommended_action: How to fix
- related_tags: Tags from transcripts
- sample_transcript_ids: Up to 5 IDs

Transcripts:
${transcripts.map(t => `ID: ${t.id}\n${t.full_transcript}`).join('\n\n')}
`;

// Feature Request Extraction
const featurePrompt = `
Identify feature requests from these transcripts.

For each feature:
- insight_title: Feature name
- business_case: Why this adds value
- conversion_signal_rate: % showing purchase intent (0-1)
- sales_consultation_rate: % requesting sales help (0-1)
...
`;

// Pattern Analysis
const patternPrompt = `
Detect recurring support patterns (friction points, common questions).

For each pattern:
- pattern_category: e.g., "UI/UX", "Billing", "Publishing"
- trend: increasing | stable | decreasing
- top_preventative_actions: How to reduce volume
...
`;
```

### 3. Tag Clustering (Unsupervised ML)

**Trigger:** Load Dashboard → Tag Clusters visualization

**Algorithm:**

```
1. Fetch transcripts with tags (last 30 days)

2. Build tag co-occurrence matrix
   └─> For each transcript:
       └─> For each pair of tags (tag_i, tag_j):
           matrix[tag_i][tag_j] += 1

3. Apply PCA (Principal Component Analysis)
   └─> Reduce co-occurrence matrix to 2D
   └─> Each tag gets (x, y) coordinates

4. K-means clustering (k=4 clusters)
   └─> Assign cluster ID to each tag
   └─> Generate cluster labels:
       - "Publishing & Infrastructure"
       - "UI/UX & Design"
       - "AI & Content"
       - "Account & Access"

5. Return to client:
   └─> { tag, x, y, cluster, count, avgSentiment }

6. Client renders ECharts scatter plot
   └─> Bubble size = occurrence count
   └─> Color = cluster assignment
```

## Data Flow Diagrams

### Upload Flow

```
User uploads XLSX
    ↓
/api/supportplane/transcripts/upload
    ↓
Parse XLSX (xlsx library)
    ↓
Map columns → database schema
    └─> Combine columns 3-18 into tags JSON
    └─> Derive: sentiment_score, interaction_status
    ↓
Batch write to DynamoDB (25 items/batch)
    ↓
Invalidate client cache
    ↓
Return: { success, processed, skipped }
```

### Feedback Sync Flow (Two-Phase)

```
User clicks "Sync Feedback"
    ↓
/api/supportplane/feedback/sync
    ↓
Phase 1: Athena Historical
    ↓
Query complete months (2024-01 through prev month)
    └─> Skip months in feedbackIngest table
    ↓
Execute Athena query → S3 results
    ↓
Parse CSV results
    ↓
Batch write to feedback table
    └─> Mark month in feedbackIngest
    ↓
Phase 2: S3 Recent Parquet
    ↓
List S3 objects (current month + recent days)
    └─> Skip files in feedbackIngest table
    ↓
For each parquet file:
    └─> Stream parquet → JSON
    └─> Batch write to feedback table
    └─> Mark file in feedbackIngest
    ↓
Aggregate daily stats
    ↓
Return: { processed, skipped, total }
```

## Component Architecture

### Frontend Components

```
src/components/supportplane/
├── transcripts/
│   ├── Dashboard.tsx              # KPIs, charts, quick actions
│   ├── BrowsePanel.tsx            # Search, filter, pagination
│   ├── Calendar.tsx               # Date range picker
│   └── PatternSeverityChart.tsx   # Radar chart (patterns by category)
├── analysis/
│   ├── AnalysisPanel.tsx          # Main analysis view
│   ├── DerivedInsightsPanel.tsx   # Bugs/features/patterns cards
│   ├── InsightsVisualizations.tsx # Recharts (radar, scatter, heatmap)
│   └── TagClusterVisualization.tsx# ECharts 2D scatter (tag clusters)
└── feedback/
    └── FeedbackPanel.tsx          # Feedback stats & browse
```

### Backend API Routes

```
src/app/api/supportplane/
├── transcripts/
│   ├── browse/route.ts            # Paginated browse (GSI query)
│   ├── upload/route.ts            # XLSX upload handler
│   ├── stats/route.ts             # Dashboard KPIs
│   └── tag-clusters/route.ts      # Tag clustering endpoint
├── insights/
│   ├── bugs/route.ts              # Query bugs (GSI1)
│   ├── features/route.ts          # Query features (GSI1)
│   ├── patterns/route.ts          # Query patterns (GSI1)
│   └── generate/route.ts          # Trigger insights generation
└── feedback/
    ├── sync/route.ts              # Two-phase sync (Athena + S3)
    ├── stats/route.ts             # Feedback KPIs
    └── browse/route.ts            # Paginated feedback browse
```

### Data Access Layer

```
src/lib/supportplane/
├── store/
│   ├── dynamo-store.ts            # DynamoDB client wrapper
│   ├── insights-client.ts         # Insights table queries
│   ├── feedback-store.ts          # Feedback table queries
│   └── config.ts                  # AWS SDK config
├── db/                            # Legacy SQLite (being phased out)
│   ├── l1-transcript-db.ts
│   └── feedback-db.ts
└── ingest/
    ├── feedback-ingest.ts         # Two-phase ingest orchestrator
    └── feedback-s3.ts             # S3 parquet reader
```

## Key Design Decisions

### 1. Append-Only Insights

**Problem:** How to track insights over time while avoiding stale duplicates?

**Solution:**  
- Each insights generation run appends new rows (PK: `insight_key`, SK: `created_at`)
- Reads collapse to **latest row per `insight_key`** (dedup on client)
- `insight_key` is stable (derived from top keywords, sorted) to group identical clusters across runs

**Benefits:**
- Full history preserved
- No update conflicts
- Simple rollback (query older `created_at`)

### 2. Hybrid Feedback Ingestion

**Problem:** Athena queries are slow; S3 parquet parsing is fast but only works for recent data

**Solution:**  
- **Phase 1 (Athena):** Complete months (slow, runs once per month)
- **Phase 2 (S3 Parquet):** Current month + recent days (fast, runs frequently)
- `feedbackIngest` table tracks what's been processed

**Benefits:**
- Fast incremental syncs
- No duplicate rows
- Athena cost minimized

### 3. Clustering for Tag Visualization

**Problem:** 50+ tags are hard to visualize; users need grouping

**Solution:**  
- PCA reduces tag co-occurrence matrix to 2D
- K-means (k=4) assigns clusters
- Cluster labels assigned based on top keywords per cluster

**Benefits:**
- Intuitive grouping (e.g., "UI/UX", "Billing")
- No manual labeling required
- Reveals hidden patterns in support data

## Caching Strategy

See [CACHING.md](CACHING.md) for detailed caching architecture.

**Summary:**
- **Client:** `SupportPlaneDataContext` (60s TTL, section-gated)
- **API:** Route cache (30s TTL, Map-based)
- **Data:** DynamoDB client in-process cache (30s TTL)

## Security & Authentication

- **All routes:** GoDaddy SSO via `gd-auth` library
- **PII handling:** Shopper/customer IDs displayed; no names, emails, addresses
- **Data isolation:** No cross-env data leakage (table names include env suffix)

## Performance Characteristics

| Operation | Latency | Notes |
|---|---|---|
| Dashboard load | <500ms | KPIs pre-aggregated |
| Browse (paginated) | <200ms | GSI query + cache |
| Tag clusters | <1s | K-means on 50-100 tags |
| Insights generation | 30-60s | Batch LLM calls (10-20 transcripts/batch) |
| Feedback sync (Athena) | 10-30s | One-time per month |
| Feedback sync (S3) | 2-5s | Recent parquet only |

## Deployment

- **Environment:** Katana (internal cluster), behind GoDaddy SSO
- **CDK Stack:** `SupportplaneDynamoStack` (deploys DynamoDB tables)
- **Region:** us-west-2
- **Monitoring:** CloudWatch (DynamoDB metrics), Grafana (logs)

## Future Enhancements

- **Real-time sync:** WebSocket/SSE for live updates
- **Advanced ML:** Sentiment analysis on free-text feedback (not just ratings)
- **Deep Dive:** Cannibalization analysis, refund correlation
- **Auto-tagging:** Background job to tag new transcripts without manual trigger
