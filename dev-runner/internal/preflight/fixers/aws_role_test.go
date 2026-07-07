package fixers

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight/awsconfig"
)

func TestAWSRoleFixer_RewritesWrongRole(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir()

	existing := `[profile airobuild-dev-private-sso]
sso_role_name = Ops
region = us-west-2
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	fixer := &AWSRoleFixer{}
	if err := fixer.Fix(context.Background(), projectRoot); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(awsDir, "config"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "sso_role_name = "+awsconfig.ExpectedRoleName) {
		t.Errorf("expected role to be rewritten to %s, got:\n%s", awsconfig.ExpectedRoleName, string(content))
	}
}

func TestAWSRoleFixer_RewritesOnlyResolvedProfiles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir()

	// app/.env references "dev" profile only
	appDir := filepath.Join(projectRoot, "app")
	if err := os.MkdirAll(appDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("AWS_PROFILE=dev\n"), 0600); err != nil {
		t.Fatal(err)
	}

	existing := `[profile dev]
sso_role_name = Ops
region = us-west-2

[profile unrelated]
sso_role_name = ReadOnly
region = us-east-1
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	fixer := &AWSRoleFixer{}
	if err := fixer.Fix(context.Background(), projectRoot); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(awsDir, "config"))
	if err != nil {
		t.Fatal(err)
	}
	// "dev" profile should be fixed
	if !strings.Contains(string(content), "sso_role_name = "+awsconfig.ExpectedRoleName) {
		t.Errorf("expected dev profile role to be rewritten, got:\n%s", string(content))
	}
	// "unrelated" profile should be untouched
	if !strings.Contains(string(content), "sso_role_name = ReadOnly") {
		t.Errorf("expected unrelated profile to remain unchanged, got:\n%s", string(content))
	}
}

func TestAWSRoleFixer_ErrorsWhenNothingToFix(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir()

	existing := `[profile airobuild-dev-private-sso]
sso_role_name = PowerUser
region = us-west-2
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	fixer := &AWSRoleFixer{}
	err := fixer.Fix(context.Background(), projectRoot)
	if err == nil {
		t.Fatal("expected error when nothing to fix")
	}
}

func TestAWSRoleFixer_HandlesDefaultProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	projectRoot := t.TempDir()

	// agents/.env uses "default" profile
	agentsDir := filepath.Join(projectRoot, "agents")
	if err := os.MkdirAll(agentsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentsDir, ".env"), []byte("AWS_PROFILE=default\n"), 0600); err != nil {
		t.Fatal(err)
	}

	existing := `[default]
sso_role_name = Ops
region = us-west-2
`
	awsDir := filepath.Join(home, ".aws")
	if err := os.MkdirAll(awsDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(awsDir, "config"), []byte(existing), 0600); err != nil {
		t.Fatal(err)
	}

	fixer := &AWSRoleFixer{}
	if err := fixer.Fix(context.Background(), projectRoot); err != nil {
		t.Fatalf("Fix: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(awsDir, "config"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "sso_role_name = "+awsconfig.ExpectedRoleName) {
		t.Errorf("expected default profile role to be rewritten, got:\n%s", string(content))
	}
}
