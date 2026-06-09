package api

import (
	"log/slog"
	"net"
	"net/http"
	"time"
)

// imagePrewarmer builds (and layer-caches) the app-container images. Satisfied
// by *docker.Manager; an interface so handler tests can inject a stub without
// invoking a real docker build.
type imagePrewarmer interface {
	PrewarmImages() error
}

// PrewarmImages builds the template + publish images to warm the Docker layer
// cache. It is a dev-only convenience: local-control-plane is never deployed,
// and this guard rejects any non-loopback caller as defense-in-depth.
func (s *Server) PrewarmImages(w http.ResponseWriter, r *http.Request) {
	if !isLoopbackRequest(r) {
		writeError(w, http.StatusForbidden, "prewarm-images is local-only")
		return
	}

	start := time.Now()
	slog.Info("prewarm.images.start")
	if err := s.imagePrewarmer.PrewarmImages(); err != nil {
		slog.Error("prewarm.images.failed", "error", err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	durationMs := time.Since(start).Milliseconds()
	slog.Info("prewarm.images.success", "duration_ms", durationMs)
	writeJSON(w, http.StatusOK, map[string]any{
		"images":     []string{"aab-template-v8:latest", "aab-publish:latest"},
		"durationMs": durationMs,
	})
}

// isLoopbackRequest reports whether the request originates from the local host.
func isLoopbackRequest(r *http.Request) bool {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
