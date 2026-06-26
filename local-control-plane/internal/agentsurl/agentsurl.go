// Package agentsurl returns the agents-service base URL the local control
// plane should advertise to UI clients (via site.agent_url) and to its own
// internal callers (registerWithAgent, the supervisor compose template,
// host_gateway).
//
// Centralising the resolution keeps the four call sites — two in the apps
// API response, registerWithAgent, host_gateway — from drifting apart again
// (apps.go used to hardcode :4000 in two places while the others were
// already env-driven, breaking port overrides for the UI alone).
package agentsurl

import (
	"fmt"
	"os"
	"strings"
)

// DefaultHost is the loopback host the local dev cert is issued for.
const DefaultHost = "local.gasket.dev-godaddy.com"

// DefaultPort matches agents/src/server/app.ts: process.env.PORT || 4000.
const DefaultPort = "4000"

// Default returns the URL the local-control-plane should advertise as the
// agents-service base URL.
//
// Precedence:
//  1. AGENTS_BASE_URL — full URL override (host + port + scheme), used in CI
//     and non-localhost setups where the host differs.
//  2. https://${DefaultHost}:${AGENTS_PORT|DefaultPort} — port-only override,
//     the common local-dev case when something is squatting on :4000.
//
// AGENTS_PORT mirrors the env knob in evals/gosym-probe/.env so a single
// AGENTS_PORT=4040 in the shell flows through the agent locator the UI uses
// AND the URL the eval probe drives. The agents service itself still reads
// PORT (Node convention) — set both PORT and AGENTS_PORT to the same value
// when running off-default.
//
// We deliberately do NOT read PORT here because local-control-plane reads
// PORT for its OWN listener (cmd/server/main.go), so reusing it cross-process
// would conflict.
func Default() string {
	if v := strings.TrimSpace(os.Getenv("AGENTS_BASE_URL")); v != "" {
		return v
	}
	port := strings.TrimSpace(os.Getenv("AGENTS_PORT"))
	if port == "" {
		port = DefaultPort
	}
	return fmt.Sprintf("https://%s:%s", DefaultHost, port)
}
