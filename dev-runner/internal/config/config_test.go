package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoad_ValidConfig(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "agents"), 0o755)
	os.MkdirAll(filepath.Join(dir, "app"), 0o755)

	configContent := `
processes:
  - name: Agents
    command: npm run dev
    dir: agents
    errorPatterns:
      - "ERROR"
  - name: App
    command: npm run dev
    dir: app
hooks:
  preStart:
    - name: Install
      command: npm install
      dir: .
`
	configPath := filepath.Join(dir, "dev-runner.yml")
	os.WriteFile(configPath, []byte(configContent), 0o644)

	cfg, err := Load(configPath, dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(cfg.Processes) != 2 {
		t.Fatalf("expected 2 processes, got %d", len(cfg.Processes))
	}
	if cfg.Processes[0].Name != "Agents" {
		t.Errorf("expected process name 'Agents', got %q", cfg.Processes[0].Name)
	}
	if len(cfg.Hooks.PreStart) != 1 {
		t.Errorf("expected 1 preStart hook, got %d", len(cfg.Hooks.PreStart))
	}
}

func TestLoad_MissingProcess(t *testing.T) {
	dir := t.TempDir()
	configContent := `
processes: []
`
	configPath := filepath.Join(dir, "dev-runner.yml")
	os.WriteFile(configPath, []byte(configContent), 0o644)

	_, err := Load(configPath, dir)
	if err == nil {
		t.Fatal("expected error for empty processes")
	}
}

func TestLoad_DuplicateNames(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "a"), 0o755)

	configContent := `
processes:
  - name: Foo
    command: echo 1
    dir: a
  - name: Foo
    command: echo 2
    dir: a
`
	configPath := filepath.Join(dir, "dev-runner.yml")
	os.WriteFile(configPath, []byte(configContent), 0o644)

	_, err := Load(configPath, dir)
	if err == nil {
		t.Fatal("expected error for duplicate names")
	}
}

func TestLoad_MissingDir(t *testing.T) {
	dir := t.TempDir()
	configContent := `
processes:
  - name: Foo
    command: echo 1
    dir: nonexistent
`
	configPath := filepath.Join(dir, "dev-runner.yml")
	os.WriteFile(configPath, []byte(configContent), 0o644)

	_, err := Load(configPath, dir)
	if err == nil {
		t.Fatal("expected error for missing directory")
	}
}
