# Auth Middleware Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement composable auth middleware supporting test mode (local JWT), app/agent JWT with subscription validation, and admin JWT with allowlist.

**Architecture:** Middleware chain pattern - ExtractAuth parses JWT and populates AuthContext, RequireSubscription validates URL match, RequireAdmin validates allowlist. Routes compose middleware based on needs.

**Tech Stack:** Go 1.21+, github.com/golang-jwt/jwt/v5, github.com/gorilla/mux

---

## Task 1: Add Auth Error Codes

**Files:**

- Modify: `pkg/errors/errors.go`

**Step 1: Add auth error codes to existing file**

Add these constants and errors to `pkg/errors/errors.go`:

```go
// Auth errors
const (
	CodeMissingAuthToken     = "MISSING_AUTH_TOKEN"
	CodeInvalidToken         = "INVALID_TOKEN"
	CodeTokenExpired         = "TOKEN_EXPIRED"
	CodeSubscriptionMismatch = "SUBSCRIPTION_MISMATCH"
	CodeAdminRequired        = "ADMIN_REQUIRED"
	CodeAdminNotAllowed      = "ADMIN_NOT_ALLOWED"
	CodeAuthContextMissing   = "AUTH_CONTEXT_MISSING"
)

var (
	ErrMissingAuthToken = APIError{
		Code:    CodeMissingAuthToken,
		Message: "authorization header required",
	}
	ErrInvalidToken = APIError{
		Code:    CodeInvalidToken,
		Message: "invalid or malformed token",
	}
	ErrTokenExpired = APIError{
		Code:    CodeTokenExpired,
		Message: "token has expired",
	}
	ErrSubscriptionMismatch = APIError{
		Code:    CodeSubscriptionMismatch,
		Message: "token subscription does not match requested resource",
	}
	ErrAdminRequired = APIError{
		Code:    CodeAdminRequired,
		Message: "admin authentication required",
	}
	ErrAdminNotAllowed = APIError{
		Code:    CodeAdminNotAllowed,
		Message: "admin identity not in allowlist",
	}
	ErrAuthContextMissing = APIError{
		Code:    CodeAuthContextMissing,
		Message: "auth context not found - middleware ordering error",
	}
)
```

**Step 2: Verify build**

Run: `go build ./...`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add pkg/errors/errors.go
git commit -m "feat(budget-service): add auth error codes"
```

---

## Task 2: Add Auth Config Fields

**Files:**

- Modify: `internal/config/config.go`
- Modify: `internal/config/config_test.go`

**Step 1: Add auth fields to Config struct**

In `internal/config/config.go`, add to the Config struct:

```go
type Config struct {
	// ... existing fields ...

	// Auth
	AuthMode               string // "test" or "jwt" (default: jwt)
	AuthJWKSURL            string // JWKS endpoint for production JWT validation
	AuthTestSigningKey     string // HMAC key for test mode JWT signing/validation
	AuthAdminAllowlist     string // Comma-separated CNAMEs/IAM identities
	AuthAdminAllowlistFile string // Path to JSON file with additional identities
}
```

**Step 2: Add to LoadConfig()**

Add these lines to `LoadConfig()`:

```go
AuthMode:               getEnvString("AUTH_MODE", "jwt"),
AuthJWKSURL:            getEnvString("AUTH_JWKS_URL", ""),
AuthTestSigningKey:     getEnvString("AUTH_TEST_SIGNING_KEY", ""),
AuthAdminAllowlist:     getEnvString("AUTH_ADMIN_ALLOWLIST", ""),
AuthAdminAllowlistFile: getEnvString("AUTH_ADMIN_ALLOWLIST_FILE", ""),
```

**Step 3: Add tests to config_test.go**

Add to `TestLoadConfig_Defaults`:

```go
{"AuthMode", cfg.AuthMode, "jwt"},
{"AuthJWKSURL", cfg.AuthJWKSURL, ""},
{"AuthTestSigningKey", cfg.AuthTestSigningKey, ""},
{"AuthAdminAllowlist", cfg.AuthAdminAllowlist, ""},
{"AuthAdminAllowlistFile", cfg.AuthAdminAllowlistFile, ""},
```

Add to `TestLoadConfig_FromEnv` env vars:

```go
"AUTH_MODE":                "test",
"AUTH_JWKS_URL":            "https://auth.example.com/.well-known/jwks.json",
"AUTH_TEST_SIGNING_KEY":    "test-secret-key-for-signing",
"AUTH_ADMIN_ALLOWLIST":     "admin1.example.com,admin2.example.com",
"AUTH_ADMIN_ALLOWLIST_FILE": "/etc/budget-service/admin-allowlist.json",
```

Add corresponding test assertions:

```go
{"AuthMode", cfg.AuthMode, "test"},
{"AuthJWKSURL", cfg.AuthJWKSURL, "https://auth.example.com/.well-known/jwks.json"},
{"AuthTestSigningKey", cfg.AuthTestSigningKey, "test-secret-key-for-signing"},
{"AuthAdminAllowlist", cfg.AuthAdminAllowlist, "admin1.example.com,admin2.example.com"},
{"AuthAdminAllowlistFile", cfg.AuthAdminAllowlistFile, "/etc/budget-service/admin-allowlist.json"},
```

**Step 4: Run tests**

Run: `go test ./internal/config/... -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(budget-service): add auth config fields"
```

---

## Task 3: Add JWT Dependency

**Files:**

- Modify: `go.mod`

**Step 1: Add jwt dependency**

Run: `go get github.com/golang-jwt/jwt/v5`
Expected: go.mod updated with jwt dependency

**Step 2: Tidy**

Run: `go mod tidy`
Expected: go.sum updated

**Step 3: Commit**

```bash
git add go.mod go.sum
git commit -m "chore(budget-service): add golang-jwt dependency"
```

---

## Task 4: Create Auth Types and Context

**Files:**

- Create: `internal/auth/types.go`
- Create: `internal/auth/context.go`

**Step 1: Create types.go**

Create `internal/auth/types.go`:

```go
// internal/auth/types.go
package auth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// AuthMode determines how JWTs are validated.
type AuthMode string

const (
	AuthModeTest AuthMode = "test" // Local JWT signing with test key
	AuthModeJWT  AuthMode = "jwt"  // Production JWKS validation
)

// SubscriptionClaims for app/agent JWTs.
type SubscriptionClaims struct {
	jwt.RegisteredClaims
	SubscriptionID string `json:"subscriptionId"`
}

// AdminClaims for admin JWTs (GoDaddy format).
type AdminClaims struct {
	jwt.RegisteredClaims
	CNAME string `json:"cname,omitempty"`
	IAM   string `json:"iam,omitempty"`
}

// AuthContext holds extracted authentication info.
type AuthContext struct {
	SubscriptionID string
	IsAdmin        bool
	AdminIdentity  string
	Exp            time.Time
	Iat            time.Time
}
```

**Step 2: Create context.go**

Create `internal/auth/context.go`:

```go
// internal/auth/context.go
package auth

import (
	"context"
	"net/http"
)

type contextKey string

const authContextKey contextKey = "authContext"

// WithAuthContext attaches AuthContext to the request context.
func WithAuthContext(ctx context.Context, authCtx *AuthContext) context.Context {
	return context.WithValue(ctx, authContextKey, authCtx)
}

// GetAuthContext retrieves AuthContext from the request.
// Returns nil if not present.
func GetAuthContext(r *http.Request) *AuthContext {
	val := r.Context().Value(authContextKey)
	if val == nil {
		return nil
	}
	return val.(*AuthContext)
}
```

**Step 3: Verify build**

Run: `go build ./...`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add internal/auth/types.go internal/auth/context.go
git commit -m "feat(budget-service): add auth types and context"
```

---

## Task 5: Create Test Auth Helper Package

**Files:**

- Create: `pkg/testauth/testauth.go`
- Create: `pkg/testauth/testauth_test.go`

**Step 1: Create testauth.go**

Create `pkg/testauth/testauth.go`:

```go
// pkg/testauth/testauth.go
package testauth

import (
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// SubscriptionClaims for app/agent test JWTs.
type SubscriptionClaims struct {
	jwt.RegisteredClaims
	SubscriptionID string `json:"subscriptionId"`
}

// AdminClaims for admin test JWTs.
type AdminClaims struct {
	jwt.RegisteredClaims
	CNAME string `json:"cname,omitempty"`
	IAM   string `json:"iam,omitempty"`
}

// SignTestToken creates a signed subscription JWT for integration tests.
func SignTestToken(signingKey string, subscriptionID string, expiry time.Duration) (string, error) {
	claims := SubscriptionClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
		SubscriptionID: subscriptionID,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(signingKey))
}

// SignAdminTestToken creates a signed admin JWT for integration tests.
func SignAdminTestToken(signingKey string, identity string, isIAM bool, expiry time.Duration) (string, error) {
	claims := AdminClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	if isIAM {
		claims.IAM = identity
	} else {
		claims.CNAME = identity
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(signingKey))
}
```

**Step 2: Create testauth_test.go**

Create `pkg/testauth/testauth_test.go`:

```go
// pkg/testauth/testauth_test.go
package testauth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSignTestToken(t *testing.T) {
	signingKey := "test-secret-key"
	subscriptionID := "sub-123"

	tokenString, err := SignTestToken(signingKey, subscriptionID, time.Hour)
	if err != nil {
		t.Fatalf("SignTestToken failed: %v", err)
	}

	// Parse and verify
	token, err := jwt.ParseWithClaims(tokenString, &SubscriptionClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*SubscriptionClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.SubscriptionID != subscriptionID {
		t.Errorf("expected subscriptionId %s, got %s", subscriptionID, claims.SubscriptionID)
	}
}

func TestSignAdminTestToken_CNAME(t *testing.T) {
	signingKey := "test-secret-key"
	cname := "admin.example.com"

	tokenString, err := SignAdminTestToken(signingKey, cname, false, time.Hour)
	if err != nil {
		t.Fatalf("SignAdminTestToken failed: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &AdminClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*AdminClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.CNAME != cname {
		t.Errorf("expected CNAME %s, got %s", cname, claims.CNAME)
	}
	if claims.IAM != "" {
		t.Errorf("expected empty IAM, got %s", claims.IAM)
	}
}

func TestSignAdminTestToken_IAM(t *testing.T) {
	signingKey := "test-secret-key"
	iam := "iam:service-account"

	tokenString, err := SignAdminTestToken(signingKey, iam, true, time.Hour)
	if err != nil {
		t.Fatalf("SignAdminTestToken failed: %v", err)
	}

	token, err := jwt.ParseWithClaims(tokenString, &AdminClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(signingKey), nil
	})
	if err != nil {
		t.Fatalf("Failed to parse token: %v", err)
	}

	claims, ok := token.Claims.(*AdminClaims)
	if !ok {
		t.Fatal("Failed to get claims")
	}

	if claims.IAM != iam {
		t.Errorf("expected IAM %s, got %s", iam, claims.IAM)
	}
	if claims.CNAME != "" {
		t.Errorf("expected empty CNAME, got %s", claims.CNAME)
	}
}
```

**Step 3: Run tests**

Run: `go test ./pkg/testauth/... -v`
Expected: All 3 tests pass

**Step 4: Commit**

```bash
git add pkg/testauth/testauth.go pkg/testauth/testauth_test.go
git commit -m "feat(budget-service): add test auth helper package"
```

---

## Task 6: Create Middleware Struct and Allowlist Loading

**Files:**

- Create: `internal/auth/middleware.go`
- Create: `internal/auth/middleware_test.go`

**Step 1: Write test for allowlist loading**

Create `internal/auth/middleware_test.go`:

```go
// internal/auth/middleware_test.go
package auth

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/budget-service/internal/config"
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
	// Create temp file
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

	// Should have both env and file entries
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
		AuthTestSigningKey: "", // Missing!
	}

	_, err := NewMiddleware(cfg)
	if err == nil {
		t.Error("expected error for missing signing key in test mode")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `go test ./internal/auth/... -v`
Expected: FAIL - NewMiddleware not defined

**Step 3: Create middleware.go**

Create `internal/auth/middleware.go`:

```go
// internal/auth/middleware.go
package auth

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/airo-ai-builder/budget-service/internal/config"
)

// Middleware provides authentication and authorization handlers.
type Middleware struct {
	config         *config.Config
	adminAllowlist map[string]bool
	testSigningKey []byte
}

// allowlistFile represents the JSON structure of the allowlist file.
type allowlistFile struct {
	Allowed []string `json:"allowed"`
}

// NewMiddleware creates authentication middleware with the given configuration.
func NewMiddleware(cfg *config.Config) (*Middleware, error) {
	m := &Middleware{
		config:         cfg,
		adminAllowlist: make(map[string]bool),
	}

	// Validate test mode requirements
	if cfg.AuthMode == "test" && cfg.AuthTestSigningKey == "" {
		return nil, fmt.Errorf("AUTH_TEST_SIGNING_KEY required in test mode")
	}
	m.testSigningKey = []byte(cfg.AuthTestSigningKey)

	// Load allowlist from env var
	if cfg.AuthAdminAllowlist != "" {
		for _, identity := range strings.Split(cfg.AuthAdminAllowlist, ",") {
			identity = strings.TrimSpace(identity)
			if identity != "" {
				m.adminAllowlist[identity] = true
			}
		}
	}

	// Load allowlist from file
	if cfg.AuthAdminAllowlistFile != "" {
		if err := m.loadAllowlistFile(cfg.AuthAdminAllowlistFile); err != nil {
			return nil, fmt.Errorf("failed to load allowlist file: %w", err)
		}
	}

	return m, nil
}

func (m *Middleware) loadAllowlistFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}

	var f allowlistFile
	if err := json.Unmarshal(data, &f); err != nil {
		return err
	}

	for _, identity := range f.Allowed {
		identity = strings.TrimSpace(identity)
		if identity != "" {
			m.adminAllowlist[identity] = true
		}
	}

	return nil
}
```

**Step 4: Run tests to verify they pass**

Run: `go test ./internal/auth/... -v`
Expected: All 3 tests pass

**Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/middleware_test.go
git commit -m "feat(budget-service): add auth middleware struct with allowlist loading"
```

---

## Task 7: Implement ExtractAuth Middleware

**Files:**

- Modify: `internal/auth/middleware.go`
- Modify: `internal/auth/middleware_test.go`

**Step 1: Add tests for ExtractAuth**

Add to `internal/auth/middleware_test.go`:

```go
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

	// Create expired token
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
```

Add imports at top of test file:

```go
import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/internal/config"
	"github.com/airo-ai-builder/budget-service/pkg/testauth"
)
```

**Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v`
Expected: FAIL - ExtractAuth not defined

**Step 3: Implement ExtractAuth**

Add to `internal/auth/middleware.go`:

```go
import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/airo-ai-builder/budget-service/internal/config"
	apierrors "github.com/airo-ai-builder/budget-service/pkg/errors"
)

// ExtractAuth parses the JWT and populates AuthContext on the request.
// Returns 401 if token is missing, malformed, or expired.
func (m *Middleware) ExtractAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenString := extractBearerToken(r)
		if tokenString == "" {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrMissingAuthToken)
			return
		}

		authCtx, err := m.validateToken(tokenString)
		if err != nil {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrInvalidToken.WithDetails(err.Error()))
			return
		}

		if time.Now().After(authCtx.Exp) {
			writeAPIError(w, http.StatusUnauthorized, apierrors.ErrTokenExpired)
			return
		}

		ctx := WithAuthContext(r.Context(), authCtx)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func (m *Middleware) validateToken(tokenString string) (*AuthContext, error) {
	// Try parsing as subscription token first
	subClaims := &SubscriptionClaims{}
	token, err := jwt.ParseWithClaims(tokenString, subClaims, func(token *jwt.Token) (interface{}, error) {
		return m.testSigningKey, nil
	})

	if err == nil && token.Valid && subClaims.SubscriptionID != "" {
		return &AuthContext{
			SubscriptionID: subClaims.SubscriptionID,
			IsAdmin:        false,
			Exp:            subClaims.ExpiresAt.Time,
			Iat:            subClaims.IssuedAt.Time,
		}, nil
	}

	// Try parsing as admin token
	adminClaims := &AdminClaims{}
	token, err = jwt.ParseWithClaims(tokenString, adminClaims, func(token *jwt.Token) (interface{}, error) {
		return m.testSigningKey, nil
	})

	if err != nil {
		return nil, fmt.Errorf("invalid token: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("token validation failed")
	}

	identity := adminClaims.CNAME
	if adminClaims.IAM != "" {
		identity = adminClaims.IAM
	}

	if identity == "" {
		return nil, fmt.Errorf("token missing identity (cname or iam)")
	}

	return &AuthContext{
		IsAdmin:       true,
		AdminIdentity: identity,
		Exp:           adminClaims.ExpiresAt.Time,
		Iat:           adminClaims.IssuedAt.Time,
	}, nil
}

func writeAPIError(w http.ResponseWriter, status int, err apierrors.APIError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(err)
}
```

**Step 4: Run tests**

Run: `go test ./internal/auth/... -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/middleware_test.go
git commit -m "feat(budget-service): implement ExtractAuth middleware"
```

---

## Task 8: Implement RequireSubscription Middleware

**Files:**

- Modify: `internal/auth/middleware.go`
- Modify: `internal/auth/middleware_test.go`

**Step 1: Add tests for RequireSubscription**

Add to `internal/auth/middleware_test.go`:

```go
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
```

Add import for mux:

```go
"github.com/gorilla/mux"
```

**Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v`
Expected: FAIL - RequireSubscription not defined

**Step 3: Implement RequireSubscription**

Add to `internal/auth/middleware.go`:

```go
import (
	// ... existing imports ...
	"log/slog"

	"github.com/gorilla/mux"
)

// RequireSubscription validates that the JWT's subscriptionId matches
// the {subscriptionId} path parameter. Returns 403 on mismatch.
func (m *Middleware) RequireSubscription(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCtx := GetAuthContext(r)
		if authCtx == nil {
			writeAPIError(w, http.StatusInternalServerError, apierrors.ErrAuthContextMissing)
			return
		}

		vars := mux.Vars(r)
		urlSubscriptionID := vars["subscriptionId"]

		if authCtx.SubscriptionID != urlSubscriptionID {
			slog.Warn("auth.subscription.mismatch",
				"tokenSubscriptionId", authCtx.SubscriptionID,
				"urlSubscriptionId", urlSubscriptionID,
			)
			writeAPIError(w, http.StatusForbidden, apierrors.ErrSubscriptionMismatch)
			return
		}

		next.ServeHTTP(w, r)
	})
}
```

**Step 4: Run tests**

Run: `go test ./internal/auth/... -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/middleware_test.go
git commit -m "feat(budget-service): implement RequireSubscription middleware"
```

---

## Task 9: Implement RequireAdmin Middleware

**Files:**

- Modify: `internal/auth/middleware.go`
- Modify: `internal/auth/middleware_test.go`

**Step 1: Add tests for RequireAdmin**

Add to `internal/auth/middleware_test.go`:

```go
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
```

**Step 2: Run tests to verify they fail**

Run: `go test ./internal/auth/... -v`
Expected: FAIL - RequireAdmin not defined

**Step 3: Implement RequireAdmin**

Add to `internal/auth/middleware.go`:

```go
// RequireAdmin validates that the request came from an admin JWT
// and the identity is in the allowlist. Returns 403 if not allowed.
func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCtx := GetAuthContext(r)
		if authCtx == nil {
			writeAPIError(w, http.StatusInternalServerError, apierrors.ErrAuthContextMissing)
			return
		}

		if !authCtx.IsAdmin {
			writeAPIError(w, http.StatusForbidden, apierrors.ErrAdminRequired)
			return
		}

		if !m.adminAllowlist[authCtx.AdminIdentity] {
			slog.Warn("auth.admin.not_allowed",
				"identity", authCtx.AdminIdentity,
			)
			writeAPIError(w, http.StatusForbidden, apierrors.ErrAdminNotAllowed)
			return
		}

		next.ServeHTTP(w, r)
	})
}
```

**Step 4: Run tests**

Run: `go test ./internal/auth/... -v`
Expected: All tests pass

**Step 5: Commit**

```bash
git add internal/auth/middleware.go internal/auth/middleware_test.go
git commit -m "feat(budget-service): implement RequireAdmin middleware"
```

---

## Task 10: Wire Up Middleware in Server Routes

**Files:**

- Modify: `internal/api/server.go`

**Step 1: Update server.go imports and Server struct**

Add to imports:

```go
"github.com/airo-ai-builder/budget-service/internal/auth"
```

Add to Server struct:

```go
authMiddleware *auth.Middleware
```

**Step 2: Initialize auth middleware in NewServer**

Add before `s.setupRoutes()`:

```go
authMiddleware, err := auth.NewMiddleware(cfg)
if err != nil {
	slog.Error("auth.middleware.init.failed", "error", err)
	panic(fmt.Sprintf("failed to initialize auth middleware: %v", err))
}
s.authMiddleware = authMiddleware
```

Add `"fmt"` to imports.

**Step 3: Update setupRoutes to use middleware**

Replace the current `setupRoutes()` with:

```go
func (s *Server) setupRoutes() {
	api := s.router.PathPrefix("/api/v1").Subrouter()

	// Health check (no auth)
	api.HandleFunc("/health", s.handleHealth).Methods(http.MethodGet)

	// Subscription endpoints - require matching subscriptionId
	sub := api.PathPrefix("/subscriptions/{subscriptionId}").Subrouter()
	sub.Use(s.authMiddleware.ExtractAuth)
	sub.Use(s.authMiddleware.RequireSubscription)
	sub.HandleFunc("/budgets", s.handleGetBudgets).Methods(http.MethodGet)
	sub.HandleFunc("/spend", s.handleSpend).Methods(http.MethodPost)
	sub.HandleFunc("/release", s.handleRelease).Methods(http.MethodPost)

	// Admin endpoints - require admin allowlist
	admin := api.PathPrefix("/budgets").Subrouter()
	admin.Use(s.authMiddleware.ExtractAuth)
	admin.Use(s.authMiddleware.RequireAdmin)
	admin.HandleFunc("", s.handleCreateBudget).Methods(http.MethodPost)
	admin.HandleFunc("/{budgetId}", s.handleUpdateBudget).Methods(http.MethodPut)
	admin.HandleFunc("/{budgetId}", s.handleDeleteBudget).Methods(http.MethodDelete)
}
```

**Step 4: Verify build**

Run: `go build ./...`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add internal/api/server.go
git commit -m "feat(budget-service): wire up auth middleware in routes"
```

---

## Task 11: Add Integration Tests

**Files:**

- Create: `internal/api/auth_integration_test.go`

**Step 1: Create integration tests**

Create `internal/api/auth_integration_test.go`:

```go
// internal/api/auth_integration_test.go
package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/internal/config"
	"github.com/airo-ai-builder/budget-service/internal/logging"
	apierrors "github.com/airo-ai-builder/budget-service/pkg/errors"
	"github.com/airo-ai-builder/budget-service/pkg/testauth"
)

func setupTestServer(t *testing.T) *Server {
	cfg := &config.Config{
		Port:               8080,
		AuthMode:           "test",
		AuthTestSigningKey: "integration-test-key",
		AuthAdminAllowlist: "admin.example.com,iam:test-service",
	}

	// Create a no-op audit logger for tests
	auditLog, _ := logging.NewAuditLogger("/dev/null", false)

	return NewServer(cfg, "test", nil, auditLog)
}

func TestHealth_NoAuthRequired(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
}

func TestSubscriptionEndpoint_MissingToken(t *testing.T) {
	server := setupTestServer(t)

	req := httptest.NewRequest("GET", "/api/v1/subscriptions/sub-123/budgets", nil)
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}

	var errResp apierrors.APIError
	json.NewDecoder(rr.Body).Decode(&errResp)
	if errResp.Code != apierrors.CodeMissingAuthToken {
		t.Errorf("expected error code %s, got %s", apierrors.CodeMissingAuthToken, errResp.Code)
	}
}

func TestSubscriptionEndpoint_SubscriptionMismatch(t *testing.T) {
	server := setupTestServer(t)

	// Token for sub-123, requesting sub-456
	token, _ := testauth.SignTestToken("integration-test-key", "sub-123", time.Hour)

	req := httptest.NewRequest("GET", "/api/v1/subscriptions/sub-456/budgets", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}

	var errResp apierrors.APIError
	json.NewDecoder(rr.Body).Decode(&errResp)
	if errResp.Code != apierrors.CodeSubscriptionMismatch {
		t.Errorf("expected error code %s, got %s", apierrors.CodeSubscriptionMismatch, errResp.Code)
	}
}

func TestSubscriptionEndpoint_ValidToken(t *testing.T) {
	server := setupTestServer(t)

	token, _ := testauth.SignTestToken("integration-test-key", "sub-123", time.Hour)

	req := httptest.NewRequest("GET", "/api/v1/subscriptions/sub-123/budgets", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	// Should pass auth (may fail later due to no DB, but not 401/403)
	if rr.Code == http.StatusUnauthorized || rr.Code == http.StatusForbidden {
		t.Errorf("auth should pass, got status %d", rr.Code)
	}
}

func TestAdminEndpoint_MissingToken(t *testing.T) {
	server := setupTestServer(t)

	body := bytes.NewBufferString(`{"subscriptionId":"sub-123","type":"burndown","label":"test","maxCredits":1000,"conversionFactor":1.0,"expirationOrResetDate":"2026-12-31T00:00:00Z"}`)
	req := httptest.NewRequest("POST", "/api/v1/budgets", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected status 401, got %d", rr.Code)
	}
}

func TestAdminEndpoint_NotAdmin(t *testing.T) {
	server := setupTestServer(t)

	// Subscription token (not admin)
	token, _ := testauth.SignTestToken("integration-test-key", "sub-123", time.Hour)

	body := bytes.NewBufferString(`{"subscriptionId":"sub-123","type":"burndown","label":"test","maxCredits":1000,"conversionFactor":1.0,"expirationOrResetDate":"2026-12-31T00:00:00Z"}`)
	req := httptest.NewRequest("POST", "/api/v1/budgets", body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}

	var errResp apierrors.APIError
	json.NewDecoder(rr.Body).Decode(&errResp)
	if errResp.Code != apierrors.CodeAdminRequired {
		t.Errorf("expected error code %s, got %s", apierrors.CodeAdminRequired, errResp.Code)
	}
}

func TestAdminEndpoint_NotInAllowlist(t *testing.T) {
	server := setupTestServer(t)

	// Admin token but not in allowlist
	token, _ := testauth.SignAdminTestToken("integration-test-key", "hacker.example.com", false, time.Hour)

	body := bytes.NewBufferString(`{"subscriptionId":"sub-123","type":"burndown","label":"test","maxCredits":1000,"conversionFactor":1.0,"expirationOrResetDate":"2026-12-31T00:00:00Z"}`)
	req := httptest.NewRequest("POST", "/api/v1/budgets", body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Errorf("expected status 403, got %d", rr.Code)
	}

	var errResp apierrors.APIError
	json.NewDecoder(rr.Body).Decode(&errResp)
	if errResp.Code != apierrors.CodeAdminNotAllowed {
		t.Errorf("expected error code %s, got %s", apierrors.CodeAdminNotAllowed, errResp.Code)
	}
}

func TestAdminEndpoint_ValidAdmin(t *testing.T) {
	server := setupTestServer(t)

	// Admin token in allowlist
	token, _ := testauth.SignAdminTestToken("integration-test-key", "admin.example.com", false, time.Hour)

	body := bytes.NewBufferString(`{"subscriptionId":"sub-123","type":"burndown","label":"test","maxCredits":1000,"conversionFactor":1.0,"expirationOrResetDate":"2026-12-31T00:00:00Z"}`)
	req := httptest.NewRequest("POST", "/api/v1/budgets", body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	server.router.ServeHTTP(rr, req)

	// Should pass auth (may fail later due to no DB, but not 401/403)
	if rr.Code == http.StatusUnauthorized || rr.Code == http.StatusForbidden {
		t.Errorf("auth should pass, got status %d", rr.Code)
	}
}
```

**Step 2: Run integration tests**

Run: `go test ./internal/api/... -v -run Test.*Endpoint`
Expected: All tests pass (or fail for non-auth reasons like missing DB)

**Step 3: Commit**

```bash
git add internal/api/auth_integration_test.go
git commit -m "test(budget-service): add auth integration tests"
```

---

## Task 12: Update README with Auth Configuration

**Files:**

- Create or Modify: `README.md`

**Step 1: Add auth configuration section**

Add to README.md:

````markdown
## Authentication Configuration

### Environment Variables

| Variable                    | Description                                        | Default |
| --------------------------- | -------------------------------------------------- | ------- |
| `AUTH_MODE`                 | `test` (HMAC) or `jwt` (JWKS)                      | `jwt`   |
| `AUTH_JWKS_URL`             | JWKS endpoint URL (required in jwt mode)           | -       |
| `AUTH_TEST_SIGNING_KEY`     | HMAC signing key (required in test mode)           | -       |
| `AUTH_ADMIN_ALLOWLIST`      | Comma-separated admin CNAMEs/IAM identities        | -       |
| `AUTH_ADMIN_ALLOWLIST_FILE` | Path to JSON file with additional admin identities | -       |

### Running Integration Tests

```bash
AUTH_MODE=test AUTH_TEST_SIGNING_KEY=test-key go test ./...
```
````

### Admin Allowlist File Format

```json
{
  "allowed": ["admin1.example.com", "iam:service-account"]
}
```

````

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs(budget-service): add auth configuration to README"
````

---

## Summary

After completing all tasks, you will have:

1. Auth error codes in `pkg/errors/errors.go`
2. Auth config fields in `internal/config/config.go`
3. JWT dependency added
4. Auth types and context in `internal/auth/`
5. Test auth helpers in `pkg/testauth/`
6. Middleware struct with allowlist loading
7. `ExtractAuth` middleware for JWT parsing
8. `RequireSubscription` middleware for subscription validation
9. `RequireAdmin` middleware for admin allowlist
10. Routes wired up with appropriate middleware
11. Integration tests covering all auth scenarios
12. Documentation in README

Run final verification:

```bash
go build ./...
go test ./... -v
```
