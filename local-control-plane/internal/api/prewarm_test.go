package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type stubPrewarmer struct {
	called bool
	err    error
}

func (s *stubPrewarmer) PrewarmImages() error { s.called = true; return s.err }

func TestPrewarmImagesLoopbackAllowed(t *testing.T) {
	stub := &stubPrewarmer{}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "127.0.0.1:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if !stub.called {
		t.Error("PrewarmImages was not called")
	}
	if !strings.Contains(rec.Body.String(), "aab-template-v8:latest") {
		t.Errorf("body missing image names: %s", rec.Body.String())
	}
}

func TestPrewarmImagesNonLoopbackForbidden(t *testing.T) {
	stub := &stubPrewarmer{}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "10.0.0.5:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if stub.called {
		t.Error("PrewarmImages should not be called for non-loopback request")
	}
}

func TestPrewarmImagesBuildError(t *testing.T) {
	stub := &stubPrewarmer{err: errors.New("build image aab-template-v8: exit status 1")}
	srv := &Server{imagePrewarmer: stub}

	req := httptest.NewRequest(http.MethodPost, "/api/_debug/prewarm-images", nil)
	req.RemoteAddr = "[::1]:54321"
	rec := httptest.NewRecorder()

	srv.PrewarmImages(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "build image") {
		t.Errorf("body missing error: %s", rec.Body.String())
	}
}
