---
status: implemented
---

# Eval Snapshots Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a manual evaluation system that captures screenshots and conversation data after initial site builds, stores them in S3, and provides a browsing UI in the debug console.

**Architecture:** Four independent PRs: (1) CDK S3 bucket, (2) app/ upload API, (3) app/ client-side capture, (4) debug-console browsing page. Each PR after #1 depends on the S3 bucket existing but can be developed in parallel.

**Tech Stack:** AWS CDK (S3), Next.js API routes, AWS SDK v3, html-to-image (existing in templates), React, postMessage API

---

## PR 1: CDK S3 Bucket

### Task 1: Create EvalSnapshotsStack

**Files:**

- Create: `cdk/lib/eval-snapshots-stack.ts`
- Modify: `cdk/app/main.ts:1-63`

**Step 1: Create the stack file**

Create `cdk/lib/eval-snapshots-stack.ts` following the exact pattern from `cdk/lib/image-search-stack.ts`:

```typescript
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
import config from "./config";

/**
 * Stack for Eval Snapshots infrastructure
 *
 * Creates S3 bucket for storing evaluation snapshots (screenshots + conversation data)
 * captured after initial site builds for manual quality review.
 */
export class EvalSnapshotsStack extends GDStack {
  public readonly snapshotsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    this.snapshotsBucket = new s3.Bucket(this, "EvalSnapshotsBucket", {
      bucketName: `airo-eval-snapshots-${config.envName}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          noncurrentVersionTransitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy:
        config.envName === "prod"
          ? cdk.RemovalPolicy.RETAIN
          : cdk.RemovalPolicy.DESTROY,
    });

    const accessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
      ],
      resources: [
        this.snapshotsBucket.bucketArn,
        `${this.snapshotsBucket.bucketArn}/*`,
      ],
      principals: [
        new iam.ArnPrincipal(
          `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`,
        ),
        ...config.gocodeAssumeRoleArns.map((arn) => new iam.ArnPrincipal(arn)),
      ],
    });

    this.snapshotsBucket.addToResourcePolicy(accessPolicy);

    new cdk.CfnOutput(this, "EvalSnapshotsBucketName", {
      value: this.snapshotsBucket.bucketName,
      description: "S3 bucket for storing evaluation snapshots",
      exportName: `${config.envName}-eval-snapshots-bucket-name`,
    });

    new cdk.CfnOutput(this, "EvalSnapshotsBucketArn", {
      value: this.snapshotsBucket.bucketArn,
      description: "ARN of the eval snapshots S3 bucket",
      exportName: `${config.envName}-eval-snapshots-bucket-arn`,
    });
  }
}
```

**Step 2: Register the stack in main.ts**

Add import and instantiation in `cdk/app/main.ts`:

```typescript
// Add import at top (after line 8):
import { EvalSnapshotsStack } from "../lib/eval-snapshots-stack";

// Add instantiation after ImageSearchStack (after line 46):
// Create Eval Snapshots infrastructure (S3 bucket for evaluation screenshots + data)
new EvalSnapshotsStack(app, "EvalSnapshotsStack", { env });
```

**Step 3: Verify CDK synthesis**

Run: `cd cdk && npx cdk synth EvalSnapshotsStack 2>&1 | head -50`
Expected: CloudFormation template with S3 bucket, IAM policy, and outputs

**Step 4: Commit**

```bash
git add cdk/lib/eval-snapshots-stack.ts cdk/app/main.ts
git commit -m "feat: add CDK stack for eval snapshots S3 bucket"
```

---

## PR 2: Upload Endpoint (app/ backend)

### Task 2: Add AWS SDK dependency

**Step 1: Install @aws-sdk/client-s3**

Run: `cd app && pnpm add @aws-sdk/client-s3`

**Step 2: Commit**

```bash
git add app/package.json pnpm-lock.yaml
git commit -m "feat: add AWS S3 SDK dependency for eval snapshots"
```

### Task 3: Create the upload API route

**Files:**

- Create: `app/src/app/api/eval-snapshots/route.ts`

**Reference files:**

- Auth pattern: `app/src/app/api/client-logs/route.ts` (POST handler with auth)
- Screenshot upload: `app/src/app/develop/[id]/page.tsx:388-423` (FormData pattern)

**Step 1: Create the API route**

Create `app/src/app/api/eval-snapshots/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { authenticateCustomer } from "@/lib/customer-auth";
import { logger } from "@/lib/request-context";

const BUCKET_NAME = process.env.EVAL_SNAPSHOTS_BUCKET;

function getS3Client() {
  return new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Require auth
    const authContext = await authenticateCustomer(request);
    if (!authContext.isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!BUCKET_NAME) {
      logger.error("eval-snapshots.upload.no-bucket", {
        message: "EVAL_SNAPSHOTS_BUCKET not configured",
      });
      return NextResponse.json(
        { error: "Eval snapshots not configured" },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const appId = formData.get("appId") as string;
    const screenshot = formData.get("screenshot") as File;
    const manifestJson = formData.get("manifest") as string;

    if (!appId || !screenshot || !manifestJson) {
      return NextResponse.json(
        { error: "Missing required fields: appId, screenshot, manifest" },
        { status: 400 },
      );
    }

    // Validate manifest JSON
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      return NextResponse.json(
        { error: "Invalid manifest JSON" },
        { status: 400 },
      );
    }

    const s3 = getS3Client();

    // Upload screenshot
    const screenshotBuffer = Buffer.from(await screenshot.arrayBuffer());
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `snapshots/${appId}/screenshot.png`,
        Body: screenshotBuffer,
        ContentType: "image/png",
      }),
    );

    // Upload manifest
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `snapshots/${appId}/manifest.json`,
        Body: JSON.stringify(manifest, null, 2),
        ContentType: "application/json",
      }),
    );

    logger.info("eval-snapshots.upload.success", { appId });

    return NextResponse.json({ success: true, appId });
  } catch (error) {
    logger.error("eval-snapshots.upload.failure", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

**Step 2: Add env var to app/.env.example and app/.env**

Add to `app/.env.example` (and your local `app/.env`):

```
EVAL_SNAPSHOTS_BUCKET=airo-eval-snapshots-dev
```

**Step 3: Verify the route compiles**

Run: `pnpm --filter website typecheck`
Expected: No new type errors

**Step 4: Commit**

```bash
git add app/src/app/api/eval-snapshots/route.ts app/.env.example
git commit -m "feat: add eval snapshots upload API endpoint"
```

---

## PR 3: Client-Side Snapshot Capture

### Task 4: Add full-height screenshot handler in app template

**Files:**

- Modify: `app-templates/v8/dev-tools/src/utils/screenshot.ts`
- Modify: `app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx:186-273`

**Reference files:**

- Existing screenshot: `app-templates/v8/dev-tools/src/utils/screenshot.ts` (uses `html-to-image` toPng)
- PostMessage handler: `app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx:186-273`

**Step 1: Add full-height capture function to screenshot.ts**

Add to `app-templates/v8/dev-tools/src/utils/screenshot.ts` after the existing `captureAndResizeScreenshot` function:

```typescript
/**
 * Captures a full-height screenshot of the entire document body
 * Used for eval snapshots - captures the full scrollable page, not just viewport
 *
 * @returns Promise resolving to a data URL of the full-height screenshot (PNG format)
 */
export async function captureFullHeightScreenshot(): Promise<string | null> {
  try {
    const fullCapture = await toPng(document.body, {
      quality: 0.95,
      cacheBust: true,
      skipAutoScale: true,
      pixelRatio: 1,
      // html-to-image captures the full element height by default
      // including content below the viewport fold
    });

    return fullCapture;
  } catch (error) {
    console.error("Failed to capture full-height screenshot:", error);
    return null;
  }
}
```

**Step 2: Add handler for REQUEST_FULL_HEIGHT_SCREENSHOT in DevelopmentMode.tsx**

In `app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx`, add import and handler:

Add to imports (line 5):

```typescript
import {
  captureAndResizeScreenshot,
  captureFullHeightScreenshot,
} from "../utils/screenshot";
```

(Replace existing import of just `captureAndResizeScreenshot`)

Add new `else if` block in the message handler (after the `REQUEST_SCREENSHOT` handler around line 240):

```typescript
    } else if (event.data && event.data.type === 'REQUEST_FULL_HEIGHT_SCREENSHOT') {
      captureFullHeightScreenshot().then(screenshot => {
        if (screenshot && window.parent !== window) {
          safePostMessage(window.parent, {
            type: 'FULL_HEIGHT_SCREENSHOT_RESPONSE',
            screenshot: screenshot
          })
        }
      }).catch((error) => {
        console.error('Full-height screenshot: Error capturing:', error)
      })
    }
```

**Step 3: Commit**

```bash
git add app-templates/v8/dev-tools/src/utils/screenshot.ts app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx
git commit -m "feat: add full-height screenshot capture in app template dev-tools"
```

### Task 5: Add eval snapshot capture logic in the develop page

**Files:**

- Create: `app/src/app/develop/hooks/useEvalSnapshotCapture.ts`
- Modify: `app/src/app/develop/[id]/page.tsx`

**Reference files:**

- CompleteHandler: `app/src/hooks/websocket/handlers/CompleteHandler.ts` (SESSION_PROMPT_COUNT_KEY pattern)
- Develop page message handler: `app/src/app/develop/[id]/page.tsx:600-684`
- Screenshot upload: `app/src/app/develop/[id]/page.tsx:388-423`
- PostMessage utils: `app/src/utils/postMessage.ts`
- Streaming store: `app/src/stores/useStreamingConversationStore.ts` (messages, getMessageCount)

**Step 1: Create the useEvalSnapshotCapture hook**

Create `app/src/app/develop/hooks/useEvalSnapshotCapture.ts`:

```typescript
import { useCallback, useRef } from "react";
import { postMessageToIframe } from "@/utils/postMessage";
import { useStreamingConversationStore } from "@/stores/useStreamingConversationStore";
import { logger } from "@/lib/request-context";
import { appFetch } from "@/lib/gasket-config";

const EVAL_SNAPSHOT_SENT_PREFIX = "airo_eval_snapshot_sent_";

interface EvalSnapshotCaptureOptions {
  appId: string | undefined;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

/**
 * Hook for capturing eval snapshots after the first build of a new app.
 *
 * Detects first STREAM_COMPLETE via session prompt count, requests a full-height
 * screenshot from the preview iframe, collects conversation data, and uploads
 * to the eval snapshots API. Fire-and-forget - never disrupts user experience.
 */
export function useEvalSnapshotCapture({
  appId,
  iframeRef,
}: EvalSnapshotCaptureOptions) {
  const captureRequestedRef = useRef(false);

  const hasAlreadyCaptured = useCallback((id: string) => {
    return (
      sessionStorage.getItem(`${EVAL_SNAPSHOT_SENT_PREFIX}${id}`) === "true"
    );
  }, []);

  const markCaptured = useCallback((id: string) => {
    sessionStorage.setItem(`${EVAL_SNAPSHOT_SENT_PREFIX}${id}`, "true");
  }, []);

  /**
   * Called after first STREAM_COMPLETE on a new app.
   * Requests full-height screenshot from iframe.
   */
  const triggerEvalSnapshot = useCallback(() => {
    if (!appId || captureRequestedRef.current || hasAlreadyCaptured(appId))
      return;

    // Check prompt count - only capture on first completion
    const countStr = sessionStorage.getItem("airo_session_prompt_count");
    const count = countStr ? parseInt(countStr, 10) : 0;
    if (count !== 1) return;

    captureRequestedRef.current = true;

    if (!iframeRef.current?.contentWindow) {
      logger.warn("eval-snapshot.no-iframe", { appId });
      return;
    }

    logger.info("eval-snapshot.requesting", { appId });

    // Delay to allow the preview to render after build completion
    setTimeout(() => {
      if (iframeRef.current?.contentWindow) {
        postMessageToIframe(iframeRef.current, {
          type: "REQUEST_FULL_HEIGHT_SCREENSHOT",
        });
      }
    }, 3000);
  }, [appId, iframeRef, hasAlreadyCaptured]);

  /**
   * Called when FULL_HEIGHT_SCREENSHOT_RESPONSE is received from iframe.
   * Collects conversation data and uploads snapshot.
   */
  const handleFullHeightScreenshot = useCallback(
    async (screenshotDataUrl: string) => {
      if (!appId || hasAlreadyCaptured(appId)) return;

      markCaptured(appId);

      logger.info("eval-snapshot.upload.start", { appId });

      try {
        // Collect conversation data for manifest
        const store = useStreamingConversationStore.getState();
        const messages = store.messages;

        // Extract initial prompt (first user message)
        const initialPrompt =
          messages.find((m) => m.role === "user")?.content || "";

        // Extract follow-up Q&A: all messages between first user message and the last message
        // Agent questions are assistant messages with question-like content
        // User answers are subsequent user messages
        const followUpQA: Array<{ question: string; answer: string }> = [];
        let foundFirstUser = false;
        let pendingQuestion: string | null = null;

        for (const msg of messages) {
          if (!foundFirstUser && msg.role === "user") {
            foundFirstUser = true;
            continue; // Skip the initial prompt
          }
          if (!foundFirstUser) continue;

          if (msg.role === "assistant" && msg.content) {
            pendingQuestion = msg.content;
          } else if (msg.role === "user" && pendingQuestion) {
            followUpQA.push({ question: pendingQuestion, answer: msg.content });
            pendingQuestion = null;
          }
        }

        const manifest = {
          appId,
          timestamp: new Date().toISOString(),
          initialPrompt,
          followUpQA,
          metadata: {
            templateVersion: "v8",
          },
        };

        // Convert data URL to Blob
        const response = await fetch(screenshotDataUrl);
        const blob = await response.blob();

        // Upload to eval snapshots API
        const formData = new FormData();
        formData.append("appId", appId);
        formData.append("screenshot", blob, "screenshot.png");
        formData.append("manifest", JSON.stringify(manifest));

        const uploadResponse = await appFetch("/api/eval-snapshots", {
          method: "POST",
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        logger.info("eval-snapshot.upload.success", { appId });
      } catch (error) {
        // Fire-and-forget - log but don't disrupt user
        logger.warn("eval-snapshot.upload.failure", {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [appId, hasAlreadyCaptured, markCaptured],
  );

  return {
    triggerEvalSnapshot,
    handleFullHeightScreenshot,
  };
}
```

**Step 2: Integrate the hook in the develop page**

In `app/src/app/develop/[id]/page.tsx`:

1. Add import near other hook imports at the top:

```typescript
import { useEvalSnapshotCapture } from "../hooks/useEvalSnapshotCapture";
```

2. Initialize the hook in the component (near other hook calls, after `iframeRef` is available). You'll need to find the iframeRef - it's in PreviewPane, so we need to pass via the message handler instead. The hook should be initialized with the appId and iframeRef from PreviewPane's context.

Actually, looking at the code more carefully: the message handler in page.tsx already listens for postMessages from the iframe (line 600-684). The `FULL_HEIGHT_SCREENSHOT_RESPONSE` can be handled there alongside `SCREENSHOT_RESPONSE`. And the trigger should fire when `STREAM_COMPLETE` happens.

In the develop page component, add the hook initialization:

```typescript
const { triggerEvalSnapshot, handleFullHeightScreenshot } =
  useEvalSnapshotCapture({
    appId,
    iframeRef: previewIframeRef, // Need to expose iframe ref from PreviewPane or use a shared ref
  });
```

Then in the message handler switch statement (around line 667), add a new case:

```typescript
        case 'FULL_HEIGHT_SCREENSHOT_RESPONSE':
          if (event.data.screenshot) {
            handleFullHeightScreenshot(event.data.screenshot)
          }
          break
```

For the trigger: subscribe to the `STREAM_COMPLETE` machine event. The simplest approach is to add a `useEffect` that watches for streaming state changes. When streaming goes from active to complete and prompt count is 1, trigger the snapshot.

Alternatively, add `triggerEvalSnapshot()` call in the `CompleteHandler.ts` after `incrementPromptCount()`. This is simpler:

In `app/src/hooks/websocket/handlers/CompleteHandler.ts`, after line 118 (`incrementPromptCount()`), add:

```typescript
// Trigger eval snapshot capture on first completion of a new app
window.dispatchEvent(new CustomEvent("eval-snapshot-trigger"));
```

Then in the develop page, add a useEffect to listen:

```typescript
useEffect(() => {
  const handler = () => triggerEvalSnapshot();
  window.addEventListener("eval-snapshot-trigger", handler);
  return () => window.removeEventListener("eval-snapshot-trigger", handler);
}, [triggerEvalSnapshot]);
```

**Note on iframeRef:** The PreviewPane component owns the iframe ref. To access it from the develop page, either:

- (a) Lift the ref up to the develop page and pass it down to PreviewPane
- (b) Use a custom event + the PreviewPane handles the screenshot request internally
- (c) Store the iframe ref in a module-level variable or store

Option (b) is cleanest - keep the screenshot request/response entirely within PreviewPane's message handler, and have the eval snapshot logic communicate via custom events. The hook would emit `eval-snapshot-trigger` and PreviewPane would handle the postMessage. Then PreviewPane emits `eval-snapshot-data` with the screenshot when it gets the response back.

The implementer should choose the approach that fits best with the existing code structure. The key files to modify are:

- `app/src/hooks/websocket/handlers/CompleteHandler.ts` - dispatch trigger event
- `app/src/app/develop/components/preview/PreviewPane.tsx` - handle REQUEST/RESPONSE postMessages
- `app/src/app/develop/[id]/page.tsx` - orchestrate data collection and upload
- Or a new hook file that encapsulates the logic

**Step 3: Verify compilation**

Run: `pnpm --filter website typecheck`
Expected: No new type errors

**Step 4: Commit**

```bash
git add app/src/app/develop/hooks/useEvalSnapshotCapture.ts app/src/app/develop/[id]/page.tsx app/src/hooks/websocket/handlers/CompleteHandler.ts app-templates/v8/dev-tools/src/utils/screenshot.ts app-templates/v8/dev-tools/src/components/DevelopmentMode.tsx
git commit -m "feat: capture eval snapshot on first build completion"
```

---

## PR 4: Debug Console Browsing Page

### Task 6: Add AWS SDK dependency to debug-console

**Step 1: Install @aws-sdk/client-s3**

Run: `cd debug-console && pnpm add @aws-sdk/client-s3`

**Step 2: Commit**

```bash
git add debug-console/package.json pnpm-lock.yaml
git commit -m "feat: add AWS S3 SDK dependency to debug-console"
```

### Task 7: Create snapshots API routes

**Files:**

- Create: `debug-console/src/app/api/snapshots/route.ts`
- Create: `debug-console/src/app/api/snapshots/[appId]/screenshot/route.ts`
- Create: `debug-console/src/app/api/snapshots/random/route.ts`
- Create: `debug-console/src/lib/snapshots-s3.ts`

**Reference files:**

- API auth pattern: `debug-console/src/lib/api-auth.ts` (withAuth wrapper)
- API route pattern: `debug-console/src/app/api/qa-results/route.ts`
- S3 bucket: `airo-eval-snapshots-{envName}`

**Step 1: Create S3 helper module**

Create `debug-console/src/lib/snapshots-s3.ts`:

```typescript
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const BUCKET_NAME = process.env.EVAL_SNAPSHOTS_BUCKET;

export interface SnapshotManifest {
  appId: string;
  timestamp: string;
  initialPrompt: string;
  followUpQA: Array<{ question: string; answer: string }>;
  metadata: {
    templateVersion?: string;
    model?: string;
  };
}

function getS3Client() {
  return new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
}

export function getBucketName(): string | undefined {
  return BUCKET_NAME;
}

/**
 * List all snapshot appIds from S3
 */
export async function listSnapshotAppIds(): Promise<string[]> {
  if (!BUCKET_NAME) return [];
  const s3 = getS3Client();
  const appIds: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: "snapshots/",
        Delimiter: "/",
        ContinuationToken: continuationToken,
      }),
    );

    for (const prefix of response.CommonPrefixes || []) {
      if (prefix.Prefix) {
        // Extract appId from "snapshots/{appId}/"
        const appId = prefix.Prefix.replace("snapshots/", "").replace("/", "");
        if (appId) appIds.push(appId);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return appIds;
}

/**
 * Fetch a manifest from S3
 */
export async function getManifest(
  appId: string,
): Promise<SnapshotManifest | null> {
  if (!BUCKET_NAME) return null;
  const s3 = getS3Client();

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `snapshots/${appId}/manifest.json`,
      }),
    );
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "NoSuchKey"
    )
      return null;
    throw error;
  }
}

/**
 * Get screenshot stream from S3
 */
export async function getScreenshotStream(appId: string) {
  if (!BUCKET_NAME) return null;
  const s3 = getS3Client();

  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: `snapshots/${appId}/screenshot.png`,
      }),
    );
    return response;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "NoSuchKey"
    )
      return null;
    throw error;
  }
}
```

**Step 2: Create list API route**

Create `debug-console/src/app/api/snapshots/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listSnapshotAppIds,
  getManifest,
  getBucketName,
} from "@/lib/snapshots-s3";

export const GET = withAuth(async (request: NextRequest) => {
  if (!getBucketName()) {
    return NextResponse.json(
      { error: "Eval snapshots not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const appIdFilter = searchParams.get("appId");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  // Direct lookup by appId
  if (appIdFilter) {
    const manifest = await getManifest(appIdFilter);
    if (!manifest) {
      return NextResponse.json({ snapshots: [], total: 0 });
    }
    return NextResponse.json({ snapshots: [manifest], total: 1 });
  }

  // List all snapshots
  const allAppIds = await listSnapshotAppIds();

  // Paginate
  const start = (page - 1) * limit;
  const pageAppIds = allAppIds.slice(start, start + limit);

  // Fetch manifests in parallel
  const manifests = await Promise.all(
    pageAppIds.map((appId) => getManifest(appId)),
  );
  const snapshots = manifests.filter(Boolean);

  // Sort by timestamp descending
  snapshots.sort(
    (a, b) =>
      new Date(b!.timestamp).getTime() - new Date(a!.timestamp).getTime(),
  );

  return NextResponse.json({
    snapshots,
    total: allAppIds.length,
    page,
    limit,
  });
});
```

**Step 3: Create screenshot proxy route**

Create `debug-console/src/app/api/snapshots/[appId]/screenshot/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import { getScreenshotStream, getBucketName } from "@/lib/snapshots-s3";

export const GET = withAuth<{ appId: string }>(
  async (request: NextRequest, context) => {
    if (!getBucketName()) {
      return NextResponse.json(
        { error: "Eval snapshots not configured" },
        { status: 503 },
      );
    }

    const { appId } = await context.params;

    const response = await getScreenshotStream(appId);
    if (!response || !response.Body) {
      return NextResponse.json(
        { error: "Screenshot not found" },
        { status: 404 },
      );
    }

    const bytes = await response.Body.transformToByteArray();

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
```

**Step 4: Create random snapshot route**

Create `debug-console/src/app/api/snapshots/random/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api-auth";
import {
  listSnapshotAppIds,
  getManifest,
  getBucketName,
} from "@/lib/snapshots-s3";

export const GET = withAuth(async (_request: NextRequest) => {
  if (!getBucketName()) {
    return NextResponse.json(
      { error: "Eval snapshots not configured" },
      { status: 503 },
    );
  }

  const allAppIds = await listSnapshotAppIds();
  if (allAppIds.length === 0) {
    return NextResponse.json({ error: "No snapshots found" }, { status: 404 });
  }

  const randomIndex = Math.floor(Math.random() * allAppIds.length);
  const manifest = await getManifest(allAppIds[randomIndex]);

  if (!manifest) {
    return NextResponse.json({ error: "Manifest not found" }, { status: 404 });
  }

  return NextResponse.json(manifest);
});
```

**Step 5: Add env var**

Add `EVAL_SNAPSHOTS_BUCKET=airo-eval-snapshots-dev` to debug-console `.env` / `.env.example`.

**Step 6: Commit**

```bash
git add debug-console/src/lib/snapshots-s3.ts debug-console/src/app/api/snapshots/
git commit -m "feat: add eval snapshots API routes to debug console"
```

### Task 8: Create snapshots browsing UI

**Files:**

- Create: `debug-console/src/app/snapshots/page.tsx`
- Create: `debug-console/src/app/snapshots/components/SnapshotsBrowser.tsx`

**Reference files:**

- Page pattern: `debug-console/src/app/page.tsx` (ProtectedRoute wrapper)
- Component pattern: `debug-console/src/components/QAResultsPanel.tsx` (fetch + state + detail view)
- Dashboard: `debug-console/src/pages/Dashboard.tsx` (URL params, navigation, inline styles)
- Styling: All inline CSS, color palette: grays (#1e293b, #64748b, #94a3b8), blues (#3b82f6)

**Step 1: Create the page wrapper**

Create `debug-console/src/app/snapshots/page.tsx`:

```typescript
'use client'

import ProtectedRoute from '@/components/ProtectedRoute'
import SnapshotsBrowser from './components/SnapshotsBrowser'

export default function SnapshotsPage() {
  return (
    <ProtectedRoute>
      <SnapshotsBrowser />
    </ProtectedRoute>
  )
}
```

**Step 2: Create the SnapshotsBrowser component**

Create `debug-console/src/app/snapshots/components/SnapshotsBrowser.tsx`:

This is a self-contained component with:

- List view with pagination
- Detail view with screenshot, prompt, Q&A
- AppId search
- Random snapshot button
- Link to debug console `/?appId={appId}`

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

interface SnapshotManifest {
  appId: string
  timestamp: string
  initialPrompt: string
  followUpQA: Array<{ question: string; answer: string }>
  metadata: {
    templateVersion?: string
    model?: string
  }
}

interface SnapshotListResponse {
  snapshots: SnapshotManifest[]
  total: number
  page: number
  limit: number
}

export default function SnapshotsBrowser() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedAppId = searchParams.get('appId')
  const currentPage = parseInt(searchParams.get('page') || '1', 10)

  const [snapshots, setSnapshots] = useState<SnapshotManifest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [selectedSnapshot, setSelectedSnapshot] = useState<SnapshotManifest | null>(null)

  const fetchSnapshots = useCallback(async (page: number, appId?: string) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (appId) params.set('appId', appId)
      params.set('page', String(page))
      params.set('limit', '20')

      const response = await fetch(`/api/snapshots?${params}`)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)

      const data: SnapshotListResponse = await response.json()
      setSnapshots(data.snapshots)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedAppId) {
      fetchSnapshots(1, selectedAppId)
    } else {
      fetchSnapshots(currentPage)
    }
  }, [selectedAppId, currentPage, fetchSnapshots])

  // Auto-select when single result from appId search
  useEffect(() => {
    if (selectedAppId && snapshots.length === 1) {
      setSelectedSnapshot(snapshots[0])
    }
  }, [selectedAppId, snapshots])

  const handleSearch = () => {
    if (searchInput.trim()) {
      router.push(`/snapshots?appId=${searchInput.trim()}`, { scroll: false })
    }
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSelectedSnapshot(null)
    router.push('/snapshots', { scroll: false })
  }

  const handlePageChange = (page: number) => {
    router.push(`/snapshots?page=${page}`, { scroll: false })
  }

  const handleRandom = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/snapshots/random')
      if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`)
      const manifest: SnapshotManifest = await response.json()
      setSelectedSnapshot(manifest)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectSnapshot = (snapshot: SnapshotManifest) => {
    setSelectedSnapshot(snapshot)
  }

  const handleBack = () => {
    setSelectedSnapshot(null)
  }

  const totalPages = Math.ceil(total / 20)

  // Detail view
  if (selectedSnapshot) {
    return (
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <button
            onClick={handleBack}
            style={{ padding: '8px 16px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Back to list
          </button>
          <h1 style={{ fontSize: '24px', fontWeight: '600', color: '#f1f5f9', margin: 0 }}>
            Snapshot: {selectedSnapshot.appId}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <a
            href={`/?appId=${selectedSnapshot.appId}`}
            style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', borderRadius: '6px', textDecoration: 'none', fontSize: '14px' }}
          >
            Open in Debug Console
          </a>
          <span style={{ color: '#94a3b8', fontSize: '14px', alignSelf: 'center' }}>
            {new Date(selectedSnapshot.timestamp).toLocaleString()}
          </span>
          {selectedSnapshot.metadata.templateVersion && (
            <span style={{ color: '#94a3b8', fontSize: '14px', alignSelf: 'center' }}>
              Template: {selectedSnapshot.metadata.templateVersion}
            </span>
          )}
        </div>

        {/* Screenshot */}
        <div style={{ marginBottom: '24px', background: '#0f172a', borderRadius: '8px', padding: '16px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#e2e8f0', marginTop: 0, marginBottom: '12px' }}>Screenshot</h2>
          <div style={{ maxHeight: '600px', overflow: 'auto', borderRadius: '4px' }}>
            <img
              src={`/api/snapshots/${selectedSnapshot.appId}/screenshot`}
              alt={`Screenshot of ${selectedSnapshot.appId}`}
              style={{ width: '100%', display: 'block' }}
            />
          </div>
        </div>

        {/* Initial Prompt */}
        <div style={{ marginBottom: '24px', background: '#0f172a', borderRadius: '8px', padding: '16px', border: '1px solid #334155' }}>
          <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#e2e8f0', marginTop: 0, marginBottom: '12px' }}>Initial Prompt</h2>
          <pre style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: '14px', lineHeight: '1.6' }}>
            {selectedSnapshot.initialPrompt}
          </pre>
        </div>

        {/* Follow-up Q&A */}
        {selectedSnapshot.followUpQA.length > 0 && (
          <div style={{ background: '#0f172a', borderRadius: '8px', padding: '16px', border: '1px solid #334155' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '600', color: '#e2e8f0', marginTop: 0, marginBottom: '12px' }}>Follow-up Q&A</h2>
            {selectedSnapshot.followUpQA.map((qa, i) => (
              <div key={i} style={{ marginBottom: '16px', paddingBottom: '16px', borderBottom: i < selectedSnapshot.followUpQA.length - 1 ? '1px solid #1e293b' : 'none' }}>
                <div style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>Agent Question</span>
                  <p style={{ color: '#e2e8f0', margin: '4px 0 0', fontSize: '14px', lineHeight: '1.5' }}>{qa.question}</p>
                </div>
                <div>
                  <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>User Answer</span>
                  <p style={{ color: '#e2e8f0', margin: '4px 0 0', fontSize: '14px', lineHeight: '1.5' }}>{qa.answer}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // List view
  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', fontWeight: '600', color: '#f1f5f9', marginBottom: '24px' }}>Eval Snapshots</h1>

      {/* Search and controls */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Search by App ID..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          style={{ flex: 1, padding: '10px 14px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: '6px', fontSize: '14px', outline: 'none' }}
        />
        <button
          onClick={handleSearch}
          style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
        >
          Search
        </button>
        {selectedAppId && (
          <button
            onClick={handleClearSearch}
            style={{ padding: '10px 20px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
          >
            Clear
          </button>
        )}
        <button
          onClick={handleRandom}
          disabled={loading}
          style={{ padding: '10px 20px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', opacity: loading ? 0.6 : 1 }}
        >
          Random
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#7f1d1d', color: '#fca5a5', borderRadius: '6px', marginBottom: '16px', fontSize: '14px' }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: '48px', fontSize: '14px' }}>Loading...</div>
      )}

      {!loading && snapshots.length === 0 && (
        <div style={{ color: '#94a3b8', textAlign: 'center', padding: '48px', fontSize: '14px' }}>No snapshots found.</div>
      )}

      {!loading && snapshots.length > 0 && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.appId}
                onClick={() => handleSelectSnapshot(snapshot)}
                style={{
                  padding: '16px',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#334155' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '14px', fontFamily: 'monospace' }}>{snapshot.appId}</span>
                  <span style={{ color: '#64748b', fontSize: '12px' }}>{new Date(snapshot.timestamp).toLocaleString()}</span>
                </div>
                <p style={{
                  color: '#94a3b8',
                  margin: 0,
                  fontSize: '13px',
                  lineHeight: '1.4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {snapshot.initialPrompt}
                </p>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                style={{ padding: '8px 14px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: currentPage <= 1 ? 'default' : 'pointer', opacity: currentPage <= 1 ? 0.5 : 1 }}
              >
                Previous
              </button>
              <span style={{ color: '#94a3b8', alignSelf: 'center', fontSize: '14px' }}>
                Page {currentPage} of {totalPages} ({total} total)
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                style={{ padding: '8px 14px', background: '#334155', color: '#e2e8f0', border: 'none', borderRadius: '4px', cursor: currentPage >= totalPages ? 'default' : 'pointer', opacity: currentPage >= totalPages ? 0.5 : 1 }}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

**Step 3: Add navigation link in Dashboard**

In `debug-console/src/pages/Dashboard.tsx`, add a link to the snapshots page alongside the existing Analytics and Image Search links in the header navigation area.

**Step 4: Verify compilation**

Run: `pnpm --filter debug-console typecheck` (or `pnpm --filter debug-console build`)
Expected: No type errors

**Step 5: Commit**

```bash
git add debug-console/src/app/snapshots/ debug-console/src/pages/Dashboard.tsx
git commit -m "feat: add eval snapshots browsing page to debug console"
```

---

## Environment Variables Summary

Add these env vars to the appropriate services:

| Service        | Variable                | Example Value             |
| -------------- | ----------------------- | ------------------------- |
| app/           | `EVAL_SNAPSHOTS_BUCKET` | `airo-eval-snapshots-dev` |
| debug-console/ | `EVAL_SNAPSHOTS_BUCKET` | `airo-eval-snapshots-dev` |

---

## PR Dependency Order

```
PR 1 (CDK bucket) ─── can be deployed independently
        │
        ├── PR 2 (Upload endpoint) ─── needs bucket to exist at runtime
        │       │
        │       └── PR 3 (Client capture) ─── needs upload endpoint
        │
        └── PR 4 (Debug console) ─── needs bucket to exist at runtime
```

PRs 2, 3, and 4 can be developed in parallel but should be merged in order for testing.
