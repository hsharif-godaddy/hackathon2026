package sandbox_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

// createTempBinary creates a temporary executable file for testing WrapCommand.
func createTempBinary(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	binaryPath := filepath.Join(tmpDir, "airo-sandbox")
	if err := os.WriteFile(binaryPath, []byte("#!/bin/sh\necho test"), 0755); err != nil {
		t.Fatalf("failed to create temp binary: %v", err)
	}
	return binaryPath
}

func TestExecPaths(t *testing.T) {
	t.Parallel()

	paths := sandbox.ExecPaths("/app", "/shared-storage")
	pathMap := makePathMap(paths)

	// Must include exec-specific paths
	assertPath(t, pathMap, "/app", "rwcx")
	assertPath(t, pathMap, "/tmp", "rwc")
	assertPath(t, pathMap, "/dist", "rwc")
	assertPath(t, pathMap, "/local", "rwc")
	assertPath(t, pathMap, "/home/agent", "rwc")
	assertPath(t, pathMap, "/git-repo", "rwc")
	assertPath(t, pathMap, "/private", "rwc")
	assertPath(t, pathMap, "/npm-cache", "rwc")
	assertPath(t, pathMap, "/node_modules", "rwcx")
	assertPath(t, pathMap, "/app/node_modules", "rwcx")
	assertPath(t, pathMap, "/shared-storage/public/assets", "rwc")
	assertPath(t, pathMap, "/app-template", "r")

	// Must NOT include paths that child processes shouldn't access
	assertNoPath(t, pathMap, "/alloc")
	assertNoPath(t, pathMap, "/management-scripts")
}

func TestExecPaths_NoSharedStorage(t *testing.T) {
	t.Parallel()

	paths := sandbox.ExecPaths("/app", "")
	pathMap := makePathMap(paths)

	if _, ok := pathMap["/shared-storage/public/assets"]; ok {
		t.Error("should not include shared-storage path when dir is empty")
	}
}

func TestPreviewProcessPaths(t *testing.T) {
	t.Parallel()

	paths := sandbox.PreviewProcessPaths("/app", "/shared-storage")
	pathMap := makePathMap(paths)

	assertPath(t, pathMap, "/app", "rwcx")
	assertPath(t, pathMap, "/tmp", "rwc")
	assertPath(t, pathMap, "/local", "rwc")
	assertPath(t, pathMap, "/home/agent", "rwc")
	assertPath(t, pathMap, "/private", "rwc")
	assertPath(t, pathMap, "/node_modules", "rwcx")
	assertPath(t, pathMap, "/app/node_modules", "rwcx")
	assertPath(t, pathMap, "/shared-storage/public/assets", "rwc")

	// Publish-only paths and forbidden paths
	assertNoPath(t, pathMap, "/dist")
	assertNoPath(t, pathMap, "/publish")
	assertNoPath(t, pathMap, "/git-repo")
	assertNoPath(t, pathMap, "/npm-cache")
	assertNoPath(t, pathMap, "/alloc")
	assertNoPath(t, pathMap, "/app-template")
	assertNoPath(t, pathMap, "/management-scripts")
}

func TestPublishProcessPaths(t *testing.T) {
	t.Parallel()

	paths := sandbox.PublishProcessPaths("/app", "/shared-storage")
	pathMap := makePathMap(paths)

	assertPath(t, pathMap, "/app", "rwcx")
	assertPath(t, pathMap, "/tmp", "rwc")
	assertPath(t, pathMap, "/local", "rwc")
	assertPath(t, pathMap, "/home/agent", "rwc")
	assertPath(t, pathMap, "/private", "rwc")
	assertPath(t, pathMap, "/dist", "rwc")
	assertPath(t, pathMap, "/publish", "rx")
	assertPath(t, pathMap, "/app/node_modules", "rwcx")
	assertPath(t, pathMap, "/shared-storage/public/assets", "rwc")

	// Preview-only paths and forbidden paths
	assertNoPath(t, pathMap, "/node_modules")
	assertNoPath(t, pathMap, "/git-repo")
	assertNoPath(t, pathMap, "/npm-cache")
	assertNoPath(t, pathMap, "/alloc")
	assertNoPath(t, pathMap, "/app-template")
	assertNoPath(t, pathMap, "/management-scripts")
}

func TestProcessPaths_Dispatches(t *testing.T) {
	t.Parallel()

	preview := makePathMap(sandbox.ProcessPaths(sandbox.VariantPreview, "/app", ""))
	assertPath(t, preview, "/node_modules", "rwcx")
	assertNoPath(t, preview, "/publish")

	publish := makePathMap(sandbox.ProcessPaths(sandbox.VariantPublish, "/app", ""))
	assertPath(t, publish, "/publish", "rx")
	assertNoPath(t, publish, "/node_modules")
}

func TestConnectTCPPorts(t *testing.T) {
	t.Parallel()

	portSet := make(map[uint16]bool, len(sandbox.ConnectTCPPorts))
	for _, p := range sandbox.ConnectTCPPorts {
		portSet[p] = true
	}

	required := []uint16{80, 443, 53, 3306, 25, 2525}
	for _, port := range required {
		if !portSet[port] {
			t.Errorf("ConnectTCPPorts missing required port %d", port)
		}
	}
}

func TestBuildExecProfile(t *testing.T) {
	t.Parallel()

	spec := sandbox.BuildExecProfile("/app", "/shared-storage", "npm install", "/app")

	if spec.Command != "npm install" {
		t.Errorf("Command = %q, want %q", spec.Command, "npm install")
	}
	if spec.WorkDir != "/app" {
		t.Errorf("WorkDir = %q, want %q", spec.WorkDir, "/app")
	}
	if len(spec.BindTCP) != 0 {
		t.Errorf("BindTCP should be nil for exec profile, got %v", spec.BindTCP)
	}
	if len(spec.ConnectTCP) != len(sandbox.ConnectTCPPorts) {
		t.Errorf("ConnectTCP length = %d, want %d", len(spec.ConnectTCP), len(sandbox.ConnectTCPPorts))
	}
}

func TestBuildProcessProfile(t *testing.T) {
	t.Parallel()

	spec := sandbox.BuildProcessProfile(
		sandbox.VariantPreview,
		"/app",
		"/shared-storage",
		"npm start",
		"/app",
		[]uint16{3000, 20010},
	)

	if spec.Command != "npm start" {
		t.Errorf("Command = %q, want %q", spec.Command, "npm start")
	}
	if len(spec.BindTCP) != 2 {
		t.Errorf("BindTCP length = %d, want 2", len(spec.BindTCP))
	}
	if spec.BindTCP[0] != 3000 || spec.BindTCP[1] != 20010 {
		t.Errorf("BindTCP = %v, want [3000, 20010]", spec.BindTCP)
	}
	if len(spec.ConnectTCP) != len(sandbox.ConnectTCPPorts) {
		t.Errorf("ConnectTCP length = %d, want %d", len(spec.ConnectTCP), len(sandbox.ConnectTCPPorts))
	}
}

func TestBuildProcessProfile_NilPorts(t *testing.T) {
	t.Parallel()

	spec := sandbox.BuildProcessProfile(sandbox.VariantPreview, "/app", "", "npm start", "/app", nil)

	if spec.BindTCP != nil {
		t.Errorf("BindTCP should be nil when no ports provided, got %v", spec.BindTCP)
	}
}

func TestBuildEnv(t *testing.T) {
	t.Parallel()

	baseEnv := []string{
		"PATH=/usr/bin",
		"HOME=/root",
	}

	spec := sandbox.Spec{
		Command: "echo hello",
		WorkDir: "/tmp",
	}

	env, err := sandbox.BuildEnv(baseEnv, spec)
	if err != nil {
		t.Fatalf("BuildEnv returned unexpected error: %v", err)
	}

	// Should have original 2 + AIRO_SANDBOX_CONFIG
	if len(env) != 3 {
		t.Fatalf("expected 3 env vars, got %d", len(env))
	}

	// Verify AIRO_SANDBOX_CONFIG is present and valid JSON
	var found bool
	for _, entry := range env {
		if strings.HasPrefix(entry, "AIRO_SANDBOX_CONFIG=") {
			found = true
			jsonStr := strings.TrimPrefix(entry, "AIRO_SANDBOX_CONFIG=")
			var parsed sandbox.Spec
			if err := json.Unmarshal([]byte(jsonStr), &parsed); err != nil {
				t.Fatalf("AIRO_SANDBOX_CONFIG is not valid JSON: %v", err)
			}
			if parsed.Command != "echo hello" {
				t.Errorf("parsed Command = %q, want %q", parsed.Command, "echo hello")
			}
		}
	}
	if !found {
		t.Error("AIRO_SANDBOX_CONFIG not found in env")
	}
}

func TestBuildEnv_RemovesExisting(t *testing.T) {
	t.Parallel()

	baseEnv := []string{
		"PATH=/usr/bin",
		"AIRO_SANDBOX_CONFIG=old_value",
		"HOME=/root",
	}

	spec := sandbox.Spec{
		Command: "echo hello",
		WorkDir: "/tmp",
	}

	env, err := sandbox.BuildEnv(baseEnv, spec)
	if err != nil {
		t.Fatalf("BuildEnv returned unexpected error: %v", err)
	}

	// Should have 2 original (minus old AIRO_SANDBOX_CONFIG) + new one = 3
	if len(env) != 3 {
		t.Fatalf("expected 3 env vars, got %d", len(env))
	}

	// Verify old value is gone
	for _, entry := range env {
		if entry == "AIRO_SANDBOX_CONFIG=old_value" {
			t.Error("old AIRO_SANDBOX_CONFIG should have been removed")
		}
	}
}

func TestBuildEnv_SafetyProperty_SuccessPath(t *testing.T) {
	t.Parallel()

	spec := sandbox.Spec{
		Command: "test",
		WorkDir: "/tmp",
	}

	env, err := sandbox.BuildEnv([]string{}, spec)
	if err != nil {
		t.Fatalf("BuildEnv returned unexpected error: %v", err)
	}
	if env == nil {
		t.Error("BuildEnv must return non-nil env on success")
	}
}

func TestWrapCommand_Disabled(t *testing.T) {
	t.Parallel()

	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp"}
	cmd, err := sandbox.WrapCommand(context.Background(), false, spec, nil)
	if err != nil {
		t.Fatalf("WrapCommand returned unexpected error: %v", err)
	}
	if cmd != nil {
		t.Error("WrapCommand should return nil when disabled")
	}
}

func TestWrapCommand_Enabled(t *testing.T) {
	// Cannot run in parallel — mutates package-level binary path.
	tempBinary := createTempBinary(t)
	sandbox.BinaryPathForTesting(t, tempBinary)

	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp"}
	baseEnv := []string{"PATH=/usr/bin", "HOME=/root"}

	cmd, err := sandbox.WrapCommand(context.Background(), true, spec, baseEnv)
	if err != nil {
		t.Fatalf("WrapCommand returned unexpected error: %v", err)
	}
	if cmd == nil {
		t.Fatal("WrapCommand should return a non-nil cmd when enabled")
	}
	if cmd.Path != tempBinary {
		t.Errorf("cmd.Path = %q, want %q", cmd.Path, tempBinary)
	}
	if cmd.Dir != spec.WorkDir {
		t.Errorf("cmd.Dir = %q, want %q", cmd.Dir, spec.WorkDir)
	}

	var configValue string
	var hasPath, hasHome, hasConfig bool
	for _, entry := range cmd.Env {
		switch {
		case strings.HasPrefix(entry, "AIRO_SANDBOX_CONFIG="):
			hasConfig = true
			configValue = strings.TrimPrefix(entry, "AIRO_SANDBOX_CONFIG=")
		case entry == "PATH=/usr/bin":
			hasPath = true
		case entry == "HOME=/root":
			hasHome = true
		}
	}
	if !hasConfig {
		t.Error("cmd.Env should contain AIRO_SANDBOX_CONFIG")
	}
	if !hasPath || !hasHome {
		t.Errorf("cmd.Env should preserve base env (PATH=%v, HOME=%v)", hasPath, hasHome)
	}
	var parsed sandbox.Spec
	if err := json.Unmarshal([]byte(configValue), &parsed); err != nil {
		t.Errorf("AIRO_SANDBOX_CONFIG should be valid JSON: %v", err)
	}
	if parsed.Command != spec.Command || parsed.WorkDir != spec.WorkDir {
		t.Errorf("parsed config mismatch: got %+v, want command=%q workDir=%q",
			parsed, spec.Command, spec.WorkDir)
	}
}

func TestWrapCommand_SetsEnv(t *testing.T) {
	t.Parallel()

	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp"}
	baseEnv := []string{"PATH=/usr/bin", "AIRO_SANDBOX_CONFIG=stale_value"}

	env, err := sandbox.BuildEnv(baseEnv, spec)
	if err != nil {
		t.Fatalf("BuildEnv returned unexpected error: %v", err)
	}

	// Should have PATH + new AIRO_SANDBOX_CONFIG (stale one removed)
	if len(env) != 2 {
		t.Errorf("expected 2 env vars, got %d: %v", len(env), env)
	}
	for _, entry := range env {
		if entry == "AIRO_SANDBOX_CONFIG=stale_value" {
			t.Error("stale AIRO_SANDBOX_CONFIG should have been removed")
		}
	}
}

func TestIsValidMode(t *testing.T) {
	t.Parallel()

	tests := []struct {
		mode string
		want bool
	}{
		{"r", true},
		{"w", true},
		{"x", true},
		{"c", true},
		{"rx", true},
		{"rw", true},
		{"rwc", true},
		{"rwxc", true},
		{"", false},
		{"z", false},
		{"rr", false},
		{"abc", false},
		{"R", false},
	}

	for _, tt := range tests {
		t.Run(tt.mode, func(t *testing.T) {
			t.Parallel()
			got := sandbox.IsValidMode(tt.mode)
			if got != tt.want {
				t.Errorf("IsValidMode(%q) = %v, want %v", tt.mode, got, tt.want)
			}
		})
	}
}

func TestFilterEnv(t *testing.T) {
	t.Parallel()

	environ := []string{
		"PATH=/usr/bin",
		"AIRO_SANDBOX_CONFIG={...}",
		"HOME=/root",
	}

	filtered := sandbox.FilterEnv(environ, "AIRO_SANDBOX_CONFIG")
	if len(filtered) != 2 {
		t.Fatalf("expected 2 env vars, got %d", len(filtered))
	}

	for _, entry := range filtered {
		if entry == "AIRO_SANDBOX_CONFIG={...}" {
			t.Error("AIRO_SANDBOX_CONFIG should have been filtered out")
		}
	}
}

func TestFilterEnv_NotPresent(t *testing.T) {
	t.Parallel()

	environ := []string{"PATH=/usr/bin", "HOME=/root"}
	filtered := sandbox.FilterEnv(environ, "AIRO_SANDBOX_CONFIG")
	if len(filtered) != 2 {
		t.Fatalf("expected 2 env vars, got %d", len(filtered))
	}
}

// helpers

func makePathMap(paths []sandbox.PathRule) map[string]string {
	m := make(map[string]string, len(paths))
	for _, p := range paths {
		m[p.Path] = p.Mode
	}
	return m
}

func assertPath(t *testing.T, pathMap map[string]string, path, wantMode string) {
	t.Helper()
	mode, ok := pathMap[path]
	if !ok {
		t.Errorf("expected path %q in profile", path)
		return
	}
	if mode != wantMode {
		t.Errorf("path %q mode = %q, want %q", path, mode, wantMode)
	}
}

func assertNoPath(t *testing.T, pathMap map[string]string, path string) {
	t.Helper()
	if _, ok := pathMap[path]; ok {
		t.Errorf("path %q should NOT be in profile", path)
	}
}
