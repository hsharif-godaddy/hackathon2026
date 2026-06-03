package main

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/clean"
	"github.com/airo-ai-builder/dev-runner/internal/config"
)

// TestCleanRunFailedError_Distinguishable pins the error-routing
// contract: the caller in main.go uses errors.As to decide between
// "clean actually ran and failed" (exit 1) and "TUI couldn't start"
// (fall back to the legacy CLI prompt). A regression that drops the
// wrapping or breaks Unwrap would silently send the user back through
// a second clean prompt on top of a partially-cleaned tree.
func TestCleanRunFailedError_Distinguishable(t *testing.T) {
	inner := fmt.Errorf("removing /etc/foo: permission denied")
	wrapped := &cleanRunFailedError{err: inner}

	var cleanFailed *cleanRunFailedError
	if !errors.As(wrapped, &cleanFailed) {
		t.Fatal("errors.As should match cleanRunFailedError")
	}
	if !errors.Is(wrapped, inner) {
		t.Fatal("errors.Is should reach the wrapped cause via Unwrap")
	}
	if !strings.Contains(wrapped.Error(), "permission denied") {
		t.Errorf("wrapped error should preserve the inner message; got %q", wrapped.Error())
	}

	// A bare error (e.g. a TTY/Bubble Tea startup failure) must NOT
	// match — that's the whole point.
	bare := fmt.Errorf("bubbletea: could not open TTY")
	var unmatched *cleanRunFailedError
	if errors.As(bare, &unmatched) {
		t.Errorf("bare error should not match cleanRunFailedError, but did")
	}
}

// TestShippedConfig_PreStartHookOrder asserts that the shipped dev-runner.yml
// has `direnv allow` as the first pre-start hook, before `pnpm install`.
// Order is load-bearing: direnv populates env vars that pnpm install may
// read (e.g. NPM_TOKEN, registry overrides), and a clean+restart that wipes
// node_modules has the same dependency. Documented only in a comment in
// dev-runner.yml today; this test pins it.
func TestShippedConfig_PreStartHookOrder(t *testing.T) {
	// Test cwd is dev-runner/cmd/dev-runner/. dev-runner.yml lives two
	// dirs up; the repo root (where app/, agents/, etc. live) is three up.
	yamlPath, err := filepath.Abs("../../dev-runner.yml")
	if err != nil {
		t.Fatalf("resolve dev-runner.yml path: %v", err)
	}
	projectRoot, err := filepath.Abs("../../..")
	if err != nil {
		t.Fatalf("resolve project root: %v", err)
	}

	cfg, err := config.Load(yamlPath, projectRoot)
	if err != nil {
		t.Fatalf("load shipped dev-runner.yml: %v", err)
	}

	if len(cfg.Hooks.PreStart) == 0 {
		t.Fatal("expected at least one preStart hook in shipped config")
	}
	first := cfg.Hooks.PreStart[0]
	if first.Command != "direnv allow" {
		t.Errorf("first preStart hook command = %q, want %q", first.Command, "direnv allow")
	}

	// Sanity check: pnpm install should still be present somewhere after.
	var sawPnpmInstall bool
	for _, h := range cfg.Hooks.PreStart[1:] {
		if h.Command == "pnpm install" {
			sawPnpmInstall = true
			break
		}
	}
	if !sawPnpmInstall {
		t.Error("expected `pnpm install` hook after `direnv allow`")
	}
}

func TestParseCleanFlags(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		wantSel     clean.Selection
		wantSkip    bool
		wantErrSubs string
	}{
		{
			name:     "no flags defaults to legacy scope",
			args:     nil,
			wantSel:  clean.Default(),
			wantSkip: false,
		},
		{
			name:     "explicit --build only",
			args:     []string{"--build"},
			wantSel:  clean.Selection{BuildArtifacts: true},
			wantSkip: false,
		},
		{
			name:     "--build --runtime additive",
			args:     []string{"--build", "--runtime"},
			wantSel:  clean.Selection{BuildArtifacts: true, RuntimeData: true},
			wantSkip: false,
		},
		{
			name:     "--all enables every group",
			args:     []string{"--all"},
			wantSel:  clean.All(),
			wantSkip: false,
		},
		{
			name:     "--all --yes",
			args:     []string{"--all", "--yes"},
			wantSel:  clean.All(),
			wantSkip: true,
		},
		{
			name:     "-y short form",
			args:     []string{"-y"},
			wantSel:  clean.Default(), // -y alone is no group flag → legacy scope
			wantSkip: true,
		},
		{
			name:     "--node-modules opt-in",
			args:     []string{"--node-modules"},
			wantSel:  clean.Selection{NodeModules: true},
			wantSkip: false,
		},
		{
			name:     "alias --build-artifacts",
			args:     []string{"--build-artifacts"},
			wantSel:  clean.Selection{BuildArtifacts: true},
			wantSkip: false,
		},
		{
			name:        "unknown flag rejected",
			args:        []string{"--bogus"},
			wantErrSubs: "unknown flag",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotSel, gotSkip, err := parseCleanFlags(tt.args)
			if tt.wantErrSubs != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErrSubs)
				}
				if !strings.Contains(err.Error(), tt.wantErrSubs) {
					t.Errorf("error %q does not contain %q", err.Error(), tt.wantErrSubs)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotSel != tt.wantSel {
				t.Errorf("Selection: got %+v, want %+v", gotSel, tt.wantSel)
			}
			if gotSkip != tt.wantSkip {
				t.Errorf("skipConfirm: got %v, want %v", gotSkip, tt.wantSkip)
			}
		})
	}
}

func TestParseDevFlags(t *testing.T) {
	tests := []struct {
		name        string
		args        []string
		wantMode    cleanMode
		wantErrSubs string
	}{
		{name: "no flags", args: nil, wantMode: cleanModeNone},
		{name: "--clean", args: []string{"--clean"}, wantMode: cleanModePicker},
		{name: "--clean-all", args: []string{"--clean-all"}, wantMode: cleanModeAll},
		{
			name:        "--clean and --clean-all rejected",
			args:        []string{"--clean", "--clean-all"},
			wantErrSubs: "cannot combine",
		},
		{
			name:        "reverse order also rejected",
			args:        []string{"--clean-all", "--clean"},
			wantErrSubs: "cannot combine",
		},
		{
			name:        "unknown flag rejected",
			args:        []string{"--unknown"},
			wantErrSubs: "unknown flag",
		},
		{
			name:        "stray positional arg rejected",
			args:        []string{"some-positional"},
			wantErrSubs: "unknown flag",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotMode, err := parseDevFlags(tt.args)
			if tt.wantErrSubs != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErrSubs)
				}
				if !strings.Contains(err.Error(), tt.wantErrSubs) {
					t.Errorf("error %q does not contain %q", err.Error(), tt.wantErrSubs)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if gotMode != tt.wantMode {
				t.Errorf("mode: got %v, want %v", gotMode, tt.wantMode)
			}
		})
	}
}
