package docker

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/airo-ai-builder/local-control-plane/internal/store"
)

func TestFormatEnvLines(t *testing.T) {
	env := map[string]string{
		"KEY1": "val1",
		"KEY2": "val2",
	}
	result := formatEnvLines(env)

	if !strings.Contains(result, `KEY1: "val1"`) {
		t.Errorf("expected KEY1 in output, got:\n%s", result)
	}
	if !strings.Contains(result, `KEY2: "val2"`) {
		t.Errorf("expected KEY2 in output, got:\n%s", result)
	}

	// Each line should be indented with 6 spaces
	for _, line := range strings.Split(result, "\n") {
		if line != "" && !strings.HasPrefix(line, "      ") {
			t.Errorf("expected 6-space indent, got: %q", line)
		}
	}
}

func TestFormatVolumeLines(t *testing.T) {
	vols := []string{"/host/path:/container/path", "/other:/mnt"}
	result := formatVolumeLines(vols)

	lines := strings.Split(result, "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d", len(lines))
	}
	if !strings.Contains(lines[0], "- /host/path:/container/path") {
		t.Errorf("unexpected first line: %s", lines[0])
	}
}

func TestFormatPortLines(t *testing.T) {
	ports := []string{`"5000:5000"`, `"8877:8877"`}
	result := formatPortLines(ports)

	if !strings.Contains(result, `- "5000:5000"`) {
		t.Errorf("expected port 5000 in output, got:\n%s", result)
	}
	if !strings.Contains(result, `- "8877:8877"`) {
		t.Errorf("expected port 8877 in output, got:\n%s", result)
	}
}

func TestGetEnvOrDefault(t *testing.T) {
	t.Run("env set", func(t *testing.T) {
		t.Setenv("TEST_COMPOSE_VAR", "custom")
		got := getEnvOrDefault("TEST_COMPOSE_VAR", "fallback")
		if got != "custom" {
			t.Errorf("expected 'custom', got %q", got)
		}
	})

	t.Run("env not set", func(t *testing.T) {
		got := getEnvOrDefault("TEST_COMPOSE_VAR_UNSET_12345", "fallback")
		if got != "fallback" {
			t.Errorf("expected 'fallback', got %q", got)
		}
	})
}

func TestGeneratePreviewEnvironment(t *testing.T) {
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://test.example.com")
	t.Setenv("AGENTS_BASE_URL", "http://agents:4000")

	app := &store.App{
		ID:             "test123",
		PreviewPort:    5000,
		SupervisorPort: 8877,
	}

	env := generatePreviewEnvironment(app)

	checks := map[string]string{
		"SITE_ID":                        "test123",
		"NODE_ENV":                       "development",
		"PORT":                           "20010",
		"HOST":                           "127.0.0.1",
		"DEV_SUPERVISOR_PROXY_PORT":      "5000",
		"DEV_SUPERVISOR_USE_TCP":         "true",
		"DEV_SUPERVISOR_TCP_PORT":        "8877",
		"VITE_PARENT_ORIGIN":             "https://test.example.com",
		"DEV_SUPERVISOR_AGENTS_BASE_URL": "http://agents:4000",
		"NOMAD_TASK_NAME":                "preview",
	}

	for key, expected := range checks {
		got, ok := env[key]
		if !ok {
			t.Errorf("missing key %q in preview environment", key)
			continue
		}
		if got != expected {
			t.Errorf("env[%q] = %q, want %q", key, got, expected)
		}
	}
}

func TestGeneratePublishEnvironment(t *testing.T) {
	app := &store.App{
		ID:                    "test123",
		PublishPort:           5500,
		PublishSupervisorPort: 9000,
	}

	env := generatePublishEnvironment(app)

	if env["NODE_ENV"] != "production" {
		t.Errorf("expected production, got %q", env["NODE_ENV"])
	}
	if env["PORT"] != "20011" {
		t.Errorf("expected 20011, got %q", env["PORT"])
	}
	if env["NOMAD_TASK_NAME"] != "publish" {
		t.Errorf("expected publish, got %q", env["NOMAD_TASK_NAME"])
	}
	if env["DIST_DIR"] != "/dist" {
		t.Errorf("expected /dist, got %q", env["DIST_DIR"])
	}
	if env["DEV_SUPERVISOR_USE_TCP"] != "true" {
		t.Errorf("expected TCP enabled for publish supervisor port > 0")
	}
	if env["DEV_SUPERVISOR_ENABLE_PROXY"] != "true" {
		t.Errorf("expected proxy enabled for publish port > 0")
	}
	if env["DEV_SUPERVISOR_PROXY_PORT"] != "5500" {
		t.Errorf("expected proxy port 5500, got %q", env["DEV_SUPERVISOR_PROXY_PORT"])
	}
}

func TestGeneratePublishEnvironmentNoPorts(t *testing.T) {
	app := &store.App{
		ID: "test123",
	}

	env := generatePublishEnvironment(app)

	if _, ok := env["DEV_SUPERVISOR_USE_TCP"]; ok {
		t.Error("expected no TCP config when publishSupervisorPort is 0")
	}
	if _, ok := env["DEV_SUPERVISOR_ENABLE_PROXY"]; ok {
		t.Error("expected no proxy config when publishPort is 0")
	}
}

func TestGenerateComposeFile(t *testing.T) {
	app := &store.App{
		ID:                    "testapp",
		PreviewPort:           5001,
		PublishPort:           5501,
		SupervisorPort:        8878,
		PublishSupervisorPort: 9001,
	}

	compose := GenerateComposeFile(app, "/tmp/airo-app-builder/testapp")

	// Basic structure
	if !strings.Contains(compose, "services:") {
		t.Error("expected 'services:' in compose file")
	}
	if !strings.Contains(compose, "networks:") {
		t.Error("expected 'networks:' in compose file")
	}
	if !strings.Contains(compose, "app-network:") {
		t.Error("expected 'app-network:' in compose file")
	}

	// Container names
	if !strings.Contains(compose, "container_name: preview-testapp-1") {
		t.Error("expected preview container name")
	}
	if !strings.Contains(compose, "container_name: publish-testapp-1") {
		t.Error("expected publish container name")
	}

	// Images
	if !strings.Contains(compose, "image: aab-template-v8:latest") {
		t.Error("expected preview image")
	}
	if !strings.Contains(compose, "image: aab-publish:latest") {
		t.Error("expected publish image")
	}

	// Port mappings
	if !strings.Contains(compose, `"5001:5001"`) {
		t.Error("expected preview port mapping")
	}
	if !strings.Contains(compose, `"5501:5501"`) {
		t.Error("expected publish port mapping")
	}

	// Volumes should reference the base path
	if !strings.Contains(compose, "/tmp/airo-app-builder/testapp/preview:/app") {
		t.Error("expected preview volume mount")
	}
}

func TestReadDotenvValue(t *testing.T) {
	t.Run("reads existing key", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("FOO=bar\nBAZ=qux\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "FOO"); got != "bar" {
			t.Errorf("got %q, want \"bar\"", got)
		}
	})

	t.Run("skips comment lines", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("# FOO=commented\nFOO=real\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "FOO"); got != "real" {
			t.Errorf("got %q, want \"real\"", got)
		}
	})

	t.Run("strips inline comments", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("FOO=bar # a comment\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "FOO"); got != "bar" {
			t.Errorf("got %q, want \"bar\"", got)
		}
	})

	t.Run("strips double quotes", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("FOO=\"bar\"\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "FOO"); got != "bar" {
			t.Errorf("got %q, want \"bar\"", got)
		}
	})

	t.Run("strips single quotes", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("FOO='bar'\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "FOO"); got != "bar" {
			t.Errorf("got %q, want \"bar\"", got)
		}
	})

	t.Run("returns empty for missing key", func(t *testing.T) {
		f := filepath.Join(t.TempDir(), ".env")
		if err := os.WriteFile(f, []byte("BAR=baz\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		if got := readDotenvValue(f, "MISSING"); got != "" {
			t.Errorf("got %q, want empty string", got)
		}
	})

	t.Run("returns empty for nonexistent file", func(t *testing.T) {
		got := readDotenvValue("/nonexistent/path/.env", "KEY")
		if got != "" {
			t.Errorf("got %q, want empty string", got)
		}
	})
}

func TestResolveAuthType(t *testing.T) {
	t.Run("env var takes priority", func(t *testing.T) {
		t.Setenv("AUTH_TYPE", "mock")
		if got := resolveAuthType(); got != "mock" {
			t.Errorf("got %q, want \"mock\"", got)
		}
	})

	t.Run("reads from dotenv file when env var unset", func(t *testing.T) {
		t.Setenv("AUTH_TYPE", "")
		dir := t.TempDir()
		appDir := filepath.Join(dir, "app")
		if err := os.MkdirAll(appDir, 0755); err != nil {
			t.Fatalf("MkdirAll: %v", err)
		}
		if err := os.WriteFile(filepath.Join(appDir, ".env"), []byte("AUTH_TYPE=mock\n"), 0644); err != nil {
			t.Fatalf("WriteFile: %v", err)
		}
		t.Setenv("PROJECT_ROOT", dir)
		if got := resolveAuthType(); got != "mock" {
			t.Errorf("got %q, want \"mock\"", got)
		}
	})

	t.Run("normalizes to lowercase", func(t *testing.T) {
		t.Setenv("AUTH_TYPE", "MOCK")
		if got := resolveAuthType(); got != "mock" {
			t.Errorf("got %q, want \"mock\"", got)
		}
	})

	t.Run("defaults to jwt when no env var and no dotenv", func(t *testing.T) {
		t.Setenv("AUTH_TYPE", "")
		t.Setenv("PROJECT_ROOT", t.TempDir()) // empty dir, no app/.env
		if got := resolveAuthType(); got != "jwt" {
			t.Errorf("got %q, want \"jwt\"", got)
		}
	})
}

func TestGeneratePreviewEnvironmentMockAuthType(t *testing.T) {
	t.Setenv("AUTH_TYPE", "mock")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://test.example.com")
	t.Setenv("AGENTS_BASE_URL", "http://agents:4000")

	app := &store.App{
		ID:             "test123",
		PreviewPort:    5000,
		SupervisorPort: 8877,
	}
	env := generatePreviewEnvironment(app)

	got, ok := env["DEV_SUPERVISOR_ENABLE_JWT_AUTH"]
	if !ok {
		t.Fatal("missing DEV_SUPERVISOR_ENABLE_JWT_AUTH")
	}
	if got != "false" {
		t.Errorf(
			"DEV_SUPERVISOR_ENABLE_JWT_AUTH = %q, want \"false\"",
			got,
		)
	}
}

func TestGeneratePreviewEnvironmentJWTAuthType(t *testing.T) {
	t.Setenv("AUTH_TYPE", "jwt")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://test.example.com")
	t.Setenv("AGENTS_BASE_URL", "http://agents:4000")

	app := &store.App{
		ID:             "test123",
		PreviewPort:    5000,
		SupervisorPort: 8877,
	}
	env := generatePreviewEnvironment(app)

	got, ok := env["DEV_SUPERVISOR_ENABLE_JWT_AUTH"]
	if !ok {
		t.Fatal("missing DEV_SUPERVISOR_ENABLE_JWT_AUTH")
	}
	if got != "true" {
		t.Errorf(
			"DEV_SUPERVISOR_ENABLE_JWT_AUTH = %q, want \"true\"",
			got,
		)
	}

	present := []string{
		"DEV_SUPERVISOR_JWKS_URL",
		"DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY",
		"DEV_SUPERVISOR_JWT_ISSUER",
		"DEV_SUPERVISOR_JWT_AUDIENCE",
		"DEV_SUPERVISOR_JWT_EXCLUDED_PATHS",
		"DEV_SUPERVISOR_ENABLE_SHARE_TOKENS",
		"DEV_SUPERVISOR_AGENTS_BASE_URL",
	}
	for _, key := range present {
		if _, ok := env[key]; !ok {
			t.Errorf("key %q must be present in JWT mode", key)
		}
	}
}

func TestGeneratePreviewEnvironmentNoneAuthType(t *testing.T) {
	t.Setenv("AUTH_TYPE", "none")
	t.Setenv("NEXT_PUBLIC_APP_URL", "https://test.example.com")

	app := &store.App{
		ID:             "test123",
		PreviewPort:    5000,
		SupervisorPort: 8877,
	}
	env := generatePreviewEnvironment(app)

	got, ok := env["DEV_SUPERVISOR_ENABLE_JWT_AUTH"]
	if !ok {
		t.Fatal("missing DEV_SUPERVISOR_ENABLE_JWT_AUTH")
	}
	if got != "false" {
		t.Errorf(
			"DEV_SUPERVISOR_ENABLE_JWT_AUTH = %q, want \"false\"",
			got,
		)
	}

	absent := []string{
		"DEV_SUPERVISOR_JWKS_URL",
		"DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY",
		"DEV_SUPERVISOR_JWT_ISSUER",
		"DEV_SUPERVISOR_JWT_AUDIENCE",
		"DEV_SUPERVISOR_JWT_EXCLUDED_PATHS",
		"DEV_SUPERVISOR_ENABLE_SHARE_TOKENS",
		"DEV_SUPERVISOR_AGENTS_BASE_URL",
	}
	for _, key := range absent {
		if _, ok := env[key]; ok {
			t.Errorf("key %q must be absent in none mode", key)
		}
	}
}

func TestGeneratePreviewEnvironmentJWKSOmittedInMockMode(t *testing.T) {
	t.Setenv("AUTH_TYPE", "mock")

	app := &store.App{ID: "test123"}
	env := generatePreviewEnvironment(app)

	absent := []string{
		"DEV_SUPERVISOR_JWKS_URL",
		"DEV_SUPERVISOR_JWKS_SKIP_TLS_VERIFY",
		"DEV_SUPERVISOR_JWT_ISSUER",
		"DEV_SUPERVISOR_JWT_AUDIENCE",
		"DEV_SUPERVISOR_JWT_EXCLUDED_PATHS",
		"DEV_SUPERVISOR_ENABLE_SHARE_TOKENS",
		"DEV_SUPERVISOR_AGENTS_BASE_URL",
	}
	for _, key := range absent {
		if _, ok := env[key]; ok {
			t.Errorf("key %q must be absent in mock mode", key)
		}
	}
}
