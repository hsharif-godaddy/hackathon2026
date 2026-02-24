# Video Generation — WebSocket-Based Async Design

## Overview

This document describes the redesigned video generation flow. Instead of the frontend
polling an HTTP endpoint repeatedly, the backend handles all polling internally and pushes
the final result (success or failure) to the client via a WebSocket message with a
dedicated `video` event type.

## Goals

- Remove frontend polling complexity
- Single HTTP request from the client to initiate generation
- Server-side async pipeline: prompt → screenshot → job → poll → download → stitch
- Real-time result delivery via WebSocket
- Idempotent: resume from `video.json` cache if generation already completed

---

## Flow Diagram

```mermaid
flowchart TD
    A([Client: POST /video\nbody: publishedUrl]) --> B{video.json\nexists?}

    B -- Yes --> C[Return cached\nvideo.json data]
    C --> Z([Response: 200 OK\nvideo metadata])

    B -- No --> D[Generate prompt\nfrom publishedUrl]
    D --> E[Take screenshot\nof publishedUrl]
    E --> F[Call initiateGeneration\nto create video job]

    F --> G[Save job metadata\nto video.json\nstatus: pending]
    G --> H[Return 202 Accepted\nto client immediately]
    H --> Z2([Client receives 202\nand awaits WebSocket event])

    G --> I[Start background poller\npoll every 10s\nmax 100 attempts]

    I --> J{Poll response\nstatus?}

    J -- pending / processing --> K[Update status\nin video.json]
    K --> L[Wait 10 seconds]
    L --> I

    J -- failed --> M[Delete video.json]
    M --> N[Send WebSocket message\neventType: video\nstatus: failed]
    N --> Z3([Client receives\nfailure event])

    J -- completed --> O[Download generated\nvideo file]

    O -- download error --> M

    O -- download success --> P[Stitch outro\nusing ffmpeg]

    P -- stitch error --> M

    P -- stitch success --> Q[Update video.json\nwith final metadata\nstatus: completed\nvideoUrl: ...]

    Q --> R[Send WebSocket message\neventType: video\nstatus: completed\nvideoUrl: ...]
    R --> Z4([Client receives\nsuccess event])
```

---

## State Machine

```mermaid
stateDiagram-v2
    [*] --> CheckCache

    CheckCache --> ReturnCached : video.json exists
    CheckCache --> PromptGeneration : no video.json

    ReturnCached --> [*] : 200 OK
    ReturnInProgress --> [*] : 202 current status

    AsyncPipeline --> WritePending : 202 queued (immediate)
    WritePending --> PromptGeneration
    PromptGeneration --> Screenshot : prompt generated
    PromptGeneration --> Cleanup : no prompt available
    Screenshot --> SubmitJob : screenshot optional
    SubmitJob --> Polling : job created, jobId saved

    Polling --> Polling : status pending/in_progress\n(wait 10s, max 100 polls)
    Polling --> Downloading : status completed
    Polling --> Failed : status failed\nOR max polls exceeded

    Downloading --> Validation : download success
    Downloading --> Failed : download error

    Validation --> Stitching : valid video
    Validation --> Failed : invalid video

    Stitching --> Completed : stitch success or failure\n(non-blocking)

    Completed --> [*] : update video.json\nsend WS event (completed)
    Failed --> [*] : delete video.json\nsend WS event (failed)
    Cleanup --> [*] : delete pending video.json\nno WS event
```

---

## video.json Schema

The `video.json` file at `{appPath}/.airo/video.json` acts as the persistent state store
for in-progress and completed video generation. It is written before the async pipeline
starts and updated after each poll and after final processing.

```json
{
  "jobId": "string | null",
  "status": "pending | in_progress | completed | failed",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "url": "string | null",
  "error": "string | null"
}
```

---

## WebSocket Event Payload

The WebSocket message sent on completion or failure uses a new `video` event type.

### Success

```json
{
  "type": "video",
  "content": "",
  "data": {
    "status": "completed",
    "jobId": "string",
    "videoUrl": "https://preview.domain/public/images/go_live-video-AbCdEf.mp4",
    "appId": "string"
  }
}
```

### Failure

```json
{
  "type": "video",
  "content": "",
  "data": {
    "status": "failed",
    "jobId": "string",
    "error": "string",
    "appId": "string"
  }
}
```

---

## HTTP API

### `POST /:id/generate-video`

Initiates video generation for a given app. Requires `canPublish` permission.

**Request Body:**

```json
{
  "publishedUrl": "https://..."
}
```

**Responses:**

| Status                      | Condition                                      | Body                                                   |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `200 OK`                    | `video.json` completed and video file exists   | `{ success: true, status: "completed", url: "…" }`     |
| `202 Accepted`              | New pipeline started or generation in progress | `{ success: true, status: "queued" }`                  |
| `400 Bad Request`           | Missing app ID or invalid publishedUrl         | `{ error: "…", status: "failed" }`                     |
| `404 Not Found`             | App not found                                  | `{ error: "App not found", status: "failed" }`         |
| `500 Internal Server Error` | Unexpected error                               | `{ error: "Internal server error", status: "failed" }` |

---

## Failure Handling

| Failure Point                   | Action                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| Prompt generation fails         | Async: delete pending video.json, no WS event                |
| Screenshot fails                | Non-blocking: proceeds without screenshot input reference    |
| OpenAI job submission fails     | Async: delete pending video.json, no WS event                |
| Poll returns `failed`           | Delete video.json, send WS failure event                     |
| Max poll attempts (100) reached | Delete video.json, send WS failure event                     |
| Download fails                  | Delete video.json, send WS failure event                     |
| Video validation fails          | Delete video file + video.json, send WS failure event        |
| ffmpeg outro stitch fails       | **Non-blocking**: video is still usable, marked as completed |

Deleting `video.json` on failure ensures the next request will retry the full pipeline
rather than returning stale/corrupted state.

---

## Sequence Diagram

```mermaid
sequenceDiagram
    participant Client
    participant API as Agents API
    participant FS as File System (video.json)
    participant Sora as OpenAI Sora API
    participant WS as WebSocket (Socket.IO)

    Client->>API: POST /:id/generate-video { publishedUrl? }

    API->>FS: Read video.json
    alt video.json completed + file exists
        FS-->>API: Return cached metadata
        API-->>Client: 200 OK { status: completed, url }
    else video.json pending/in_progress
        FS-->>API: Return current status
        API-->>Client: 202 Accepted { status }
    else no video.json
        API-->>Client: 202 Accepted { status: queued }

        API->>FS: Write video.json { status: pending }
        API->>API: Generate prompt from app conversation
        API->>API: Take screenshot (optional, non-blocking)
        API->>Sora: POST /videos (prompt + screenshot)
        Sora-->>API: { id: jobId }
        API->>FS: Update video.json { jobId, status: pending }

        loop Every 10s, up to 100 times
            API->>Sora: GET /videos/{jobId}
            Sora-->>API: { status }
            API->>FS: Update video.json { status }
            alt status = completed
                API->>Sora: GET /videos/{jobId}/content
                Sora-->>API: video binary
                API->>API: Validate video with ffmpeg
                API->>API: Stitch outro (non-blocking)
                API->>FS: Update video.json { status: completed, url }
                API->>WS: emit('message', { type: video, data: { status: completed, videoUrl, appId } })
                WS-->>Client: video event (completed)
            else status = failed OR max polls
                API->>FS: Delete video.json
                API->>WS: emit('message', { type: video, data: { status: failed, error, appId } })
                WS-->>Client: video event (failed)
            end
        end
    end
```
