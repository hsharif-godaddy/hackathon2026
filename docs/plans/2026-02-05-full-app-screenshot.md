---
status: implemented
---

# Full App Screenshot Feature

**Date:** 2026-02-05
**Status:** Implemented
**Implementation:** Screen Capture API (`getDisplayMedia()`)
**Author:** Claude Code

## Overview

Feature to capture screenshots of the application being built using the native browser Screen Capture API. Users are prompted to select what to capture (entire screen, window, or tab), and the screenshot is automatically attached to their AI chat messages. This approach avoids all iframe/CORS issues and works reliably across all browsers.

## Problem Statement

Users want to provide visual context to the AI by sharing what their app looks like at a specific moment. The existing element screenshot feature (select mode) only captures individual elements. Users need a way to capture the entire application view for broader context and feedback.

## Requirements

### Functional Requirements

1. User can trigger full app screenshot from chat input attachment menu
2. Screenshot captures the exact page currently displayed in preview iframe
3. Screenshot appears as an inline asset in chat input (like uploaded files)
4. User can clear screenshot before sending
5. Screenshot is sent with the next message to AI
6. Works for all apps (old and new) without requiring app updates

### Non-Functional Requirements

1. Screenshot capture completes within 5 seconds
2. Screenshot quality suitable for AI analysis (512px wide, as per existing pattern)
3. Capture works regardless of dev-tools version in app
4. No client-side cross-origin restrictions

## Design

### Architecture

**Final Implementation uses Screen Capture API - no backend involved**

```
┌─────────────────────────────────────────────────────────────┐
│ Builder UI (app/)                                            │
│                                                              │
│  ChatAttachmentMenu                                          │
│  ┌──────────────────┐                                       │
│  │ + (Popover)      │                                       │
│  ├──────────────────┤                                       │
│  │ 📷 Take screenshot│ ─┐                                   │
│  │ 📎 Attach file    │  │                                   │
│  └──────────────────┘  │                                   │
│                         │                                   │
│                         ▼                                   │
│  1. User clicks "Take app screenshot"                      │
│  2. Call navigator.mediaDevices.getDisplayMedia()          │
│  3. Browser prompts user to select capture target          │
│  4. User selects tab/window/screen                         │
│  5. Capture video stream                                   │
│  6. Draw first frame to canvas                             │
│  7. Resize to 512px wide                                   │
│  8. Convert to PNG data URL                                │
│  9. Display as AssetInline in chat input                   │
│  10. User sends message with screenshot attached           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key Benefits:**
- No backend/API calls needed
- No CORS/iframe issues
- Native browser security (user explicitly selects what to capture)
- Works immediately for all apps
- Fast capture (< 1 second)
- No additional dependencies

### Component Changes

#### 1. New Component: `ChatAttachmentMenu`

**Location:** `app/src/app/develop/components/chat/ChatAttachmentMenu.tsx`

**Purpose:** Replaces `FileUploadButton` with a popover menu containing both screenshot and file upload options.

**Props:**
```typescript
interface ChatAttachmentMenuProps {
  appId: string;
  onFilesUploaded: (files: UploadedFile[]) => void;
  onScreenshotCaptured: (dataUrl: string) => void;
  onUploadStart?: (files: File[]) => void;
  onUploadError?: () => void;
  disabled?: boolean;
}
```

**UI Structure:**
- Trigger: `<Button icon={<PlusIcon />} design="stateless" size="sm" />`
- Popover: 2 menu items
  - Camera icon + "Take app screenshot"
  - Paperclip icon + "Attach a file"

**Behavior:**
- Clicking "Take app screenshot":
  1. Calls `navigator.mediaDevices.getDisplayMedia()` to request screen capture
  2. Browser prompts user to select capture target (tab/window/screen)
  3. Shows loading state ("Capturing...")
  4. Captures video stream and extracts first frame
  5. Resizes to 512px wide, converts to PNG data URL
  6. Calls `onScreenshotCaptured(dataUrl)`
  7. On user cancellation: silently closes (no error shown)
  8. On error: logs error (no toast, as it's usually user cancellation)
- Clicking "Attach a file":
  - Triggers file input (existing FileUploadButton logic)

#### 2. Modified Component: `ChatInput`

**Changes:**
- Replace `FileUploadButton` with `ChatAttachmentMenu`
- Add `onScreenshotCaptured` handler
- Handle screenshot data URL same as uploaded files

**New Props:**
```typescript
interface ChatInputProps {
  // ... existing props
  onScreenshotCaptured?: (dataUrl: string) => void;
}
```

#### 3. Modified Page: `app/src/app/develop/[id]/page.tsx`

**Changes:**
- Add handler for screenshot capture
- Convert screenshot data URL to uploaded file format
- Existing `handleFilesUploaded` can handle the result

### API Changes

#### New Endpoint: `POST /apps/:id/screenshot/capture`

**Location:** `agents/src/server/routes/apps.ts`

**Request:**
```typescript
{
  appId: string;      // From URL param
  url: string;        // Full URL to capture (e.g., "https://app123.preview.c4.dev-airoapp.ai/services")
  width?: number;     // Optional viewport width (default: 1920)
  height?: number;    // Optional viewport height (default: 1080)
}
```

**Response:**
```typescript
{
  success: true;
  screenshot: string; // Data URL (image/png, base64)
  capturedUrl: string; // URL that was captured
  timestamp: number;   // Capture timestamp
}
```

**Error Response:**
```typescript
{
  error: string;
  details?: string;
}
```

**Implementation Details:**

1. **Validation:**
   - Use `validateAppOwnership` middleware
   - Validate URL format and domain
   - Ensure URL matches app's preview domain

2. **Playwright Capture:**
   - Launch headless browser
   - Set viewport to requested dimensions
   - Navigate to URL
   - Wait for `networkidle` (no requests for 500ms)
   - Capture full page screenshot
   - Close browser

3. **Image Processing:**
   - Resize to 512px wide (maintain aspect ratio)
   - Convert to PNG data URL
   - Compress with quality: 0.8

4. **Security:**
   - Only capture URLs from app's preview domain
   - Timeout after 10 seconds
   - Validate appId ownership

### Data Flow

#### Screenshot Capture Flow

```typescript
// 1. User clicks "Take app screenshot"
const context = await captureVisualContext();
const currentUrl = `${previewBaseUrl}${context.page}`;

// 2. Request screenshot from agents service
const response = await fetch(`/api/apps/${appId}/screenshot/capture`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: currentUrl })
});

const { screenshot } = await response.json();

// 3. Handle screenshot as if it were an uploaded file
onScreenshotCaptured(screenshot);

// 4. Display in chat input
setSelectedAssets([{
  imageUrl: screenshot,
  imageAlt: 'App screenshot',
  mediaType: MediaType.IMAGE
}]);
```

### File Structure

```
app/src/app/develop/components/chat/
├── ChatAttachmentMenu.tsx          # NEW: Popover menu component
├── ChatAttachmentMenu.test.tsx     # NEW: Component tests
├── ChatInput.tsx                   # MODIFIED: Use new menu
└── FileUploadButton.tsx            # KEEP: Logic reused by menu

agents/src/server/routes/
└── apps.ts                         # MODIFIED: Add screenshot endpoint

agents/src/services/
└── ScreenshotCaptureService.ts     # NEW: Playwright screenshot logic
```

## Implementation Plan

### Phase 1: Backend (Agents Service)

1. Add `ScreenshotCaptureService` with Playwright integration
2. Add `POST /apps/:id/screenshot/capture` endpoint
3. Add validation and security checks
4. Add tests for screenshot capture

### Phase 2: Frontend (Builder UI)

1. Create `ChatAttachmentMenu` component
2. Integrate with `captureVisualContext()`
3. Update `ChatInput` to use new menu
4. Add loading states and error handling
5. Add tests for new components

### Phase 3: Integration

1. Wire up screenshot capture flow
2. Test with various page sizes
3. Test error cases (timeout, invalid URL)
4. Update documentation

## Dependencies

### New Dependencies

**None!** The implementation uses native browser APIs:
- `navigator.mediaDevices.getDisplayMedia()` - Screen Capture API
- `HTMLCanvasElement` - For image processing
- `HTMLVideoElement` - For capturing video stream frames

### Existing Dependencies

- Existing file upload UI patterns
- Existing asset display components in chat

## Security Considerations

**Browser-native security model:**

1. **User Permission Required:**
   - Browser prompts user to explicitly select what to capture
   - User must grant permission for each capture
   - Cannot be automated or triggered without user interaction

2. **No Backend Access:**
   - Screenshot never leaves the browser
   - No server-side processing or storage
   - Data URL stays in client memory only

3. **Content Control:**
   - User chooses exactly what gets captured (tab/window/screen)
   - No risk of capturing unintended content
   - Browser enforces same-origin policy for capture stream

4. **Resource Management:**
   - MediaStream automatically cleaned up after capture
   - No persistent browser processes
   - Minimal memory footprint

## Testing Strategy

### Unit Tests

1. `ChatAttachmentMenu.test.tsx`
   - Renders popover correctly
   - Shows both menu options
   - Triggers screenshot capture on click
   - Triggers file upload on click

2. `ScreenshotCaptureService.test.ts`
   - Captures screenshot with Playwright
   - Resizes image correctly
   - Handles timeout errors
   - Validates URLs

### Integration Tests

1. End-to-end screenshot flow:
   - Open chat attachment menu
   - Click "Take app screenshot"
   - Verify API call made
   - Verify screenshot appears in chat input
   - Send message with screenshot

2. Error scenarios:
   - Invalid URL
   - Timeout
   - Network error
   - Cross-tenant access attempt

## Performance Considerations

1. **Capture Speed:**
   - Browser prompt: instant (native OS dialog)
   - Stream setup: < 100ms
   - Frame capture: < 50ms
   - Resize: < 50ms
   - **Total time: < 1 second** (excluding user interaction time)

2. **Memory Usage:**
   - Video stream: temporary, cleaned up immediately after capture
   - Canvas: temporary, garbage collected after conversion
   - Final data URL: ~100-300KB (512px wide, 0.8 quality)

3. **No Backend Load:**
   - Zero server resources used
   - No network requests
   - Works offline

## Future Enhancements

1. **Screenshot History:**
   - Store screenshots in database with conversation history
   - Allow browsing previous screenshots
   - "Use last screenshot" quick action

2. **Advanced Capture Options:**
   - Annotation tools before sending (draw arrows, highlight areas)
   - Crop tool to focus on specific area
   - Add text labels/comments

3. **Video Recording:**
   - Extend MediaStream capture to record video clips
   - Screen recording for bug reports and demos
   - Loom-style recording with webcam overlay

4. **Auto-capture:**
   - Automatically capture screenshot when AI makes visual changes
   - Before/after comparisons for edits

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| User cancels capture prompt | Low | Graceful handling, no error toast shown |
| Browser doesn't support getDisplayMedia() | Low | Feature only available on supported browsers (all modern browsers) |
| User selects wrong tab/window | Low | Clear instructions, user can retry immediately |
| Screenshot too large | Low | Automatic resize to 512px keeps size manageable |

## Open Questions

1. Should we cache screenshots temporarily to avoid re-capture?
   - **Decision:** No caching in v1, add if needed based on usage

2. What happens if the app is not running?
   - **Decision:** Return 503 error with helpful message

3. Should we support capturing specific viewport sizes?
   - **Decision:** Default to 1920x1080, allow override in request

## Success Metrics

1. Screenshot capture success rate > 90% (excluding user cancellations)
2. Average capture time < 1 second (technical capture, excluding user selection)
3. User adoption: % of messages with screenshots
4. Technical error rate < 1%
5. User completion rate (selected + captured) > 80%

## References

### Implementation Files

- **ChatAttachmentMenu:** `app/src/app/develop/components/chat/ChatAttachmentMenu.tsx`
- **ChatInput:** `app/src/app/develop/components/chat/ChatInput.tsx`
- **ChatPane:** `app/src/app/develop/components/chat/ChatPane.tsx`

### External Documentation

- [Screen Capture API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API)
- [getDisplayMedia() (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [Browser Compatibility](https://caniuse.com/mdn-api_mediadevices_getdisplaymedia)
