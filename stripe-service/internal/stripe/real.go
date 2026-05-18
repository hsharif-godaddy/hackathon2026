package stripe

import (
	"context"
	"errors"
	"fmt"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
)

// claimableSandboxCreator is the slice of *stripeapi.Client this package
// needs. Production wiring (in cmd/server/main.go) passes the real
// *stripeapi.Client; tests inject a fake implementation. Same narrow-
// interface pattern as mhpairo.tokenMinter / kmspubkey.keyFetcher.
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
// The idempotency key is "sandbox-<appId>" — deterministic per app, so
// concurrent retries from the agent (or human-triggered re-tries during
// a pre-existing transient failure) dedupe within Stripe's 24-hour
// idempotency window rather than minting duplicate sandboxes that all
// race to land in DDB.
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
	idempotencyKey := "sandbox-" + in.AppID
	req := stripeapi.CreateClaimableSandboxRequest{
		Prefill: &stripeapi.SandboxPrefill{
			Email:   in.Email,
			Country: in.Country,
		},
		EnableMcpAccess: true,
	}

	resp, err := r.inner.CreateClaimableSandbox(ctx, idempotencyKey, req)
	if err != nil {
		return Sandbox{}, fmt.Errorf("CreateClaimableSandbox: %w", err)
	}
	return Sandbox{
		SandboxID:      resp.ID,
		AccountID:      resp.Account.ID,
		PublishableKey: resp.APIKeys.Publishable,
		SecretKey:      resp.APIKeys.Secret,
		MCPKey:         resp.APIKeys.MCP,
		ClaimURL:       resp.ClaimURL,
	}, nil
}
