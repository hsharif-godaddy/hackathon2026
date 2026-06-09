package prewarm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWarmImagesSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/_debug/prewarm-images" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"images":["aab-template-v8:latest","aab-publish:latest"],"durationMs":1234}`))
	}))
	defer srv.Close()

	var out strings.Builder
	if err := WarmImages(context.Background(), srv.URL, &out); err != nil {
		t.Fatalf("WarmImages error: %v", err)
	}
	if !strings.Contains(out.String(), "aab-template-v8:latest") {
		t.Errorf("output missing image names:\n%s", out.String())
	}
}

func TestWarmImagesBuildError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"build image aab-template-v8: exit status 1"}`))
	}))
	defer srv.Close()

	err := WarmImages(context.Background(), srv.URL, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "build image") {
		t.Errorf("WarmImages err = %v, want build error", err)
	}
}

func TestWarmImagesControlPlaneDown(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close()
	if err := WarmImages(context.Background(), url, &strings.Builder{}); err == nil {
		t.Error("WarmImages = nil, want connection error when control plane is down")
	}
}

// A 200 with a non-JSON body (e.g. a different process bound to the port, or a
// proxy injecting HTML) must surface an error, not a fabricated success.
func TestWarmImagesMalformed200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>not the control plane</html>"))
	}))
	defer srv.Close()

	var out strings.Builder
	err := WarmImages(context.Background(), srv.URL, &out)
	if err == nil || !strings.Contains(err.Error(), "non-JSON") {
		t.Errorf("WarmImages err = %v, want non-JSON error", err)
	}
	if strings.Contains(out.String(), "images built") {
		t.Errorf("must not report success on malformed 200; got:\n%s", out.String())
	}
}

// A 200 with valid JSON but zero images means the server claimed success
// without building anything — treat as an error.
func TestWarmImagesEmptyImages(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"images":[],"durationMs":3}`))
	}))
	defer srv.Close()

	err := WarmImages(context.Background(), srv.URL, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "no images") {
		t.Errorf("WarmImages err = %v, want no-images error", err)
	}
}

// A non-200 with an empty body falls back to status + raw body (no panic, clear error).
func TestWarmImagesNon200EmptyBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer srv.Close()

	err := WarmImages(context.Background(), srv.URL, &strings.Builder{})
	if err == nil || !strings.Contains(err.Error(), "502") {
		t.Errorf("WarmImages err = %v, want HTTP 502 error", err)
	}
}
