package fixers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
)

func readAWSConfig(t *testing.T, home string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join(home, ".aws", "config"))
	if err != nil {
		t.Fatalf("reading ~/.aws/config: %v", err)
	}
	return string(content)
}

// countSections counts occurrences of a "[section]" header in the config.
func countSections(content, section string) int {
	target := "[" + section + "]"
	n := 0
	for line := range strings.SplitSeq(content, "\n") {
		if strings.TrimSpace(line) == target {
			n++
		}
	}
	return n
}

func TestEnsureAWSConfig_CreatesSessionAndProfileWhenEmpty(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := ensureAWSConfig(awsconfig.DefaultProfile); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	content := readAWSConfig(t, home)
	if countSections(content, "sso-session "+awsconfig.SSOSessionName) != 1 {
		t.Errorf("expected airo-sso session to be created exactly once:\n%s", content)
	}
	if countSections(content, "profile "+awsconfig.DefaultProfile) != 1 {
		t.Errorf("expected default profile to be created exactly once:\n%s", content)
	}
	if !strings.Contains(content, "sso_session = "+awsconfig.SSOSessionName) {
		t.Errorf("profile should reference airo-sso session:\n%s", content)
	}
}

func TestEnsureAWSConfig_LeavesExistingProfileUntouched(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	existing := `[sso-session my-own-session]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start/#
sso_region = us-west-2
sso_registration_scopes = sso:account:access

[profile airobuild-dev-private-sso]
sso_session = my-own-session
sso_account_id = 694282668781
sso_role_name = PowerUser
region = us-west-2
output = json
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	if err := ensureAWSConfig(awsconfig.DefaultProfile); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	content := readAWSConfig(t, home)
	if content != existing {
		t.Errorf("config was modified when profile already existed:\n--- got ---\n%s\n--- want ---\n%s", content, existing)
	}
}

func TestEnsureAWSConfig_ReusesMatchingSessionForNewProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	existing := `[sso-session corp-dev]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start
sso_region = us-west-2
sso_registration_scopes = sso:account:access
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	if err := ensureAWSConfig(awsconfig.DefaultProfile); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	content := readAWSConfig(t, home)
	if countSections(content, "sso-session "+awsconfig.SSOSessionName) != 0 {
		t.Errorf("airo-sso session should not be created when a matching session exists:\n%s", content)
	}
	if countSections(content, "profile "+awsconfig.DefaultProfile) != 1 {
		t.Errorf("expected profile to be created exactly once:\n%s", content)
	}
	if !strings.Contains(content, "sso_session = corp-dev") {
		t.Errorf("profile should reference the existing corp-dev session:\n%s", content)
	}
}

func TestEnsureAWSConfig_SkipsNonDefaultMissingProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	if err := ensureAWSConfig("some-custom-profile"); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	if _, err := os.Stat(filepath.Join(home, ".aws", "config")); !os.IsNotExist(err) {
		content := readAWSConfig(t, home)
		t.Errorf("should not have written config for a non-default profile:\n%s", content)
	}
}
