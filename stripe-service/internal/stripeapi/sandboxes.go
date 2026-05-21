package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// CreateClaimableSandboxRequest is the body of POST /v2/core/claimable_sandboxes.
//
// Pointer fields (OnboardingLinkDetails, Prefill) are pointers so that a
// zero-valued nested struct serializes as omitted rather than `{}` —
// `omitempty` on a struct value is a no-op. Don't "consistency"-refactor
// the pointer types away without preserving that wire shape.
type CreateClaimableSandboxRequest struct {
	AppChannel            string                 `json:"app_channel,omitempty"`
	EnableMcpAccess       bool                   `json:"enable_mcp_access"`
	OnboardingLinkDetails *OnboardingLinkDetails `json:"onboarding_link_details,omitempty"`
	Prefill               *SandboxPrefill        `json:"prefill,omitempty"`
}

// OnboardingLinkDetails configures the claim onboarding flow Stripe
// hosts. RefreshURL is where users land if their onboarding link expires.
type OnboardingLinkDetails struct {
	RefreshURL string `json:"refresh_url,omitempty"`
}

// SandboxPrefill is optional metadata Stripe uses to pre-fill the
// hosted claim flow. Not required for sandbox creation; nil is fine.
// Country is ISO-3166-1 alpha-2 lowercase.
type SandboxPrefill struct {
	Email   string `json:"email,omitempty"`
	Country string `json:"country,omitempty"`
	Name    string `json:"name,omitempty"`
}

// CreateClaimableSandboxResponse mirrors the v2 preview payload.
type CreateClaimableSandboxResponse struct {
	ID                    string                        `json:"id"` // clmsbx_*
	SandboxDetails        SandboxDetails                `json:"sandbox_details"`
	OnboardingLinkDetails OnboardingLinkResponseDetails `json:"onboarding_link_details"`
}

// SandboxDetails wraps the sandbox account ID and API keys.
type SandboxDetails struct {
	Account string         `json:"account"` // acct_*
	APIKeys SandboxAPIKeys `json:"api_keys"`
}

// OnboardingLinkResponseDetails is the response counterpart of
// OnboardingLinkDetails on the request side. URL is the hosted
// claim flow.
type OnboardingLinkResponseDetails struct {
	URL string `json:"url"`
}

// SandboxAPIKeys are the three test-mode keys Stripe issues alongside
// a freshly-created claimable sandbox.
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
	// Defensive: a 2xx that decodes to a zero-valued struct (empty body,
	// schema drift like the 2024-11-20 → 2026-04-22 rename of `account`
	// → `sandbox_details.account`) would silently store empty values
	// downstream. Reject at the boundary on every load-bearing field —
	// the handler in internal/api/sandboxes.go persists Account and
	// ClaimURL into DDB, and the API keys are the load-bearing payload
	// for the eventual mhp-airo push (see TODO in api/sandboxes.go) so
	// the agent's STRIPE_MCP_KEY etc. depend on them. A schema drift
	// emptying api_keys would fail the same way the account rename did.
	if out.ID == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing id")
	}
	if out.SandboxDetails.Account == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing sandbox_details.account")
	}
	if out.SandboxDetails.APIKeys.Secret == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing sandbox_details.api_keys.secret")
	}
	if out.SandboxDetails.APIKeys.Publishable == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing sandbox_details.api_keys.publishable")
	}
	if out.SandboxDetails.APIKeys.MCP == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing sandbox_details.api_keys.mcp")
	}
	if out.OnboardingLinkDetails.URL == "" {
		return nil, fmt.Errorf("stripeapi CreateClaimableSandbox: response missing onboarding_link_details.url")
	}
	return &out, nil
}
