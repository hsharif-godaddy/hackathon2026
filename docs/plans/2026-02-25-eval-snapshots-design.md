---
status: implemented
---

# Eval Snapshots Design

Manual evaluation system for site builds. Captures a screenshot and conversation data after the first initial build of a new app, stores it in S3, and provides a browsing UI in the debug console.

## Components

Four PRs, each independent after the S3 bucket is created:

1. CDK S3 bucket
2. Upload endpoint in app/
3. Client-side snapshot capture in app/
4. Debug console browsing page

## S3 Bucket (CDK)

New stack in `cdk/lib/` following the `ImageSearchStack` pattern.

- **Bucket name:** `airo-eval-snapshots-{envName}`
- **Key structure:**
  - `snapshots/{appId}/manifest.json`
  - `snapshots/{appId}/screenshot.png`
- **Config:** Versioning enabled, SSE-S3 encryption, public access blocked
- **Lifecycle:** Non-current versions to IA after 30 days, delete after 90 days
- **Access:** PowerUser role + GoCode assume role ARNs
- **Removal policy:** RETAIN in prod, DESTROY in dev

### Manifest Schema

```json
{
  "appId": "string",
  "timestamp": "ISO-8601",
  "initialPrompt": "string",
  "followUpQA": [{ "question": "string", "answer": "string" }],
  "metadata": {
    "templateVersion": "string",
    "model": "string"
  }
}
```

## Upload Endpoint (app/ backend)

- **Route:** `POST /api/eval-snapshots`
- **Auth:** Existing GD Auth middleware
- **Request body:** Multipart form data with `appId`, `screenshot` (PNG blob), `manifest` (JSON string)
- **Implementation:** AWS SDK v3 `PutObject` to the eval snapshots bucket. Bucket name from `EVAL_SNAPSHOTS_BUCKET` env var. IAM role provides S3 access.
- **Response:** `{ success: true, appId }`

No database writes. Simple passthrough to S3 with auth.

## Client-Side Snapshot Capture (app/ frontend)

### Trigger

After the first `STREAM_COMPLETE` event on a newly created app. Detect via session prompt count === 1 after completion. Only trigger once per app creation lifecycle.

### Screenshot Flow

1. First completion detected -> send `REQUEST_FULL_HEIGHT_SCREENSHOT` postMessage to preview iframe
2. Iframe captures full `document.body.scrollHeight` onto a canvas, posts data URL back
3. Parent collects manifest data (initial prompt + Q&A from conversation transcript)
4. POST to `/api/eval-snapshots`

### Iframe Capture

Enhance the existing postMessage handling in built apps. New handler renders full page height: canvas at `(viewportWidth, document.body.scrollHeight)`, captures entire document.

### Data Collection

- Initial prompt: first user message in conversation transcript
- Follow-up Q&A: agent questions + user answers between first message and build start
- App metadata: appId, timestamp from existing context

### Fire-and-Forget

Best-effort upload. Log warning on failure, never disrupt user experience.

## Debug Console Browsing Page

### Self-Contained Structure

All under `/snapshots` in the debug-console app:

- `src/app/snapshots/page.tsx` - page wrapper
- `src/app/snapshots/components/` - snapshot-specific components
- API routes under `src/app/api/snapshots/`

### API Routes

- `GET /api/snapshots` - Lists snapshots via S3 `ListObjectsV2`. Fetches manifests in parallel (paginated, 20 at a time). Sorted by timestamp newest first. Supports `?appId=` for direct lookup.
- `GET /api/snapshots/[appId]/screenshot` - Proxies screenshot PNG from S3.
- `GET /api/snapshots/random` - Returns a random snapshot manifest.

### UI

- **SnapshotList** - Paginated list/grid: appId, timestamp, truncated prompt. Click to view.
- **SnapshotDetail** - Screenshot image, initial prompt, Q&A exchanges, link to debug console filtered by appId, link to Langfuse traces.
- **AppId search bar** - Direct lookup.
- **Random button** - Load random snapshot for evaluation.

### Auth

Existing `ProtectedRoute` wrapper.

### Extraction

Only external dependencies are the shared auth wrapper and S3 bucket config env var. Everything else is self-contained under `/snapshots`.
