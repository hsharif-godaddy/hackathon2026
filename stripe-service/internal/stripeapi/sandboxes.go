package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// CreateClaimableSandboxRequest is the body of POST /v2/core/claimable_sandboxes.
// Matches the shape documented in STRIPE_INTEGRATION_PLAN.md §6.1.
type CreateClaimableSandboxRequest struct {
	Prefill         *SandboxPrefill `json:"prefill,omitempty"`
	EnableMcpAccess bool            `json:"enable_mcp_access"`
}

// SandboxPrefill is optional metadata Stripe uses to pre-fill the
// hosted claim flow. Not required for sandbox creation; nil is fine.
type SandboxPrefill struct {
	Email   string `json:"email,omitempty"`
	Country string `json:"country,omitempty"`
}

// CreateClaimableSandboxResponse mirrors the documented payload. All
// three sandbox API keys are returned alongside metadata at creation
// time — the platform doesn't fetch them later.
type CreateClaimableSandboxResponse struct {
	ID       string         `json:"id"` // clmsbx_*
	Account  SandboxAccount `json:"account"`
	APIKeys  SandboxAPIKeys `json:"api_keys"`
	ClaimURL string         `json:"claim_url"`
}

// SandboxAccount is the per-sandbox Stripe account, addressed by
// `acct_*` ID for cross-account API calls (Stripe-Context header).
type SandboxAccount struct {
	ID string `json:"id"` // acct_*
}

// SandboxAPIKeys are the three test-mode keys Stripe issues alongside
// a freshly-created claimable sandbox. They go straight into the alloc
// env via mhp-airo and are never persisted in stripe-service.
type SandboxAPIKeys struct {
	Secret      string `json:"secret"`      // sk_test_*
	Publishable string `json:"publishable"` // pk_test_*
	MCP         string `json:"mcp"`         // ek_test_*
}

// CreateClaimableSandbox calls POST /v2/core/claimable_sandboxes.
//
// idempotencyKey must be non-empty. A deterministic key like
// "sandbox-<appId>" is the right choice when a single sandbox per app
// is the design invariant — repeats of the same call return the same
// sandbox rather than creating a new one.
func (c *Client) CreateClaimableSandbox(
	ctx context.Context,
	idempotencyKey string,
	req CreateClaimableSandboxRequest,
) (*CreateClaimableSandboxResponse, error) {
	if idempotencyKey == "" {
		return nil, errors.New("stripeapi: CreateClaimableSandbox: idempotencyKey is required")
	}

	rawResp, err := c.do(
		ctx,
		http.MethodPost,
		"/v2/core/claimable_sandboxes",
		requestHeaders{idempotencyKey: idempotencyKey},
		req,
	)
	if err != nil {
		return nil, err
	}

	var out CreateClaimableSandboxResponse
	if err := json.Unmarshal(rawResp, &out); err != nil {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: decode response: %w", err)
	}
	// Defensive: a 2xx that decodes to an all-zero struct (empty body,
	// schema drift) would silently store an empty sandbox_id downstream.
	// Reject it at the boundary.
	if out.ID == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing id")
	}
	return &out, nil
}
