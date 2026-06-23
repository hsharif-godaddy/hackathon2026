# SupportPlane Sequence Diagrams

This document provides sequence diagrams for key SupportPlane flows.

## 1. Transcript Upload Flow

```
┌──────┐       ┌────────┐       ┌────────────┐       ┌──────────┐       ┌─────────┐
│Client│       │Next.js │       │Upload API  │       │  XLSX    │       │DynamoDB │
│      │       │  UI    │       │Route       │       │ Parser   │       │         │
└──┬───┘       └───┬────┘       └─────┬──────┘       └────┬─────┘       └────┬────┘
   │                │                  │                   │                   │
   │ 1. Select XLSX │                  │                   │                   │
   │───────────────>│                  │                   │                   │
   │                │                  │                   │                   │
   │ 2. Upload file │                  │                   │                   │
   │───────────────>│                  │                   │                   │
   │                │                  │                   │                   │
   │                │ 3. POST /upload  │                   │                   │
   │                │─────────────────>│                   │                   │
   │                │                  │                   │                   │
   │                │                  │ 4. Parse XLSX    │                   │
   │                │                  │──────────────────>│                   │
   │                │                  │                   │                   │
   │                │                  │ 5. Rows (array)   │                   │
   │                │                  │<──────────────────│                   │
   │                │                  │                   │                   │
   │                │                  │ 6. Map columns →  │                   │
   │                │                  │    database schema│                   │
   │                │                  │    (combine tags, │                   │
   │                │                  │     derive fields)│                   │
   │                │                  │                   │                   │
   │                │                  │ 7. BatchWriteItem (25 items/batch)    │
   │                │                  │──────────────────────────────────────>│
   │                │                  │                   │                   │
   │                │                  │ 8. Success/Error  │                   │
   │                │                  │<──────────────────────────────────────│
   │                │                  │                   │                   │
   │                │                  │ 9. Log upload     │                   │
   │                │                  │    metadata to    │                   │
   │                │                  │    uploads table  │                   │
   │                │                  │──────────────────────────────────────>│
   │                │                  │                   │                   │
   │                │ 10. Response:    │                   │                   │
   │                │     {processed,  │                   │                   │
   │                │      skipped}    │                   │                   │
   │                │<─────────────────│                   │                   │
   │                │                  │                   │                   │
   │ 11. Invalidate │                  │                   │                   │
   │     cache      │                  │                   │                   │
   │<───────────────│                  │                   │                   │
   │                │                  │                   │                   │
   │ 12. Show       │                  │                   │                   │
   │     success    │                  │                   │                   │
   │<───────────────│                  │                   │                   │
```

## 2. Insights Generation Flow (Prompt-Driven)

```
┌──────┐   ┌────────┐   ┌─────────┐   ┌─────────┐   ┌────────┐   ┌─────────┐
│Client│   │Generate│   │Transcr. │   │ Claude  │   │Post-   │   │DynamoDB │
│      │   │API     │   │Fetcher  │   │ API     │   │Process │   │         │
└──┬───┘   └───┬────┘   └────┬────┘   └────┬────┘   └───┬────┘   └────┬────┘
   │            │             │             │            │             │
   │ 1. Click   │             │             │            │             │
   │   "Generate│             │             │            │             │
   │    Insights"│            │             │            │             │
   │───────────>│             │             │            │             │
   │            │             │             │            │             │
   │            │ 2. Query    │             │            │             │
   │            │    last 30  │             │            │             │
   │            │    days     │             │            │             │
   │            │────────────>│             │            │             │
   │            │             │             │            │             │
   │            │             │ 3. Query DynamoDB        │             │
   │            │             │    (date range filter)   │             │
   │            │             │─────────────────────────────────────>│
   │            │             │             │            │             │
   │            │             │ 4. Transcripts (array)   │             │
   │            │             │<─────────────────────────────────────│
   │            │             │             │            │             │
   │            │ 5. Batch    │             │            │             │
   │            │    (10-20)  │             │            │             │
   │            │<────────────│             │            │             │
   │            │             │             │            │             │
   │            │ 6. For each batch:        │            │             │
   │            │    ┌─────────────────────┐│            │             │
   │            │    │ Build prompt        ││            │             │
   │            │    │ (bug/feature/pattern││            │             │
   │            │    │  templates)         ││            │             │
   │            │    └─────────────────────┘│            │             │
   │            │             │             │            │             │
   │            │ 7. POST /messages         │            │             │
   │            │    (Claude API)           │            │             │
   │            │────────────────────────────>           │             │
   │            │             │             │            │             │
   │            │             │ 8. Structured JSON       │             │
   │            │             │    {bugs:[...],          │             │
   │            │             │     features:[...],      │             │
   │            │             │     patterns:[...]}      │             │
   │            │<────────────────────────────            │             │
   │            │             │             │            │             │
   │            │ 9. Post-process:          │            │             │
   │            │────────────────────────────────────────>│             │
   │            │    - Generate cluster_id  │            │             │
   │            │      (hash of top keywords)│           │             │
   │            │    - Calc business_impact_score       │             │
   │            │    - Assign categories    │            │             │
   │            │    - Set created_at       │            │             │
   │            │             │             │            │             │
   │            │             │             │ 10. Insights (array)      │
   │            │<────────────────────────────────────────│             │
   │            │             │             │            │             │
   │            │ 11. BatchWriteItem        │            │             │
   │            │    (insight_key, created_at)          │             │
   │            │───────────────────────────────────────────────────>│
   │            │             │             │            │             │
   │            │             │             │ 12. Success│             │
   │            │<───────────────────────────────────────────────────│
   │            │             │             │            │             │
   │ 13. Response:            │             │            │             │
   │     {bugs: N,            │             │            │             │
   │      features: M,        │             │            │             │
   │      patterns: P}        │             │            │             │
   │<───────────│             │             │            │             │
   │            │             │             │            │             │
   │ 14. Refresh│             │             │            │             │
   │     Insights│            │             │            │             │
   │     panel  │             │             │            │             │
   │<───────────│             │             │            │             │
```

## 3. Browse Transcripts with Caching

```
┌──────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│Client│   │Support  │   │Browse   │   │Insights │   │DynamoDB │
│      │   │Plane    │   │API      │   │Client   │   │         │
│      │   │Context  │   │Route    │   │(Cache)  │   │         │
└──┬───┘   └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
   │            │             │             │             │
   │ 1. Load    │             │             │             │
   │   Browse   │             │             │             │
   │───────────>│             │             │             │
   │            │             │             │             │
   │ 2. Check   │             │             │             │
   │    client  │             │             │             │
   │    cache   │             │             │             │
   │    (60s TTL)             │             │             │
   │            │             │             │             │
   │   ┌────────▼──────────┐  │             │             │
   │   │ Cache hit?        │  │             │             │
   │   │   ├─ YES: return │  │             │             │
   │   │   └─ NO: continue│  │             │             │
   │   └───────────────────┘  │             │             │
   │            │             │             │             │
   │            │ 3. GET      │             │             │
   │            │    /browse? │             │             │
   │            │    limit=50 │             │             │
   │            │────────────>│             │             │
   │            │             │             │             │
   │            │             │ 4. Check    │             │
   │            │             │    route    │             │
   │            │             │    cache    │             │
   │            │             │    (30s TTL)│             │
   │            │             │             │             │
   │            │             │   ┌─────────▼──────────┐  │
   │            │             │   │ Cache hit?        │  │
   │            │             │   │   ├─ YES: return │  │
   │            │             │   │   └─ NO: query   │  │
   │            │             │   └───────────────────┘  │
   │            │             │             │             │
   │            │             │ 5. Query DynamoDB         │
   │            │             │    (GSI: browseIndex)     │
   │            │             │────────────────────────>│
   │            │             │             │             │
   │            │             │ 6. Results  │             │
   │            │             │    (paginated)           │
   │            │             │<────────────────────────│
   │            │             │             │             │
   │            │             │ 7. Store in │             │
   │            │             │    route cache           │
   │            │             │─────────────>            │
   │            │             │             │             │
   │            │ 8. Response:│             │             │
   │            │    {transcripts,          │             │
   │            │     pagination}           │             │
   │            │<────────────│             │             │
   │            │             │             │             │
   │ 9. Store in│             │             │             │
   │    client  │             │             │             │
   │    cache   │             │             │             │
   │<───────────│             │             │             │
   │            │             │             │             │
   │ 10. Render │             │             │             │
   │     table  │             │             │             │
   │<───────────│             │             │             │
   │            │             │             │             │
   │ 11. Next   │             │             │             │
   │     page   │             │             │             │
   │     (same  │             │             │             │
   │      filters)            │             │             │
   │───────────>│             │             │             │
   │            │             │             │             │
   │ 12. Cache  │             │             │             │
   │     HIT    │             │             │             │
   │     (instant)            │             │             │
   │<───────────│             │             │             │
```

## 4. Tag Clustering Pipeline

```
┌──────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│Client│   │Tag      │   │Clustering│   │DynamoDB │   │ECharts  │
│      │   │Cluster  │   │Algorithm │   │         │   │Renderer │
│      │   │API      │   │          │   │         │   │         │
└──┬───┘   └────┬────┘   └────┬─────┘   └────┬────┘   └────┬────┘
   │            │             │             │             │
   │ 1. Load    │             │             │             │
   │   Dashboard│             │             │             │
   │───────────>│             │             │             │
   │            │             │             │             │
   │            │ 2. GET      │             │             │
   │            │    /tag-    │             │             │
   │            │     clusters│             │             │
   │            │────────────>│             │             │
   │            │             │             │             │
   │            │             │ 3. Query    │             │
   │            │             │    transcripts           │
   │            │             │    (last 30 days)        │
   │            │             │────────────>             │
   │            │             │             │             │
   │            │             │ 4. Transcripts + tags    │
   │            │             │<────────────             │
   │            │             │             │             │
   │            │             │ 5. Build tag│             │
   │            │             │    co-occurrence         │
   │            │             │    matrix   │             │
   │            │             │    ┌────────▼──────┐     │
   │            │             │    │ For each pair:│     │
   │            │             │    │  matrix[i][j]++│    │
   │            │             │    └────────────────┘    │
   │            │             │             │             │
   │            │             │ 6. PCA: reduce to 2D     │
   │            │             │    ┌────────▼──────┐     │
   │            │             │    │ Eigenvectors  │     │
   │            │             │    │ → (x, y) coords│    │
   │            │             │    └────────────────┘    │
   │            │             │             │             │
   │            │             │ 7. K-means (k=4)         │
   │            │             │    ┌────────▼──────┐     │
   │            │             │    │ Assign cluster│     │
   │            │             │    │ IDs to tags   │     │
   │            │             │    └────────────────┘    │
   │            │             │             │             │
   │            │             │ 8. Label clusters        │
   │            │             │    based on top          │
   │            │             │    keywords              │
   │            │             │    ┌────────▼──────┐     │
   │            │             │    │ Cluster 0:    │     │
   │            │             │    │  "Publishing" │     │
   │            │             │    │ Cluster 1:    │     │
   │            │             │    │  "UI/UX"      │     │
   │            │             │    │ ...           │     │
   │            │             │    └────────────────┘    │
   │            │             │             │             │
   │            │ 9. Response:│             │             │
   │            │    [{tag,   │             │             │
   │            │      x, y,  │             │             │
   │            │      cluster,│            │             │
   │            │      count}] │            │             │
   │            │<────────────│             │             │
   │            │             │             │             │
   │ 10. Render │             │             │             │
   │     ECharts│             │             │             │
   │     scatter│             │             │             │
   │────────────────────────────────────────────────────>│
   │            │             │             │             │
   │ 11. Interactive          │             │             │
   │     2D scatter           │             │             │
   │     (bubbles colored     │             │             │
   │      by cluster)         │             │             │
   │<────────────────────────────────────────────────────│
```

## 5. Feedback Sync (Two-Phase Hybrid)

```
┌──────┐   ┌─────────┐   ┌─────────┐   ┌────────┐   ┌─────────┐
│Client│   │Sync API │   │Athena   │   │S3       │   │DynamoDB │
│      │   │         │   │Client   │   │Parquet  │   │         │
└──┬───┘   └────┬────┘   └────┬────┘   └────┬───┘   └────┬────┘
   │            │             │             │             │
   │ 1. Click   │             │             │             │
   │   "Sync    │             │             │             │
   │    Feedback"│            │             │             │
   │───────────>│             │             │             │
   │            │             │             │             │
   │            │ PHASE 1: Athena (Historical)           │
   │            │             │             │             │
   │            │ 2. Check    │             │             │
   │            │    processed│             │             │
   │            │    months   │             │             │
   │            │────────────────────────────────────────>│
   │            │             │             │             │
   │            │ 3. Already  │             │             │
   │            │    processed│             │             │
   │            │    list     │             │             │
   │            │<────────────────────────────────────────│
   │            │             │             │             │
   │            │ 4. Build    │             │             │
   │            │    Athena   │             │             │
   │            │    query    │             │             │
   │            │    (skip    │             │             │
   │            │     processed│            │             │
   │            │     months) │             │             │
   │            │             │             │             │
   │            │ 5. Execute  │             │             │
   │            │    query    │             │             │
   │            │────────────>│             │             │
   │            │             │             │             │
   │            │             │ 6. Poll     │             │
   │            │             │    status   │             │
   │            │             │    (async)  │             │
   │            │             │             │             │
   │            │             │ 7. Query    │             │
   │            │             │    complete │             │
   │            │             │    → S3 CSV │             │
   │            │<────────────│             │             │
   │            │             │             │             │
   │            │ 8. Download │             │             │
   │            │    CSV →    │             │             │
   │            │    parse    │             │             │
   │            │             │             │             │
   │            │ 9. Batch    │             │             │
   │            │    write    │             │             │
   │            │────────────────────────────────────────>│
   │            │             │             │             │
   │            │ 10. Mark    │             │             │
   │            │     months  │             │             │
   │            │     processed│            │             │
   │            │────────────────────────────────────────>│
   │            │             │             │             │
   │            │ PHASE 2: S3 Parquet (Recent)           │
   │            │             │             │             │
   │            │ 11. List    │             │             │
   │            │     S3 files│             │             │
   │            │     (current│             │             │
   │            │      month) │             │             │
   │            │────────────────────────────>            │
   │            │             │             │             │
   │            │ 12. Files   │             │             │
   │            │     list    │             │             │
   │            │<────────────────────────────            │
   │            │             │             │             │
   │            │ 13. For each file:        │             │
   │            │     ┌───────▼──────────┐  │             │
   │            │     │ Check processed  │  │             │
   │            │     │ in feedbackIngest│  │             │
   │            │     └───────┬──────────┘  │             │
   │            │             │             │             │
   │            │ 14. Download│             │             │
   │            │     parquet │             │             │
   │            │────────────────────────────>            │
   │            │             │             │             │
   │            │ 15. Stream  │             │             │
   │            │     parquet │             │             │
   │            │     → JSON  │             │             │
   │            │<────────────────────────────            │
   │            │             │             │             │
   │            │ 16. Batch   │             │             │
   │            │     write   │             │             │
   │            │────────────────────────────────────────>│
   │            │             │             │             │
   │            │ 17. Mark    │             │             │
   │            │     file    │             │             │
   │            │     processed│            │             │
   │            │────────────────────────────────────────>│
   │            │             │             │             │
   │ 18. Response:            │             │             │
   │     {processed,          │             │             │
   │      skipped,            │             │             │
   │      total}              │             │             │
   │<───────────│             │             │             │
   │            │             │             │             │
   │ 19. Show   │             │             │             │
   │     stats  │             │             │             │
   │<───────────│             │             │             │
```

## 6. Insights Deduplication (Read-Time Collapse)

```
┌──────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│Client│   │Insights │   │Insights │   │DynamoDB │
│      │   │API      │   │Client   │   │         │
└──┬───┘   └────┬────┘   └────┬────┘   └────┬────┘
   │            │             │             │
   │ 1. Load    │             │             │
   │   Derived  │             │             │
   │   Insights │             │             │
   │───────────>│             │             │
   │            │             │             │
   │            │ 2. GET      │             │
   │            │    /insights│             │
   │            │    /bugs    │             │
   │            │────────────>│             │
   │            │             │             │
   │            │             │ 3. Query    │
   │            │             │    GSI1     │
   │            │             │    (insight_type=BUG)  │
   │            │             │────────────>             │
   │            │             │             │             │
   │            │             │ 4. ALL rows │             │
   │            │             │    for type │             │
   │            │             │    (multi-run│            │
   │            │             │     history) │            │
   │            │             │<────────────             │
   │            │             │             │             │
   │            │             │ 5. Dedupe:  │             │
   │            │             │    Group by │             │
   │            │             │    insight_key           │
   │            │             │    ┌─────────▼──────┐    │
   │            │             │    │ For each key:  │    │
   │            │             │    │   Keep row with│    │
   │            │             │    │   latest       │    │
   │            │             │    │   created_at   │    │
   │            │             │    └─────────────────┘   │
   │            │             │             │             │
   │            │             │ 6. Sort &   │             │
   │            │             │    limit    │             │
   │            │             │    (top N   │             │
   │            │             │     by impact)           │
   │            │             │             │             │
   │            │ 7. Response:│             │             │
   │            │    {bugs: [ │             │             │
   │            │      {insight_key,        │             │
   │            │       latest row}         │             │
   │            │    ]}       │             │             │
   │            │<────────────│             │             │
   │            │             │             │             │
   │ 8. Render  │             │             │             │
   │    cards   │             │             │             │
   │<───────────│             │             │             │
```

## Key Observations

### Caching Layers
1. **Client cache (60s TTL)** — Prevents refetch on tab switches
2. **Route cache (30s TTL)** — Reduces load on DynamoDB
3. **DynamoDB client cache (30s TTL)** — In-process Map-based

### Async Operations
- **Insights generation**: Background LLM calls (30-60s)
- **Feedback sync**: Two-phase with progress updates
- **Tag clustering**: Synchronous (< 1s)

### Data Integrity
- **Append-only insights** — Full history preserved, dedup on read
- **Ingestion tracking** — `feedbackIngest` table prevents duplicates
- **Batch writes** — 25 items per DynamoDB batch

See [CACHING.md](CACHING.md) for detailed caching architecture.
