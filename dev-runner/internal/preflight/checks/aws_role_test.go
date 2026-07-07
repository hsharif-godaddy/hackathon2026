package checks

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
)

func writeAWSConfig(t *testing.T, home string, content string) {
	t.Helper()
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestAWSRoleCheck_PassesWithCorrectRole(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeAWSConfig(t, home, `[profile airobuild-dev-private-sso]
sso_role_name = PowerUser
region = us-west-2
`)

	result := (&AWSRoleCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass, got %v: %s", result.Status, result.Message)
	}
}

func TestAWSRoleCheck_FailsWithWrongRole(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeAWSConfig(t, home, `[profile airobuild-dev-private-sso]
sso_role_name = Ops
region = us-west-2
`)

	result := (&AWSRoleCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusFail {
		t.Fatalf("expected Fail, got %v: %s", result.Status, result.Message)
	}
	if !result.FixAvailable {
		t.Error("expected FixAvailable=true")
	}
}

func TestAWSRoleCheck_SkipsWhenConfigMissing(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	result := (&AWSRoleCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusSkip {
		t.Errorf("expected Skip, got %v: %s", result.Status, result.Message)
	}
}

func TestAWSRoleCheck_PassesWhenNoRoleKey(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeAWSConfig(t, home, `[profile airobuild-dev-private-sso]
region = us-west-2
`)

	result := (&AWSRoleCheck{}).Run(context.Background(), t.TempDir())
	if result.Status != preflight.StatusPass {
		t.Errorf("expected Pass when sso_role_name absent, got %v: %s", result.Status, result.Message)
	}
}

func TestAWSRoleCheck_FailsOnDefaultProfileSection(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeAWSConfig(t, home, `[default]
sso_role_name = Ops
region = us-west-2
`)

	// Create a project root with agents/.env using "default"
	projectRoot := t.TempDir()
	agentsDir := filepath.Join(projectRoot, "agents")
	if err := os.MkdirAll(agentsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentsDir, ".env"), []byte("AWS_PROFILE=default\n"), 0600); err != nil {
		t.Fatal(err)
	}

	result := (&AWSRoleCheck{}).Run(context.Background(), projectRoot)
	if result.Status != preflight.StatusFail {
		t.Fatalf("expected Fail for [default] section with wrong role, got %v: %s", result.Status, result.Message)
	}
}

func TestAWSRoleCheck_FailsOnCustomProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	writeAWSConfig(t, home, `[profile custom-profile]
sso_role_name = ReadOnly
region = us-west-2

[profile `+awsconfig.DefaultProfile+`]
sso_role_name = PowerUser
region = us-west-2
`)

	// Create a project root with app/.env referencing the custom profile
	projectRoot := t.TempDir()
	appDir := filepath.Join(projectRoot, "app")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("AWS_PROFILE=custom-profile\n"), 0600); err != nil {
		t.Fatal(err)
	}

	result := (&AWSRoleCheck{}).Run(context.Background(), projectRoot)
	if result.Status != preflight.StatusFail {
		t.Fatalf("expected Fail for custom profile with wrong role, got %v: %s", result.Status, result.Message)
	}
}
