package fixers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
)

func setupBMSTest(t *testing.T) (string, func()) {
	t.Helper()
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, ".dev-bms"), 0755)

	origBaseURL := bmsBaseURL
	origGetToken := getTokenFunc

	cleanup := func() {
		bmsBaseURL = origBaseURL
		getTokenFunc = origGetToken
	}
	return dir, cleanup
}

func mockToken(_ context.Context, _ string) (string, error) {
	return "test-token", nil
}

func mockTokenError(_ context.Context, _ string) (string, error) {
	return "", fmt.Errorf("AWS SSO expired")
}

func TestBMSRemoteSeedFixer_TokenFailure(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockTokenError

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err == nil {
		t.Fatal("expected error from token failure")
	}
	if !strings.Contains(err.Error(), "AWS SSO expired") {
		t.Errorf("expected AWS SSO error, got: %s", err)
	}

	status, _ := os.ReadFile(filepath.Join(dir, preflight.BMSSeedStatusFile))
	if !strings.Contains(string(status), "failed:") {
		t.Errorf("expected failed status, got: %s", status)
	}
}

func TestBMSRemoteSeedFixer_ExistingBudgetOK(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/api/v1/budgets/") {
			json.NewEncoder(w).Encode(budgetResponse{
				CreditsTotal: "1000000.000000",
				CreditsUsed:  "500.000000",
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.WriteFile(idPath, []byte("existing-budget-id\n"), 0644)

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	status, _ := os.ReadFile(filepath.Join(dir, preflight.BMSSeedStatusFile))
	if !strings.Contains(string(status), "ok") {
		t.Errorf("expected ok status, got: %s", status)
	}
}

func TestBMSRemoteSeedFixer_ExistingBudgetExhausted_TopUpSuccess(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/api/v1/budgets/") {
			json.NewEncoder(w).Encode(budgetResponse{
				CreditsTotal: "1000.000000",
				CreditsUsed:  "1000.000000",
			})
			return
		}
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/budget-items") {
			w.WriteHeader(http.StatusCreated)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.WriteFile(idPath, []byte("exhausted-budget-id\n"), 0644)

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	status, _ := os.ReadFile(filepath.Join(dir, preflight.BMSSeedStatusFile))
	if !strings.Contains(string(status), "ok") {
		t.Errorf("expected ok status, got: %s", status)
	}
}

func TestBMSRemoteSeedFixer_ExistingBudgetExhausted_TopUpFails(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/api/v1/budgets/") {
			json.NewEncoder(w).Encode(budgetResponse{
				CreditsTotal: "1000.000000",
				CreditsUsed:  "1000.000000",
			})
			return
		}
		if r.Method == http.MethodPost && strings.Contains(r.URL.Path, "/budget-items") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.WriteFile(idPath, []byte("exhausted-budget-id\n"), 0644)

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err == nil {
		t.Fatal("expected error from top-up failure")
	}
	if !strings.Contains(err.Error(), "top-up budget item") {
		t.Errorf("expected top-up error, got: %s", err)
	}
}

func TestBMSRemoteSeedFixer_Budget404_CreatesNew(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken
	newBudgetID := "new-budget-abc123"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/budgets" {
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(createBudgetResponse{BudgetID: newBudgetID})
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.WriteFile(idPath, []byte("deleted-budget-id\n"), 0644)

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	content, _ := os.ReadFile(idPath)
	if strings.TrimSpace(string(content)) != newBudgetID {
		t.Errorf("expected budget ID %q, got %q", newBudgetID, strings.TrimSpace(string(content)))
	}
}

func TestBMSRemoteSeedFixer_NoExistingFile_CreatesNew(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken
	newBudgetID := "fresh-budget-xyz"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/budgets" {
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(createBudgetResponse{BudgetID: newBudgetID})
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err != nil {
		t.Fatalf("unexpected error: %s", err)
	}

	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	content, _ := os.ReadFile(idPath)
	if strings.TrimSpace(string(content)) != newBudgetID {
		t.Errorf("expected budget ID %q, got %q", newBudgetID, strings.TrimSpace(string(content)))
	}
}

func TestBMSRemoteSeedFixer_CreateBudgetHTTPError(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/budgets" {
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "insufficient permissions"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err == nil {
		t.Fatal("expected error from create budget failure")
	}
	if !strings.Contains(err.Error(), "create budget") {
		t.Errorf("expected create budget error, got: %s", err)
	}
	if !strings.Contains(err.Error(), "403") {
		t.Errorf("expected HTTP 403 in error, got: %s", err)
	}
}

func TestBMSRemoteSeedFixer_FileWriteFailure_OrphanedBudget(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken
	newBudgetID := "orphan-budget-id"

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/budgets" {
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(createBudgetResponse{BudgetID: newBudgetID})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	// Write a pre-existing file as a directory to make WriteFile fail.
	idPath := filepath.Join(dir, preflight.BMSDevBudgetIDFile)
	os.Remove(idPath)
	os.MkdirAll(idPath, 0755)
	defer os.RemoveAll(idPath)

	fixer := &BMSRemoteSeedFixer{}
	err := fixer.Fix(context.Background(), dir)
	if err == nil {
		t.Fatal("expected error from file write failure")
	}
	if !strings.Contains(err.Error(), "orphaned remote budget") {
		t.Errorf("expected orphaned budget error, got: %s", err)
	}
	if !strings.Contains(err.Error(), newBudgetID) {
		t.Errorf("expected budget ID in error, got: %s", err)
	}

	status, _ := os.ReadFile(filepath.Join(dir, preflight.BMSSeedStatusFile))
	if !strings.Contains(string(status), "orphaned") {
		t.Errorf("expected orphaned in status, got: %s", status)
	}
	if !strings.Contains(string(status), newBudgetID) {
		t.Errorf("expected budget ID in status for manual cleanup, got: %s", status)
	}
}

func TestBMSRemoteSeedFixer_AuthorizationHeader(t *testing.T) {
	dir, cleanup := setupBMSTest(t)
	defer cleanup()

	getTokenFunc = mockToken
	var capturedAuth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		if r.Method == http.MethodPost && r.URL.Path == "/api/v1/budgets" {
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(createBudgetResponse{BudgetID: "auth-test-id"})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	bmsBaseURL = srv.URL

	fixer := &BMSRemoteSeedFixer{}
	_ = fixer.Fix(context.Background(), dir)

	if capturedAuth != "sso-jwt test-token" {
		t.Errorf("expected 'sso-jwt test-token', got %q", capturedAuth)
	}
}
