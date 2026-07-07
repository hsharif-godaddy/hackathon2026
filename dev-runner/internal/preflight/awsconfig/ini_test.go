package awsconfig

import (
	"strings"
	"testing"
)

func TestSectionExists(t *testing.T) {
	content := `[profile foo]
region = us-west-2

[sso-session airo-sso]
sso_start_url = https://example.com
`
	tests := []struct {
		section string
		want    bool
	}{
		{"profile foo", true},
		{"sso-session airo-sso", true},
		{"profile bar", false},
		{"sso-session missing", false},
	}
	for _, tt := range tests {
		t.Run(tt.section, func(t *testing.T) {
			got := SectionExists(content, tt.section)
			if got != tt.want {
				t.Errorf("SectionExists(%q) = %v, want %v", tt.section, got, tt.want)
			}
		})
	}
}

func TestProfileKey(t *testing.T) {
	content := `[default]
sso_session = my-session
sso_account_id = 694282668781
sso_role_name = PowerUser
region = us-west-2

[profile dev]
sso_session = my-session
sso_account_id = 123456789012
sso_role_name = PowerUser
region = us-west-2

[profile staging]
sso_session = staging-session
sso_role_name = Ops
region = us-east-1
`
	tests := []struct {
		name    string
		profile string
		key     string
		want    string
	}{
		{"existing key", "dev", "sso_role_name", "PowerUser"},
		{"different profile", "staging", "sso_role_name", "Ops"},
		{"missing key", "dev", "output", ""},
		{"missing profile", "prod", "sso_role_name", ""},
		{"key with value containing equals", "dev", "sso_account_id", "123456789012"},
		{"default profile uses [default] section", "default", "sso_role_name", "PowerUser"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ProfileKey(content, tt.profile, tt.key)
			if got != tt.want {
				t.Errorf("ProfileKey(%q, %q) = %q, want %q", tt.profile, tt.key, got, tt.want)
			}
		})
	}
}

func TestSetProfileKey(t *testing.T) {
	tests := []struct {
		name        string
		content     string
		profile     string
		key         string
		value       string
		wantChanged bool
		wantContain string
	}{
		{
			name: "replaces existing value",
			content: `[profile dev]
sso_role_name = Ops
region = us-west-2
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: true,
			wantContain: "sso_role_name = PowerUser",
		},
		{
			name: "preserves other sections",
			content: `[profile staging]
sso_role_name = Admin

[profile dev]
sso_role_name = Ops
region = us-west-2
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: true,
			wantContain: "sso_role_name = Admin",
		},
		{
			name: "no change when key missing",
			content: `[profile dev]
region = us-west-2
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: false,
		},
		{
			name: "no change when profile missing",
			content: `[profile staging]
sso_role_name = Ops
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: false,
		},
		{
			name: "replaces in [default] section",
			content: `[default]
sso_role_name = Ops
region = us-west-2
`,
			profile:     "default",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: true,
			wantContain: "sso_role_name = PowerUser",
		},
		{
			name: "no change when value already matches",
			content: `[profile dev]
sso_role_name = PowerUser
region = us-west-2
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: false,
		},
		{
			name: "preserves trailing newline",
			content: `[profile dev]
sso_role_name = Ops
`,
			profile:     "dev",
			key:         "sso_role_name",
			value:       "PowerUser",
			wantChanged: true,
			wantContain: "sso_role_name = PowerUser\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, changed := SetProfileKey(tt.content, tt.profile, tt.key, tt.value)
			if changed != tt.wantChanged {
				t.Fatalf("changed = %v, want %v", changed, tt.wantChanged)
			}
			if !changed {
				if got != tt.content {
					t.Errorf("content was modified despite no change")
				}
				return
			}
			if tt.wantContain != "" {
				if !strings.Contains(got, tt.wantContain) {
					t.Errorf("result missing %q:\n%s", tt.wantContain, got)
				}
			}
		})
	}
}

func TestFindSSOSessionByStartURL(t *testing.T) {
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
			name: "non-matching url",
			content: `[sso-session sso-pci]
sso_start_url = https://d-aaaaaaaaaa.awsapps.com/start/#
`,
			wantFound: false,
		},
		{
			name: "ignores non-matching and finds matching",
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
			name, found := FindSSOSessionByStartURL(tt.content, SSOStartURL)
			if found != tt.wantFound {
				t.Fatalf("found = %v, want %v", found, tt.wantFound)
			}
			if found && name != tt.wantName {
				t.Errorf("name = %q, want %q", name, tt.wantName)
			}
		})
	}
}
