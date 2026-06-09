package prewarm

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// imagesResponse is the JSON shape returned by the LCP prewarm endpoint.
type imagesResponse struct {
	Images     []string `json:"images"`
	DurationMs int64    `json:"durationMs"`
	Error      string   `json:"error"`
}

// WarmImages asks local-control-plane to build (and thus layer-cache) the
// app-container images so a subsequent per-app build is a cache hit. It POSTs
// the loopback-guarded endpoint and relays the result to out. The build runs
// synchronously server-side and can take minutes on a cold cache, so no client
// timeout is imposed beyond ctx.
func WarmImages(ctx context.Context, controlPlaneURL string, out io.Writer) error {
	url := strings.TrimRight(controlPlaneURL, "/") + "/api/_debug/prewarm-images"
	fmt.Fprintf(out, "[prewarm] building images via %s ...\n", url)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("contact control plane: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)
	var parsed imagesResponse
	// On the non-200 path the unmarshal error is intentionally ignored — the
	// branch below falls back to the raw body + status, which is correct.
	unmarshalErr := json.Unmarshal(body, &parsed)

	if resp.StatusCode != http.StatusOK {
		if parsed.Error != "" {
			return fmt.Errorf("prewarm-images failed: %s", parsed.Error)
		}
		return fmt.Errorf("prewarm-images failed: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	// 200 must carry valid JSON with at least one image; otherwise something
	// other than the real LCP handler answered (port/identity mismatch, proxy
	// HTML, truncated write). Surface it instead of a fabricated success.
	if unmarshalErr != nil {
		return fmt.Errorf("prewarm-images: unexpected non-JSON response (HTTP 200): %s", strings.TrimSpace(string(body)))
	}
	if len(parsed.Images) == 0 {
		return fmt.Errorf("prewarm-images: server reported success but built no images")
	}
	fmt.Fprintf(out, "[prewarm] images built in %dms: %s\n", parsed.DurationMs, strings.Join(parsed.Images, ", "))
	return nil
}
