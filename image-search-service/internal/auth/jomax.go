// Package auth provides JWT authentication for the image search service.
package auth

import (
	"context"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// kidPattern validates key IDs to prevent URL injection attacks.
// Allows alphanumeric characters, hyphens, and underscores only.
var kidPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// Token type constants.
const (
	TokenTypeAiroApp = "airo-app"
	TokenTypeJomax   = "jomax"
	TokenTypeUnknown = "unknown"
)

// Cache duration for JOMAX keys (24 hours).
const jomaxCacheDuration = 24 * time.Hour

// ErrJomaxKeyNotFound is returned when a key with the specified kid is not found.
var ErrJomaxKeyNotFound = errors.New("jomax: key not found")

// ErrInvalidKid is returned when the key ID contains invalid characters.
var ErrInvalidKid = errors.New("jomax: invalid key id format")

// jomaxCachedKey holds a cached RSA public key with its expiration time.
type jomaxCachedKey struct {
	key       *rsa.PublicKey
	expiresAt time.Time
}

// JomaxKeyClient fetches and caches RSA public keys from GoDaddy SSO.
// Keys are fetched from {ssoHost}/v1/api/key/{kid} and returned as PEM-encoded RSA public keys.
type JomaxKeyClient struct {
	ssoHost    string
	httpClient *http.Client
	cache      map[string]*jomaxCachedKey
	mu         sync.RWMutex
}

// NewJomaxKeyClient creates a new JOMAX key client that fetches keys from the given SSO host.
// If ssoHost doesn't include a scheme, https:// is prepended automatically.
func NewJomaxKeyClient(ssoHost string) *JomaxKeyClient {
	// Normalize ssoHost to ensure it has a scheme
	normalizedHost := ssoHost
	if !strings.HasPrefix(normalizedHost, "http://") && !strings.HasPrefix(normalizedHost, "https://") {
		normalizedHost = "https://" + normalizedHost
	}
	// Remove trailing slash if present
	normalizedHost = strings.TrimSuffix(normalizedHost, "/")

	return &JomaxKeyClient{
		ssoHost:    normalizedHost,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]*jomaxCachedKey),
	}
}

// GetKey retrieves the RSA public key for the given key ID.
// It first checks the cache and only fetches from the SSO endpoint if not cached or expired.
// Returns ErrInvalidKid if the kid contains invalid characters.
func (c *JomaxKeyClient) GetKey(kid string) (*rsa.PublicKey, error) {
	// Validate kid format to prevent URL injection attacks
	if kid == "" || !kidPattern.MatchString(kid) {
		return nil, ErrInvalidKid
	}

	// Check cache with read lock
	c.mu.RLock()
	cached, ok := c.cache[kid]
	c.mu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	// Cache miss or expired - fetch and cache the key
	return c.fetchAndCacheKey(kid)
}

// fetchAndCacheKey fetches the key from SSO and caches it.
// Uses double-check locking to prevent concurrent fetches for the same key.
func (c *JomaxKeyClient) fetchAndCacheKey(kid string) (*rsa.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Double-check: another goroutine may have fetched while we waited for the lock
	if cached, ok := c.cache[kid]; ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	// Build URL: {ssoHost}/v1/api/key/{kid}
	url := fmt.Sprintf("%s/v1/api/key/%s", c.ssoHost, kid)

	// Fetch key from SSO endpoint
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
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

	// Read PEM data
	pemData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to read response: %w", err)
	}

	// Parse PEM block
	block, _ := pem.Decode(pemData)
	if block == nil {
		return nil, errors.New("jomax: failed to decode PEM block")
	}

	// Parse RSA public key
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to parse public key: %w", err)
	}

	rsaKey, ok := pub.(*rsa.PublicKey)
	if !ok {
		return nil, errors.New("jomax: key is not an RSA public key")
	}

	// Cache the key
	c.cache[kid] = &jomaxCachedKey{
		key:       rsaKey,
		expiresAt: time.Now().Add(jomaxCacheDuration),
	}

	return rsaKey, nil
}

// JomaxValidator validates JOMAX (GoDaddy employee) JWT tokens using RS256.
type JomaxValidator struct {
	keyClient *JomaxKeyClient
}

// NewJomaxValidator creates a new JOMAX token validator.
// ssoHost is the GoDaddy SSO host URL (e.g., "https://sso.godaddy.com").
func NewJomaxValidator(ssoHost string) *JomaxValidator {
	return &JomaxValidator{
		keyClient: NewJomaxKeyClient(ssoHost),
	}
}

// Validate validates a JOMAX JWT token and returns its claims if valid.
// The token must be signed with RS256 using a key from GoDaddy SSO.
func (v *JomaxValidator) Validate(tokenString string) (jwt.MapClaims, error) {
	// Parse unverified to get the kid from header
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	// Get kid from header
	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, ErrMissingKid
	}

	// Get public key from JOMAX SSO
	publicKey, err := v.keyClient.GetKey(kid)
	if err != nil {
		if errors.Is(err, ErrJomaxKeyNotFound) {
			return nil, fmt.Errorf("%w: key not found for kid %s", ErrInvalidSignature, kid)
		}
		return nil, fmt.Errorf("failed to get signing key: %w", err)
	}

	// Parse and verify the token with RS256
	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		// Verify algorithm is RS256
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

// detectTokenTypeFromClaims determines the token type based on JWT claims.
// Returns TokenTypeAiroApp if iss claim equals "airo-app".
// Returns TokenTypeJomax if per claim exists OR shopperId claim exists.
// Returns TokenTypeUnknown otherwise.
func detectTokenTypeFromClaims(claims map[string]any) string {
	// Check for airo-app token first (takes precedence)
	if iss, ok := claims["iss"].(string); ok && iss == TokenTypeAiroApp {
		return TokenTypeAiroApp
	}

	// Check for JOMAX token indicators
	if _, hasPer := claims["per"]; hasPer {
		return TokenTypeJomax
	}
	if _, hasShopperID := claims["shopperId"]; hasShopperID {
		return TokenTypeJomax
	}

	return TokenTypeUnknown
}
