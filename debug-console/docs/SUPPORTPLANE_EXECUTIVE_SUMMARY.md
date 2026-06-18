# SupportPlane — Executive Summary

**For:** VP of Engineering / CEO / Senior Leadership  
**Date:** June 2026  
**Prepared by:** Airo App Builder Support Intelligence Team

---

## What We Built

**SupportPlane** is a real-time support intelligence platform that gives the Airo App Builder team a single, unified view of everything happening across customer support — all in one screen, all the time.

Before SupportPlane, answering "How is support doing today?" required opening four separate tools, pulling data manually, and waiting for someone to compile it. Now it takes one click.

---

## The Business Problem We're Solving

The Airo App Builder support team handles thousands of interactions weekly across multiple channels:

- **L1 Call Transcripts** — customer service calls captured in SharePoint/S3
- **Product Feedback** — in-product ratings, bug reports, and SOS requests stored in AWS S3 and Athena
- **Engineering Tickets** — CIEC and AABSP Jira boards tracking support-driven issues

**The gap:** These data sources lived in silos. No one had a unified view of customer health, trend direction, or what was driving support volume. Decisions were made on gut feeling or delayed weekly reports.

---

## What SupportPlane Delivers

### 1. Three Top-Level Dashboards (30-second briefing for any leader)

| Dashboard | What it shows |
|---|---|
| **L1 Transcripts** | Call volume, top issue categories, resolution time trends, weekly vs. prior week |
| **Feedback Intelligence** | Customer satisfaction score (1-7 scale), sentiment split (positive/neutral/negative), rating trends over time, top complaint topics |
| **Support Tickets** | CIEC + AABSP combined open/in-progress/done counts, high-priority escalations |

### 2. Feedback Intelligence (S3/Athena powered)

Every piece of customer feedback — product ratings, bug reports, SOS support requests — is now pulled from production S3 data into a local analytics database and surfaced as:

- **Week-over-week and month-over-month trends** — is satisfaction improving or declining?
- **Rating distribution (1-7 scale)** — how many customers are rating 1-2 (very unhappy) vs. 5-7 (satisfied)?
- **Topic analysis** — which themes appear most in negative feedback? (e.g., "publishing", "domain", "billing")
- **App leaderboard** — which apps have the lowest satisfaction scores and highest complaint volume?
- **Browse** — drill into any individual feedback record; open FullStory session replays directly

### 3. AI Chat Interfaces

Each section has a natural language chat interface. A support lead can type:
- *"How many negative feedback items came in this week compared to last week?"*
- *"Which apps had the most billing-related complaints in June?"*
- *"What were the top 3 issues mentioned in low-rated feedback?"*

And get an instant answer — without writing SQL or waiting for a data team.

### 4. L1 Transcript Intelligence

- Upload XLSX transcript files manually or sync automatically from SharePoint
- Filter and search by date range, category, agent, sentiment
- View week-over-week and month-over-month trends in call volume and issue types
- Deep dive analysis with heatmaps, tag clouds, and funnel views

### 5. Support Ticket Boards (CIEC + AABSP)

Live views of both Jira boards, surfacing open tickets, high-priority escalations, and age-in-status — all without leaving the dashboard.

---

## Why This Matters

| Before | After |
|---|---|
| Support health check = 30 minutes across 4 tools | Support health check = 5 seconds |
| Feedback trends analyzed once a week (manually) | Feedback trends updated on-demand, synced from S3 |
| No visibility into which apps are driving complaints | Per-app leaderboard with satisfaction scores |
| NLP queries required SQL skills | Any team member can ask questions in plain English |
| Jira boards accessed separately | Unified ticket view alongside feedback and transcripts |

---

## Technical Highlights (for technical leaders)

- **Zero new infrastructure** — runs inside the existing `debug-console` internal tool; two local SQLite databases for sub-millisecond query response
- **Secure by default** — all routes require GoDaddy SSO authentication; no customer PII leaves the internal network
- **Hybrid data pipeline** — Athena queries for complete historical months + direct S3 parquet reads for recent data, with automatic deduplication
- **Incremental sync** — re-syncing only fetches new data; already-ingested files and months are skipped
- **AWS credential aware** — works with SSO named profiles; detects and reports expired credentials instead of silently returning empty data

---

## What's Next

| Priority | Feature | Timeline |
|---|---|---|
| High | Wire AI Chat to GoCaaS/Claude API for live DB queries | Q3 2026 |
| High | Auto-sync feedback from S3 on a schedule (cron) | Q3 2026 |
| Medium | NLP-based sentiment scoring of free-text feedback (vs. rating-only) | Q3 2026 |
| Medium | Deep Dive: Cannibalization analysis (which apps are driving customer-to-competitor churn) | Q3 2026 |
| Medium | Deep Dive: Refund Audit (correlation between feedback and refund events) | Q3 2026 |
| Low | Real-time push updates (WebSocket/SSE) vs. manual refresh | Q4 2026 |

---

## Note on Loom Video

A 3-5 minute walkthrough video should be recorded by a team member showing:
1. The three top-level dashboards (30-second overview)
2. Feedback Intelligence: syncing S3 data, rating distribution, WoW trends, topic analysis
3. Browsing raw feedback records and opening a FullStory session replay
4. Using the AI Chat to ask a natural language question
5. The CIEC and AABSP ticket boards

*Screen recording tools: Loom, Zoom, or QuickTime. Walk through each section using the left nav, highlighting the data, not the code.*

---

*SupportPlane is available internally at http://localhost:3443/supportplane (dev) and will be deployed via Katana to the internal debug-console endpoint for team-wide access.*
