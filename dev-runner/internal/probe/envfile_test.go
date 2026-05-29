package probe

import (
	"os"
	"path/filepath"
	"testing"
)

// --- ParseEnvFile ---

func TestParseEnvFile_ValidKeyValue(t *testing.T) {
	f := writeTempEnv(t, "FOO=bar\nBAZ=qux\n")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["FOO"] != "bar" {
		t.Errorf("FOO = %q, want %q", m["FOO"], "bar")
	}
	if m["BAZ"] != "qux" {
		t.Errorf("BAZ = %q, want %q", m["BAZ"], "qux")
	}
}

func TestParseEnvFile_DoubleQuotedValue(t *testing.T) {
	f := writeTempEnv(t, `KEY="hello world"`)
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["KEY"] != "hello world" {
		t.Errorf("KEY = %q, want %q", m["KEY"], "hello world")
	}
}

func TestParseEnvFile_SingleQuotedValue(t *testing.T) {
	f := writeTempEnv(t, "KEY='hello world'")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["KEY"] != "hello world" {
		t.Errorf("KEY = %q, want %q", m["KEY"], "hello world")
	}
}

func TestParseEnvFile_CommentsPreserved(t *testing.T) {
	f := writeTempEnv(t, "# a comment\nFOO=bar\n")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Lines slice should have 2 entries: comment + key-value
	if len(lines) < 2 {
		t.Fatalf("expected at least 2 lines, got %d", len(lines))
	}
	if lines[0].Key != "" {
		t.Errorf("lines[0].Key = %q, want empty (comment line)", lines[0].Key)
	}
}

func TestParseEnvFile_BlankLinesPreserved(t *testing.T) {
	f := writeTempEnv(t, "FOO=bar\n\nBAZ=qux\n")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should have 3 entries: key, blank, key
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines, got %d", len(lines))
	}
}

func TestParseEnvFile_EmptyValue(t *testing.T) {
	f := writeTempEnv(t, "EMPTY=\n")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := EnvLinesToMap(lines)
	v, ok := m["EMPTY"]
	if !ok {
		t.Fatal("EMPTY key not found")
	}
	if v != "" {
		t.Errorf("EMPTY = %q, want %q", v, "")
	}
}

func TestParseEnvFile_MissingFile_ReturnsError(t *testing.T) {
	_, err := ParseEnvFile(filepath.Join(t.TempDir(), "nonexistent.env"))
	if err == nil {
		t.Error("expected error for missing file, got nil")
	}
}

func TestParseEnvFile_NoTrailingNewline(t *testing.T) {
	f := writeTempEnv(t, "FOO=bar")
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["FOO"] != "bar" {
		t.Errorf("FOO = %q, want %q", m["FOO"], "bar")
	}
}

// --- WriteEnvFile ---

func TestWriteEnvFile_PreservesCommentsAndOrder(t *testing.T) {
	content := "# OpenAI config\nOPENAI_API_KEY=secret\n\n# Env\nGD_ENV=local.dev\n"
	f := writeTempEnv(t, content)

	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("ParseEnvFile error: %v", err)
	}
	if err := WriteEnvFile(f, lines); err != nil {
		t.Fatalf("WriteEnvFile error: %v", err)
	}

	lines2, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("second ParseEnvFile error: %v", err)
	}
	m := EnvLinesToMap(lines2)
	if m["OPENAI_API_KEY"] != "secret" {
		t.Errorf("OPENAI_API_KEY = %q, want %q", m["OPENAI_API_KEY"], "secret")
	}
	if m["GD_ENV"] != "local.dev" {
		t.Errorf("GD_ENV = %q, want %q", m["GD_ENV"], "local.dev")
	}
	// Comment should still be present
	if len(lines2) < len(lines) {
		t.Errorf("WriteEnvFile lost lines: got %d, want at least %d", len(lines2), len(lines))
	}
}

// --- UpdateEnvFile ---

func TestUpdateEnvFile_UpdatesExistingKey(t *testing.T) {
	f := writeTempEnv(t, "GD_ENV=local.dev\n")
	if err := UpdateEnvFile(f, "GD_ENV", "local.test"); err != nil {
		t.Fatalf("UpdateEnvFile error: %v", err)
	}
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("ParseEnvFile error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["GD_ENV"] != "local.test" {
		t.Errorf("GD_ENV = %q, want %q", m["GD_ENV"], "local.test")
	}
}

func TestUpdateEnvFile_AppendsNewKey(t *testing.T) {
	f := writeTempEnv(t, "FOO=bar\n")
	if err := UpdateEnvFile(f, "NEW_KEY", "new_value"); err != nil {
		t.Fatalf("UpdateEnvFile error: %v", err)
	}
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("ParseEnvFile error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["FOO"] != "bar" {
		t.Errorf("FOO = %q, want %q (original preserved)", m["FOO"], "bar")
	}
	if m["NEW_KEY"] != "new_value" {
		t.Errorf("NEW_KEY = %q, want %q", m["NEW_KEY"], "new_value")
	}
}

func TestUpdateEnvFile_PreservesComments(t *testing.T) {
	f := writeTempEnv(t, "# comment\nGD_ENV=local.dev\n")
	if err := UpdateEnvFile(f, "GD_ENV", "local.test"); err != nil {
		t.Fatalf("UpdateEnvFile error: %v", err)
	}
	lines, err := ParseEnvFile(f)
	if err != nil {
		t.Fatalf("ParseEnvFile error: %v", err)
	}
	hasComment := false
	for _, l := range lines {
		if l.Key == "" && l.Raw != "" {
			hasComment = true
		}
	}
	if !hasComment {
		t.Error("UpdateEnvFile dropped comment line")
	}
}

func TestUpdateEnvFile_MissingFile_CreatesFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := UpdateEnvFile(path, "GD_ENV", "local.dev"); err != nil {
		t.Fatalf("UpdateEnvFile error: %v", err)
	}
	lines, err := ParseEnvFile(path)
	if err != nil {
		t.Fatalf("ParseEnvFile error: %v", err)
	}
	m := EnvLinesToMap(lines)
	if m["GD_ENV"] != "local.dev" {
		t.Errorf("GD_ENV = %q, want %q", m["GD_ENV"], "local.dev")
	}
}

// --- MaskSensitiveValue ---

func TestMaskSensitiveValue_MasksAPIKey(t *testing.T) {
	got := MaskSensitiveValue("OPENAI_API_KEY", "super-secret")
	if got == "super-secret" {
		t.Error("MaskSensitiveValue did not mask OPENAI_API_KEY")
	}
}

func TestMaskSensitiveValue_MasksTokenKey(t *testing.T) {
	got := MaskSensitiveValue("GITHUB_TOKEN", "ghp_abc123")
	if got == "ghp_abc123" {
		t.Error("MaskSensitiveValue did not mask GITHUB_TOKEN")
	}
}

func TestMaskSensitiveValue_MasksSecretKey(t *testing.T) {
	got := MaskSensitiveValue("DB_SECRET", "mysecret")
	if got == "mysecret" {
		t.Error("MaskSensitiveValue did not mask DB_SECRET")
	}
}

func TestMaskSensitiveValue_MasksPasswordKey(t *testing.T) {
	got := MaskSensitiveValue("DB_PASSWORD", "hunter2")
	if got == "hunter2" {
		t.Error("MaskSensitiveValue did not mask DB_PASSWORD")
	}
}

func TestMaskSensitiveValue_DoesNotMaskNonSensitive(t *testing.T) {
	got := MaskSensitiveValue("GD_ENV", "local.dev")
	if got != "local.dev" {
		t.Errorf("MaskSensitiveValue(%q) = %q, want %q (no masking)", "GD_ENV", got, "local.dev")
	}
}

func TestMaskSensitiveValue_EmptyValueNotMasked(t *testing.T) {
	got := MaskSensitiveValue("OPENAI_API_KEY", "")
	// Empty values stay empty regardless of key name
	if got != "" {
		t.Errorf("MaskSensitiveValue(%q, %q) = %q, want empty", "OPENAI_API_KEY", "", got)
	}
}

// --- EnvLinesToMap ---

func TestEnvLinesToMap_OnlyKeyLines(t *testing.T) {
	lines := []EnvLine{
		{Raw: "# comment"},
		{Key: "A", Value: "1"},
		{Raw: ""},
		{Key: "B", Value: "2"},
	}
	m := EnvLinesToMap(lines)
	if len(m) != 2 {
		t.Errorf("EnvLinesToMap: len = %d, want 2", len(m))
	}
	if m["A"] != "1" || m["B"] != "2" {
		t.Errorf("EnvLinesToMap: unexpected values %v", m)
	}
}

// writeTempEnv writes content to a temp .env file and returns its path.
func writeTempEnv(t *testing.T, content string) string {
	t.Helper()
	f, err := os.CreateTemp(t.TempDir(), "*.env")
	if err != nil {
		t.Fatalf("creating temp file: %v", err)
	}
	if _, err := f.WriteString(content); err != nil {
		t.Fatalf("writing temp file: %v", err)
	}
	_ = f.Close()
	return f.Name()
}
