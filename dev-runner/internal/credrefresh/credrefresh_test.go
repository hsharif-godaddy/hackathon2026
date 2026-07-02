package credrefresh

import (
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCheckToken_Valid(t *testing.T) {
	dir := t.TempDir()
	cacheDir := filepath.Join(dir, ".aws", "sso", "cache")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Write a config file with an sso-session
	configDir := filepath.Join(dir, ".aws")
	configContent := `[profile test-profile]
sso_session = test-session
sso_account_id = 123456789
sso_role_name = PowerUser
region = us-west-2

[sso-session test-session]
sso_start_url = https://example.awsapps.com/start
sso_region = us-west-2
`
	if err := os.WriteFile(filepath.Join(configDir, "config"), []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Write a valid token expiring in 45 minutes at the SHA1-derived path
	token := map[string]string{
		"expiresAt": time.Now().Add(45 * time.Minute).UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(token)
	hash := fmt.Sprintf("%x", sha1.Sum([]byte("test-session")))
	tokenPath := filepath.Join(cacheDir, hash+".json")
	if err := os.WriteFile(tokenPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	status := CheckToken("test-profile", dir)
	if !status.OK {
		t.Errorf("expected OK=true, got OK=false: %s", status.Message)
	}
	if status.TTL < 44*time.Minute || status.TTL > 46*time.Minute {
		t.Errorf("expected TTL ~45m, got %v", status.TTL)
	}
}

func TestCheckToken_Expired(t *testing.T) {
	dir := t.TempDir()
	cacheDir := filepath.Join(dir, ".aws", "sso", "cache")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatal(err)
	}

	configDir := filepath.Join(dir, ".aws")
	configContent := `[profile test-profile]
sso_session = test-session
sso_account_id = 123456789
sso_role_name = PowerUser
region = us-west-2

[sso-session test-session]
sso_start_url = https://example.awsapps.com/start
sso_region = us-west-2
`
	if err := os.WriteFile(filepath.Join(configDir, "config"), []byte(configContent), 0644); err != nil {
		t.Fatal(err)
	}

	token := map[string]string{
		"expiresAt": time.Now().Add(-5 * time.Minute).UTC().Format(time.RFC3339),
	}
	data, _ := json.Marshal(token)
	hash := fmt.Sprintf("%x", sha1.Sum([]byte("test-session")))
	tokenPath := filepath.Join(cacheDir, hash+".json")
	if err := os.WriteFile(tokenPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	status := CheckToken("test-profile", dir)
	if status.OK {
		t.Error("expected OK=false for expired token")
	}
}

func TestBracketFor(t *testing.T) {
	tests := []struct {
		ttl      time.Duration
		expected Bracket
	}{
		{45 * time.Minute, BracketHealthy},
		{25 * time.Minute, BracketWarning},
		{8 * time.Minute, BracketUrgent},
		{3 * time.Minute, BracketCritical},
	}
	for _, tc := range tests {
		got := BracketFor(tc.ttl)
		if got != tc.expected {
			t.Errorf("BracketFor(%v) = %v, want %v", tc.ttl, got, tc.expected)
		}
	}
}
