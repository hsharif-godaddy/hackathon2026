---
status: active
---

# Image Search Testing UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add JOMAX (GoDaddy employee) token authentication to image-search-service and create a standalone testing UI in debug-console.

**Architecture:** Dual validator pattern - image-search-service detects token type (airo-app vs JOMAX) and routes to appropriate validator. Debug console proxies requests through its backend to forward JOMAX tokens.

**Tech Stack:** Go (image-search-service auth), Next.js/React (debug-console UI), TypeScript

---

## Task 1: Add JOMAX Key Client

**Files:**

- Create: `image-search-service/internal/auth/jomax.go`
- Create: `image-search-service/internal/auth/jomax_test.go`

**Step 1: Write the failing test for JOMAX key fetching**

```go
// jomax_test.go
package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestJomaxKeyClient_GetKey(t *testing.T) {
	// Mock SSO key endpoint
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/api/key/test-kid" {
			t.Errorf("unexpected path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		// Return a test RSA public key in PEM format
		w.Write([]byte(`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyFZ4VNvkHrBL+dNc8JUqx0tZ3l/JHtH+LPx9T3T0MH//u6Iv4R3xP6b8xA5TQHH1cMN2knGSLHPPxH3fZ3S3C/cPjHH1vM2bLH0aG2kCQqQlH+3fK6H3r1YiQj+H8J/LSu7g3tHiE3TZlVLVQpHPJfFnKPLQPgzF3nFX7lhA9RvLQ2HK9C4dLPJzNF4KjPyV3cL5T2LmGPxH3TvSZQ+C2mVj5HzP3jNX2hKT4DzTz8L8gJu5mSjfHvYH3r3xAzDQ8E+TLvX1QhH+x9C9Lj/jRPgP3X8C3YG+q/cZk3YH+3S/xPvJQ5mHgJ2hLzDh7jP3J+QIDAQAB
-----END PUBLIC KEY-----`))
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)
	key, err := client.GetKey("test-kid")
	if err != nil {
		t.Fatalf("GetKey failed: %v", err)
	}
	if key == nil {
		t.Fatal("expected non-nil key")
	}
}

func TestJomaxKeyClient_GetKey_NotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewJomaxKeyClient(server.URL)
	_, err := client.GetKey("unknown-kid")
	if err == nil {
		t.Fatal("expected error for unknown kid")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd image-search-service && go test ./internal/auth/... -run TestJomaxKeyClient -v`
Expected: FAIL with "undefined: NewJomaxKeyClient"

**Step 3: Write minimal implementation**

```go
// jomax.go
package auth

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

// Cache duration for JOMAX keys (24 hours - they're long-lived).
const jomaxKeyCacheDuration = 24 * time.Hour

// ErrJomaxKeyNotFound is returned when a JOMAX key is not found.
var ErrJomaxKeyNotFound = errors.New("jomax: key not found")

// jomaxCachedKey holds a cached RSA public key with its expiration time.
type jomaxCachedKey struct {
	key       *rsa.PublicKey
	expiresAt time.Time
}

// JomaxKeyClient fetches and caches public keys from GoDaddy SSO.
type JomaxKeyClient struct {
	ssoHost    string
	httpClient *http.Client
	cache      map[string]*jomaxCachedKey
	mu         sync.RWMutex
}

// NewJomaxKeyClient creates a new JOMAX key client.
// ssoHost should be like "https://sso.godaddy.com" or "https://sso.test-godaddy.com".
func NewJomaxKeyClient(ssoHost string) *JomaxKeyClient {
	return &JomaxKeyClient{
		ssoHost:    ssoHost,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]*jomaxCachedKey),
	}
}

// GetKey retrieves the RSA public key for the given key ID from GoDaddy SSO.
func (c *JomaxKeyClient) GetKey(kid string) (*rsa.PublicKey, error) {
	// Check cache
	c.mu.RLock()
	cached, ok := c.cache[kid]
	c.mu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	return c.fetchAndCacheKey(kid)
}

func (c *JomaxKeyClient) fetchAndCacheKey(kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check
	if cached, ok := c.cache[kid]; ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	// Fetch from SSO: GET /v1/api/key/{kid}
	url := fmt.Sprintf("%s/v1/api/key/%s", c.ssoHost, kid)
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to fetch key: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrJomaxKeyNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("jomax: unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to read response: %w", err)
	}

	key, err := parseRSAPublicKeyPEM(body)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to parse key: %w", err)
	}

	c.cache[kid] = &jomaxCachedKey{
		key:       key,
		expiresAt: time.Now().Add(jomaxKeyCacheDuration),
	}

	return key, nil
}

// parseRSAPublicKeyPEM parses a PEM-encoded RSA public key.
func parseRSAPublicKeyPEM(pemBytes []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("failed to decode PEM block")
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	rsaKey, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("not an RSA public key")
	}

	return rsaKey, nil
}
```

**Step 4: Run test to verify it passes**

Run: `cd image-search-service && go test ./internal/auth/... -run TestJomaxKeyClient -v`
Expected: PASS

**Step 5: Commit**

```bash
git add image-search-service/internal/auth/jomax.go image-search-service/internal/auth/jomax_test.go
git commit -m "feat(image-search): add JOMAX key client for GoDaddy SSO"
```

---

## Task 2: Add JOMAX Token Validator

**Files:**

- Modify: `image-search-service/internal/auth/jomax.go`
- Modify: `image-search-service/internal/auth/jomax_test.go`

**Step 1: Write the failing test for JOMAX validation**

Add to `jomax_test.go`:

```go
func TestJomaxValidator_Validate(t *testing.T) {
	// This test uses a pre-generated test token
	// In real tests, you'd mock the key endpoint
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Return test key for any kid
		w.Write([]byte(`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWy
FZ4VNvkHrBL+dNc8JUqx0tZ3l/JHtH+LPx9T3T0MH//u6Iv4R3xP6b8xA5TQHH1c
MN2knGSLHPPxH3fZ3S3C/cPjHH1vM2bLH0aG2kCQqQlH+3fK6H3r1YiQj+H8J/LS
u7g3tHiE3TZlVLVQpHPJfFnKPLQPgzF3nFX7lhA9RvLQ2HK9C4dLPJzNF4KjPyV3
cL5T2LmGPxH3TvSZQ+C2mVj5HzP3jNX2hKT4DzTz8L8gJu5mSjfHvYH3r3xAzDQ8
E+TLvX1QhH+x9C9Lj/jRPgP3X8C3YG+q/cZk3YH+3S/xPvJQ5mHgJ2hLzDh7jP3J
+QIDAQAB
-----END PUBLIC KEY-----`))
	}))
	defer server.Close()

	validator := NewJomaxValidator(server.URL)

	// Test with invalid token format
	_, err := validator.Validate("not-a-jwt")
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
}

func TestDetectTokenType(t *testing.T) {
	tests := []struct {
		name     string
		claims   map[string]interface{}
		expected string
	}{
		{
			name:     "airo-app token",
			claims:   map[string]interface{}{"iss": "airo-app", "siteId": "123"},
			expected: "airo-app",
		},
		{
			name:     "jomax token with per claim",
			claims:   map[string]interface{}{"per": true, "shopperId": "123"},
			expected: "jomax",
		},
		{
			name:     "unknown token",
			claims:   map[string]interface{}{"foo": "bar"},
			expected: "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := detectTokenTypeFromClaims(tt.claims)
			if result != tt.expected {
				t.Errorf("expected %s, got %s", tt.expected, result)
			}
		})
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd image-search-service && go test ./internal/auth/... -run "TestJomaxValidator|TestDetectTokenType" -v`
Expected: FAIL with "undefined: NewJomaxValidator"

**Step 3: Write minimal implementation**

Add to `jomax.go`:

```go
// JomaxValidator validates JOMAX tokens from GoDaddy SSO.
type JomaxValidator struct {
	keyClient *JomaxKeyClient
}

// NewJomaxValidator creates a new JOMAX token validator.
func NewJomaxValidator(ssoHost string) *JomaxValidator {
	return &JomaxValidator{
		keyClient: NewJomaxKeyClient(ssoHost),
	}
}

// Validate validates a JOMAX token and returns its claims.
func (v *JomaxValidator) Validate(tokenString string) (jwt.MapClaims, error) {
	// Parse unverified to get kid
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, ErrMissingKid
	}

	// Get key from SSO
	publicKey, err := v.keyClient.GetKey(kid)
	if err != nil {
		if errors.Is(err, ErrJomaxKeyNotFound) {
			return nil, fmt.Errorf("%w: key not found for kid %s", ErrInvalidSignature, kid)
		}
		return nil, fmt.Errorf("failed to get jomax key: %w", err)
	}

	// Parse and verify
	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		if _, isRSA := t.Method.(*jwt.SigningMethodRSA); !isRSA {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"RS256"}))

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, fmt.Errorf("%w: %w", ErrInvalidSignature, err)
	}

	if !validatedToken.Valid {
		return nil, ErrInvalidToken
	}

	claims, ok := validatedToken.Claims.(jwt.MapClaims)
	if !ok {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// detectTokenTypeFromClaims determines the token type from its claims.
func detectTokenTypeFromClaims(claims map[string]interface{}) string {
	// Airo-app tokens have iss="airo-app"
	if iss, ok := claims["iss"].(string); ok && iss == "airo-app" {
		return "airo-app"
	}

	// JOMAX tokens have "per" claim (persistent)
	if _, ok := claims["per"]; ok {
		return "jomax"
	}

	// JOMAX tokens may also have shopperId without per
	if _, ok := claims["shopperId"]; ok {
		return "jomax"
	}

	return "unknown"
}
```

Add import at top: `"github.com/golang-jwt/jwt/v5"`

**Step 4: Run test to verify it passes**

Run: `cd image-search-service && go test ./internal/auth/... -run "TestJomaxValidator|TestDetectTokenType" -v`
Expected: PASS

**Step 5: Commit**

```bash
git add image-search-service/internal/auth/jomax.go image-search-service/internal/auth/jomax_test.go
git commit -m "feat(image-search): add JOMAX token validator"
```

---

## Task 3: Update Middleware for Dual Auth

**Files:**

- Modify: `image-search-service/internal/auth/middleware.go`
- Modify: `image-search-service/internal/auth/middleware_test.go`

**Step 1: Write the failing test**

Add to `middleware_test.go`:

```go
func TestMiddleware_DualAuth(t *testing.T) {
	// Test that middleware accepts both token types
	m := NewMiddleware("jwt", "https://example.com/jwks", "airo-app", "agents-service", "https://sso.test-godaddy.com")

	if m.airoValidator == nil {
		t.Error("expected airo validator to be initialized")
	}
	if m.jomaxValidator == nil {
		t.Error("expected jomax validator to be initialized")
	}
}
```

**Step 2: Run test to verify it fails**

Run: `cd image-search-service && go test ./internal/auth/... -run TestMiddleware_DualAuth -v`
Expected: FAIL (NewMiddleware signature mismatch)

**Step 3: Write minimal implementation**

Update `middleware.go`:

```go
package auth

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// Middleware provides HTTP middleware for JWT authentication.
type Middleware struct {
	airoValidator  *Validator
	jomaxValidator *JomaxValidator
	authType       string
}

// NewMiddleware creates a new auth middleware with dual validator support.
// If authType is "jwt", validators are created for both airo-app and JOMAX tokens.
// If authType is "none", authentication is bypassed entirely.
func NewMiddleware(authType, jwksURL, issuer, audience, ssoHost string) *Middleware {
	m := &Middleware{
		authType: authType,
	}

	if authType == "jwt" {
		m.airoValidator = NewValidator(jwksURL, issuer, audience)
		m.jomaxValidator = NewJomaxValidator(ssoHost)
	}

	return m
}

// Authenticate returns HTTP middleware that validates JWT tokens.
func (m *Middleware) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if m.authType == "none" {
			next.ServeHTTP(w, r)
			return
		}

		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			slog.Warn("auth.missing_header", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "missing authorization header")
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			slog.Warn("auth.invalid_format", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "invalid authorization format")
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if token == "" {
			slog.Warn("auth.empty_token", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "empty token")
			return
		}

		// Detect token type and route to appropriate validator
		tokenType := detectTokenType(token)
		slog.Debug("auth.token_type_detected", "type", tokenType, "path", r.URL.Path)

		var err error
		switch tokenType {
		case "airo-app":
			_, err = m.airoValidator.Validate(token)
		case "jomax":
			_, err = m.jomaxValidator.Validate(token)
		default:
			slog.Warn("auth.unknown_token_type", "path", r.URL.Path, "method", r.Method)
			writeUnauthorizedError(w, "unrecognized token type")
			return
		}

		if err != nil {
			slog.Warn("auth.validation_failed", "path", r.URL.Path, "method", r.Method, "tokenType", tokenType, "error", err.Error())
			writeUnauthorizedError(w, "invalid token")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// detectTokenType inspects a JWT without verification to determine its type.
func detectTokenType(tokenString string) string {
	parts := strings.Split(tokenString, ".")
	if len(parts) != 3 {
		return "unknown"
	}

	// Decode payload (second part)
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "unknown"
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "unknown"
	}

	return detectTokenTypeFromClaims(claims)
}

func writeUnauthorizedError(w http.ResponseWriter, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
```

**Step 4: Run test to verify it passes**

Run: `cd image-search-service && go test ./internal/auth/... -run TestMiddleware -v`
Expected: PASS

**Step 5: Commit**

```bash
git add image-search-service/internal/auth/middleware.go image-search-service/internal/auth/middleware_test.go
git commit -m "feat(image-search): update middleware for dual auth (airo-app + JOMAX)"
```

---

## Task 4: Update Server to Pass SSO Host

**Files:**

- Modify: `image-search-service/internal/api/server.go`

**Step 1: Update server initialization**

In `server.go`, update line 53:

```go
// Before:
s.authMiddleware = auth.NewMiddleware(cfg.AuthType, cfg.JWKSURL, "airo-app", "agents-service")

// After:
s.authMiddleware = auth.NewMiddleware(cfg.AuthType, cfg.JWKSURL, "airo-app", "agents-service", cfg.SSOHost)
```

**Step 2: Run existing tests**

Run: `cd image-search-service && go test ./internal/api/... -v`
Expected: PASS

**Step 3: Commit**

```bash
git add image-search-service/internal/api/server.go
git commit -m "feat(image-search): pass SSO host to auth middleware"
```

---

## Task 5: Create Debug Console API Proxy Route

**Files:**

- Create: `debug-console/src/app/api/image-search/route.ts`

**Step 1: Create the API route**

```typescript
// route.ts
import { NextRequest, NextResponse } from "next/server";

import { gdAuthService } from "@/lib/gd-auth-service";

const IMAGE_SEARCH_SERVICE_URL =
  process.env.IMAGE_SEARCH_SERVICE_URL || "http://localhost:8080";

export async function POST(request: NextRequest) {
  const token = gdAuthService.extractTokenFromRequest(request);

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    const response = await fetch(`${IMAGE_SEARCH_SERVICE_URL}/api/v1/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("image-search.proxy.error", error);
    return NextResponse.json(
      { error: "Failed to connect to image search service" },
      { status: 503 },
    );
  }
}
```

**Step 2: Run lint**

Run: `cd debug-console && pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add debug-console/src/app/api/image-search/route.ts
git commit -m "feat(debug-console): add image search API proxy route"
```

---

## Task 6: Create ImageSearchPanel Component

**Files:**

- Create: `debug-console/src/components/ImageSearchPanel.tsx`

**Step 1: Create the component**

```typescript
'use client';

import React, { useState } from 'react';

interface SearchResult {
  gettyId: string;
  title: string;
  previewUrl: string;
  relevanceScore: number;
  cached: boolean;
  keywords?: string[];
  analysis?: {
    description: string;
    subjects: string[];
    mood: string[];
  };
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  totalCached: number;
  totalLive: number;
}

type FilterMode = 'all' | 'cached' | 'live';

export default function ImageSearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<SearchResult | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [stats, setStats] = useState<{ cached: number; live: number } | null>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setSelectedImage(null);

    try {
      const response = await fetch('/api/image-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), maxResults: 20 }),
      });

      if (response.status === 401) {
        setError('Session expired. Please refresh the page.');
        return;
      }

      if (response.status === 503) {
        setError('Image search service is unavailable.');
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Search failed');
        return;
      }

      const data: SearchResponse = await response.json();
      setResults(data.results || []);
      setStats({ cached: data.totalCached, live: data.totalLive });
    } catch (err) {
      setError('Failed to connect to search service');
    } finally {
      setLoading(false);
    }
  };

  const filteredResults = results.filter((r) => {
    if (filterMode === 'cached') return r.cached;
    if (filterMode === 'live') return !r.cached;
    return true;
  });

  return (
    <div style={{ padding: '1.5rem' }}>
      {/* Search Controls */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for images..."
            style={{
              flex: 1,
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={loading || !query.trim()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: loading || !query.trim() ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 500,
            }}
          >
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>Filter:</span>
          {(['all', 'cached', 'live'] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              style={{
                padding: '0.375rem 0.75rem',
                fontSize: '0.875rem',
                backgroundColor: filterMode === mode ? '#3b82f6' : '#f3f4f6',
                color: filterMode === mode ? 'white' : '#374151',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
              {stats && mode === 'cached' && ` (${stats.cached})`}
              {stats && mode === 'live' && ` (${stats.live})`}
            </button>
          ))}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            borderRadius: '8px',
            marginBottom: '1rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Results Grid */}
      {filteredResults.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '1.5rem',
          }}
        >
          {filteredResults.map((result) => (
            <div
              key={result.gettyId}
              onClick={() => setSelectedImage(result)}
              style={{
                border: selectedImage?.gettyId === result.gettyId ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                borderRadius: '8px',
                overflow: 'hidden',
                cursor: 'pointer',
                backgroundColor: 'white',
              }}
            >
              <div style={{ position: 'relative', paddingTop: '75%', backgroundColor: '#f3f4f6' }}>
                <img
                  src={result.previewUrl}
                  alt={result.title}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                  }}
                />
                {result.cached && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '0.5rem',
                      right: '0.5rem',
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#10b981',
                      color: 'white',
                      fontSize: '0.75rem',
                      borderRadius: '4px',
                    }}
                  >
                    Cached
                  </span>
                )}
              </div>
              <div style={{ padding: '0.75rem' }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {result.title}
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#6b7280' }}>
                  Score: {(result.relevanceScore * 100).toFixed(0)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Results */}
      {!loading && results.length === 0 && query && !error && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#6b7280' }}>
          No images found for "{query}"
        </div>
      )}

      {/* Selected Image Detail */}
      {selectedImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setSelectedImage(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '1.5rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>{selectedImage.title}</h3>
              <button
                onClick={() => setSelectedImage(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: '#6b7280',
                }}
              >
                &times;
              </button>
            </div>
            <img
              src={selectedImage.previewUrl}
              alt={selectedImage.title}
              style={{ width: '100%', borderRadius: '8px', marginBottom: '1rem' }}
            />
            <div style={{ fontSize: '0.875rem' }}>
              <p><strong>Getty ID:</strong> {selectedImage.gettyId}</p>
              <p><strong>Relevance:</strong> {(selectedImage.relevanceScore * 100).toFixed(1)}%</p>
              <p><strong>Cached:</strong> {selectedImage.cached ? 'Yes' : 'No'}</p>
              {selectedImage.keywords && (
                <p><strong>Keywords:</strong> {selectedImage.keywords.join(', ')}</p>
              )}
              {selectedImage.analysis && (
                <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <h4 style={{ margin: '0 0 0.5rem' }}>Analysis</h4>
                  <p><strong>Description:</strong> {selectedImage.analysis.description}</p>
                  <p><strong>Subjects:</strong> {selectedImage.analysis.subjects.join(', ')}</p>
                  <p><strong>Mood:</strong> {selectedImage.analysis.mood.join(', ')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Run lint**

Run: `cd debug-console && pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add debug-console/src/components/ImageSearchPanel.tsx
git commit -m "feat(debug-console): add ImageSearchPanel component"
```

---

## Task 7: Create Image Search Page

**Files:**

- Create: `debug-console/src/app/image-search/page.tsx`

**Step 1: Create the page**

```typescript
import ImageSearchPanel from '@/components/ImageSearchPanel';
import ProtectedRoute from '@/components/ProtectedRoute';

export default function ImageSearchPage() {
  return (
    <ProtectedRoute>
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#f5f5f5',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          {/* Header */}
          <header
            style={{
              backgroundColor: 'white',
              padding: '1.5rem 2rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 600, color: '#1a1a1a' }}>
                  Image Search Testing
                </h1>
                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.875rem', color: '#666' }}>
                  Test the image search service with Getty Images
                </p>
              </div>
              <a
                href="/"
                style={{
                  color: '#3b82f6',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                &larr; Back to Dashboard
              </a>
            </div>
          </header>

          {/* Main Content */}
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <ImageSearchPanel />
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
```

**Step 2: Run lint**

Run: `cd debug-console && pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add debug-console/src/app/image-search/page.tsx
git commit -m "feat(debug-console): add image search page"
```

---

## Task 8: Add Navigation Link

**Files:**

- Modify: `debug-console/src/pages/Dashboard.tsx`

**Step 1: Add navigation link**

In `Dashboard.tsx`, find the header section (around line 255-271) and add the Image Search link:

```tsx
// After the Analytics link, add:
<a
  href="/image-search"
  style={{
    color: "#3b82f6",
    textDecoration: "none",
    fontSize: "0.875rem",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    marginLeft: "1rem",
  }}
>
  Image Search
</a>
```

**Step 2: Run lint**

Run: `cd debug-console && pnpm lint`
Expected: PASS

**Step 3: Commit**

```bash
git add debug-console/src/pages/Dashboard.tsx
git commit -m "feat(debug-console): add image search navigation link"
```

---

## Task 9: Run Full Test Suite

**Step 1: Run Go tests**

Run: `cd image-search-service && go test ./... -v`
Expected: All tests PASS

**Step 2: Run TypeScript checks**

Run: `cd debug-console && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 3: Final commit if any fixes needed**

```bash
git status
# If clean, proceed to next task
```

---

## Task 10: Manual Testing

**Step 1: Start image-search-service locally**

Run: `cd image-search-service && AUTH_TYPE=none go run ./cmd/server`
Expected: Server starts on port 8080

**Step 2: Start debug-console**

Run: `cd debug-console && pnpm dev`
Expected: Server starts on port 3001

**Step 3: Test the UI**

1. Open http://localhost:3001/image-search
2. Enter a search query like "business meeting"
3. Verify results appear with images
4. Click an image to see detail panel
5. Test filter buttons

**Step 4: Test with real auth (if deployed)**

1. Set `AUTH_TYPE=jwt` and `SSO_HOST=sso.test-godaddy.com`
2. Access via deployed debug-console with JOMAX auth
3. Verify search works with real token
