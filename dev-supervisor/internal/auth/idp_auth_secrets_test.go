package auth //nolint:testpackage // testing unexported readFromDisk method

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeAuthJSON(t *testing.T, dir string, content map[string]any) string {
	t.Helper()
	data, err := json.Marshal(content)
	require.NoError(t, err)
	path := filepath.Join(dir, "auth.json")
	require.NoError(t, os.WriteFile(path, data, 0o600))
	return path
}

// validAuthJSON returns the three-row auth.json format matching PR #721.
func validAuthJSON() map[string]any {
	return map[string]any{
		"SSO_OAUTH_CONFIG": map[string]any{
			"SYSTEM_MANAGED": true,
			"AUTH":           true,
			"VALUE": map[string]any{
				"idpType":          "godaddy_shopper",
				"issuer":           "https://godaddy.okta.com",
				"jwksUrl":          "https://godaddy.okta.com/oauth2/v1/keys",
				"expectedAudience": "my-audience",
				"ssoRequired":      true,
				"clientIdKey":      "SSO_CLIENT_ID_abc123",
				"clientSecretKey":  "SSO_CLIENT_SECRET_abc123",
			},
		},
		"SSO_CLIENT_ID_abc123": map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          "my-client-id",
		},
		"SSO_CLIENT_SECRET_abc123": map[string]any{
			"SYSTEM_MANAGED": false,
			"AUTH":           true,
			"VALUE":          "my-client-secret",
		},
	}
}

func TestSecretsLoader_Load_Success(t *testing.T) {
	dir := t.TempDir()
	path := writeAuthJSON(t, dir, validAuthJSON())

	loader := NewSecretsLoader(path)
	entry, err := loader.Load()

	require.NoError(t, err)
	assert.Equal(t, "https://godaddy.okta.com", entry.Issuer)
	assert.Equal(t, "my-client-id", entry.ClientID)
	assert.Equal(t, "my-client-secret", entry.ClientSecret)
	assert.Equal(t, "https://godaddy.okta.com/oauth2/v1/keys", entry.JwksURL)
	assert.Equal(t, "my-audience", entry.ExpectedAudience)
	assert.Equal(t, "godaddy_shopper", entry.IDPType)
	assert.True(t, entry.SSORequired)
}

func TestSecretsLoader_Load_FileMissing(t *testing.T) {
	loader := NewSecretsLoader("/nonexistent/auth.json")
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to read auth secrets file")
}

func TestSecretsLoader_Load_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "auth.json")
	require.NoError(t, os.WriteFile(path, []byte("not json"), 0o600))

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse auth secrets file")
}

func TestSecretsLoader_Load_MissingCacheRow(t *testing.T) {
	dir := t.TempDir()
	writeAuthJSON(t, dir, map[string]any{
		"SOME_OTHER_KEY": map[string]any{
			"VALUE": map[string]any{},
		},
	})

	loader := NewSecretsLoader(filepath.Join(dir, "auth.json"))
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing \"SSO_OAUTH_CONFIG\" cache row")
}

func TestSecretsLoader_Load_MissingIssuer(t *testing.T) {
	content := validAuthJSON()
	cacheValue := content["SSO_OAUTH_CONFIG"].(map[string]any)["VALUE"].(map[string]any)
	cacheValue["issuer"] = ""

	dir := t.TempDir()
	path := writeAuthJSON(t, dir, content)

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing issuer")
}

func TestSecretsLoader_Load_MissingClientIdKey(t *testing.T) {
	content := validAuthJSON()
	cacheValue := content["SSO_OAUTH_CONFIG"].(map[string]any)["VALUE"].(map[string]any)
	cacheValue["clientIdKey"] = ""

	dir := t.TempDir()
	path := writeAuthJSON(t, dir, content)

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing clientIdKey")
}

func TestSecretsLoader_Load_MissingCredentialRow(t *testing.T) {
	content := validAuthJSON()
	delete(content, "SSO_CLIENT_ID_abc123") // remove the client ID row

	dir := t.TempDir()
	path := writeAuthJSON(t, dir, content)

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "SSO_CLIENT_ID_abc123")
}

func TestSecretsLoader_Load_EmptyCredentialValue(t *testing.T) {
	content := validAuthJSON()
	content["SSO_CLIENT_SECRET_abc123"] = map[string]any{
		"SYSTEM_MANAGED": false,
		"AUTH":           true,
		"VALUE":          "",
	}

	dir := t.TempDir()
	path := writeAuthJSON(t, dir, content)

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

func TestSecretsLoader_Load_CachesTTL(t *testing.T) {
	dir := t.TempDir()
	path := writeAuthJSON(t, dir, validAuthJSON())

	loader := NewSecretsLoader(path)
	loader.ttl = 1 * time.Hour // long TTL to test caching

	// First load reads from disk
	entry1, err := loader.Load()
	require.NoError(t, err)
	assert.Equal(t, "my-client-id", entry1.ClientID)

	// Delete the file — cached value should still be returned
	require.NoError(t, os.Remove(path))

	entry2, err := loader.Load()
	require.NoError(t, err)
	assert.Equal(t, "my-client-id", entry2.ClientID)
}

func TestSecretsLoader_Load_RefreshesAfterTTL(t *testing.T) {
	dir := t.TempDir()
	path := writeAuthJSON(t, dir, validAuthJSON())

	loader := NewSecretsLoader(path)
	loader.ttl = 1 * time.Millisecond // immediate expiry

	// First load
	entry1, err := loader.Load()
	require.NoError(t, err)
	assert.Equal(t, "my-client-id", entry1.ClientID)

	// Update the file with rotated credentials
	time.Sleep(5 * time.Millisecond)
	rotated := validAuthJSON()
	rotated["SSO_CLIENT_ID_abc123"] = map[string]any{
		"SYSTEM_MANAGED": false,
		"AUTH":           true,
		"VALUE":          "rotated-client-id",
	}
	writeAuthJSON(t, dir, rotated)

	// Second load should pick up rotated credentials
	entry2, err := loader.Load()
	require.NoError(t, err)
	assert.Equal(t, "rotated-client-id", entry2.ClientID)
}

func TestSecretsLoader_Load_ReturnsCopy(t *testing.T) {
	dir := t.TempDir()
	path := writeAuthJSON(t, dir, validAuthJSON())

	loader := NewSecretsLoader(path)

	entry1, err := loader.Load()
	require.NoError(t, err)

	// Mutate the returned entry — should not affect cached value
	entry1.ClientID = "mutated"

	entry2, err := loader.Load()
	require.NoError(t, err)
	assert.Equal(t, "my-client-id", entry2.ClientID)
}

func TestSecretsLoader_Load_NonStringCredentialValue(t *testing.T) {
	content := validAuthJSON()
	content["SSO_CLIENT_ID_abc123"] = map[string]any{
		"SYSTEM_MANAGED": false,
		"AUTH":           true,
		"VALUE":          12345, // not a string
	}

	dir := t.TempDir()
	path := writeAuthJSON(t, dir, content)

	loader := NewSecretsLoader(path)
	_, err := loader.Load()

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a string")
}
