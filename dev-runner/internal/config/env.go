package config

import (
	"os"
	"regexp"
	"strconv"
)

// DefaultAgentsPort is the agents HTTP server port when AGENTS_PORT is unset.
//
// Kept in sync with:
//   - agents/src/server/app.ts            (`process.env.PORT || process.env.AGENTS_PORT || 4000`)
//   - local-control-plane/internal/agentsurl/agentsurl.go
//   - app/src/lib/agents-base-url.ts
//   - evals/gosym-probe/config/environments/parse-env.ts
const DefaultAgentsPort = "4000"

// AgentsPort returns the effective agents-service port from `AGENTS_PORT`,
// falling back to DefaultAgentsPort. Sets the env var as a side-effect so
// subsequent `os.ExpandEnv` calls on dev-runner.yml see a non-empty
// `${AGENTS_PORT}` value (POSIX-style defaults are not part of `os.ExpandEnv`).
//
// Side-effect rationale: dev-runner is a single-tenant TUI launched once per
// shell, so writing back into the process environment is observable only to
// child processes the runner itself spawns — which is exactly where we want
// the value to land (agents inherits AGENTS_PORT and its own
// `PORT || AGENTS_PORT || 4000` resolver returns the same port).
func AgentsPort() string {
	if v := os.Getenv("AGENTS_PORT"); v != "" {
		return v
	}
	_ = os.Setenv("AGENTS_PORT", DefaultAgentsPort)
	return DefaultAgentsPort
}

// AgentsPortInt returns AgentsPort() parsed as a positive int, falling back
// to {@code fallback} on parse error or non-positive values. Callers that need
// to construct an int port (preflight map, listeners) can use this instead of
// repeating the strconv + clamp logic at every call site.
func AgentsPortInt(fallback int) int {
	p, err := strconv.Atoi(AgentsPort())
	if err != nil || p <= 0 {
		return fallback
	}
	return p
}

// agentsPortPlaceholder matches `${AGENTS_PORT}` and `$AGENTS_PORT` exactly —
// nothing else. Other shell-style placeholders (`$HOME`, `${BAR}`, `$(...)`,
// regex anchors, escaped `$$`) are not matched by this pattern so the replace
// pass leaves them byte-for-byte intact. `os.Expand` would have normalized
// `$BAR` to `${BAR}`; explicit regex preserves the original surface form.
var agentsPortPlaceholder = regexp.MustCompile(`\$\{AGENTS_PORT\}|\$AGENTS_PORT\b`)

// expandAgentsPort substitutes `${AGENTS_PORT}` and `$AGENTS_PORT` in a string
// with the resolved port. Every other token in the string passes through
// unchanged.
func expandAgentsPort(s string) string {
	// Literal-string replace (not template-style) so a future port value
	// containing `$` couldn't be reinterpreted as a backreference.
	return agentsPortPlaceholder.ReplaceAllLiteralString(s, AgentsPort())
}
