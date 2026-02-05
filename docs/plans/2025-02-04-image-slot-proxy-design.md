# Image Slot Proxy Design

## Overview

This document describes the implementation of the image slot proxy component in dev-supervisor. The proxy resolves semantic image slot paths to actual image URLs via a manifest file, enabling decoupled image management without code changes.

## Design Decisions

| Decision            | Choice                                   | Rationale                                           |
| ------------------- | ---------------------------------------- | --------------------------------------------------- |
| Manifest location   | `/tmp/apps/{appId}/app/image-slots.json` | Travels with code through build/deploy pipeline     |
| Resolution strategy | 302 redirect                             | Simple, lets Getty CDN handle scaling/caching       |
| Manifest loading    | mtime-based caching                      | Cheap stat call per request, re-read only on change |
| Missing slots       | 404 with JSON error                      | Simple, frontend decides display                    |
| Size parameters     | Ignore query params                      | Use manifest `requestedSize` only                   |

## Architecture

### Request Flow

```
Browser Request                    dev-supervisor                     Getty CDN
      │                                 │                                 │
      │  GET /airo-assets/images/       │                                 │
      │     pages/home/hero             │                                 │
      │────────────────────────────────▶│                                 │
      │                                 │                                 │
      │                           ┌─────┴─────┐                           │
      │                           │ Load/check│                           │
      │                           │ manifest  │                           │
      │                           └─────┬─────┘                           │
      │                                 │                                 │
      │  302 Redirect                   │                                 │
      │  Location: https://media.       │                                 │
      │    gettyimages.com/id/abc123/..│                                 │
      │◀────────────────────────────────│                                 │
      │                                 │                                 │
      │  GET https://media.gettyimages.com/...                            │
      │────────────────────────────────────────────────────────────────▶│
      │                                                                   │
      │  200 OK (image data)                                              │
      │◀──────────────────────────────────────────────────────────────────│
```

### URL Scheme

- Route: `/airo-assets/images/{slot-path}`
- Example: `/airo-assets/images/pages/home/hero`
- Slot path extraction: Strip `/airo-assets/images/` prefix

## Data Structures

### Manifest Schema

```json
{
  "pages/home/hero": {
    "currentUrl": "https://media.gettyimages.com/id/abc123/...",
    "searchQuery": "modern office collaboration diverse team",
    "requestedSize": {
      "width": 1920,
      "height": 1080,
      "fit": "cover"
    },
    "alternatives": [
      "https://media.gettyimages.com/id/def456/...",
      "https://media.gettyimages.com/id/ghi789/..."
    ],
    "userModified": false,
    "createdAt": "2025-02-04T10:30:00Z",
    "lastUpdated": "2025-02-04T10:30:00Z"
  }
}
```

### Go Types

```go
type ImageSlot struct {
    CurrentURL    string     `json:"currentUrl"`
    SearchQuery   string     `json:"searchQuery"`
    RequestedSize *ImageSize `json:"requestedSize,omitempty"`
    Alternatives  []string   `json:"alternatives,omitempty"`
    UserModified  bool       `json:"userModified"`
    CreatedAt     string     `json:"createdAt"`
    LastUpdated   string     `json:"lastUpdated"`
}

type ImageSize struct {
    Width  int    `json:"width"`
    Height int    `json:"height"`
    Fit    string `json:"fit"`
}

type ImageManifest map[string]ImageSlot
```

### Manifest Cache

```go
type ManifestCache struct {
    mu          sync.RWMutex
    manifest    ImageManifest
    lastModTime time.Time
    filePath    string
}

func (c *ManifestCache) Get(slotPath string) (*ImageSlot, error) {
    // 1. Stat the file
    // 2. If mtime unchanged, return cached value
    // 3. If mtime changed, re-read and parse JSON
    // 4. Return slot or nil if not found
}
```

## Implementation

### Handler Function

```go
func (p *HTTPProxy) handleImageSlot(w http.ResponseWriter, r *http.Request) {
    // Only GET/HEAD allowed
    if r.Method != http.MethodGet && r.Method != http.MethodHead {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }

    // Extract slot path
    slotPath := strings.TrimPrefix(r.URL.Path, "/airo-assets/images/")
    if slotPath == "" {
        p.respondSlotError(w, "empty slot path", http.StatusBadRequest)
        return
    }

    // Look up in manifest
    slot, err := p.imageManifest.Get(slotPath)
    if err != nil {
        p.respondSlotError(w, err.Error(), http.StatusInternalServerError)
        return
    }

    if slot == nil {
        p.respondSlotError(w, fmt.Sprintf("slot not found: %s", slotPath),
            http.StatusNotFound)
        return
    }

    // Redirect to the image URL
    http.Redirect(w, r, slot.CurrentURL, http.StatusFound)
}

func (p *HTTPProxy) respondSlotError(w http.ResponseWriter, msg string, status int) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    json.NewEncoder(w).Encode(map[string]string{
        "error": msg,
    })
}
```

### Integration Points

**HTTPProxy struct** (types.go):

```go
type HTTPProxy struct {
    // ... existing fields ...
    imageManifest *ManifestCache
}
```

**Initialization** (server.go):

```go
func NewHTTPProxy(config Config, procMgr ProcessController) *HTTPProxy {
    var imageManifest *ManifestCache
    if config.StaticRoot != "" {
        manifestPath := filepath.Join(config.StaticRoot, "image-slots.json")
        imageManifest = NewManifestCache(manifestPath)
    }

    return &HTTPProxy{
        // ... existing fields ...
        imageManifest: imageManifest,
    }
}
```

**Route registration** (server.go):

```go
if p.imageManifest != nil {
    mux.HandleFunc("/airo-assets/images/", p.handleImageSlot)
}
```

### File Organization

```
dev-supervisor/internal/proxy/http/
├── image_slots.go       # ManifestCache + ImageSlot types + handler
├── image_slots_test.go  # Unit tests
└── ... existing files ...
```

## Testing

### Test Cases

1. **Happy path** - Valid slot returns 302 redirect to correct URL
2. **Missing slot** - Returns 404 with JSON error
3. **Missing manifest file** - Returns 500 with error
4. **Invalid JSON** - Returns 500 with parse error
5. **Mtime caching** - Verify file is re-read when modified
6. **Empty slot path** - Returns 400 bad request
7. **Non-GET methods** - Returns 405 method not allowed

### Test Approach

```go
func TestImageSlotHandler(t *testing.T) {
    tmpDir := t.TempDir()
    manifestPath := filepath.Join(tmpDir, "image-slots.json")

    manifest := map[string]ImageSlot{
        "pages/home/hero": {CurrentURL: "https://example.com/image.jpg"},
    }
    writeJSON(t, manifestPath, manifest)

    cache := NewManifestCache(manifestPath)
    // ... test requests ...
}
```

## Future Considerations

Items deferred from initial implementation:

- **Placeholder generation** - Generate gray images with dimension text for missing slots
- **Query parameter size overrides** - Allow `?w=800&h=600&fit=crop` overrides
- **Proxy passthrough mode** - Stream images through dev-supervisor instead of redirect
- **File watching** - Use fsnotify instead of mtime polling
