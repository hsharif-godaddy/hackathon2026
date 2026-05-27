package stripe

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
)

// claimableSandboxCreator is the slice of *stripeapi.Client this package
// needs. Production wiring (in cmd/server/main.go) passes the real
// *stripeapi.Client; tests inject a fake implementation. Same narrow-
// interface pattern as hosting.tokenMinter / kmspubkey.keyFetcher.
type claimableSandboxCreator interface {
	CreateClaimableSandbox(
		ctx context.Context,
		idempotencyKey string,
		req stripeapi.CreateClaimableSandboxRequest,
	) (*stripeapi.CreateClaimableSandboxResponse, error)
}

// RealClient implements Client by translating to/from the stripeapi
// package's request and response shapes. The handler at
// internal/api/sandboxes.go depends only on the Client interface, so
// swapping FakeClient for RealClient is a one-line change in main.go.
type RealClient struct {
	inner claimableSandboxCreator
}

// Compile-time check that RealClient satisfies Client.
var _ Client = (*RealClient)(nil)

// NewRealClient validates the dependency and returns a RealClient. The
// constructor is fail-fast on a nil dependency so a wiring mistake in
// main.go surfaces at boot rather than on the first sandbox request.
func NewRealClient(c claimableSandboxCreator) (*RealClient, error) {
	if c == nil {
		return nil, errors.New("stripe.NewRealClient: claimableSandboxCreator is required")
	}
	return &RealClient{inner: c}, nil
}

// CreateClaimableSandbox calls Stripe's v2.core.claimableSandboxes.create
// via the inner stripeapi client, then maps the response into the
// handler-facing Sandbox shape.
//
// The idempotency key is "sandbox-<appId>-<normalized-email>" — email is
// lowercased and trimmed so incidental case/whitespace differences (e.g.
// "Founder@Example.com" vs "founder@example.com") don't fragment dedupe
// within Stripe's 24-hour window. Deterministic per app+email pair lets
// concurrent retries collapse without blocking a corrected email on the
// same app.
//
// EnableMcpAccess is always true: this platform's only consumer is the
// agent, which needs the MCP key surfaced in the response so it can
// flow through to the alloc env via mhp-airo (see TODO in
// internal/api/sandboxes.go). A future caller that doesn't need MCP
// would justify a dedicated method, not a flag here.
//
// Errors propagate via fmt.Errorf("...: %w", err). %w preserves the
// chain so callers can still errors.As(*stripeapi.StripeError); the
// prefix adds call-site context to logs/traces. The handler in
// internal/api/sandboxes.go maps any returned error to 502
// STRIPE_CREATE_FAILED, but the wrapped error message lives in slog
// for triage.
func (r *RealClient) CreateClaimableSandbox(ctx context.Context, in CreateSandboxInput) (Sandbox, error) {
	idempotencyKey := fmt.Sprintf("sandbox-%s-%s", in.AppID, strings.ToLower(strings.TrimSpace(in.Email)))
	req := stripeapi.CreateClaimableSandboxRequest{
		// TODO(stripe-publish): hardcoded to "testing" because com.gdairo.app
		// isn't published for production yet. "public" requires a published
		// version; "testing" requires an external testing version configured
		// in the Stripe Dashboard. Make this env-driven (e.g. STRIPE_APP_CHANNEL)
		// once the app is approved for live mode so dev can keep using "testing".
		AppChannel:      "testing",
		EnableMcpAccess: true,
		OnboardingLinkDetails: &stripeapi.OnboardingLinkDetails{
			// TODO(env-config): hardcoded marketing URL while we have a single
			// deployment target. Lift to env (e.g. STRIPE_ONBOARDING_REFRESH_URL)
			// when test/prod environments need different landing pages.
			RefreshURL: "https://airo-builder.godaddy.com",
		},
		Prefill: &stripeapi.SandboxPrefill{
			Email:   in.Email,
			Country: strings.ToLower(in.Country),
			Name:    "GoDaddy Airo App: " + in.AppID,
		},
	}

	resp, err := r.inner.CreateClaimableSandbox(ctx, idempotencyKey, req)
	if err != nil {
		return Sandbox{}, fmt.Errorf("CreateClaimableSandbox: %w", err)
	}
	return Sandbox{
		SandboxID:      resp.ID,
		AccountID:      resp.SandboxDetails.Account,
		PublishableKey: resp.SandboxDetails.APIKeys.Publishable,
		SecretKey:      resp.SandboxDetails.APIKeys.Secret,
		MCPKey:         resp.SandboxDetails.APIKeys.MCP,
		ClaimURL:       resp.OnboardingLinkDetails.URL,
	}, nil
}
