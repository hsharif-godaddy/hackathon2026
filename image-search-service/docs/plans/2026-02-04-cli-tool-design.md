# CLI Tool for Ad-Hoc Testing

**Goal:** Provide a simple CLI to test the image search service with human-readable table output.

**Architecture:** Single binary using standard library only, reusing existing `pkg/models` types.

---

## Command Structure

```bash
# Basic search
image-search "sunset over mountains"

# With count
image-search "sunset over mountains" --count 5

# Against different server
image-search "sunset over mountains" --server http://prod:8080
```

Query is a positional argument. Server defaults to `http://localhost:8080`.

## Output Format

Table with aligned columns:

```
GETTY ID      SCORE  SUBJECT              TONE     THUMBNAIL
1234567890    0.92   mountain landscape   serene   https://media.gettyimages.com/photos/1234567890?s=170x170
2345678901    0.87   sunset sky           warm     https://media.gettyimages.com/photos/2345678901?s=170x170
```

Columns:

1. Getty ID
2. Score (relevance, 2 decimal places)
3. Subject (truncated to 20 chars)
4. Tone
5. Thumbnail URL (full, clickable)

## Implementation

- Location: `cmd/cli/main.go`
- Dependencies: Standard library only (`flag`, `text/tabwriter`, `net/http`)
- Reuses: `pkg/models` for request/response types

## Flags

| Flag       | Default                 | Description                 |
| ---------- | ----------------------- | --------------------------- |
| `--count`  | 10                      | Number of results to return |
| `--server` | `http://localhost:8080` | Server URL                  |

## Error Handling

- Connection refused → "Cannot connect to server at <url>"
- Non-200 response → Show error message from response body
- No results → "No results found for query"

## Exit Codes

- 0: Success
- 1: Error

## Build

```bash
go build -o image-search ./cmd/cli
```
