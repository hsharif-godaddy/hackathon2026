---
status: implemented
---

# Media Slot Image Upload Design

**Date:** 2026-02-16
**Status:** Approved
**Product:** AiroAppBuilder

## Problem Statement

Media slots currently only support Getty Images URLs. Users cannot upload their own images as alternatives for a slot, limiting customization options.

## Goals

1. Allow users to upload their own images to media slots
2. Support uploads from both MediaSlotDialog and chat
3. Process/optimize uploaded images for web performance
4. Integrate with existing airo-assets proxy pattern

## Non-Goals

- Video upload support (images only for this iteration)
- Batch upload of multiple images at once
- Image editing (crop, rotate, filters)

## Requirements Summary

| Requirement      | Decision                                          |
| ---------------- | ------------------------------------------------- |
| Upload points    | MediaSlotDialog AND Chat                          |
| Upload behavior  | Replace current image immediately                 |
| Storage location | `/public/media/` in project                       |
| Image processing | Resize/optimize before storage                    |
| URL format       | `/airo-assets/uploads/{filename}` (proxy pattern) |

## Architecture Overview

### Data Flow

```
┌─────────────────────┐     ┌─────────────────────┐
│  MediaSlotDialog    │     │    Chat Upload      │
│  (Upload Button)    │     │  (File Reference)   │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          ▼                           ▼
┌─────────────────────────────────────────────────┐
│  POST /media/:appId/slots/:slotName/upload      │
│  - Validates image type/size                    │
│  - Resizes/optimizes image                      │
│  - Stores to /public/media/{slotName}-{hash}.jpg│
│  - Updates airo-media.json manifest             │
│  - Commits to git                               │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  airo-media.json                                │
│  {                                              │
│    "pages/home/hero": {                         │
│      "currentUrl": "/airo-assets/uploads/...",  │
│      "alternatives": [...getty urls...],        │
│      "userModified": true                       │
│    }                                            │
│  }                                              │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  dev-supervisor proxy                           │
│  /airo-assets/uploads/* → /public/media/*       │
└─────────────────────────────────────────────────┘
```

### Key Components

| Component       | Location                                        | Purpose                                              |
| --------------- | ----------------------------------------------- | ---------------------------------------------------- |
| Upload Endpoint | `agents/src/server/routes/media.ts`             | Handle upload, process, store, update manifest       |
| Image Processor | `agents/src/services/ImageProcessingService.ts` | Resize/optimize images using sharp                   |
| Proxy Route     | `dev-supervisor/http_proxy.go`                  | Serve `/airo-assets/uploads/*` from `/public/media/` |
| Upload UI       | `app/src/components/media/MediaSlotDialog.tsx`  | Upload button in the dialog                          |

## Backend Implementation

### New Endpoint: `POST /media/:appId/slots/:slotName/upload`

**Location:** `agents/src/server/routes/media.ts`

```typescript
// Request: multipart/form-data with 'image' field
// Response: { success, slot, uploadedUrl }

router.post(
  "/:appId/slots/:slotName(*)/upload",
  uploadRateLimiter,
  upload.single("image"),
  async (req, res) => {
    // 1. Validate image (type, size)
    // 2. Process image (resize to slot dimensions or max 2048px)
    // 3. Store to /public/media/{slotName-hash}.{ext}
    // 4. Update manifest (new URL becomes current, old current → alternatives)
    // 5. Git commit
    // 6. Return updated slot
  },
);
```

### Image Processing Service

**Location:** `agents/src/services/ImageProcessingService.ts`

```typescript
interface ProcessImageOptions {
  maxWidth?: number; // Default: 2048
  maxHeight?: number; // Default: 2048
  quality?: number; // Default: 85
  format?: "jpeg" | "png" | "webp"; // Default: preserve or jpeg
}

class ImageProcessingService {
  async processImage(
    buffer: Buffer,
    options: ProcessImageOptions,
  ): Promise<{ buffer: Buffer; width: number; height: number; format: string }>;
}
```

Features:

- Uses `sharp` library (already in package.json)
- Resizes if larger than max dimensions (preserves aspect ratio)
- Compresses with quality setting
- Strips EXIF metadata for privacy

### Proxy Update

**Location:** `dev-supervisor/http_proxy.go`

Add route to serve uploaded media:

```go
// /airo-assets/uploads/{filename} → /app/public/media/{filename}
```

### File Naming

Files stored as: `/public/media/{sanitized-slot-name}-{8-char-hash}.{ext}`

Example: `pages-home-hero-a1b2c3d4.jpg`

- Slot name sanitized (slashes → dashes)
- Hash from file content for cache-busting
- Original extension preserved (or converted to jpg)

## Frontend Implementation

### MediaSlotDialog Updates

**Location:** `app/src/components/media/MediaSlotDialog.tsx`

Add an "Upload Image" button in the dialog header area:

```tsx
// New state
const [isUploading, setIsUploading] = useState(false)
const fileInputRef = useRef<HTMLInputElement>(null)

// Upload handler
const handleUploadImage = async (file: File) => {
  setIsUploading(true)
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch(
    `${apiConfig.agentUrl}/media/${appId}/slots/${slotName}/upload`,
    { method: 'POST', body: formData, headers: { Authorization: `Bearer ${token}` } }
  )

  // On success: reload slot data, notify preview iframe
}

// UI: Upload button + hidden file input
<Button onClick={() => fileInputRef.current?.click()} design="secondary">
  <UploadIcon /> Upload Image
</Button>
<input
  type="file"
  ref={fileInputRef}
  accept="image/*"
  onChange={(e) => handleUploadImage(e.target.files[0])}
  hidden
/>
```

### Chat Integration

When a user uploads an image via chat and wants to use it in a media slot:

1. User uploads image via existing chat upload (stores in `/tmp/uploads/`)
2. User opens MediaSlotDialog for a slot
3. "Use from uploads" section shows recent chat uploads
4. Clicking an uploaded image re-uploads it to permanent storage with processing

**New component:** `UploadedImagesSection` in MediaSlotDialog

### UI Layout

**Desktop:** Upload button in header row next to "Use this image"

**Mobile:** Upload button in bottom action area, stacked with "Use this image"

## Error Handling & Validation

### Upload Validation

| Check      | Limit                                                | Error Message                                        |
| ---------- | ---------------------------------------------------- | ---------------------------------------------------- |
| File type  | `image/jpeg`, `image/png`, `image/webp`, `image/gif` | "Only JPEG, PNG, WebP, and GIF images are supported" |
| File size  | 10MB max                                             | "Image exceeds 10MB limit"                           |
| Dimensions | Min 50x50px                                          | "Image must be at least 50x50 pixels"                |

### Error Scenarios

| Scenario                | Handling                                              |
| ----------------------- | ----------------------------------------------------- |
| Upload fails mid-stream | Show toast error, allow retry                         |
| Image processing fails  | Return 400 with specific error, don't update manifest |
| Slot doesn't exist      | Return 404, suggest creating slot first via AI        |
| Git commit fails        | Log warning, still return success (file saved)        |
| Disk full               | Return 500, log critical error                        |

### Client-Side Validation

Validate before upload to provide instant feedback:

- Check file type via `file.type`
- Check file size via `file.size`
- Show inline error in dialog, don't close dialog on error

## Testing Strategy

### Unit Tests

**Backend:**

- `ImageProcessingService.test.ts` - resize, format conversion, quality
- `media.test.ts` - upload endpoint validation, authorization

**Frontend:**

- `MediaSlotDialog.test.tsx` - upload button rendering, file selection, upload flow

### Integration Tests

1. **Upload replaces current image**

   - Upload image → verify manifest updated → verify file exists in `/public/media/`

2. **Chat upload → slot assignment**

   - Upload via chat → open dialog → select from uploads → verify slot updated

3. **Image processing**
   - Upload 4000x3000 image → verify resized to max 2048px

### Manual Testing Checklist

- [ ] Upload JPEG, PNG, WebP, GIF
- [ ] Upload image > 2048px (verify resize)
- [ ] Upload via dialog on mobile
- [ ] Upload via dialog on desktop
- [ ] Use chat-uploaded image in slot
- [ ] Verify proxy serves uploaded images
- [ ] Verify preview iframe updates after upload

## Security Considerations

- Ownership validation via `validateAppOwnership` middleware
- Rate limiting on upload endpoint (reuse existing `uploadRateLimiter`)
- File type validation (MIME type + extension)
- Image processing strips EXIF metadata (privacy)
- Sanitized filenames prevent path traversal

## Dependencies

- `sharp` - Already in agents package.json for image processing
- Existing `FileUploadService` patterns for validation
- Existing `MediaManifestService` for manifest updates
- dev-supervisor proxy for serving uploaded files
