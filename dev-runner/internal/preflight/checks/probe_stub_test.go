package checks

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/jfrog"
)

// stubProbe redirects jfrog.Probe at a local httptest server that returns
// the given status, regardless of token value. Restores the original
// endpoint on test cleanup. Used by both ArtifactoryCheck and GoProxyCheck
// tests that need to control probe responses.
func stubProbe(t *testing.T, status int) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
	}))
	t.Cleanup(srv.Close)

	prev := jfrog.ValidateEndpoint
	jfrog.ValidateEndpoint = srv.URL
	t.Cleanup(func() { jfrog.ValidateEndpoint = prev })
}

// stubProbeUnreachable points jfrog.Probe at a closed local listener so it
// fails with a deterministic "connection refused" -- a non-auth network
// error. Avoids depending on TEST-NET-1 (192.0.2.1) routing, which can be
// intercepted by transparent proxies in some corp/VPN environments.
func stubProbeUnreachable(t *testing.T) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	url := srv.URL
	srv.Close()

	prev := jfrog.ValidateEndpoint
	jfrog.ValidateEndpoint = url
	t.Cleanup(func() { jfrog.ValidateEndpoint = prev })
}
