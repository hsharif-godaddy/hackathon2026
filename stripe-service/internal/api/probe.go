package api

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/config"
)

// probeTimeout bounds the total time the probe spends on AWS calls so a
// hanging Describe* doesn't stall the response up to http.Server.WriteTimeout.
// 5 Describe* calls at typical <200ms leaves ample headroom.
const probeTimeout = 5 * time.Second

type probeCheck struct {
	Name      string `json:"name"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

type probeResponse struct {
	Status string       `json:"status"`
	Checks []probeCheck `json:"checks"`
}

// getProbe runs one zero-side-effect Describe* call against each backing AWS
// resource (2 DynamoDB tables, 2 Secrets Manager secrets, 1 KMS CMK alias) to
// verify creds and IAM grants. 200 if all pass, 503 if any fail. Each failure
// is always logged with the full AWS error. In non-prod envs the error text is
// also included in the response body for easier debugging; in prod it stays
// masked as "describe failed" so ARNs and error details don't leak.
func (s *Server) getProbe(w http.ResponseWriter, r *http.Request) {
	verbose := s.Environment != string(config.EnvProd)
	names := s.ResourceNames

	ctx, cancel := context.WithTimeout(r.Context(), probeTimeout)
	defer cancel()

	steps := []struct {
		name string
		fn   func(context.Context) error
	}{
		{"dynamodb.sandboxes", func(ctx context.Context) error { return s.Prober.DescribeTable(ctx, names.SandboxesTable) }},
		{"dynamodb.events", func(ctx context.Context) error { return s.Prober.DescribeTable(ctx, names.EventsTable) }},
		{"secretsmanager.platform", func(ctx context.Context) error { return s.Prober.DescribeSecret(ctx, names.PlatformKeySecret) }},
		{"secretsmanager.webhook", func(ctx context.Context) error { return s.Prober.DescribeSecret(ctx, names.WebhookSigningSecret) }},
		{"kms.managed", func(ctx context.Context) error { return s.Prober.DescribeKey(ctx, names.ManagedKeysAlias) }},
	}

	checks := make([]probeCheck, 0, len(steps))
	allOK := true
	for _, st := range steps {
		start := time.Now()
		err := st.fn(ctx)
		c := probeCheck{
			Name:      st.name,
			OK:        err == nil,
			LatencyMs: time.Since(start).Milliseconds(),
		}
		if err != nil {
			allOK = false
			if verbose {
				c.Error = err.Error()
			} else {
				c.Error = "describe failed"
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
