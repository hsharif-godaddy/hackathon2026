package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetHealthReturnsOK(t *testing.T) {
	srv := &Server{Environment: "test", Version: "0.0.0"}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type: want application/json, got %q", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json decode: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("status: want ok, got %q", body["status"])
	}
	if body["environment"] != "test" {
		t.Errorf("environment: want test, got %q", body["environment"])
	}
	if body["version"] != "0.0.0" {
		t.Errorf("version: want 0.0.0, got %q", body["version"])
	}
}

func TestGetHealthHEADReturnsOKNoBody(t *testing.T) {
	srv := &Server{Environment: "test", Version: "0.0.0"}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodHead, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("HEAD response should have empty body; got %d bytes", rec.Body.Len())
	}
}

func TestUnknownRouteReturns404JSON(t *testing.T) {
	srv := &Server{Environment: "test", Version: "0.0.0"}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodGet, "/nope", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json decode: %v", err)
	}
	if body["code"] != "NOT_FOUND" {
		t.Errorf("code: want NOT_FOUND, got %q", body["code"])
	}
}

func TestWrongMethodReturns405JSON(t *testing.T) {
	srv := &Server{Environment: "test", Version: "0.0.0"}
	h := NewRouter(srv)

	req := httptest.NewRequest(http.MethodPost, "/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status: want 405, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type: want application/json, got %q", ct)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json decode: %v", err)
	}
	if body["code"] != "METHOD_NOT_ALLOWED" {
		t.Errorf("code: want METHOD_NOT_ALLOWED, got %q", body["code"])
	}
	if body["error"] == "" {
		t.Error("error field should be non-empty")
	}
}
