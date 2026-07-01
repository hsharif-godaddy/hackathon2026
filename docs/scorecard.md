# Instrumentation Scorecard

Internal analytics dashboard in debug-console that gives the team a real-time view of the Airo Builder user journey — from first prompt through build, publish, revenue, and quality signals.

---

## Local Setup

See [debug-console/README.md](../debug-console/README.md) for full dev setup (hostname mapping, cert trust, install, and run commands).

**Scorecard-specific:** BMP is the primary data source and requires a **prod SSO session**. Add the prod hostname in addition to the dev one:

```bash
echo "127.0.0.1 local.console.airo-builder.gdcorp.tools" | sudo tee -a /etc/hosts
```

Open `https://local.console.airo-builder.gdcorp.tools:3443/scorecard` and sign in with your GoDaddy SSO account. The dev hostname (`local.console.airo-builder.dev-gdcorp.tools`) works for all other data sources but BMP will show no data without a prod `auth_jomax` cookie.

### Scorecard Environment Variables

All set in `debug-console/.env.local`. Ask in `#airo-eng` for values.

| Variable             | Required | Description                                                      |
| -------------------- | -------- | ---------------------------------------------------------------- |
| `PDNA_ES_ENDPOINT`   | Optional | PDNA ES URL — enables paid units in Revenue tab                  |
| `PDNA_ES_API_KEY`    | Optional | PDNA ES API key                                                  |
| `FEEDBACK_S3_BUCKET` | Optional | S3 bucket for Parquet feedback data — enables numeric love score |
| `FEEDBACK_S3_PREFIX` | Optional | S3 prefix (default: `airo_builder_feedback_cln/`)                |
| `FEEDBACK_S3_REGION` | Optional | AWS region (default: `us-west-2`)                                |
| `LOKI_ENDPOINT`      | Optional | Loki URL — enables server-side publish outcomes and WS errors    |
| `LOKI_API_KEY`       | Optional | Loki API key (if required by the Loki instance)                  |
| `FULLSTORY_API_KEY`  | Optional | FullStory API key — enables Journey tab per-app session timeline |

Getting specific credentials:

- **BMP** — no env var needed. Sign in to the dashboard; `auth_jomax` cookie is forwarded automatically.
- **S3** — ask in `#airo-eng` for the bucket name. S3 uses the AWS SDK default credential chain — set credentials via `aws sso login`, env vars (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), or IAM role. No `AWS_PROFILE` env var needed by the scorecard itself.
- **Loki** — endpoint is `https://grafana.monitoring.gd3p.tools/api/datasources/proxy/uid/ff18mpwxpc7wgd`. Create a service account token at https://grafana.monitoring.gd3p.tools/org/serviceaccounts.
- **FullStory** — ask in `#airo-eng`.

---

## Data Sources

| Source         | System                                     | Env Var(s)                                                       | What it covers                                                              |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **BMP**        | `metric-api.bmp.api.int.godaddy.com`       | SSO session (auto — forwarded from `auth_jomax` cookie)          | Funnel events, feedback counts, engagement metrics (primary source)         |
| **PDNA ES**    | `airo-builder-provisioning-summary-prod-`* | `PDNA_ES_ENDPOINT`, `PDNA_ES_API_KEY`                            | Confirmed paid subscription counts per day by plan (authoritative KR1)     |
| **S3 Parquet** | Hive-partitioned Parquet files             | `FEEDBACK_S3_BUCKET`, `FEEDBACK_S3_PREFIX`, `FEEDBACK_S3_REGION` | Numeric love score (1–7 avg rating) from in-product feedback survey (KR2)  |
| **Loki**       | Grafana Loki                               | `LOKI_ENDPOINT`, `LOKI_API_KEY` (optional)                       | Server-side publish outcomes, WebSocket errors, failure categories          |
| **FullStory**  | FullStory MCP API                          | `FULLSTORY_API_KEY`                                              | Per-app session timeline — events, navigation, and outcomes for a given app |

### Why each source

**BMP (primary)** is the authoritative clickstream source for all user funnel events. All instrumentation events (`initial_build_started`, `publish_attempt`, `chat_start`, etc.) flow into BMP's `airo-instrumentation` namespace and are pre-aggregated by day/period. It covers everything except authoritative paid-unit counts and free-text feedback.

**PDNA ES** is the authoritative source for KR1 (paid units / day). BMP `purchase_success` is a supplementary signal; PDNA reflects actual provisioning state, not just frontend events.

**S3 Parquet** is the source for KR2 (love score ≥ 6.0). The in-product feedback survey writes 1–7 numeric ratings with free text to S3 as Hive-partitioned Parquet files. Read directly at query time — no intermediate pipeline.

**Loki** fills the gap for server-side outcomes not captured in clickstream: whether a publish container actually succeeded or failed, with structured failure reasons from the publish pipeline.

**FullStory** is used for exploratory and qualitative analysis — per-app session replay and cross-app event feeds. Not a primary KR data source.

---

## Scorecard Metrics

Based on the [Airo Task Metric Goal doc](./airo-task-metric-goal.md). Each metric is annotated with its data source.

### KRs

| KR | Metric | Data Source | Status |
| --- | --- | --- | --- |
| **KR1** | 1000 paid units / day | PDNA ES (`subscriptionsDailyByPlan`) | ✅ Live |
| **KR2** | Love it or leave it ≥ 6.0 | S3 Parquet (avg 1–7 score per app) | ✅ Live |

### Leading Indicators

#### Revenue (KR1)

| Metric | Data Source | Measure / Formula | Status |
| --- | --- | --- | --- |
| Task starts | BMP `website_core_events` | `initial_build_started` | ✅ Live |
| Initial build completion rate | BMP `website_core_events` | `initial_build_completed ÷ initial_build_started` | ✅ Live |
| Task completion rate | BMP `website_core_events` | `first_publish_success ÷ initial_build_started` | ✅ Live |
| Publish rate | BMP `website_core_events` | `(first_publish_success + republish_success) ÷ publish_attempt` | ✅ Live |
| Purchase conversion rate | BMP `paywall_conversion_events` | `purchase_success ÷ paywall_view` | ✅ Live |
| Paid units (supplementary) | BMP `paywall_conversion_events` | `purchase_success` + tier breakdown | ✅ Live |

> **Task completion rate vs Publish rate:** Task completion rate measures user funnel drop-off (did users who started a task ever publish?). Publish rate measures pipeline reliability (of the users who clicked Publish, how many succeeded?). A low publish rate at a high task completion rate points to a publish infrastructure problem, not user drop-off.

> **`initial_build_started` vs `generation_triggered`:** `initial_build_started` (`appbuilder.develop.initialbuild.start.impression`) fires exactly once — when the AI begins the very first website build for an app. `generation_triggered` fires for every subsequent generation (edits, rebuilds) and is no longer used as a task-start proxy. All "Task Starts" metrics across every view now use `initial_build_started`.

#### Quality / Satisfaction (KR2)

| Metric | Data Source | Measure / Formula | Status |
| --- | --- | --- | --- |
| Customer rating (love score) | S3 Parquet | Per-app avg 1–7 | ✅ Live |
| Failure/error rate (chat) | BMP `website_core_events` | `chat_failed ÷ chat_start` | ✅ Live |
| Failure/error rate (publish) | BMP `website_core_events` | `publish_failed ÷ publish_attempt` | ✅ Live |
| Time to task completion | BMP `time_to_completion` | `AVG/P50(durationMs)` | 🔧 Pending BMP registration |

### Diagnostics

| Metric | Data Source | Measure / Formula | Status |
| --- | --- | --- | --- |
| Funnel analysis (4-step) | BMP `website_core_events` | `initial_build_started` → `initial_build_completed` → `publish_attempt` → `first_publish_success` | ✅ Live |
| Onboarding Q&A drop-off | BMP `website_core_events` | `context_gathering_started` → `context_gathering_completed` (completion rate + abandon count) | ✅ Live |
| Initial build success rate | BMP `website_core_events` | `initial_build_completed ÷ initial_build_started` | ✅ Live |
| Top failures — publish | Loki + BMP | `publish_failed` count + `buildFailed`/`archiveFailed` log reasons | ✅ Live |
| Number of iterations / regenerations | BMP `website_core_events` | `rebuild_started`, `edit_triggered`, `chat_delete` | ✅ Live |
| Entry point + intent tracking | BMP `website_core_events` | `entry_point`, `intent_category` dimensions | ✅ Live |
| Thumbs up/down feedback rate | BMP `agent_feedback_count` | `positive_count ÷ total_count × 100` | ✅ Live |
| Free-text feedback + category breakdown | S3 Parquet | Raw text + positive / neutral / negative buckets | ✅ Live |
| Cross-session analysis | — | No cross-session identity stitching available | ❌ Not possible |

---

## Navigation Structure

The scorecard uses a collapsible left sidebar with four navigation groups:

### 📊 Analytics
| Page | Route key | Description |
| --- | --- | --- |
| **Overview** | `overview` | Core metrics grid (5-per-row), audience breakdown by `entry_point`/`plan_type`/`creation_source`/`intent`, funnel analysis, Q&A drop-off diagnostic |
| **Apps** | `appprovisioning` | App provisioning counts and growth trends |

### 💰 Revenue
| Page | Route key | Description |
| --- | --- | --- |
| **Overview** | `revenue` | Revenue summary — paywall hits, purchases, tier breakdown, PDNA paid units |
| **Funnel** | `revenuefunnel` | Full journey funnel with **free / paid / all** lens switcher. Steps: Task Starts → Initial Build → Publish Intent → Paywall → Purchase → Task Complete. Includes per-step drill-down by intent. |
| **Subscriptions** | `subscriptions` | Subscription lifecycle — new, cancelled, suspended, downgraded |

### ⭐ Feedback
| Page | Route key | Description |
| --- | --- | --- |
| **Overview** | `feedback` (sub: `overview`) | Love score summary, thumbs up/down rate, rating distribution |
| **Deep Dive** | `feedback` (sub: `deep-dive`) | Free-text comments with category + sentiment breakdown |

### 🔍 Journey
| Page | Route key | Description |
| --- | --- | --- |
| **Journey** | `journey` | Per-app FullStory session timeline — events, navigation, and outcomes |

---

## Overview Page Sections

### Core Metrics (5-per-row grid)
Ten stat/metric cards showing the most important numbers at a glance:

| Card | Source | Notes |
| --- | --- | --- |
| Task Starts | BMP `initial_build_started` | Entry to the AI build funnel |
| Initial Build Rate | BMP `initial_build_completed ÷ initial_build_started` | AI generation success rate |
| Task Completion | BMP `first_publish_success ÷ initial_build_started` | Full funnel conversion |
| Publish Rate | BMP publish success/attempt | Pipeline reliability |
| Chat Success | BMP `chat_complete ÷ chat_start` | Chat queue health |
| Paywall Hits | BMP `paywall_conversion_events` | Upgrade funnel entry |
| Purchases | BMP `purchase_success` | Supplementary to PDNA |
| Purchase Rate | BMP `purchase_success ÷ paywall_view` | Paywall conversion |
| Love Score | S3 Parquet | Avg 1–7 rating |
| Feedback Rate | BMP `agent_feedback_count` | Thumbs up/down engagement |

### Onboarding Q&A Drop-off (conditional)
Shown only when `context_gathering_started > 0`. Displays four cards:
- **Q&A Started** — `context_gathering_started` count
- **Q&A Completed** — `context_gathering_completed` count
- **Q&A Completion Rate** — `completed ÷ started` (green ≥ 80%, amber ≥ 60%)
- **Q&A Drop-off** — percentage and raw user count who abandoned before the AI build

### Funnel Analysis
4-step funnel starting at `initial_build_started` (Context Gathering is shown separately in Q&A Drop-off, not as a funnel step):

```
initial_build_started → initial_build_completed → publish_attempt → first_publish_success
```

Each step shows absolute count, conversion rate from previous step, and a `dropFromPrev` connector showing the drop percentage.

### Audience Breakdown
Dimension tables segmented by `entry_point`, `plan_type`, `creation_source`, and `intent_category`, each showing `initial_build_started` counts and publish completion rates per dimension value.

---

## Revenue Funnel Page — Lens Switcher

The Revenue Funnel page (`revenuefunnel`) has a **free / paid / all** lens:

| Lens | Data source | Description |
| --- | --- | --- |
| **all** | `websiteData` (no dimension) | Full population |
| **free** | `dimPlanTypeData` filtered `plan_type = 'free'` | Free-tier users only |
| **paid** | `dimPlanTypeData` filtered `plan_type ∈ {starter, professional, ultimate}` | Paying users only |

The dimension data (`dimPlanTypeData`) is fetched by the server-side route with measures `['initial_build_started', 'initial_build_completed', 'publish_attempt', 'first_publish_success']` and dimension `['plan_type']`.

Paywall and purchase metrics are always shown from the all-user paywall dataset (no plan-type split available at paywall time — users upgrade during that step).

`suspended_nonpayment` count is shown in the Subscriptions view and is retained in paywall data regardless of lens.

---

## Troubleshooting

**BMP data empty** → Sign in via the prod hostname (`local.console.airo-builder.gdcorp.tools`). BMP requires a prod `auth_jomax` cookie — dev hostname won't work.

**PDNA shows 0** → `PDNA_ES_ENDPOINT` or `PDNA_ES_API_KEY` not set. Ask in `#airo-eng`.

**S3 "not configured"** → `FEEDBACK_S3_BUCKET` missing. Ask in `#airo-eng`. Authenticate via `aws sso login` so the SDK default credential chain resolves.

**S3 shows `avgRating: null`** → No numeric ratings in the range. Try `30d` or `90d`.

**S3 shows `mergedTruncated: true`** → More than 2000 feedback items in the range. Narrow the date window.

**Feedback comments show "Failed to load comments: …"** → The comment fetch returned an error (HTTP non-200 or network failure). The message shown is the server-side error string or HTTP status code. Check `FEEDBACK_S3_BUCKET` config and AWS credentials.

**Loki data missing** → `LOKI_ENDPOINT` not set. See credentials section above.

**Journey tab shows 503** → `FULLSTORY_API_KEY` not configured. Add it to `.env.local` and restart.

**SSO redirect loop** → Check `/etc/hosts` has the hostname entry. Restart after any `.env.local` change.

**Free/paid lens shows 0 for task starts** → `initial_build_started` events include `plan_type` from the instrumentation context. If the context isn't set when the event fires (new user, no plan loaded yet), events go to the "unknown" bucket. Check that `setInstrumentationPlanType` is called before `activateInitialBuildFunnel` in the develop page lifecycle.

---

## Key Files

```
debug-console/src/
├── app/api/analytics/scorecard/
│   └── route.ts                        # All scorecard server-side actions (/api/analytics/scorecard)
│                                       # runBmpQuery() — fans out 7 BMP queries via Promise.allSettled
│                                       # SCORECARD_WEBSITE_CORE_MEASURES — full measure list for overview
│                                       # SCORECARD_WEBSITE_DIM_MEASURES — dimension query measures
│                                       #   ['initial_build_started', 'initial_build_completed',
│                                       #    'publish_attempt', 'first_publish_success']
│                                       # SCORECARD_PAYWALL_MEASURES — paywall/purchase measures
│                                       # actions: bmp, bmp-feedback, feedback-s3, pdna,
│                                       #          loki, datasource-status, c1-events, journey,
│                                       #          feedback-comments
├── app/scorecard/
│   ├── page.tsx                        # Scorecard root — sidebar + page router + range picker
│   ├── ScorecardSidebar.tsx            # Collapsible sidebar with Analytics/Revenue/Feedback/Journey groups
│   ├── types.ts                        # All scorecard types — ScorecardData, MetricValue, TabId, etc.
│   ├── hooks/
│   │   ├── useFetch.ts                 # Generic AbortController fetch hook (StrictMode-safe)
│   │   ├── useScorecardBmp.ts          # Single fetch → { bmp, website, dimEntryPoint,
│   │   │                               #   dimPlanType, dimCreationSource, dimIntent, paywall }
│   │   ├── useBmpData.ts               # BMP types (ScorecardBmpFeedbackData, BmpMetric, bmpVal)
│   │   │                               # WEBSITE_DIM_MEASURES constant (client-side ref)
│   │   ├── usePdnaData.ts              # PDNA paid units
│   │   ├── useLokiData.ts              # Loki publish + WS error data
│   │   ├── useS3Feedback.ts            # S3 Parquet numeric love score (action=feedback-s3)
│   │   └── useDatasourceStatus.ts      # Polls /api/analytics/scorecard?action=datasource-status
│   ├── components/
│   │   ├── FunnelBars.tsx              # Funnel renderer — steps + dropFromPrev connectors
│   │   ├── IntervalChart.tsx           # Time-series chart (ECharts)
│   │   ├── MetricCard.tsx              # Rate card with green/amber/red threshold colouring
│   │   ├── StatCard.tsx                # Simple count card (accent: default | premium | info)
│   │   ├── Section.tsx                 # Titled section wrapper
│   │   ├── Skeleton.tsx                # Loading skeletons
│   │   └── SessionTimeline.tsx         # FullStory session event renderer
│   └── pages/
│       ├── Overview.tsx                # Analytics > Overview — core metrics, Q&A drop-off,
│       │                               #   funnel analysis, audience breakdown
│       ├── AppProvisioning.tsx         # Analytics > Apps
│       ├── C1LiveFeed.tsx              # ClickHouse C1 live event feed
│       ├── Journey.tsx                 # Journey tab — FullStory per-app timeline
│       ├── feedback/
│       │   ├── Overview.tsx            # Feedback > Overview — love score + thumbs
│       │   ├── DeepDive.tsx            # Feedback > Deep Dive — free-text + categories
│       │   └── shared.tsx              # Shared feedback helpers
│       └── revenue/
│           ├── Overview.tsx            # Revenue > Overview — paywall, purchases, PDNA units
│           ├── Funnel.tsx              # Revenue > Funnel — journey funnel with free/paid/all lens
│           └── Subscriptions.tsx       # Revenue > Subscriptions — lifecycle metrics
└── lib/analytics/scorecard/
    ├── cache.ts                        # Scorecard-specific stale-while-revalidate cache (5 min TTL)
    ├── loki.ts                         # Loki query logic for scorecard
    ├── s3-feedback.ts                  # S3 Parquet aggregation
    ├── fs-journey.ts                   # FullStory MCP calls → AppJourneyData (per-app)
    └── fs-utils.ts                     # FullStory URL helpers
```

---

## Upcoming Instrumentation

Planned signals not yet wired to the scorecard. These are instrumentation gaps, not data pipeline gaps — the events either don't exist yet or are not registered in BMP.

### Logo Creation

Logo creation is a distinct JTBD in Airo Builder. Planned instrumentation:

- Task start / completion: logo generation triggered, logo accepted / regenerated / abandoned
- Iteration count: number of regenerations before acceptance
- Time to completion: first logo generation → accepted
- Task-level feedback: JTBD-specific prompt ("did the logo meet your needs")

*Data source: BMP `airo-instrumentation` once measures are registered.*

### Domain Setup

Domain setup is another distinct JTBD. Planned instrumentation:

- Task start: domain search initiated
- Task completion: domain connected / published with custom domain
- Drop-off point: where users abandon (search vs connect vs verify)
- Purchase conversion: domain purchase triggered from within the Airo Builder flow

*Data source: BMP `airo-instrumentation` once measures are registered.*

### Other Planned Signals

- **Time to task completion** — `AVG/P50(durationMs)` from `chat.queue.complete`; blocked on BMP `time_to_completion` metric registration
- **Structured failure reasons** — product-level failure categories (not raw technical codes) for publish and chat failures; requires a classification layer or structured enum from the agent
- **Per-asset feedback** — feedback tagged to the specific asset type (logo vs domain vs page section); requires product-side feedback flow changes
- **Task-level customer feedback** — JTBD-aware feedback prompt; current prompt is generic; requires both product and instrumentation changes
