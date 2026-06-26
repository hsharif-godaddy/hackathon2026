package config

import (
	"os"
	"testing"
)

// Helper: clear AGENTS_PORT, run fn, restore. Each test isolates state
// because AgentsPort() has a load-bearing os.Setenv side-effect.
func withEnv(t *testing.T, key, value string, fn func()) {
	t.Helper()
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

func TestAgentsPort_Unset_ReturnsDefaultAndSetsEnv(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "", func() {
		got := AgentsPort()
		if got != DefaultAgentsPort {
			t.Errorf("AgentsPort() = %q, want %q", got, DefaultAgentsPort)
		}
		// Side-effect: subsequent lookups must see the default — this is the
		// contract Load() relies on so expandAgentsPort sees a non-empty value.
		if got := os.Getenv("AGENTS_PORT"); got != DefaultAgentsPort {
			t.Errorf("AgentsPort() did not seed env; os.Getenv = %q, want %q", got, DefaultAgentsPort)
		}
	})
}

func TestAgentsPort_Set_ReturnsValueAndDoesNotOverwrite(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "4040", func() {
		got := AgentsPort()
		if got != "4040" {
			t.Errorf("AgentsPort() = %q, want %q", got, "4040")
		}
		// Must not clobber an explicitly-set value with the default.
		if got := os.Getenv("AGENTS_PORT"); got != "4040" {
			t.Errorf("AgentsPort() overwrote AGENTS_PORT; os.Getenv = %q, want %q", got, "4040")
		}
	})
}

func TestAgentsPortInt_Numeric(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "4040", func() {
		if got := AgentsPortInt(4000); got != 4040 {
			t.Errorf("AgentsPortInt(4000) = %d, want 4040", got)
		}
	})
}

func TestAgentsPortInt_NonNumeric_FallsBack(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "not-a-port", func() {
		if got := AgentsPortInt(4000); got != 4000 {
			t.Errorf("AgentsPortInt(4000) with non-numeric env = %d, want 4000 (fallback)", got)
		}
	})
}

func TestAgentsPortInt_ZeroOrNegative_FallsBack(t *testing.T) {
	for _, v := range []string{"0", "-1"} {
		withEnv(t, "AGENTS_PORT", v, func() {
			if got := AgentsPortInt(4000); got != 4000 {
				t.Errorf("AgentsPortInt(4000) with AGENTS_PORT=%q = %d, want 4000 (fallback)", v, got)
			}
		})
	}
}

func TestAgentsPortInt_Unset_FallsBackToDefaultPort(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "", func() {
		// AgentsPort() returns "4000" (DefaultAgentsPort) → parses to 4000.
		// Fallback param only fires when the resolved value is unparseable.
		if got := AgentsPortInt(9999); got != 4000 {
			t.Errorf("AgentsPortInt(9999) with unset env = %d, want 4000 (DefaultAgentsPort wins over fallback param)", got)
		}
	})
}

func TestExpandAgentsPort_ReplacesPlaceholder(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "4040", func() {
		got := expandAgentsPort("https://host:${AGENTS_PORT}/health")
		want := "https://host:4040/health"
		if got != want {
			t.Errorf("expandAgentsPort = %q, want %q", got, want)
		}
	})
}

func TestExpandAgentsPort_PreservesUnrelatedVars(t *testing.T) {
	// Ensures the scoped expansion does NOT clobber other tokens — the bug the
	// previous blanket os.ExpandEnv introduced for command strings. Also pins
	// that `$BAR` stays `$BAR` (regex preserves surface form; the earlier
	// os.Expand-based implementation normalised it to `${BAR}`).
	withEnv(t, "AGENTS_PORT", "4040", func() {
		input := "FOO=$BAR pnpm exec --port ${AGENTS_PORT} -- ${HOME}/bin"
		got := expandAgentsPort(input)
		want := "FOO=$BAR pnpm exec --port 4040 -- ${HOME}/bin"
		if got != want {
			t.Errorf("expandAgentsPort scope leaked.\n got: %q\nwant: %q", got, want)
		}
	})
}

func TestExpandAgentsPort_PreservesRegexAnchorsAndCommandSubst(t *testing.T) {
	// Edge cases the reviewer called out: a literal `$` at end-of-string
	// (regex anchor) and `$(...)` command substitution must survive verbatim.
	withEnv(t, "AGENTS_PORT", "4040", func() {
		cases := []string{
			"^password$",
			"$(echo hello)",
			"price=$10",
			"$AGENTS_PORTS",
		}
		for _, in := range cases {
			if got := expandAgentsPort(in); got != in {
				t.Errorf("expandAgentsPort(%q) = %q, want unchanged", in, got)
			}
		}
	})
}

func TestExpandAgentsPort_NoPlaceholder_Passthrough(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "4040", func() {
		input := "https://host:4000/health"
		if got := expandAgentsPort(input); got != input {
			t.Errorf("expandAgentsPort modified passthrough string: %q → %q", input, got)
		}
	})
}

func TestExpandAgentsPort_BareDollarSyntax(t *testing.T) {
	withEnv(t, "AGENTS_PORT", "4040", func() {
		got := expandAgentsPort("https://host:$AGENTS_PORT/health")
		want := "https://host:4040/health"
		if got != want {
			t.Errorf("expandAgentsPort($AGENTS_PORT) = %q, want %q", got, want)
		}
	})
}
