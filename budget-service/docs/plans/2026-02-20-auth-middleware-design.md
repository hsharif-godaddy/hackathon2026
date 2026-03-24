# Auth Middleware Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement composable auth middleware supporting three authentication modes: test (local JWT signing), app/agent JWT with subscription validation, and admin JWT with allowlist.

**Architecture:** Middleware chain pattern with separate concerns - ExtractAuth handles JWT parsing, RequireSubscription validates ownership, RequireAdmin validates allowlist. Routes compose middleware based on their auth needs.

**Tech Stack:** Go, golang-jwt/jwt/v5, gorilla/mux

---

## Requirements

1. **Test mode**: Local JWT signing with HMAC key - full auth code path exercised without external dependencies
2. **App/Agent JWT**: subscriptionId claim for tenant identification, middleware validates URL subscriptionId matches JWT
3. **Admin JWT**: GoDaddy JWT with IAM/cert CNAME, validated against allowlist (env var + config file)

## Core Types

```go
// AuthMode determines how JWTs are validated
type AuthMode string

const (
    AuthModeTest AuthMode = "test"  // Local JWT signing with test key
    AuthModeJWT  AuthMode = "jwt"   // Production JWKS validation
)

// AuthContext holds extracted authentication info, attached to request context
type AuthContext struct {
    SubscriptionID string    // From JWT claim - primary tenant identifier
    IsAdmin        bool      // True if authenticated via admin path
    AdminIdentity  string    // CNAME or IAM identity (when IsAdmin=true)
    Exp            time.Time // Token expiration
    Iat            time.Time // Token issued at
}

// Claims for app/agent JWTs
type SubscriptionClaims struct {
    jwt.RegisteredClaims
    SubscriptionID string `json:"subscriptionId"`
}

// Claims for admin JWTs (GoDaddy format)
type AdminClaims struct {
    jwt.RegisteredClaims
    CNAME string `json:"cname,omitempty"` // Certificate CN
    IAM   string `json:"iam,omitempty"`   // IAM identity
}
```

## Configuration

```go
// Config additions to internal/config/config.go
type Config struct {
    // ... existing fields ...

    // Auth
    AuthMode           AuthMode // "test" or "jwt"
    AuthJWKSURL        string   // JWKS endpoint for production JWT validation
    AuthTestSigningKey string   // HMAC key for test mode JWT signing/validation

    // Admin allowlist - identities that can make admin requests
    AuthAdminAllowlist     string // Comma-separated CNAMEs/IAM identities (env var)
    AuthAdminAllowlistFile string // Path to JSON file with additional identities
}
```

**Environment variables:**

- `AUTH_MODE=test|jwt` (default: jwt)
- `AUTH_JWKS_URL=https://...` (required in jwt mode)
- `AUTH_TEST_SIGNING_KEY=...` (required in test mode)
- `AUTH_ADMIN_ALLOWLIST=cname1,cname2,iam:identity1`
- `AUTH_ADMIN_ALLOWLIST_FILE=/path/to/allowlist.json`

**Allowlist file format:**

```json
{
  "allowed": ["cname1", "cname2", "iam:identity1"]
}
```

## Middleware Functions

```go
// Package: internal/auth

// Middleware creates the auth middleware with the given configuration
type Middleware struct {
    config         *config.Config
    jwksValidator  *JWKSValidator  // For production JWT validation
    adminAllowlist map[string]bool // Loaded from env + file
}

// NewMiddleware constructs the middleware, loading allowlist from config
func NewMiddleware(cfg *config.Config) (*Middleware, error)

// ExtractAuth parses the JWT and populates AuthContext on the request.
// Does NOT enforce authorization - just extracts identity.
// Returns 401 if token is missing, malformed, or expired.
func (m *Middleware) ExtractAuth(next http.Handler) http.Handler

// RequireSubscription validates that the JWT's subscriptionId matches
// the {subscriptionId} path parameter. Returns 403 on mismatch.
// Must be called after ExtractAuth.
func (m *Middleware) RequireSubscription(next http.Handler) http.Handler

// RequireAdmin validates that the request came from an admin JWT
// and the identity is in the allowlist. Returns 403 if not allowed.
// Must be called after ExtractAuth.
func (m *Middleware) RequireAdmin(next http.Handler) http.Handler

// Helper to get AuthContext from request
func GetAuthContext(r *http.Request) *AuthContext
```

## Route Composition

```go
// Health - no auth
api.HandleFunc("/health", s.handleHealth)

// Subscription endpoints - require matching subscriptionId
sub := api.PathPrefix("/subscriptions/{subscriptionId}").Subrouter()
sub.Use(authMiddleware.ExtractAuth)
sub.Use(authMiddleware.RequireSubscription)
sub.HandleFunc("/budgets", s.handleGetBudgets).Methods("GET")
sub.HandleFunc("/spend", s.handleSpend).Methods("POST")
sub.HandleFunc("/release", s.handleRelease).Methods("POST")

// Admin endpoints - require admin allowlist
admin := api.PathPrefix("/budgets").Subrouter()
admin.Use(authMiddleware.ExtractAuth)
admin.Use(authMiddleware.RequireAdmin)
admin.HandleFunc("", s.handleCreateBudget).Methods("POST")
admin.HandleFunc("/{budgetId}", s.handleUpdateBudget).Methods("PUT")
admin.HandleFunc("/{budgetId}", s.handleDeleteBudget).Methods("DELETE")
```

## JWT Validation Logic

### ExtractAuth Flow

```go
func (m *Middleware) ExtractAuth(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // 1. Extract Bearer token from Authorization header
        token := extractBearerToken(r)
        if token == "" {
            writeAPIError(w, 401, ErrMissingAuthToken)
            return
        }

        // 2. Validate based on mode
        var authCtx *AuthContext
        var err error

        switch m.config.AuthMode {
        case AuthModeTest:
            // HMAC validation with test signing key
            authCtx, err = m.validateTestToken(token)
        case AuthModeJWT:
            // JWKS validation (RS256) against production endpoint
            authCtx, err = m.validateProductionToken(token)
        }

        if err != nil {
            writeAPIError(w, 401, ErrInvalidToken.WithDetails(err.Error()))
            return
        }

        // 3. Check expiration
        if time.Now().After(authCtx.Exp) {
            writeAPIError(w, 401, ErrTokenExpired)
            return
        }

        // 4. Attach to request context
        ctx := context.WithValue(r.Context(), authContextKey, authCtx)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Test Mode

- Tokens signed with HMAC-SHA256 using `AUTH_TEST_SIGNING_KEY`
- Tests create their own tokens with `jwt.NewWithClaims()`
- Middleware validates signature with same key
- Full validation path exercised (parsing, claims extraction, expiry check)

### Production Mode

- Tokens validated against JWKS endpoint
- Fetches public keys from `AUTH_JWKS_URL` (cached 5 min)
- Validates RS256 signature
- Extracts subscriptionId from claims

## Authorization Logic

### RequireSubscription

```go
func (m *Middleware) RequireSubscription(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authCtx := GetAuthContext(r)
        if authCtx == nil {
            writeAPIError(w, 500, ErrAuthContextMissing)
            return
        }

        vars := mux.Vars(r)
        urlSubscriptionID := vars["subscriptionId"]

        if authCtx.SubscriptionID != urlSubscriptionID {
            slog.Warn("auth.subscription.mismatch",
                "tokenSubscriptionId", authCtx.SubscriptionID,
                "urlSubscriptionId", urlSubscriptionID,
            )
            writeAPIError(w, 403, ErrSubscriptionMismatch)
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

### RequireAdmin

```go
func (m *Middleware) RequireAdmin(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        authCtx := GetAuthContext(r)
        if authCtx == nil {
            writeAPIError(w, 500, ErrAuthContextMissing)
            return
        }

        if !authCtx.IsAdmin {
            writeAPIError(w, 403, ErrAdminRequired)
            return
        }

        if !m.adminAllowlist[authCtx.AdminIdentity] {
            slog.Warn("auth.admin.not_allowed",
                "identity", authCtx.AdminIdentity,
            )
            writeAPIError(w, 403, ErrAdminNotAllowed)
            return
        }

        next.ServeHTTP(w, r)
    })
}
```

## Error Codes

Add to `pkg/errors/errors.go`:

```go
// Auth errors (4xxx)
CodeMissingAuthToken     = "MISSING_AUTH_TOKEN"
CodeInvalidToken         = "INVALID_TOKEN"
CodeTokenExpired         = "TOKEN_EXPIRED"
CodeSubscriptionMismatch = "SUBSCRIPTION_MISMATCH"
CodeAdminRequired        = "ADMIN_REQUIRED"
CodeAdminNotAllowed      = "ADMIN_NOT_ALLOWED"
CodeAuthContextMissing   = "AUTH_CONTEXT_MISSING"
```

## Test Helper Package

```go
// pkg/testauth/testauth.go

// SignTestToken creates a signed JWT for integration tests
func SignTestToken(signingKey string, claims SubscriptionClaims) (string, error)

// SignAdminTestToken creates a signed admin JWT for integration tests
func SignAdminTestToken(signingKey string, claims AdminClaims) (string, error)
```

## Test Coverage

```go
func TestSpendEndpoint_RequiresMatchingSubscription(t *testing.T) {
    signingKey := os.Getenv("AUTH_TEST_SIGNING_KEY")

    token, _ := testauth.SignTestToken(signingKey, testauth.SubscriptionClaims{
        SubscriptionID: "sub-123",
        RegisteredClaims: jwt.RegisteredClaims{
            ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
        },
    })

    req := httptest.NewRequest("POST", "/api/v1/subscriptions/sub-456/spend", body)
    req.Header.Set("Authorization", "Bearer "+token)

    assert.Equal(t, 403, resp.StatusCode)
    assert.Contains(t, resp.Body, "SUBSCRIPTION_MISMATCH")
}

func TestAdminEndpoint_RequiresAllowlistedIdentity(t *testing.T) {
    os.Setenv("AUTH_ADMIN_ALLOWLIST", "allowed-service.example.com")

    token, _ := testauth.SignAdminTestToken(signingKey, testauth.AdminClaims{
        CNAME: "not-allowed.example.com",
    })

    req := httptest.NewRequest("POST", "/api/v1/budgets", body)
    req.Header.Set("Authorization", "Bearer "+token)

    assert.Equal(t, 403, resp.StatusCode)
    assert.Contains(t, resp.Body, "ADMIN_NOT_ALLOWED")
}
```

**Test coverage goals:**

- Token missing → 401
- Token malformed → 401
- Token expired → 401
- Subscription mismatch → 403
- Admin not in allowlist → 403
- Valid subscription token → passes to handler
- Valid admin token in allowlist → passes to handler

## File Structure

```
budget-service/
├── internal/
│   ├── auth/
│   │   ├── middleware.go      # Middleware struct and NewMiddleware
│   │   ├── extract.go         # ExtractAuth middleware
│   │   ├── subscription.go    # RequireSubscription middleware
│   │   ├── admin.go           # RequireAdmin middleware
│   │   ├── jwks.go            # JWKS validator (production mode)
│   │   ├── claims.go          # JWT claims types
│   │   ├── context.go         # AuthContext and helpers
│   │   └── middleware_test.go # Unit tests
│   └── config/
│       └── config.go          # Add auth config fields
├── pkg/
│   ├── errors/
│   │   └── errors.go          # Add auth error codes
│   └── testauth/
│       └── testauth.go        # Test JWT signing helpers
```
