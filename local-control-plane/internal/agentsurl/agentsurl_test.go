package agentsurl

import "testing"

func TestDefault_NoEnv(t *testing.T) {
	t.Setenv("AGENTS_BASE_URL", "")
	t.Setenv("AGENTS_PORT", "")
	if got, want := Default(), "https://local.gasket.dev-godaddy.com:4000"; got != want {
		t.Errorf("Default() = %q, want %q", got, want)
	}
}

func TestDefault_AgentsPortOverride(t *testing.T) {
	t.Setenv("AGENTS_BASE_URL", "")
	t.Setenv("AGENTS_PORT", "4040")
	if got, want := Default(), "https://local.gasket.dev-godaddy.com:4040"; got != want {
		t.Errorf("Default() with AGENTS_PORT=4040 = %q, want %q", got, want)
	}
}

func TestDefault_BaseURLWinsOverPort(t *testing.T) {
	t.Setenv("AGENTS_BASE_URL", "https://example.com:9999")
	t.Setenv("AGENTS_PORT", "4040")
	if got, want := Default(), "https://example.com:9999"; got != want {
		t.Errorf("Default() with AGENTS_BASE_URL set = %q, want %q (AGENTS_PORT must lose)", got, want)
	}
}

func TestDefault_EmptyAgentsPortFallsBack(t *testing.T) {
	t.Setenv("AGENTS_BASE_URL", "")
	t.Setenv("AGENTS_PORT", "   ")
	if got, want := Default(), "https://local.gasket.dev-godaddy.com:4000"; got != want {
		t.Errorf("Default() with whitespace AGENTS_PORT = %q, want %q", got, want)
	}
}
