package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	_ "github.com/lib/pq"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

type fakeTokenProvider struct {
	healthy   bool
	lastError error
}

func (f *fakeTokenProvider) GetToken() (string, error) {
	return "", nil
}

func (f *fakeTokenProvider) Healthy() bool {
	return f.healthy
}

func (f *fakeTokenProvider) LastError() error {
	return f.lastError
}

func TestGetHealthNoDatabaseNoTokenGenerator(t *testing.T) {
	t.Parallel()
	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "ok" {
		t.Fatalf("status field %v", body["status"])
	}
	db, _ := body["database"].(map[string]any)
	if db["ok"] != false || db["configured"] != false {
		t.Fatalf("database %v", db)
	}
	tg, _ := body["tokenGenerator"].(map[string]any)
	if tg["ok"] != true || tg["configured"] != false {
		t.Fatalf("tokenGenerator %v", tg)
	}
}

func TestGetHealthHealthyTokenGenerator(t *testing.T) {
	t.Parallel()
	s := &Server{
		TokenGenerator: &fakeTokenProvider{healthy: true},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	tg, _ := body["tokenGenerator"].(map[string]any)
	if tg["ok"] != true {
		t.Fatalf("tokenGenerator %v", tg)
	}
	if _, hasConfigured := tg["configured"]; hasConfigured {
		t.Fatalf("expected no configured flag when generator present, got %v", tg)
	}
}

func TestGetHealthUnhealthyTokenGeneratorWithLastError(t *testing.T) {
	t.Parallel()
	errFail := errors.New("token refresh failed")
	s := &Server{
		TokenGenerator: &fakeTokenProvider{healthy: false, lastError: errFail},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "unhealthy" {
		t.Fatalf("status %v", body["status"])
	}
	tg, _ := body["tokenGenerator"].(map[string]any)
	if tg["ok"] != false {
		t.Fatalf("tokenGenerator %v", tg)
	}
	if tg["error"] != errFail.Error() {
		t.Fatalf("error %v", tg["error"])
	}
}

func TestGetHealthUnhealthyTokenGeneratorNoLastError(t *testing.T) {
	t.Parallel()
	s := &Server{
		TokenGenerator: &fakeTokenProvider{healthy: false, lastError: nil},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	tg, _ := body["tokenGenerator"].(map[string]any)
	if tg["ok"] != false {
		t.Fatalf("tokenGenerator %v", tg)
	}
	if _, has := tg["error"]; has {
		t.Fatalf("expected no error key, got %v", tg)
	}
}

func TestGetHealthHEADNoBody(t *testing.T) {
	t.Parallel()
	s := &Server{}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type %q", rec.Header().Get("Content-Type"))
	}
	if strings.TrimSpace(rec.Body.String()) != "" {
		t.Fatalf("body should be empty, got %q", rec.Body.String())
	}
}

func TestGetHealthHEADUnhealthyNoBody(t *testing.T) {
	t.Parallel()
	s := &Server{
		TokenGenerator: &fakeTokenProvider{healthy: false},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodHead, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d", rec.Code)
	}
	if strings.TrimSpace(rec.Body.String()) != "" {
		t.Fatalf("body should be empty, got %q", rec.Body.String())
	}
}

func closedLocalTCPAddr(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	return addr
}

func TestGetHealthDatabasePingFailure(t *testing.T) {
	t.Parallel()
	addr := closedLocalTCPAddr(t)
	db, err := sql.Open("postgres", fmt.Sprintf(
		"postgres://nouser:nopass@%s/nodb?sslmode=disable&connect_timeout=2", addr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s := &Server{Store: store.New(db)}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil).WithContext(ctx)
	s.getHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "degraded" {
		t.Fatalf("status %v", body["status"])
	}
	dbOut, _ := body["database"].(map[string]any)
	if dbOut["ok"] != false {
		t.Fatalf("database %v", dbOut)
	}
}

func TestGetHealthDatabasePingFailureAndUnhealthyTokenGenerator(t *testing.T) {
	t.Parallel()
	addr := closedLocalTCPAddr(t)
	db, err := sql.Open("postgres", fmt.Sprintf(
		"postgres://nouser:nopass@%s/nodb?sslmode=disable&connect_timeout=2", addr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s := &Server{
		Store:          store.New(db),
		TokenGenerator: &fakeTokenProvider{healthy: false, lastError: errors.New("token down")},
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil).WithContext(ctx)
	s.getHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "unhealthy" {
		t.Fatalf("want token branch to win; got status %v", body["status"])
	}
	dbOut, _ := body["database"].(map[string]any)
	if dbOut["ok"] != false {
		t.Fatalf("database %v", dbOut)
	}
	tg, _ := body["tokenGenerator"].(map[string]any)
	if tg["ok"] != false {
		t.Fatalf("tokenGenerator %v", tg)
	}
}

func TestGetHealthDatabasePingOK(t *testing.T) {
	st := testStore(t)
	s := &Server{Store: st}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	s.getHealth(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	dbOut, _ := body["database"].(map[string]any)
	if dbOut["ok"] != true {
		t.Fatalf("database %v", dbOut)
	}
}
