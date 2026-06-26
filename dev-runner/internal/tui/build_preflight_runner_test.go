package tui

import (
	"os"
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/preflight"
	"github.com/airo-ai-builder/dev-runner/internal/preflight/checks"
)

// withAgentsPortEnv saves AGENTS_PORT, sets (or clears) it for the test, and
// restores the original value on cleanup. Each test isolates state because
// config.AgentsPort() has a load-bearing os.Setenv side-effect that would
// otherwise leak across cases.
func withAgentsPortEnv(t *testing.T, value string, fn func()) {
	t.Helper()
	const key string = "AGENTS_PORT"
	saved, hadOriginal := os.LookupEnv(key)
	t.Cleanup(func() {
		if hadOriginal {
			os.Setenv(key, saved)
		} else {
			os.Unsetenv(key)
		}
	})
	if value == "" {
		os.Unsetenv(key)
	} else {
		os.Setenv(key, value)
	}
	fn()
}

// findPortCheck walks the runner's Services category and returns the
// PortCheck registered there, or nil if not found.
func findPortCheck(r *preflight.Runner) *checks.PortCheck {
	for _, cat := range r.Categories {
		if cat.Name != preflight.CategoryServices {
			continue
		}
		for _, c := range cat.Checks {
			if pc, ok := c.Check.(*checks.PortCheck); ok {
				return pc
			}
		}
	}
	return nil
}

func TestBuildPreflightRunner_AgentsPort_Default(t *testing.T) {
	withAgentsPortEnv(t, "", func() {
		runner := buildPreflightRunner(t.TempDir())
		pc := findPortCheck(runner)
		if pc == nil {
			t.Fatal("PortCheck not registered under Services category")
		}
		got, ok := pc.Ports[4000]
		if !ok {
			t.Fatalf("requiredPorts missing default agents port 4000; got %v", pc.Ports)
		}
		if got != "Agents" {
			t.Errorf("requiredPorts[4000] = %q, want %q", got, "Agents")
		}
	})
}

func TestBuildPreflightRunner_AgentsPort_Override(t *testing.T) {
	withAgentsPortEnv(t, "4040", func() {
		runner := buildPreflightRunner(t.TempDir())
		pc := findPortCheck(runner)
		if pc == nil {
			t.Fatal("PortCheck not registered under Services category")
		}

		got, ok := pc.Ports[4040]
		if !ok {
			t.Fatalf("requiredPorts missing override agents port 4040; got %v", pc.Ports)
		}
		if got != "Agents" {
			t.Errorf("requiredPorts[4040] = %q, want %q", got, "Agents")
		}

		// The whole point of the override: when AGENTS_PORT=4040, the preflight
		// must NOT gate on 4000. Otherwise the user gets a 4000-in-use failure
		// for a port nothing on the run actually tries to claim.
		if _, leaked := pc.Ports[4000]; leaked {
			t.Errorf("requiredPorts still contains 4000 after override to 4040: %v", pc.Ports)
		}
	})
}

// Non-numeric AGENTS_PORT exercises AgentsPortInt's fallback path through the
// preflight integration: the runner must still produce a usable map (falling
// back to 4000) rather than panicking or emitting a 0-port entry.
func TestBuildPreflightRunner_AgentsPort_InvalidFallsBackTo4000(t *testing.T) {
	withAgentsPortEnv(t, "not-a-port", func() {
		runner := buildPreflightRunner(t.TempDir())
		pc := findPortCheck(runner)
		if pc == nil {
			t.Fatal("PortCheck not registered under Services category")
		}
		if name, ok := pc.Ports[4000]; !ok || name != "Agents" {
			t.Errorf("requiredPorts[4000] = (%q, %v), want (\"Agents\", true) — fallback path",
				name, ok)
		}
		if _, zeroPresent := pc.Ports[0]; zeroPresent {
			t.Errorf("requiredPorts contains 0 port (clamp leaked): %v", pc.Ports)
		}
	})
}

func TestBuildPreflightRunner_OtherStaticPortsUnchanged(t *testing.T) {
	withAgentsPortEnv(t, "4040", func() {
		runner := buildPreflightRunner(t.TempDir())
		pc := findPortCheck(runner)
		if pc == nil {
			t.Fatal("PortCheck not registered under Services category")
		}
		// The agents-port override must not perturb the other static
		// service-port entries.
		expected := map[int]string{
			3000: "App",
			4100: "Control Plane",
			8443: "App HTTPS",
		}
		for port, want := range expected {
			if got, ok := pc.Ports[port]; !ok || got != want {
				t.Errorf("requiredPorts[%d] = (%q, %v), want (%q, true)",
					port, got, ok, want)
			}
		}
	})
}
