// Package jfrog provides shared utilities for working with the GoDaddy
// Artifactory (JFrog) JWT used by pnpm (via ~/.npmrc) and Go (via GOPROXY).
//
// Note on test injection: ValidateEndpoint and ProbeTimeout are mutable
// package-level variables so tests can redirect Probe at httptest servers.
// Tests that mutate them MUST NOT call t.Parallel() -- they share global
// state across the whole package. If parallel tests are ever needed here,
// migrate to a Prober struct with these as fields.
package jfrog

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Host is the Artifactory hostname shared by npm and Go repos.
const Host = "gdartifactory1.jfrog.io"

// ValidateEndpoint is probed by Probe; overridable for tests.
// `/api/system/version` is the canonical JFrog "am I authenticated?" endpoint:
// it returns 200 for any authenticated user (since JFrog 2.2.1) and 401 when
// the token is missing, expired, or revoked. Avoid repository-scoped endpoints
// (e.g. /api/repositories/{key}) which require Manage permission and would
// produce false-positive 403s for developers with normal deploy/read access.
var ValidateEndpoint = "https://" + Host + "/artifactory/api/system/version"

// ProbeTimeout bounds how long Probe will wait for Artifactory.
var ProbeTimeout = 5 * time.Second

// Sentinel errors returned by Probe.
var (
	ErrMissingToken = errors.New("no Artifactory token available")
	ErrUnauthorized = errors.New("artifactory rejected the token (expired or revoked)")
)

// TokenFromNpmrc extracts the _authToken for gdartifactory1.jfrog.io from
// ~/.npmrc. Returns an empty string (and no error) when the file exists but
// has no matching line, so callers can distinguish "no token" from IO errors.
func TokenFromNpmrc() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(home, ".npmrc"))
	if err != nil {
		return "", err
	}
	return tokenFromNpmrcBytes(data), nil
}

func tokenFromNpmrcBytes(data []byte) string {
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		// Skip blank lines and ini-style comments (`#` or `;`). Without
		// this, a stale commented-out token would be returned in
		// preference to the real one on a later line.
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if !strings.Contains(line, Host) {
			continue
		}
		if _, token, ok := strings.Cut(line, "_authToken="); ok {
			return strings.TrimSpace(token)
		}
	}
	return ""
}

// TokenFromProxyURL extracts the JWT from the first comma-separated entry of
// a GOPROXY string that points at Artifactory.
func TokenFromProxyURL(goproxy string) string {
	for _, entry := range strings.Split(goproxy, ",") {
		entry = strings.TrimSpace(entry)
		if !strings.Contains(entry, Host) {
			continue
		}
		u, err := url.Parse(entry)
		if err != nil || u.User == nil {
			continue
		}
		if password, ok := u.User.Password(); ok && password != "" {
			return password
		}
	}
	return ""
}

// Probe makes an authenticated request to Artifactory to confirm the token
// is accepted. Returns:
//   - nil on 2xx (token is valid)
//   - ErrMissingToken when token is empty
//   - ErrUnauthorized on 401/403 (token expired or revoked)
//   - a wrapped error for network failures or unexpected statuses; callers
//     treating the probe as advisory should typically ignore these.
func Probe(ctx context.Context, token string) error {
	if token == "" {
		return ErrMissingToken
	}
	ctx, cancel := context.WithTimeout(ctx, ProbeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ValidateEndpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("probing %s: %w", ValidateEndpoint, err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusUnauthorized, resp.StatusCode == http.StatusForbidden:
		return ErrUnauthorized
	default:
		return fmt.Errorf("unexpected status %d from %s", resp.StatusCode, ValidateEndpoint)
	}
}
