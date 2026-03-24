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

func TestBuildExecProfile(t *testing.T) {
	t.Parallel()

	cfg := sandbox.Config{
		Enabled:    true,
		BinaryPath: "/usr/local/bin/airo-sandbox",
		Paths: []sandbox.PathRule{
			{Mode: "rwc", Path: "/app"},
			{Mode: "rwc", Path: "/tmp"},
			{Mode: "r", Path: "/usr"},
			{Mode: "r", Path: "/lib"},
		},
		Defaults:   true,
		ConnectTCP: []uint16{80, 443},
		BindTCP:    []uint16{3000}, // Should be ignored for exec
	}

	spec := sandbox.BuildExecProfile(cfg, "npm install", "/app")

	if spec.Command != "npm install" {
		t.Errorf("Command = %q, want %q", spec.Command, "npm install")
	}
	if spec.WorkDir != "/app" {
		t.Errorf("WorkDir = %q, want %q", spec.WorkDir, "/app")
	}
	if len(spec.BindTCP) != 0 {
		t.Errorf("BindTCP should be nil for exec profile, got %v", spec.BindTCP)
	}
	if len(spec.ConnectTCP) != 2 {
		t.Errorf("ConnectTCP length = %d, want 2", len(spec.ConnectTCP))
	}
	if len(spec.Paths) != 4 {
		t.Errorf("Paths length = %d, want 4", len(spec.Paths))
	}
	if !spec.Defaults {
		t.Error("Defaults should be true")
	}
}

func TestBuildProcessProfile(t *testing.T) {
	t.Parallel()

	cfg := sandbox.Config{
		Enabled:    true,
		BinaryPath: "/usr/local/bin/airo-sandbox",
		Paths: []sandbox.PathRule{
			{Mode: "rwc", Path: "/app"},
			{Mode: "rwc", Path: "/tmp"},
			{Mode: "r", Path: "/usr"},
		},
		Defaults:   true,
		ConnectTCP: []uint16{80, 443},
		BindTCP:    []uint16{},
	}

	spec := sandbox.BuildProcessProfile(cfg, "npm start", "/app", []uint16{3000, 20010})

	if spec.Command != "npm start" {
		t.Errorf("Command = %q, want %q", spec.Command, "npm start")
	}
	if len(spec.BindTCP) != 2 {
		t.Errorf("BindTCP length = %d, want 2", len(spec.BindTCP))
	}
}

func TestBuildProcessProfile_DeduplicatesPorts(t *testing.T) {
	t.Parallel()

	cfg := sandbox.Config{
		Enabled: true,
		BindTCP: []uint16{3000, 80},
	}

	spec := sandbox.BuildProcessProfile(cfg, "npm start", "/app", []uint16{3000, 443})

	// 3000 appears in both base and extra — should be deduplicated
	if len(spec.BindTCP) != 3 {
		t.Errorf("BindTCP length = %d, want 3 (deduplicated), got %v", len(spec.BindTCP), spec.BindTCP)
	}
}

func TestBuildEnv(t *testing.T) {
	t.Parallel()

	baseEnv := []string{
		"PATH=/usr/bin",
		"HOME=/root",
	}

	spec := sandbox.Spec{
		Command:  "echo hello",
		WorkDir:  "/tmp",
		Defaults: true,
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

// TestBuildEnv_SafetyProperty_SuccessPath verifies BuildEnv's critical safety property
// on the success path: it must return non-nil env when successful.
//
// Note: The error path (json.Marshal failure) is unreachable with the current Spec struct
// (only basic JSON-marshalable types), so we cannot test that BuildEnv returns nil env on
// error. The error handling code exists in BuildEnv and would properly propagate errors
// if Spec were modified to include unmarshalable types, but that scenario can't be triggered
// in tests without mocking json.Marshal.
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

	cfg := sandbox.Config{Enabled: false}
	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp"}
	cmd, err := sandbox.WrapCommand(context.Background(), cfg, spec, nil)
	if err != nil {
		t.Fatalf("WrapCommand returned unexpected error: %v", err)
	}
	if cmd != nil {
		t.Error("WrapCommand should return nil when disabled")
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

func TestParsePathRulesString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		input   string
		want    int
		wantErr bool
	}{
		{"empty", "", 0, false},
		{"single", "rx:/usr/bin", 1, false},
		{"multiple", "rx:/usr/bin,r:/etc/hosts,rwc:/app", 3, false},
		{"with_spaces", "rx:/usr/bin , r:/etc/hosts", 2, false},
		{"invalid_mode", "z:/app", 0, true},
		{"missing_colon", "/usr/bin", 0, true},
		{"empty_path", "r:", 0, true},
		{"duplicate_mode_chars", "rr:/app", 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			rules, err := sandbox.ParsePathRulesString(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf(
					"ParsePathRulesString(%q) error = %v, wantErr %v",
					tt.input, err, tt.wantErr)
				return
			}
			if !tt.wantErr && len(rules) != tt.want {
				t.Errorf(
					"ParsePathRulesString(%q) got %d rules, want %d",
					tt.input, len(rules), tt.want)
			}
		})
	}
}

func TestWrapCommand_Enabled(t *testing.T) {
	t.Parallel()

	cfg := sandbox.Config{
		Enabled:    true,
		BinaryPath: createTempBinary(t),
	}
	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp"}
	baseEnv := []string{"PATH=/usr/bin", "HOME=/root"}

	cmd, err := sandbox.WrapCommand(context.Background(), cfg, spec, baseEnv)
	if err != nil {
		t.Fatalf("WrapCommand returned unexpected error: %v", err)
	}
	if cmd == nil {
		t.Fatal("WrapCommand should return non-nil when enabled")
	}
	if cmd.Dir != "/tmp" {
		t.Errorf("cmd.Dir = %q, want %q", cmd.Dir, "/tmp")
	}
	if cmd.Path != cfg.BinaryPath {
		t.Errorf("cmd.Path = %q, want %q", cmd.Path, cfg.BinaryPath)
	}
	// Verify AIRO_SANDBOX_CONFIG is in cmd.Env
	var found bool
	for _, entry := range cmd.Env {
		if strings.HasPrefix(entry, "AIRO_SANDBOX_CONFIG=") {
			found = true
			break
		}
	}
	if !found {
		t.Error("cmd.Env should contain AIRO_SANDBOX_CONFIG")
	}
}

func TestWrapCommand_SetsEnv(t *testing.T) {
	t.Parallel()

	cfg := sandbox.Config{
		Enabled:    true,
		BinaryPath: createTempBinary(t),
	}
	spec := sandbox.Spec{Command: "echo hello", WorkDir: "/tmp", Defaults: true}
	baseEnv := []string{"PATH=/usr/bin", "AIRO_SANDBOX_CONFIG=stale_value"}

	cmd, err := sandbox.WrapCommand(context.Background(), cfg, spec, baseEnv)
	if err != nil {
		t.Fatalf("WrapCommand returned unexpected error: %v", err)
	}

	// Should have PATH + new AIRO_SANDBOX_CONFIG (stale one removed)
	if len(cmd.Env) != 2 {
		t.Errorf("expected 2 env vars, got %d: %v", len(cmd.Env), cmd.Env)
	}
	for _, entry := range cmd.Env {
		if entry == "AIRO_SANDBOX_CONFIG=stale_value" {
			t.Error("stale AIRO_SANDBOX_CONFIG should have been removed")
		}
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
