package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	// DefaultAuthSecretsTTL is how often auth.json is re-read from disk.
	// Balances credential-rotation latency against file I/O frequency.
	DefaultAuthSecretsTTL = 5 * time.Minute

	// ssoOAuthConfigKey is the fixed top-level key in auth.json holding
	// the cache row written by airo-go's SSOOAuthConfigMirror.
	ssoOAuthConfigKey = "SSO_OAUTH_CONFIG"
)

// DefaultAuthSecretsPath returns the conventional path to auth.json.
// In production, Nomad sets NOMAD_SECRETS_DIR and the secrets tar is extracted there.
// In local dev, defaults to /alloc (where docker-compose mounts the alloc directory).
// mhp-core delivers auth.json directly into the secrets root: ${NOMAD_SECRETS_DIR}/auth.json.
func DefaultAuthSecretsPath() string {
	return "/alloc/auth.json"
}

// SecretsEntry holds OAuth credentials and IDP metadata resolved from auth.json.
type SecretsEntry struct {
	Issuer           string // IDP issuer URL (e.g., https://godaddy.okta.com)
	ClientID         string // OAuth client ID
	ClientSecret     string // OAuth client secret
	JwksURL          string // JWKS endpoint URL
	ExpectedAudience string // Expected audience claim
	IDPType          string // IDP type (e.g., godaddy_shopper)
	SSORequired      bool   // Whether SSO is enforced
}

// ssoCacheRow is the VALUE of the SSO_OAUTH_CONFIG cache row in auth.json.
// Field names match the constants in backends/hosting and airo-go.
type ssoCacheRow struct {
	IDPType          string `json:"idpType"`
	Issuer           string `json:"issuer"`
	JwksURL          string `json:"jwksUrl"`
	ExpectedAudience string `json:"expectedAudience"`
	SSORequired      bool   `json:"ssoRequired"`
	ClientIDKey      string `json:"clientIdKey"`
	ClientSecretKey  string `json:"clientSecretKey"`
}

// secretRow is the SYSTEM_MANAGED secret envelope for any row in auth.json.
type secretRow struct {
	Value         json.RawMessage `json:"VALUE"`
	SystemManaged bool            `json:"SYSTEM_MANAGED"`
	Auth          bool            `json:"AUTH"`
}

// SecretsLoader reads IDP OAuth credentials from auth.json with TTL-based caching.
// Thread-safe for concurrent access from the HTTP middleware path.
//
// auth.json contains three rows (written by the hosting secrets pipeline):
//   - SSO_OAUTH_CONFIG — cache row with IDP metadata + pointer keys
//   - <clientIdKey>    — row whose VALUE is the raw client ID
//   - <clientSecretKey> — row whose VALUE is the raw client secret
type SecretsLoader struct {
	path     string
	ttl      time.Duration
	mu       sync.RWMutex
	cached   *SecretsEntry
	loadedAt time.Time
}

// NewSecretsLoader creates a loader that reads auth.json from the given path.
func NewSecretsLoader(path string) *SecretsLoader {
	return &SecretsLoader{
		path: path,
		ttl:  DefaultAuthSecretsTTL,
	}
}

// Load returns the cached credentials, re-reading from disk if the TTL has expired.
// Returns an error if the file is missing, malformed, or required entries are absent.
func (l *SecretsLoader) Load() (*SecretsEntry, error) {
	l.mu.RLock()
	if l.cached != nil && time.Since(l.loadedAt) < l.ttl {
		entry := *l.cached
		l.mu.RUnlock()
		return &entry, nil
	}
	l.mu.RUnlock()

	l.mu.Lock()
	defer l.mu.Unlock()

	// Double-check after acquiring write lock
	if l.cached != nil && time.Since(l.loadedAt) < l.ttl {
		entry := *l.cached
		return &entry, nil
	}

	entry, err := l.readFromDisk()
	if err != nil {
		return nil, err
	}

	l.cached = entry
	l.loadedAt = time.Now()

	slog.Info("idp.auth_secrets.loaded", "path", l.path, "issuer", entry.Issuer)

	result := *entry
	return &result, nil
}

// readFromDisk reads and parses auth.json using the three-row format:
//  1. Parse SSO_OAUTH_CONFIG cache row → extract issuer + clientIdKey/clientSecretKey pointers
//  2. Read the row named by clientIdKey → extract VALUE as the client ID
//  3. Read the row named by clientSecretKey → extract VALUE as the client secret
func (l *SecretsLoader) readFromDisk() (*SecretsEntry, error) {
	data, err := os.ReadFile(l.path)
	if err != nil {
		return nil, fmt.Errorf("failed to read auth secrets file %s: %w", l.path, err)
	}

	var file map[string]secretRow
	if unmarshalErr := json.Unmarshal(data, &file); unmarshalErr != nil {
		return nil, fmt.Errorf("failed to parse auth secrets file: %w", unmarshalErr)
	}

	// 1. Parse the SSO_OAUTH_CONFIG cache row
	cacheRowRaw, ok := file[ssoOAuthConfigKey]
	if !ok {
		return nil, fmt.Errorf("auth secrets file missing %q cache row", ssoOAuthConfigKey)
	}

	var cache ssoCacheRow
	if unmarshalErr := json.Unmarshal(cacheRowRaw.Value, &cache); unmarshalErr != nil {
		return nil, fmt.Errorf("failed to parse %s VALUE: %w", ssoOAuthConfigKey, unmarshalErr)
	}

	if strings.TrimSpace(cache.Issuer) == "" {
		return nil, errors.New("SSO_OAUTH_CONFIG cache row missing issuer")
	}
	if strings.TrimSpace(cache.ClientIDKey) == "" {
		return nil, errors.New("SSO_OAUTH_CONFIG cache row missing clientIdKey")
	}
	if strings.TrimSpace(cache.ClientSecretKey) == "" {
		return nil, errors.New("SSO_OAUTH_CONFIG cache row missing clientSecretKey")
	}

	// 2. Read client ID from the pointer-named row
	clientID, err := extractStringValue(file, cache.ClientIDKey)
	if err != nil {
		return nil, fmt.Errorf("failed to read client ID from %q: %w", cache.ClientIDKey, err)
	}

	// 3. Read client secret from the pointer-named row
	clientSecret, err := extractStringValue(file, cache.ClientSecretKey)
	if err != nil {
		return nil, fmt.Errorf("failed to read client secret from %q: %w", cache.ClientSecretKey, err)
	}

	return &SecretsEntry{
		Issuer:           cache.Issuer,
		ClientID:         clientID,
		ClientSecret:     clientSecret,
		JwksURL:          cache.JwksURL,
		ExpectedAudience: cache.ExpectedAudience,
		IDPType:          cache.IDPType,
		SSORequired:      cache.SSORequired,
	}, nil
}

// extractStringValue reads a top-level row from auth.json and returns its VALUE as a string.
func extractStringValue(file map[string]secretRow, key string) (string, error) {
	row, ok := file[key]
	if !ok {
		return "", fmt.Errorf("auth secrets file missing row %q", key)
	}

	var val string
	if err := json.Unmarshal(row.Value, &val); err != nil {
		return "", fmt.Errorf("row %q VALUE is not a string: %w", key, err)
	}

	if strings.TrimSpace(val) == "" {
		return "", fmt.Errorf("row %q VALUE is empty", key)
	}

	return val, nil
}
