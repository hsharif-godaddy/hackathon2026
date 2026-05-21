package stripe

import (
	"context"
	"errors"
	"testing"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
)

// fakeCreator records its inputs and returns canned outputs.
type fakeCreator struct {
	out *stripeapi.CreateClaimableSandboxResponse
	err error

	callCount   int
	lastIdemKey string
	lastReq     stripeapi.CreateClaimableSandboxRequest
}

func (f *fakeCreator) CreateClaimableSandbox(
	_ context.Context,
	idempotencyKey string,
	req stripeapi.CreateClaimableSandboxRequest,
) (*stripeapi.CreateClaimableSandboxResponse, error) {
	f.callCount++
	f.lastIdemKey = idempotencyKey
	f.lastReq = req
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func TestNewRealClient_RejectsNil(t *testing.T) {
	if _, err := NewRealClient(nil); err == nil {
		t.Errorf("want error for nil creator, got nil")
	}
}

func TestRealClient_CreateClaimableSandbox_TranslatesInput(t *testing.T) {
	fc := &fakeCreator{
		out: &stripeapi.CreateClaimableSandboxResponse{
			ID: "clmsbx_real_X",
			SandboxDetails: stripeapi.SandboxDetails{
				Account: "acct_real_X",
				APIKeys: stripeapi.SandboxAPIKeys{Secret: "sk_test_X", Publishable: "pk_test_X", MCP: "ek_test_X"},
			},
			OnboardingLinkDetails: stripeapi.OnboardingLinkResponseDetails{
				URL: "https://dashboard.stripe.com/claim/clmsbx_real_X",
			},
		},
	}
	rc, err := NewRealClient(fc)
	if err != nil {
		t.Fatalf("NewRealClient: %v", err)
	}

	_, err = rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{
		AppID:   "app-1",
		Email:   "founder@example.com",
		Country: "US",
	})
	if err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if fc.callCount != 1 {
		t.Errorf("call count: want 1, got %d", fc.callCount)
	}
	if fc.lastIdemKey != "sandbox-app-1-founder@example.com" {
		t.Errorf("idempotency key: want sandbox-app-1-founder@example.com, got %q", fc.lastIdemKey)
	}
	if fc.lastReq.Prefill == nil {
		t.Fatalf("Prefill: want non-nil")
	}
	if fc.lastReq.Prefill.Email != "founder@example.com" {
		t.Errorf("Prefill.Email: want founder@example.com, got %q", fc.lastReq.Prefill.Email)
	}
	if fc.lastReq.Prefill.Country != "us" {
		t.Errorf("Prefill.Country: want us (lowercased), got %q", fc.lastReq.Prefill.Country)
	}
	if fc.lastReq.Prefill.Name != "GoDaddy Airo App: app-1" {
		t.Errorf("Prefill.Name: want %q, got %q", "GoDaddy Airo App: app-1", fc.lastReq.Prefill.Name)
	}
	if !fc.lastReq.EnableMcpAccess {
		t.Errorf("EnableMcpAccess: want true (the agent needs the MCP key)")
	}
	// AppChannel and OnboardingLinkDetails.RefreshURL are the integration
	// constants Stripe currently demands; missing or wrong values produce
	// the 500 api_error this PR fixed. Asserted explicitly so a regression
	// surfaces here instead of in a live-fire Stripe call.
	if fc.lastReq.AppChannel != "testing" {
		t.Errorf("AppChannel: want %q, got %q", "testing", fc.lastReq.AppChannel)
	}
	if fc.lastReq.OnboardingLinkDetails == nil {
		t.Fatalf("OnboardingLinkDetails: want non-nil")
	}
	if fc.lastReq.OnboardingLinkDetails.RefreshURL != "https://airo-builder.godaddy.com" {
		t.Errorf("OnboardingLinkDetails.RefreshURL: want %q, got %q",
			"https://airo-builder.godaddy.com", fc.lastReq.OnboardingLinkDetails.RefreshURL)
	}
}

// Pin: incidental case/whitespace differences in the email don't fragment
// the dedupe window. Two requests for the same app+email-modulo-normalization
// must produce the same idempotency key so Stripe replays the cached
// response on retry instead of minting a second sandbox.
func TestRealClient_CreateClaimableSandbox_NormalizesEmailInIdempotencyKey(t *testing.T) {
	cases := []struct {
		name, email string
	}{
		{"lowercase canonical", "founder@example.com"},
		{"mixed case", "Founder@Example.COM"},
		{"surrounding whitespace", "  founder@example.com  "},
		{"both", "  Founder@Example.COM  "},
	}
	const wantKey = "sandbox-app-1-founder@example.com"

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fc := &fakeCreator{
				out: &stripeapi.CreateClaimableSandboxResponse{ID: "clmsbx_X"},
			}
			rc, err := NewRealClient(fc)
			if err != nil {
				t.Fatalf("NewRealClient: %v", err)
			}
			if _, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{
				AppID:   "app-1",
				Email:   c.email,
				Country: "US",
			}); err != nil {
				t.Fatalf("CreateClaimableSandbox: %v", err)
			}
			if fc.lastIdemKey != wantKey {
				t.Errorf("idempotency key: want %q, got %q", wantKey, fc.lastIdemKey)
			}
		})
	}
}

func TestRealClient_CreateClaimableSandbox_TranslatesOutput(t *testing.T) {
	fc := &fakeCreator{
		out: &stripeapi.CreateClaimableSandboxResponse{
			ID: "clmsbx_real_X",
			SandboxDetails: stripeapi.SandboxDetails{
				Account: "acct_real_X",
				APIKeys: stripeapi.SandboxAPIKeys{Secret: "sk_test_X", Publishable: "pk_test_X", MCP: "ek_test_X"},
			},
			OnboardingLinkDetails: stripeapi.OnboardingLinkResponseDetails{
				URL: "https://dashboard.stripe.com/claim/clmsbx_real_X",
			},
		},
	}
	rc, _ := NewRealClient(fc)

	sb, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1"})
	if err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	cases := []struct {
		name, got, want string
	}{
		{"SandboxID", sb.SandboxID, "clmsbx_real_X"},
		{"AccountID", sb.AccountID, "acct_real_X"},
		{"PublishableKey", sb.PublishableKey, "pk_test_X"},
		{"SecretKey", sb.SecretKey, "sk_test_X"},
		{"MCPKey", sb.MCPKey, "ek_test_X"},
		{"ClaimURL", sb.ClaimURL, "https://dashboard.stripe.com/claim/clmsbx_real_X"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: want %q, got %q", c.name, c.want, c.got)
		}
	}
}

func TestRealClient_CreateClaimableSandbox_PropagatesStripeError(t *testing.T) {
	// Simulate the post-step-1 "preview not enabled" path. A real
	// Stripe rejection surfaces as *stripeapi.StripeError; the
	// adapter must propagate it as-is so callers can still inspect
	// the structured error fields via errors.As.
	stripeErr := &stripeapi.StripeError{
		HTTPStatus: 400,
		Type:       "invalid_request_error",
		Code:       "preview_not_enabled",
		Message:    "claimable_sandboxes is not enabled for this account",
	}
	fc := &fakeCreator{err: stripeErr}
	rc, _ := NewRealClient(fc)

	_, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1"})
	if err == nil {
		t.Fatalf("want error from Stripe rejection, got nil")
	}

	var got *stripeapi.StripeError
	if !errors.As(err, &got) {
		t.Fatalf("want errors.As(*stripeapi.StripeError), got %T: %v", err, err)
	}
	if got.Code != "preview_not_enabled" {
		t.Errorf("StripeError.Code: want preview_not_enabled, got %q", got.Code)
	}
}

func TestRealClient_CreateClaimableSandbox_PropagatesGenericError(t *testing.T) {
	transportErr := errors.New("dial tcp: i/o timeout")
	fc := &fakeCreator{err: transportErr}
	rc, _ := NewRealClient(fc)

	_, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1"})
	if !errors.Is(err, transportErr) {
		t.Errorf("want errors.Is(transportErr), got %v", err)
	}
}
