package httpproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"time"
)

// handleHealthCheck handles health check requests for the proxy.
func (p *HTTPProxy) handleHealthCheck(w http.ResponseWriter, r *http.Request) {
	slog.Debug("proxy.health.check", "remote_addr", r.RemoteAddr)

	// CORS headers are set by CORS middleware (outermost layer)
	// Set content type and cache control headers
	// Health check responses should never be cached as they reflect real-time status
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Check if proxy is enabled (shouldn't happen as handler is only registered when enabled)
	if !p.config.Enabled {
		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "proxy not enabled",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("proxy.health.encode_error", "error", err)
		}
		return
	}

	// Check if process is idled but was healthy before idle (start-on-request mode only)
	// This allows health checks to pass for idled apps without waking them
	if p.procMgr != nil && p.startOnRequestEnabled {
		status := p.procMgr.GetStatus()
		if status.State == ProcessStateStopped && p.procMgr.WasHealthyBeforeIdle() {
			slog.Debug("proxy.health.idle_healthy",
				"remote_addr", r.RemoteAddr,
				"state", status.State)

			resp := ProxyHealthResponse{
				Status: "healthy",
				Reason: "idle",
			}
			w.WriteHeader(http.StatusOK)
			if err := json.NewEncoder(w).Encode(resp); err != nil {
				slog.Error("proxy.health.encode_error", "error", err)
			}
			return
		}
	}

	// Perform HTTP GET to target with timeout
	targetURL := fmt.Sprintf(
		"http://%s/",
		net.JoinHostPort(p.config.TargetHost, strconv.Itoa(p.config.TargetPort)),
	)

	client := &http.Client{
		Timeout: 5 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			// Don't follow redirects - 3xx responses are not considered healthy
			return http.ErrUseLastResponse
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, targetURL, nil)
	if err != nil {
		slog.Debug("proxy.health.request_error",
			"target", targetURL,
			"error", err.Error())

		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "failed to create request",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
			slog.Error("proxy.health.encode_error", "error", encodeErr)
		}
		return
	}

	httpResp, err := client.Do(req)
	if err != nil {
		slog.Debug("proxy.health.target_unreachable",
			"target", targetURL,
			"error", err.Error())

		resp := ProxyHealthResponse{
			Status: "unhealthy",
			Reason: "target not reachable",
		}
		w.WriteHeader(http.StatusServiceUnavailable)
		if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
			slog.Error("proxy.health.encode_error", "error", encodeErr)
		}
		return
	}
	defer httpResp.Body.Close()

	// Discard response body
	if _, discardErr := io.Copy(io.Discard, httpResp.Body); discardErr != nil {
		slog.Debug("proxy.health.discard_error", "error", discardErr.Error())
	}

	// Check status code - only 2xx is healthy (aligned with mhp-core SimpleDomainHealthService)
	if httpResp.StatusCode >= 200 && httpResp.StatusCode < 300 {
		// Target is healthy
		resp := ProxyHealthResponse{
			Status: "healthy",
		}
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(resp); err != nil {
			slog.Error("proxy.health.encode_error", "error", err)
		}
		return
	}

	// Target returned error status
	slog.Debug("proxy.health.target_error",
		"target", targetURL,
		"status", httpResp.StatusCode)

	resp := ProxyHealthResponse{
		Status: "unhealthy",
		Reason: fmt.Sprintf("target returned status %d", httpResp.StatusCode),
	}
	w.WriteHeader(http.StatusServiceUnavailable)
	if encodeErr := json.NewEncoder(w).Encode(resp); encodeErr != nil {
		slog.Error("proxy.health.encode_error", "error", encodeErr)
	}
}
