// TODO: Extract auth code (jomax, jwks, validator) into a shared Go library for reuse across services.
package auth

import (
	"context"
	"crypto"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/lestrrat-go/jwx/v2/jwk"
)

var kidPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

const (
	TokenTypeAiroApp = "airo-app"
	TokenTypeJomax   = "jomax"
	TokenTypeUnknown = "unknown"
)

const jomaxCacheDuration = 24 * time.Hour

var ErrJomaxKeyNotFound = errors.New("jomax: key not found")
var ErrInvalidKid = errors.New("jomax: invalid key id format")

type jomaxCachedKey struct {
	key       crypto.PublicKey
	expiresAt time.Time
}

type JomaxKeyClient struct {
	ssoHost    string
	httpClient *http.Client
	cache      map[string]*jomaxCachedKey
	mu         sync.RWMutex
}

// ssoKeyResponse is the envelope returned by sso.godaddy.com/v1/api/key/{kid}.
// The inner Data field is a standard JWK object.
type ssoKeyResponse struct {
	Data json.RawMessage `json:"data"`
}

func NewJomaxKeyClient(ssoHost string) *JomaxKeyClient {
	normalizedHost := ssoHost
	if !strings.HasPrefix(normalizedHost, "http://") && !strings.HasPrefix(normalizedHost, "https://") {
		normalizedHost = "https://" + normalizedHost
	}
	normalizedHost = strings.TrimSuffix(normalizedHost, "/")

	return &JomaxKeyClient{
		ssoHost:    normalizedHost,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		cache:      make(map[string]*jomaxCachedKey),
	}
}

func (c *JomaxKeyClient) GetKey(kid string) (crypto.PublicKey, error) {
	if kid == "" || !kidPattern.MatchString(kid) {
		return nil, ErrInvalidKid
	}

	c.mu.RLock()
	cached, ok := c.cache[kid]
	c.mu.RUnlock()

	if ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	return c.fetchAndCacheKey(kid)
}

func (c *JomaxKeyClient) fetchAndCacheKey(kid string) (crypto.PublicKey, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if cached, ok := c.cache[kid]; ok && time.Now().Before(cached.expiresAt) {
		return cached.key, nil
	}

	url := fmt.Sprintf("%s/v1/api/key/%s", c.ssoHost, kid)

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

	// Unwrap the GoDaddy envelope and parse the inner JWK using the standard library.
	// This handles RSA, EC, or any future algorithm without code changes.
	var envelope ssoKeyResponse
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return nil, fmt.Errorf("jomax: failed to decode response envelope: %w", err)
	}
	if len(envelope.Data) == 0 {
		return nil, errors.New("jomax: missing data field in response")
	}

	jwkKey, err := jwk.ParseKey(envelope.Data)
	if err != nil {
		return nil, fmt.Errorf("jomax: failed to parse JWK: %w", err)
	}

	var pubKey crypto.PublicKey
	if err := jwkKey.Raw(&pubKey); err != nil {
		return nil, fmt.Errorf("jomax: failed to extract public key: %w", err)
	}

	c.cache[kid] = &jomaxCachedKey{
		key:       pubKey,
		expiresAt: time.Now().Add(jomaxCacheDuration),
	}

	return pubKey, nil
}

type JomaxValidator struct {
	keyClient *JomaxKeyClient
}

func NewJomaxValidator(ssoHost string) *JomaxValidator {
	return &JomaxValidator{
		keyClient: NewJomaxKeyClient(ssoHost),
	}
}

func (v *JomaxValidator) Validate(tokenString string) (jwt.MapClaims, error) {
	token, _, err := jwt.NewParser().ParseUnverified(tokenString, jwt.MapClaims{})
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	kid, ok := token.Header["kid"].(string)
	if !ok || kid == "" {
		return nil, ErrMissingKid
	}

	publicKey, err := v.keyClient.GetKey(kid)
	if err != nil {
		if errors.Is(err, ErrJomaxKeyNotFound) {
			return nil, fmt.Errorf("%w: key not found for kid %s", ErrInvalidSignature, kid)
		}
		return nil, fmt.Errorf("failed to get signing key: %w", err)
	}

	validatedToken, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
		return publicKey, nil
	}, jwt.WithValidMethods([]string{"RS256", "RS384", "RS512", "ES256", "ES384", "ES512"}))

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

func detectTokenTypeFromClaims(claims map[string]any) string {
	if iss, ok := claims["iss"].(string); ok && iss == TokenTypeAiroApp {
		return TokenTypeAiroApp
	}

	// Shopper Jomax tokens carry "per" (permissions) or "shopperId".
	if _, hasPer := claims["per"]; hasPer {
		return TokenTypeJomax
	}
	if _, hasShopperID := claims["shopperId"]; hasShopperID {
		return TokenTypeJomax
	}
	// Employee Jomax tokens carry typ="jomax" or accountName instead.
	if typ, ok := claims["typ"].(string); ok && typ == "jomax" {
		return TokenTypeJomax
	}
	if _, hasAccountName := claims["accountName"]; hasAccountName {
		return TokenTypeJomax
	}

	return TokenTypeUnknown
}
