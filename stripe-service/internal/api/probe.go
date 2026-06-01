package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
)

// probeTimeout bounds the total time the probe spends on outbound calls so a
// hanging dependency doesn't stall the response up to http.Server.WriteTimeout.
// AWS Describe* calls run ~<200ms each; the SSO mint inside hosting.auth can
// take ~1s on a cold cache; hosting.reach adds one HTTP round-trip. 15s
// leaves ample headroom even when every cache is cold.
const probeTimeout = 15 * time.Second

type probeCheck struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
	// Details carries non-error context for diagnostic value: auth scheme
	// for hosting.auth, mhp-core status code + body preview for
	// hosting.reach. Omitted for AWS Describe* checks where OK alone is
	// sufficient.
	Details string `json:"details,omitempty"`
}

type probeResponse struct {
	Status string       `json:"status"`
	Checks []probeCheck `json:"checks"`
}

// probeStep is the unit of work each probe runs. fn returns optional
// diagnostic detail (auth scheme, status code, etc.) and an error.
type probeStep struct {
	name string
	fn   func(context.Context) (details string, err error)
}

// getProbe runs zero-side-effect probes against backing dependencies.
// AWS: 2 DynamoDB tables, 2 Secrets Manager secrets, 1 KMS CMK alias.
// mhp-core (when HostingProber is wired): auth provider produces a
// credential, then a no-op GET to mhp-core's secrets endpoint to confirm
// reachability + caller-identity allowlisting.
//
// Returns 200 if all checks pass, 503 if any fail. Each failure is always
// logged with the full underlying error. In non-prod envs the error text
// also lands in the response body for easier debugging; in prod it stays
// masked as "describe failed" / "probe failed" so ARNs and error details
// don't leak.
func (s *Server) getProbe(w http.ResponseWriter, r *http.Request) {
	verbose := s.Environment != string(config.EnvProd)
	names := s.ResourceNames

	ctx, cancel := context.WithTimeout(r.Context(), probeTimeout)
	defer cancel()

	steps := []probeStep{
		{"dynamodb.sandboxes", func(ctx context.Context) (string, error) {
			return "", s.Prober.DescribeTable(ctx, names.SandboxesTable)
		}},
		{"dynamodb.events", func(ctx context.Context) (string, error) {
			return "", s.Prober.DescribeTable(ctx, names.EventsTable)
		}},
		{"secretsmanager.platform", func(ctx context.Context) (string, error) {
			return "", s.Prober.DescribeSecret(ctx, names.PlatformKeySecret)
		}},
		{"secretsmanager.webhook", func(ctx context.Context) (string, error) {
			return "", s.Prober.DescribeSecret(ctx, names.WebhookSigningSecret)
		}},
		{"kms.managed", func(ctx context.Context) (string, error) {
			return "", s.Prober.DescribeKey(ctx, names.ManagedKeysAlias)
		}},
	}

	// Hosting probes are gated on HostingProber being wired. Tests that
	// don't exercise the hosting path leave it nil and these steps skip.
	if s.HostingProber != nil {
		steps = append(steps,
			probeStep{"hosting.auth", func(ctx context.Context) (string, error) {
				scheme, err := s.HostingProber.ProbeAuth(ctx)
				if err != nil {
					return "", err
				}
				return "scheme=" + scheme, nil
			}},
			probeStep{"hosting.reach", func(ctx context.Context) (string, error) {
				status, body, err := s.HostingProber.ProbeReach(ctx)
				if err != nil {
					return "", err
				}
				detail := fmt.Sprintf("status=%d", status)
				// 401 from middleware (CN not in allowlist, or endpoint
				// still JWTOnly) and 404 (auth passed, _probe app not
				// found) are the expected non-success outcomes — both
				// have meaningful diagnostic body text we want surfaced.
				if verbose && body != "" {
					trimmed := strings.TrimSpace(body)
					if len(trimmed) > 200 {
						trimmed = trimmed[:200] + "…"
					}
					detail = fmt.Sprintf("%s body=%q", detail, trimmed)
				}
				if status >= 200 && status < 500 {
					// Any 2xx/4xx is a clean response — the probe call
					// itself succeeded even if mhp-core didn't return 2xx.
					// 5xx is the only "probe broken" case for OK purposes.
					return detail, nil
				}
				return detail, fmt.Errorf("mhp-core returned %d", status)
			}},
		)
	}

	checks := make([]probeCheck, 0, len(steps))
	allOK := true
	for _, st := range steps {
		start := time.Now()
		details, err := st.fn(ctx)
		c := probeCheck{
			Name:      st.name,
			OK:        err == nil,
			LatencyMs: time.Since(start).Milliseconds(),
			Details:   details,
		}
		if err != nil {
			allOK = false
			if verbose {
				c.Error = err.Error()
			} else {
				c.Error = "probe failed"
			}
			slog.Error("stripe_service.probe.check_failed", "name", st.name, "error", err)
		}
		checks = append(checks, c)
	}

	resp := probeResponse{Status: "ok", Checks: checks}
	status := http.StatusOK
	if !allOK {
		resp.Status = "error"
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, resp)
}
