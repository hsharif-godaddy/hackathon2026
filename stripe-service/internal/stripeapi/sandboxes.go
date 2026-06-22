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
//
// ExpiresAt is the top-level sandbox expiration (RFC3339 string, e.g.
// "2026-08-17T00:00:00.000Z" — parsed by stripe.parseStripeTime).
// Claimable sandboxes are permanently deleted at T+60d if unclaimed;
// Stripe sends a reminder email to prefill.email seven days before
// expiry. We surface ExpiresAt to the agent via /v1/status so the
// skill can warn the user proactively.
//
// See https://docs.stripe.com/sandboxes/claimable-sandboxes.
type CreateClaimableSandboxResponse struct {
	ID                    string                        `json:"id"`         // clmsbx_*
	ExpiresAt             string                        `json:"expires_at"` // ISO 8601; e.g. "2026-08-17T00:00:00.000Z"
	SandboxDetails        SandboxDetails                `json:"sandbox_details"`
	OnboardingLinkDetails OnboardingLinkResponseDetails `json:"onboarding_link_details"`
}

// SandboxDetails wraps the sandbox account ID and API keys.
type SandboxDetails struct {
	Account string         `json:"account"` // acct_*
	APIKeys SandboxAPIKeys `json:"api_keys"`
}

// OnboardingLinkResponseDetails is the response counterpart of
// OnboardingLinkDetails on the request side.
//
// URL is the hosted claim flow. ExpiresAt is the link's own expiry
// (RFC3339 string, e.g. "2026-04-29T00:00:00.000Z"; seven days from
// creation/renewal). Stripe redirects expired-link visitors to
// OnboardingLinkDetails.RefreshURL, which must call the Renew
// Onboarding Link API to mint a fresh URL.
type OnboardingLinkResponseDetails struct {
	URL       string `json:"url"`
	ExpiresAt string `json:"expires_at"` // ISO 8601; e.g. "2026-04-29T00:00:00.000Z"
}

// SandboxAPIKeys are the three test-mode keys Stripe issues alongside
// a freshly-created claimable sandbox. They go straight into the alloc
// env via the hosting service and are never persisted in stripe-service.
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

// RenewOnboardingLinkRequest is the body of
// POST /v2/core/claimable_sandboxes/:id/renew_onboarding_link.
// onboarding_link_details.refresh_url is required by Stripe — omitting
// the block re-uses the previous request's value, but we always re-supply
// the URL on every renewal so renewed links continue to point at Airo.
type RenewOnboardingLinkRequest struct {
	OnboardingLinkDetails *OnboardingLinkDetails `json:"onboarding_link_details,omitempty"`
}

// RenewOnboardingLinkResponse mirrors the renew endpoint's payload.
// Stripe returns the full sandbox object on renew (status / claimed_at /
// expires_at / owner_details / etc.); we only consume the onboarding-link
// block since the rest is unchanged by a renewal. Go's json decoder
// silently ignores the extra fields.
type RenewOnboardingLinkResponse struct {
	OnboardingLinkDetails OnboardingLinkResponseDetails `json:"onboarding_link_details"`
}

// RenewOnboardingLink calls POST
// /v2/core/claimable_sandboxes/:id/renew_onboarding_link to mint a fresh
// seven-day onboarding URL for an existing sandbox. The previous URL is
// invalidated server-side as soon as the new one is issued, so callers
// must persist the returned URL before any user-visible redirect.
//
// Stripe rejects with 400 claimable_sandbox_cant_renew_link if the
// sandbox status is not `unclaimed` or `claimed`. Callers should gate
// on claim_status before invoking — see api.shouldRenewClaimURL for the
// existing pre-claim guard.
func (c *Client) RenewOnboardingLink(
	ctx context.Context,
	idempotencyKey string,
	sandboxID string,
	req RenewOnboardingLinkRequest,
) (*RenewOnboardingLinkResponse, error) {
	if idempotencyKey == "" {
		return nil, errors.New("stripeapi: RenewOnboardingLink: idempotencyKey is required")
	}
	if sandboxID == "" {
		return nil, errors.New("stripeapi: RenewOnboardingLink: sandboxID is required")
	}

	rawResp, err := c.do(
		ctx,
		http.MethodPost,
		"/v2/core/claimable_sandboxes/"+sandboxID+"/renew_onboarding_link",
		requestHeaders{idempotencyKey: idempotencyKey},
		req,
	)
	if err != nil {
		return nil, err
	}

	var out RenewOnboardingLinkResponse
	if err := json.Unmarshal(rawResp, &out); err != nil {
		return nil, fmt.Errorf("stripeapi RenewOnboardingLink: decode response: %w", err)
	}
	if out.OnboardingLinkDetails.URL == "" {
		return nil, fmt.Errorf("stripeapi RenewOnboardingLink: response missing onboarding_link_details.url")
	}
	return &out, nil
}
