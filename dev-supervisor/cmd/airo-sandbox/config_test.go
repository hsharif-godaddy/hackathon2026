package main

import (
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
)

func TestParseConfig_Valid(t *testing.T) {
	t.Parallel()

	input := `{
		"paths": [
			{"mode": "r", "path": "/usr"},
			{"mode": "r", "path": "/lib"},
			{"mode": "rwc", "path": "/app"},
			{"mode": "rwc", "path": "/tmp"}
		],
		"connect_tcp": [80, 443],
		"bind_tcp": [3000],
		"command": "npm start",
		"work_dir": "/app"
	}`

	cfg, err := ParseConfig([]byte(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Command != "npm start" {
		t.Errorf("Command = %q, want %q", cfg.Command, "npm start")
	}
	if cfg.WorkDir != "/app" {
		t.Errorf("WorkDir = %q, want %q", cfg.WorkDir, "/app")
	}
	if len(cfg.Paths) != 4 {
		t.Errorf("Paths length = %d, want 4", len(cfg.Paths))
	}
	if len(cfg.ConnectTCP) != 2 {
		t.Errorf("ConnectTCP length = %d, want 2", len(cfg.ConnectTCP))
	}
	if len(cfg.BindTCP) != 1 {
		t.Errorf("BindTCP length = %d, want 1", len(cfg.BindTCP))
	}
	// Defaults should be true by default
	if !cfg.Defaults {
		t.Error("Defaults should be true by default")
	}
}

func TestParseConfig_DefaultsFalse(t *testing.T) {
	t.Parallel()

	input := `{
		"defaults": false,
		"command": "echo hello",
		"work_dir": "/tmp"
	}`

	cfg, err := ParseConfig([]byte(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.Defaults {
		t.Error("Defaults should be false when explicitly set")
	}
}

func TestParseConfig_MissingCommand(t *testing.T) {
	t.Parallel()

	input := `{"work_dir": "/app"}`
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for missing command, got nil")
	}
}

func TestParseConfig_MissingWorkDir(t *testing.T) {
	t.Parallel()

	input := `{"command": "npm start"}`
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for missing work_dir, got nil")
	}
}

func TestParseConfig_RelativeWorkDir(t *testing.T) {
	t.Parallel()

	input := `{"command": "npm start", "work_dir": "relative/path"}`
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for relative work_dir, got nil")
	}
}

func TestParseConfig_WorkDirWithTraversal(t *testing.T) {
	t.Parallel()

	input := `{"command": "npm start", "work_dir": "/app/../etc"}`
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for work_dir with path traversal, got nil")
	}
}

func TestParseConfig_WorkDirWithNullByte(t *testing.T) {
	t.Parallel()

	input := "{\"command\": \"npm start\", \"work_dir\": \"/app\\u0000/evil\"}"
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for work_dir with null byte, got nil")
	}
}

func TestParseConfig_InvalidJSON(t *testing.T) {
	t.Parallel()

	_, err := ParseConfig([]byte("not json"))
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
}

func TestParseConfig_EmptyPaths(t *testing.T) {
	t.Parallel()

	input := `{
		"command": "echo hello",
		"work_dir": "/tmp"
	}`

	cfg, err := ParseConfig([]byte(input))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(cfg.Paths) != 0 {
		t.Errorf("Paths should be empty, got %d", len(cfg.Paths))
	}
	if len(cfg.ConnectTCP) != 0 {
		t.Errorf("ConnectTCP should be empty, got %d", len(cfg.ConnectTCP))
	}
	if len(cfg.BindTCP) != 0 {
		t.Errorf("BindTCP should be empty, got %d", len(cfg.BindTCP))
	}
}

func TestParseConfig_InvalidMode(t *testing.T) {
	t.Parallel()

	input := `{
		"paths": [{"mode": "z", "path": "/app"}],
		"command": "echo hello",
		"work_dir": "/tmp"
	}`

	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for invalid mode, got nil")
	}
}

func TestParseConfig_EmptyMode(t *testing.T) {
	t.Parallel()

	input := `{
		"paths": [{"mode": "", "path": "/app"}],
		"command": "echo hello",
		"work_dir": "/tmp"
	}`

	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for empty mode, got nil")
	}
}

func TestParseConfig_EmptyPath(t *testing.T) {
	t.Parallel()

	input := `{
		"paths": [{"mode": "r", "path": ""}],
		"command": "echo hello",
		"work_dir": "/tmp"
	}`

	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for empty path, got nil")
	}
}

func TestParseConfig_PathWithNullByte(t *testing.T) {
	t.Parallel()

	input := "{\"paths\": [{\"mode\": \"r\", \"path\": \"/app\\u0000/evil\"}], \"command\": \"echo hello\", \"work_dir\": \"/tmp\"}"
	_, err := ParseConfig([]byte(input))
	if err == nil {
		t.Fatal("expected error for path with null byte, got nil")
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
		{"rr", false}, // duplicate
		{"abc", false},
		{"R", false}, // case-sensitive
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
