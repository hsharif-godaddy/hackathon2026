// internal/auth/middleware_test.go
package auth

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/mux"

	"github.com/airo-ai-builder/budget-service/internal/config"
	"github.com/airo-ai-builder/budget-service/pkg/testauth"
)

func TestNewMiddleware_LoadsAllowlistFromEnv(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
		AuthAdminAllowlist: "admin1.example.com,admin2.example.com,iam:service1",
	}

	m, err := NewMiddleware(cfg)
	if err != nil {
		t.Fatalf("NewMiddleware failed: %v", err)
	}

	tests := []struct {
		identity string
		allowed  bool
	}{
		{"admin1.example.com", true},
		{"admin2.example.com", true},
		{"iam:service1", true},
		{"unknown.example.com", false},
	}

	for _, tt := range tests {
		if m.adminAllowlist[tt.identity] != tt.allowed {
			t.Errorf("allowlist[%s] = %v, want %v", tt.identity, m.adminAllowlist[tt.identity], tt.allowed)
		}
	}
}

func TestNewMiddleware_LoadsAllowlistFromFile(t *testing.T) {
	tmpDir := t.TempDir()
	allowlistFile := filepath.Join(tmpDir, "allowlist.json")
	content := `{"allowed": ["file-admin1.example.com", "file-admin2.example.com"]}`
	if err := os.WriteFile(allowlistFile, []byte(content), 0644); err != nil {
		t.Fatalf("Failed to write temp file: %v", err)
	}

	cfg := &config.Config{
		AuthMode:               "test",
		AuthTestSigningKey:     "test-key",
		AuthAdminAllowlist:     "env-admin.example.com",
		AuthAdminAllowlistFile: allowlistFile,
	}

	m, err := NewMiddleware(cfg)
	if err != nil {
		t.Fatalf("NewMiddleware failed: %v", err)
	}

	tests := []struct {
		identity string
		allowed  bool
	}{
		{"env-admin.example.com", true},
		{"file-admin1.example.com", true},
		{"file-admin2.example.com", true},
		{"unknown.example.com", false},
	}

	for _, tt := range tests {
		if m.adminAllowlist[tt.identity] != tt.allowed {
			t.Errorf("allowlist[%s] = %v, want %v", tt.identity, m.adminAllowlist[tt.identity], tt.allowed)
		}
	}
}

func TestNewMiddleware_TestModeRequiresSigningKey(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "",
	}

	_, err := NewMiddleware(cfg)
	if err == nil {
		t.Error("expected error for missing signing key in test mode")
	}
}

func TestExtractAuth_MissingToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("GET", "/test", nil)
	rr := httptest.NewRecorder()

	handler := m.ExtractAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestExtractAuth_InvalidToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rr := httptest.NewRecorder()

	handler := m.ExtractAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestExtractAuth_ExpiredToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	token, _ := testauth.SignTestToken("test-key", "sub-123", -time.Hour)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	handler := m.ExtractAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestExtractAuth_ValidSubscriptionToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	token, _ := testauth.SignTestToken("test-key", "sub-123", time.Hour)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	var capturedCtx *AuthContext
	handler := m.ExtractAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedCtx = GetAuthContext(r)
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	if capturedCtx == nil {
		t.Fatal("AuthContext not set")
	}
	if capturedCtx.SubscriptionID != "sub-123" {
		t.Errorf("expected subscriptionId sub-123, got %s", capturedCtx.SubscriptionID)
	}
	if capturedCtx.IsAdmin {
		t.Error("expected IsAdmin to be false")
	}
}

func TestExtractAuth_ValidAdminToken(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	token, _ := testauth.SignAdminTestToken("test-key", "admin.example.com", false, time.Hour)

	req := httptest.NewRequest("GET", "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	var capturedCtx *AuthContext
	handler := m.ExtractAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedCtx = GetAuthContext(r)
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	if capturedCtx == nil {
		t.Fatal("AuthContext not set")
	}
	if !capturedCtx.IsAdmin {
		t.Error("expected IsAdmin to be true")
	}
	if capturedCtx.AdminIdentity != "admin.example.com" {
		t.Errorf("expected AdminIdentity admin.example.com, got %s", capturedCtx.AdminIdentity)
	}
}

func TestRequireSubscription_NoAuthContext(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("GET", "/subscriptions/sub-123/budgets", nil)
	req = mux.SetURLVars(req, map[string]string{"subscriptionId": "sub-123"})
	rr := httptest.NewRecorder()

	handler := m.RequireSubscription(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", rr.Code)
	}
}

func TestRequireSubscription_Mismatch(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("GET", "/subscriptions/sub-456/budgets", nil)
	req = mux.SetURLVars(req, map[string]string{"subscriptionId": "sub-456"})
	// Set auth context with different subscription
	ctx := WithAuthContext(req.Context(), &AuthContext{SubscriptionID: "sub-123"})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handler := m.RequireSubscription(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}
}

func TestRequireSubscription_Match(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("GET", "/subscriptions/sub-123/budgets", nil)
	req = mux.SetURLVars(req, map[string]string{"subscriptionId": "sub-123"})
	ctx := WithAuthContext(req.Context(), &AuthContext{SubscriptionID: "sub-123"})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handlerCalled := false
	handler := m.RequireSubscription(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	if !handlerCalled {
		t.Error("handler was not called")
	}
}

func TestRequireAdmin_NoAuthContext(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("POST", "/budgets", nil)
	rr := httptest.NewRecorder()

	handler := m.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("expected status 500, got %d", rr.Code)
	}
}

func TestRequireAdmin_NotAdmin(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("POST", "/budgets", nil)
	ctx := WithAuthContext(req.Context(), &AuthContext{
		SubscriptionID: "sub-123",
		IsAdmin:        false,
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handler := m.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}
}

func TestRequireAdmin_NotInAllowlist(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
		AuthAdminAllowlist: "allowed.example.com",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("POST", "/budgets", nil)
	ctx := WithAuthContext(req.Context(), &AuthContext{
		IsAdmin:       true,
		AdminIdentity: "not-allowed.example.com",
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handler := m.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler should not be called")
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}
}

func TestRequireAdmin_Allowed(t *testing.T) {
	cfg := &config.Config{
		AuthMode:           "test",
		AuthTestSigningKey: "test-key",
		AuthAdminAllowlist: "allowed.example.com,other.example.com",
	}
	m, _ := NewMiddleware(cfg)

	req := httptest.NewRequest("POST", "/budgets", nil)
	ctx := WithAuthContext(req.Context(), &AuthContext{
		IsAdmin:       true,
		AdminIdentity: "allowed.example.com",
	})
	req = req.WithContext(ctx)
	rr := httptest.NewRecorder()

	handlerCalled := false
	handler := m.RequireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusOK)
	}))

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	if !handlerCalled {
		t.Error("handler was not called")
	}
}
