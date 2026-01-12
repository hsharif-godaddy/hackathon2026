# Social Posts Architecture

This document describes the `social_posts` table schema and the publish flow for social media posts.

## Table Schema

### `social_posts`

Stores publish attempts and results for social media posts.

```
┌─────────────────────┬──────────────┬─────────────────────────────────────────┐
│ Column              │ Type         │ Description                             │
├─────────────────────┼──────────────┼─────────────────────────────────────────┤
│ id                  │ String (PK)  │ Unique identifier (cuid)                │
│ site_id             │ String (FK)  │ Reference to sites table                │
│ association_id      │ String? (FK) │ Reference to social_associations        │
│ platform            │ String       │ Platform: facebook, instagram           │
│ state               │ PostState    │ SCHEDULED, PUBLISHED, FAILED            │
│ payload             │ Json         │ Post content (message, imageUrls)       │
│ external_response   │ Json?        │ Platform API response or error          │
│ external_id         │ String?      │ Platform's post ID                      │
│ scheduled_at        │ DateTime?    │ When post should publish                │
│ completed_at        │ DateTime?    │ When post was published/failed          │
│ campaign_id         │ String?      │ Links to automated campaign             │
│ created_by          │ String?      │ Who created: 'agent', 'user'            │
│ created_at          │ DateTime     │ Record creation time                    │
│ updated_at          │ DateTime     │ Last update time                        │
└─────────────────────┴──────────────┴─────────────────────────────────────────┘
```

### Field Details

#### `payload` (JSON)

```typescript
{
  message: string,      // Combined content: text + callToAction + hashtags
  imageUrls: string[]   // Array of image URLs to publish
}
```

#### `external_response` (JSON)

```typescript
// Success - contains platform response directly
{
  id: string,         // Platform's post ID
  platformUrl: string // URL to view post on platform
}

// Error
{
  error: string       // Error message
}
```

### Indexes

- `site_id` - Filter posts by site
- `site_id, state` - Filter by site and state
- `association_id` - Filter by social connection
- `platform` - Filter by platform
- `scheduled_at` - Query scheduled posts
- `campaign_id` - Filter by campaign

---

## Publish Flow

### State Machine

```mermaid
stateDiagram-v2
    [*] --> ReadyToPublish: User clicks Publish (connection verified)

    ReadyToPublish --> Publishing: Connection fetched

    Publishing --> Success: Platform accepts post
    Publishing --> Error: Platform rejects post

    Success --> [*]
    Error --> [*]
```

> **Note:** Connection verification happens in `SocialPostModal` before entering this flow. If no connection exists, the user is sent to connect first via `SocialConnectToolRenderer`.

### Flow Status Enum

```typescript
enum PublishFlowState {
  ReadyToPublish = "ready-to-publish",
  Publishing = "publishing",
  Success = "success",
  Error = "error",
}

type PublishStatus = `${PublishFlowState}`;
```

> **Note:** Connection checking is now handled by the frontend before initiating the publish flow. If no connection exists, the user is redirected to the connect flow instead.

---

## Component Architecture

### Sequence Diagram

```mermaid
sequenceDiagram
    participant User
    participant Modal as SocialPostModal
    participant Agent as AI Agent
    participant Tool as socialPostPublish
    participant Widget as SocialPublishWidget
    participant Hook as usePublishFlowWithCallbacks
    participant API as /api/sites/[id]/social/posts
    participant Platform as Facebook/Instagram API

    User->>Modal: Click "Publish"
    Modal->>Modal: Check if platform connected

    alt No connection
        Modal->>Agent: sendMessage("Connect", {postData})
        Note over Modal: Redirects to connect flow
    else Has connection
        Modal->>Agent: sendMessage("Publish", {pendingPublish, postData})
        Note over Modal: Closes modal
    end

    Agent->>Tool: socialPostPublish()
    Tool-->>Widget: result: {publishId, pendingPublish, postData}

    Widget->>Widget: Initialize from tool result
    Hook->>Hook: Fetch connection details
    Hook->>Widget: onStatusChange(Publishing)

    Hook->>Platform: publishToFacebook/Instagram

    alt Success
        Platform-->>Hook: { id, platformUrl }
        Hook->>API: POST (state: PUBLISHED)
        API-->>Hook: Created
        Hook->>Widget: onStatusChange(Success)
        Widget->>Widget: emitPostPublished(postId)
        Widget->>User: Show success + "View Post" link
    else Failure
        Platform-->>Hook: Error
        Hook->>API: POST (state: FAILED)
        Hook->>Widget: onStatusChange(Error)
        Widget->>User: Show error message
    end
```

> **Note:** Data flows through context attachments in messages rather than global state. The `SocialPostCreateToolRenderer` listens for `postPublished` events to update post status.

---

## Data Flow

### Post Data Transformation

```mermaid
flowchart LR
    subgraph "AI Agent"
        A[SocialPostData]
    end

    subgraph "Modal"
        B[editedPost]
    end

    subgraph "Store"
        C[PendingPublish]
    end

    subgraph "Platform API"
        D[API Payload]
    end

    subgraph "Database"
        E[social_posts.payload]
    end

    A -->|"User edits"| B
    B -->|"setPendingPublish()"| C
    C -->|"publishToPlatform()"| D
    C -->|"storePostResult()"| E
```

### Data Shapes

```typescript
// 1. SocialPostData (from AI agent)
{
  id: "sp_123",
  styleLabel: "Professional",
  content: "Check out our new product!",
  callToAction: "Shop now",
  hashtags: ["#sale", "#new"],
  images: [{ url: "...", width: 1200, height: 630 }],
  platform: "facebook"
}

// 2. PendingPublish (in store)
{
  platform: "facebook",
  message: "Check out our new product!\n\nShop now",
  imageUrls: ["..."],
  scheduledAt?: Date
}

// 3. API Payload (to Facebook)
{
  url: "...",
  caption: "Check out our new product!\n\nShop now"
}

// 4. Database Record
{
  platform: "facebook",
  state: "PUBLISHED",
  payload: { message: "...", imageUrls: [...] },
  external_response: { status: 200, body: { id: "fb_789", platformUrl: "..." } },
  external_id: "fb_789"
}
```

---

## Key Components

| Component                           | Location                          | Responsibility                          |
| ----------------------------------- | --------------------------------- | --------------------------------------- |
| `SocialPostModal`                   | `app/develop/components/widgets/` | UI for editing/publishing posts         |
| `SocialPublishWidget`               | `app/develop/components/widgets/` | Shows publish status in chat            |
| `SocialPostList`                    | `app/develop/components/widgets/` | List view of posts with click-to-edit   |
| `PostCardPreview`                   | `app/develop/components/widgets/` | Post preview card with platform styling |
| `usePublishFlowWithCallbacks`       | `hooks/social/`                   | Orchestrates the publish process        |
| `SocialV2Client`                    | `lib/social.ts`                   | API client for Facebook/Instagram       |
| `POST /api/sites/[id]/social/posts` | `app/api/`                        | Stores publish records in DB            |

---

## Utils (`utils/social/`)

Shared utilities for social post formatting, validation, and events.

| File            | Exports                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `format.ts`     | `formatHashtags()`, `formatPlatformName()`                                                |
| `validation.ts` | `getPlatformLimits()`, `getCharacterCount()`, `validateSocialPost()`, `isPostOverLimit()` |
| `events.ts`     | `emitPostPublished()`, `onPostPublished()`                                                |
| `index.ts`      | Barrel export for all utils                                                               |

### Platform Limits

| Platform  | Min Images | Max Images | Max Characters | Max Image Width | Max File Size |
| --------- | ---------- | ---------- | -------------- | --------------- | ------------- |
| Instagram | 1          | 20         | 2,200          | 1440px          | 8MB           |
| Facebook  | 0          | 9          | 63,206         | -               | -             |

### Usage

```typescript
import {
  formatHashtags,
  formatPlatformName,
  validateSocialPost,
} from "@/utils/social";

// Format hashtags for display
formatHashtags(["sale", "new"]); // → "#sale #new"

// Capitalize platform name
formatPlatformName("instagram"); // → "Instagram"

// Validate a post
const validation = validateSocialPost(post);
if (!validation.isValid) {
  console.log(validation.errorMessages);
}
```
