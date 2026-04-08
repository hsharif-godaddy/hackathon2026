package checks

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func TestGettyCheck_NotEnabled(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "NODE_ENV=development\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_EnabledWithCreds(t *testing.T) {
	// Start a test server that returns 200 for valid tokens
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer test-token" {
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, `{"result_count":0,"images":[]}`)
			return
		}
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer ts.Close()

	root := t.TempDir()
	writeAgentsEnv(t, root, fmt.Sprintf("IMAGE_SEARCH_DRIVER=getty\nGETTY_API_URL=%s\nGETTY_TOKEN=test-token\n", ts.URL))

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_EnabledExpiredToken(t *testing.T) {
	// Start a test server that rejects the token
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer ts.Close()

	root := t.TempDir()
	writeAgentsEnv(t, root, fmt.Sprintf("IMAGE_SEARCH_DRIVER=getty\nGETTY_API_URL=%s\nGETTY_TOKEN=expired-token\n", ts.URL))

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true for expired token")
	}
}

func TestGettyCheck_EnabledMissingCreds(t *testing.T) {
	root := t.TempDir()
	writeAgentsEnv(t, root, "IMAGE_SEARCH_DRIVER=getty\n")

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusWarn {
		t.Errorf("expected Warn, got %v: %s", result.Status, result.Message)
	}
}

func TestGettyCheck_MissingEnvFile(t *testing.T) {
	root := t.TempDir()

	result := (&GettyCheck{}).Run(context.Background(), root)
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}
