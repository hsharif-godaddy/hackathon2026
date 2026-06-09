package fixers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

	if err := ensureAWSConfig(defaultAWSProfile); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	content := readAWSConfig(t, home)
	if countSections(content, "sso-session "+ssoSessionName) != 1 {
		t.Errorf("expected airo-sso session to be created exactly once:\n%s", content)
	}
	if countSections(content, "profile "+defaultAWSProfile) != 1 {
		t.Errorf("expected default profile to be created exactly once:\n%s", content)
	}
	if !strings.Contains(content, "sso_session = "+ssoSessionName) {
		t.Errorf("profile should reference airo-sso session:\n%s", content)
	}
}

func TestEnsureAWSConfig_LeavesExistingProfileUntouched(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Profile already exists but references a differently-named session, and
	// no airo-sso session is present. The fixer must NOT append airo-sso.
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

	if err := ensureAWSConfig(defaultAWSProfile); err != nil {
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

	// A session pointing at our start URL exists under a custom name, but the
	// profile is missing. We should create the profile referencing that
	// session and NOT create a duplicate airo-sso session.
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

	if err := ensureAWSConfig(defaultAWSProfile); err != nil {
		t.Fatalf("ensureAWSConfig: %v", err)
	}

	content := readAWSConfig(t, home)
	if countSections(content, "sso-session "+ssoSessionName) != 0 {
		t.Errorf("airo-sso session should not be created when a matching session exists:\n%s", content)
	}
	if countSections(content, "profile "+defaultAWSProfile) != 1 {
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

func TestFindReusableSSOSession(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		wantName  string
		wantFound bool
	}{
		{
			name:      "no sessions",
			content:   "[profile foo]\nregion = us-west-2\n",
			wantFound: false,
		},
		{
			name: "matching url with trailing hash difference",
			content: `[sso-session corp]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start
sso_region = us-west-2
`,
			wantName:  "corp",
			wantFound: true,
		},
		{
			name: "non-matching url (e.g. a PCI portal)",
			content: `[sso-session sso-pci]
sso_start_url = https://d-aaaaaaaaaa.awsapps.com/start/#
`,
			wantFound: false,
		},
		{
			name: `"non-pci" in the name is not treated as PCI`,
			content: `[sso-session sso-non-pci]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start/#
sso_region = us-west-2
sso_registration_scopes = sso:account:access
`,
			wantName:  "sso-non-pci",
			wantFound: true,
		},
		{
			name: "ignores a PCI session and reuses the matching one",
			content: `[sso-session sso-pci]
sso_start_url = https://d-aaaaaaaaaa.awsapps.com/start/#

[sso-session devbox]
sso_start_url = https://d-9267a7c4d5.awsapps.com/start/#
`,
			wantName:  "devbox",
			wantFound: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			name, found := findReusableSSOSession(tt.content)
			if found != tt.wantFound {
				t.Fatalf("found = %v, want %v", found, tt.wantFound)
			}
			if found && name != tt.wantName {
				t.Errorf("name = %q, want %q", name, tt.wantName)
			}
		})
	}
}
