package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestCreateClaimableSandbox_SendsExpectedRequest(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"clmsbx_abc","sandbox_details":{"account":"acct_test_xyz","api_keys":{"secret":"sk_test_x","publishable":"pk_test_y","mcp":"ek_test_z"}},"onboarding_link_details":{"url":"https://stripe.com/claim/abc"}}`)

	resp, err := c.CreateClaimableSandbox(context.Background(), "sandbox-app-1", CreateClaimableSandboxRequest{
		AppChannel: "testing",
		OnboardingLinkDetails: &OnboardingLinkDetails{
			RefreshURL: "https://airo-builder.godaddy.com",
		},
		Prefill: &SandboxPrefill{
			Email:   "merchant@example.com",
			Country: "us",
			Name:    "GoDaddy Airo App: app-1",
		},
		EnableMcpAccess: true,
	})
	if err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if got.Method != http.MethodPost {
		t.Errorf("method: want POST, got %s", got.Method)
	}
	if got.Path != "/v2/core/claimable_sandboxes" {
		t.Errorf("path: want /v2/core/claimable_sandboxes, got %q", got.Path)
	}
	if got.Idempotency != "sandbox-app-1" {
		t.Errorf("Idempotency-Key: want sandbox-app-1, got %q", got.Idempotency)
	}
	if got.StripeContext != "" {
		t.Errorf("Stripe-Context: want absent, got %q", got.StripeContext)
	}

	// Round-trip the body through json.Unmarshal so accidental field-name
	// typos (e.g. `app_channel` → `appChannel`) surface as failed assertions
	// instead of silently passing.
	var bodyParsed struct {
		AppChannel            string                 `json:"app_channel"`
		OnboardingLinkDetails *OnboardingLinkDetails `json:"onboarding_link_details"`
		Prefill               *SandboxPrefill        `json:"prefill"`
		EnableMcpAccess       bool                   `json:"enable_mcp_access"`
	}
	if err := json.Unmarshal(got.Body, &bodyParsed); err != nil {
		t.Fatalf("unmarshal sent body: %v (raw=%q)", err, string(got.Body))
	}
	if bodyParsed.AppChannel != "testing" {
		t.Errorf("app_channel: want testing, got %q", bodyParsed.AppChannel)
	}
	if bodyParsed.OnboardingLinkDetails == nil {
		t.Fatalf("body.onboarding_link_details missing (raw=%q)", string(got.Body))
	}
	if bodyParsed.OnboardingLinkDetails.RefreshURL != "https://airo-builder.godaddy.com" {
		t.Errorf("onboarding_link_details.refresh_url: want %q, got %q",
			"https://airo-builder.godaddy.com", bodyParsed.OnboardingLinkDetails.RefreshURL)
	}
	if bodyParsed.Prefill == nil {
		t.Fatalf("body.prefill missing (raw=%q)", string(got.Body))
	}
	if bodyParsed.Prefill.Email != "merchant@example.com" {
		t.Errorf("prefill.email: want merchant@example.com, got %q", bodyParsed.Prefill.Email)
	}
	if bodyParsed.Prefill.Country != "us" {
		t.Errorf("prefill.country: want us, got %q", bodyParsed.Prefill.Country)
	}
	if bodyParsed.Prefill.Name != "GoDaddy Airo App: app-1" {
		t.Errorf("prefill.name: want %q, got %q", "GoDaddy Airo App: app-1", bodyParsed.Prefill.Name)
	}
	if !bodyParsed.EnableMcpAccess {
		t.Errorf("enable_mcp_access: want true, got false")
	}

	// Response shape
	if resp.ID != "clmsbx_abc" {
		t.Errorf("resp.ID: want clmsbx_abc, got %q", resp.ID)
	}
	if resp.SandboxDetails.Account != "acct_test_xyz" {
		t.Errorf("resp.SandboxDetails.Account: want acct_test_xyz, got %q", resp.SandboxDetails.Account)
	}
	if resp.SandboxDetails.APIKeys.Secret != "sk_test_x" {
		t.Errorf("resp.SandboxDetails.APIKeys.Secret: want sk_test_x, got %q", resp.SandboxDetails.APIKeys.Secret)
	}
	if resp.SandboxDetails.APIKeys.MCP != "ek_test_z" {
		t.Errorf("resp.SandboxDetails.APIKeys.MCP: want ek_test_z, got %q", resp.SandboxDetails.APIKeys.MCP)
	}
	if !strings.HasPrefix(resp.OnboardingLinkDetails.URL, "https://stripe.com/claim/") {
		t.Errorf("resp.OnboardingLinkDetails.URL: want https://stripe.com/claim/ prefix, got %q", resp.OnboardingLinkDetails.URL)
	}
}

func TestCreateClaimableSandbox_OmitsPrefillWhenNil(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"clmsbx_abc","sandbox_details":{"account":"a","api_keys":{"secret":"s","publishable":"p","mcp":"m"}},"onboarding_link_details":{"url":"u"}}`)

	if _, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{
		Prefill:         nil,
		EnableMcpAccess: false,
	}); err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if strings.Contains(string(got.Body), `"prefill"`) {
		t.Errorf("prefill should be omitted when nil; got body %q", string(got.Body))
	}
}

func TestCreateClaimableSandbox_OmitsAppChannelWhenEmpty(t *testing.T) {
	// Locks in the `omitempty` JSON tag on AppChannel — Stripe rejects
	// an empty `app_channel` string (it's not a documented value), so
	// callers that don't set the field should produce a body without it.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"clmsbx_abc","sandbox_details":{"account":"a","api_keys":{"secret":"s","publishable":"p","mcp":"m"}},"onboarding_link_details":{"url":"u"}}`)

	if _, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{
		AppChannel: "",
	}); err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if strings.Contains(string(got.Body), `"app_channel"`) {
		t.Errorf("app_channel should be omitted when empty; got body %q", string(got.Body))
	}
}

func TestCreateClaimableSandbox_OmitsOnboardingLinkDetailsWhenNil(t *testing.T) {
	// Locks in the `omitempty` JSON tag on OnboardingLinkDetails — a
	// `{}` would be ambiguous to Stripe (and is exactly the shape the
	// 2026-04-22 preview no longer tolerates from us when refresh_url
	// is absent), so a nil pointer must produce no key at all.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"clmsbx_abc","sandbox_details":{"account":"a","api_keys":{"secret":"s","publishable":"p","mcp":"m"}},"onboarding_link_details":{"url":"u"}}`)

	if _, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{
		OnboardingLinkDetails: nil,
	}); err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if strings.Contains(string(got.Body), `"onboarding_link_details"`) {
		t.Errorf("onboarding_link_details should be omitted when nil; got body %q", string(got.Body))
	}
}

func TestCreateClaimableSandbox_RejectsEmptyIdempotencyKey(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x", BaseURL: "https://stripe.example.com"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.CreateClaimableSandbox(context.Background(), "", CreateClaimableSandboxRequest{})
	if err == nil {
		t.Fatalf("want error for empty idempotency key, got nil")
	}
	if !strings.Contains(err.Error(), "idempotencyKey") {
		t.Errorf("error should mention idempotencyKey; got %q", err.Error())
	}
}

func TestCreateClaimableSandbox_PropagatesStripeError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusBadRequest,
		`{"error":{"type":"invalid_request_error","code":"already_exists","message":"sandbox exists"}}`)

	_, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{})
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.Code != "already_exists" {
		t.Errorf("Code: want already_exists, got %q", se.Code)
	}
}

// --- post-decode invariants (PR #3735 review fix) ---

func TestCreateClaimableSandbox_RejectsResponseMissingID(t *testing.T) {
	// 2xx with `{}` would otherwise propagate an empty sandbox_id
	// downstream and look like a successful sandbox creation.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{}`)

	_, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{})
	if err == nil {
		t.Fatalf("want error for response missing id, got nil")
	}
	if !strings.Contains(err.Error(), "missing id") {
		t.Errorf("error should mention 'missing id'; got %q", err.Error())
	}
}

// Pin the post-decode invariants. Each entry is a 2xx body that's structurally
// valid JSON but missing a load-bearing field. The adapter MUST reject at the
// boundary so the handler never persists an unusable sandbox row (e.g. empty
// claim URL leaves the user with a non-functional claim link; missing api_keys
// would silently break the eventual mhp-airo push that delivers STRIPE_MCP_KEY
// to the agent).
func TestCreateClaimableSandbox_RejectsResponseMissingLoadBearingField(t *testing.T) {
	cases := []struct {
		name      string
		body      string
		errSubstr string
	}{
		{
			name:      "missing sandbox_details.account",
			body:      `{"id":"clmsbx_x","sandbox_details":{"api_keys":{"secret":"sk","publishable":"pk","mcp":"ek"}},"onboarding_link_details":{"url":"https://x"}}`,
			errSubstr: "missing sandbox_details.account",
		},
		{
			name:      "missing sandbox_details.api_keys.secret",
			body:      `{"id":"clmsbx_x","sandbox_details":{"account":"acct_x","api_keys":{"publishable":"pk","mcp":"ek"}},"onboarding_link_details":{"url":"https://x"}}`,
			errSubstr: "missing sandbox_details.api_keys.secret",
		},
		{
			name:      "missing sandbox_details.api_keys.publishable",
			body:      `{"id":"clmsbx_x","sandbox_details":{"account":"acct_x","api_keys":{"secret":"sk","mcp":"ek"}},"onboarding_link_details":{"url":"https://x"}}`,
			errSubstr: "missing sandbox_details.api_keys.publishable",
		},
		{
			name:      "missing sandbox_details.api_keys.mcp",
			body:      `{"id":"clmsbx_x","sandbox_details":{"account":"acct_x","api_keys":{"secret":"sk","publishable":"pk"}},"onboarding_link_details":{"url":"https://x"}}`,
			errSubstr: "missing sandbox_details.api_keys.mcp",
		},
		{
			name:      "missing onboarding_link_details.url",
			body:      `{"id":"clmsbx_x","sandbox_details":{"account":"acct_x","api_keys":{"secret":"sk","publishable":"pk","mcp":"ek"}}}`,
			errSubstr: "missing onboarding_link_details.url",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var got recordedRequest
			client, _ := newFakeServer(t, &got, http.StatusOK, c.body)

			_, err := client.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{})
			if err == nil {
				t.Fatalf("want error, got nil")
			}
			if !strings.Contains(err.Error(), c.errSubstr) {
				t.Errorf("error should mention %q; got %q", c.errSubstr, err.Error())
			}
		})
	}
}

func TestCreateClaimableSandbox_PropagatesDecodeError(t *testing.T) {
	// 2xx + non-JSON body should surface as a decode error, not a
	// silent zero-valued response.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `not json`)

	_, err := c.CreateClaimableSandbox(context.Background(), "k", CreateClaimableSandboxRequest{})
	if err == nil {
		t.Fatalf("want decode error, got nil")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Errorf("error should mention 'decode response'; got %q", err.Error())
	}
}

// --- RenewOnboardingLink HTTP tests ---

func TestRenewOnboardingLink_SendsExpectedRequest(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"onboarding_link_details":{"url":"https://stripe.com/claim/renewed","expires_at":"2026-05-25T00:00:00.000Z"}}`)

	resp, err := c.RenewOnboardingLink(context.Background(), "renew-clmsbx_abc-2026-05-18T00:00:00Z", "clmsbx_abc",
		RenewOnboardingLinkRequest{
			OnboardingLinkDetails: &OnboardingLinkDetails{
				RefreshURL: "https://airo-builder.godaddy.com",
			},
		})
	if err != nil {
		t.Fatalf("RenewOnboardingLink: %v", err)
	}

	if got.Method != http.MethodPost {
		t.Errorf("method: want POST, got %s", got.Method)
	}
	wantPath := "/v2/core/claimable_sandboxes/clmsbx_abc/renew_onboarding_link"
	if got.Path != wantPath {
		t.Errorf("path: want %q, got %q", wantPath, got.Path)
	}
	if got.Idempotency != "renew-clmsbx_abc-2026-05-18T00:00:00Z" {
		t.Errorf("Idempotency-Key: want renew-clmsbx_abc-2026-05-18T00:00:00Z, got %q", got.Idempotency)
	}
	if got.StripeContext != "" {
		t.Errorf("Stripe-Context: want absent (sandbox ops use platform key, not merchant context), got %q", got.StripeContext)
	}

	var bodyParsed struct {
		OnboardingLinkDetails *OnboardingLinkDetails `json:"onboarding_link_details"`
	}
	if err := json.Unmarshal(got.Body, &bodyParsed); err != nil {
		t.Fatalf("unmarshal sent body: %v (raw=%q)", err, string(got.Body))
	}
	if bodyParsed.OnboardingLinkDetails == nil {
		t.Fatalf("body.onboarding_link_details missing (raw=%q)", string(got.Body))
	}
	if bodyParsed.OnboardingLinkDetails.RefreshURL != "https://airo-builder.godaddy.com" {
		t.Errorf("onboarding_link_details.refresh_url: want %q, got %q",
			"https://airo-builder.godaddy.com", bodyParsed.OnboardingLinkDetails.RefreshURL)
	}

	// Response shape
	if resp.OnboardingLinkDetails.URL != "https://stripe.com/claim/renewed" {
		t.Errorf("resp.OnboardingLinkDetails.URL: want https://stripe.com/claim/renewed, got %q",
			resp.OnboardingLinkDetails.URL)
	}
	if resp.OnboardingLinkDetails.ExpiresAt != "2026-05-25T00:00:00.000Z" {
		t.Errorf("resp.OnboardingLinkDetails.ExpiresAt: want 2026-05-25T00:00:00.000Z, got %q",
			resp.OnboardingLinkDetails.ExpiresAt)
	}
}

func TestRenewOnboardingLink_RejectsEmptyIdempotencyKey(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x", BaseURL: "https://stripe.example.com"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.RenewOnboardingLink(context.Background(), "", "clmsbx_abc", RenewOnboardingLinkRequest{})
	if err == nil {
		t.Fatalf("want error for empty idempotency key, got nil")
	}
	if !strings.Contains(err.Error(), "idempotencyKey") {
		t.Errorf("error should mention idempotencyKey; got %q", err.Error())
	}
}

func TestRenewOnboardingLink_RejectsEmptySandboxID(t *testing.T) {
	c, err := New(Config{APIKey: "sk_test_x", BaseURL: "https://stripe.example.com"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	_, err = c.RenewOnboardingLink(context.Background(), "some-key", "", RenewOnboardingLinkRequest{})
	if err == nil {
		t.Fatalf("want error for empty sandboxID, got nil")
	}
	if !strings.Contains(err.Error(), "sandboxID") {
		t.Errorf("error should mention sandboxID; got %q", err.Error())
	}
}

func TestRenewOnboardingLink_ReturnsErrorWhenURLMissing(t *testing.T) {
	// A 2xx that decodes to a response with no onboarding_link_details.url
	// must be rejected — callers depend on the URL being populated.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `{"onboarding_link_details":{}}`)

	_, err := c.RenewOnboardingLink(context.Background(), "k", "clmsbx_abc", RenewOnboardingLinkRequest{})
	if err == nil {
		t.Fatalf("want error for missing url, got nil")
	}
	if !strings.Contains(err.Error(), "missing onboarding_link_details.url") {
		t.Errorf("error should mention missing url; got %q", err.Error())
	}
}

func TestRenewOnboardingLink_PropagatesStripeError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusNotFound,
		`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"sandbox not found"}}`)

	_, err := c.RenewOnboardingLink(context.Background(), "k", "clmsbx_missing", RenewOnboardingLinkRequest{})
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.Code != "resource_missing" {
		t.Errorf("Code: want resource_missing, got %q", se.Code)
	}
}
