package checks

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/credentials/ssocreds"
)

// stageHome creates a temporary HOME with an ~/.aws/config containing the given
// content and returns the path. Callers should also seed ~/.aws/sso/cache as
// needed via writeSSOCache.
func stageHome(t *testing.T, awsConfig string) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)

	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if awsConfig != "" {
		if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(awsConfig), 0o644); err != nil {
			t.Fatalf("WriteFile config: %v", err)
		}
	}
	return home
}

// writeSSOCache writes the cache file at the path the AWS SDK derives for the
// given key (sso_session name or sso_start_url). Using the same SDK helper the
// production code calls keeps tests aligned with the live derivation rule.
func writeSSOCache(t *testing.T, key, body string) string {
	t.Helper()
	path, err := ssocreds.StandardCachedTokenFilepath(key)
	if err != nil {
		t.Fatalf("StandardCachedTokenFilepath: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("MkdirAll cache: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("WriteFile cache: %v", err)
	}
	return path
}

func TestCheckSSOToken_ValidSessionToken(t *testing.T) {
	stageHome(t, `[sso-session airo-sso]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile airobuild-dev-private-sso]
sso_session = airo-sso
sso_account_id = 12345
sso_role_name = PowerUser
`)
	expires := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	writeSSOCache(t, "airo-sso", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("airobuild-dev-private-sso")
	if !ok {
		t.Fatalf("expected ok, got fail: %s", msg)
	}
}

func TestCheckSSOToken_ExpiredToken(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)
	expires := time.Now().Add(-1 * time.Minute).UTC().Format(time.RFC3339)
	writeSSOCache(t, "s", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail for expired token, got ok")
	}
	if !strings.Contains(msg, "aws sso login --profile p") {
		t.Errorf("expected actionable login command, got: %s", msg)
	}
}

func TestCheckSSOToken_ExpiringWithinBuffer(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)
	// Within the 5-minute safety buffer — treat as expired.
	expires := time.Now().Add(2 * time.Minute).UTC().Format(time.RFC3339)
	writeSSOCache(t, "s", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail for token within buffer, got ok: %s", msg)
	}
}

func TestCheckSSOToken_MissingCacheFile(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail when cache file missing, got ok")
	}
	if !strings.Contains(msg, "aws sso login --profile p") {
		t.Errorf("expected actionable login command, got: %s", msg)
	}
}

func TestCheckSSOToken_LegacyStartURL(t *testing.T) {
	startURL := "https://legacy.awsapps.com/start/"
	stageHome(t, fmt.Sprintf(`[profile legacy]
sso_start_url = %s
sso_region = us-west-2
sso_account_id = 1
sso_role_name = R
`, startURL))
	expires := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	writeSSOCache(t, startURL, fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("legacy")
	if !ok {
		t.Fatalf("expected ok for legacy SSO profile, got: %s", msg)
	}
}

func TestCheckSSOToken_NonSSOProfile(t *testing.T) {
	stageHome(t, `[profile static]
region = us-west-2
`)

	ok, msg := checkSSOToken("static")
	if !ok {
		t.Fatalf("expected ok for non-SSO profile (defer to STS), got: %s", msg)
	}
	if msg != "" {
		t.Errorf("expected empty message for non-SSO profile, got: %s", msg)
	}
}

func TestCheckSSOToken_ProfileNotFound(t *testing.T) {
	stageHome(t, `[profile somethingelse]
sso_session = s
`)

	ok, msg := checkSSOToken("missing")
	if ok {
		t.Fatalf("expected fail when profile not in ~/.aws/config, got ok")
	}
	if !strings.Contains(msg, "missing") {
		t.Errorf("expected message to mention profile name, got: %s", msg)
	}
	if !strings.Contains(msg, "aws sso login --profile missing") {
		t.Errorf("expected actionable login command, got: %s", msg)
	}
}

func TestCheckSSOToken_NoConfigFile(t *testing.T) {
	stageHome(t, "")

	ok, msg := checkSSOToken("any")
	if !ok {
		t.Fatalf("expected ok when ~/.aws/config absent (defer to STS), got: %s", msg)
	}
	if msg != "" {
		t.Errorf("expected empty message when config absent, got: %s", msg)
	}
}

func TestCheckSSOToken_MalformedCacheJSON(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)
	writeSSOCache(t, "s", `not json`)

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail for malformed cache, got ok")
	}
	if !strings.Contains(msg, "parsing cache") {
		t.Errorf("expected parse-error message, got: %s", msg)
	}
}

func TestCheckSSOToken_MissingExpiresAt(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)
	// Valid JSON but missing the expiresAt field.
	writeSSOCache(t, "s", `{"accessToken":"abc"}`)

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail when expiresAt absent, got ok")
	}
	if !strings.Contains(msg, "missing expiresAt") {
		t.Errorf("expected message to mention missing expiresAt, got: %s", msg)
	}
	if !strings.Contains(msg, "aws sso login --profile p") {
		t.Errorf("expected actionable login command, got: %s", msg)
	}
}

func TestCheckSSOToken_MalformedExpiresAt(t *testing.T) {
	stageHome(t, `[sso-session s]
sso_start_url = https://example.awsapps.com/start/
sso_region = us-west-2

[profile p]
sso_session = s
`)
	// expiresAt present but not RFC3339.
	writeSSOCache(t, "s", `{"expiresAt":"yesterday"}`)

	ok, msg := checkSSOToken("p")
	if ok {
		t.Fatalf("expected fail for malformed expiresAt, got ok")
	}
	if !strings.Contains(msg, "parsing expiresAt") {
		t.Errorf("expected parse-expiresAt error message, got: %s", msg)
	}
}

func TestCheckSSOToken_DefaultProfileSection(t *testing.T) {
	// Default profile uses [default] not [profile default]
	stageHome(t, `[sso-session ds]
sso_start_url = https://default.awsapps.com/start/
sso_region = us-west-2

[default]
sso_session = ds
`)
	expires := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	writeSSOCache(t, "ds", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("default")
	if !ok {
		t.Fatalf("expected ok for default profile, got: %s", msg)
	}
}

func TestCheckSSOToken_ResolvesTargetProfileSession(t *testing.T) {
	// Two profiles referencing distinct SSO sessions. Only the target session
	// has a cached token; if resolution picked the other profile's session the
	// cache lookup would miss and the check would fail. Pins section isolation.
	stageHome(t, `[sso-session right]
sso_start_url = https://right.awsapps.com/start/
sso_region = us-west-2

[sso-session wrong]
sso_start_url = https://wrong.awsapps.com/start/
sso_region = us-west-2

[profile other]
sso_session = wrong

[profile target]
sso_session = right
`)
	expires := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	writeSSOCache(t, "right", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("target")
	if !ok {
		t.Fatalf("expected ok for target profile, got: %s", msg)
	}
}

func TestCheckSSOToken_DefaultSessionNotLeakedToNamedProfile(t *testing.T) {
	// [default] uses the bare-name header while the named profile uses
	// [profile <name>]. Only the named profile's session has a cached token, so
	// a valid result proves the default session did not leak into resolution.
	stageHome(t, `[sso-session default-session]
sso_start_url = https://default.awsapps.com/start/
sso_region = us-west-2

[sso-session target-session]
sso_start_url = https://target.awsapps.com/start/
sso_region = us-west-2

[default]
sso_session = default-session

[profile target]
sso_session = target-session
`)
	expires := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	writeSSOCache(t, "target-session", fmt.Sprintf(`{"expiresAt":%q}`, expires))

	ok, msg := checkSSOToken("target")
	if !ok {
		t.Fatalf("expected ok for target profile, got: %s", msg)
	}
}
