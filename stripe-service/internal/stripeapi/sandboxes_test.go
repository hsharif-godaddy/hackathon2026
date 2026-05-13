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
		`{"id":"clmsbx_abc","account":{"id":"acct_test_xyz"},"api_keys":{"secret":"sk_test_x","publishable":"pk_test_y","mcp":"ek_test_z"},"claim_url":"https://stripe.com/claim/abc"}`)

	resp, err := c.CreateClaimableSandbox(context.Background(), "sandbox-app-1", CreateClaimableSandboxRequest{
		Prefill:         &SandboxPrefill{Email: "merchant@example.com", Country: "US"},
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
	// typos surface as failed assertions instead of silently passing.
	var bodyParsed struct {
		Prefill         *SandboxPrefill `json:"prefill"`
		EnableMcpAccess bool            `json:"enable_mcp_access"`
	}
	if err := json.Unmarshal(got.Body, &bodyParsed); err != nil {
		t.Fatalf("unmarshal sent body: %v (raw=%q)", err, string(got.Body))
	}
	if bodyParsed.Prefill == nil {
		t.Fatalf("body.prefill missing (raw=%q)", string(got.Body))
	}
	if bodyParsed.Prefill.Email != "merchant@example.com" {
		t.Errorf("prefill.email: want merchant@example.com, got %q", bodyParsed.Prefill.Email)
	}
	if !bodyParsed.EnableMcpAccess {
		t.Errorf("enable_mcp_access: want true, got false")
	}

	// Response shape
	if resp.ID != "clmsbx_abc" {
		t.Errorf("resp.ID: want clmsbx_abc, got %q", resp.ID)
	}
	if resp.Account.ID != "acct_test_xyz" {
		t.Errorf("resp.Account.ID: want acct_test_xyz, got %q", resp.Account.ID)
	}
	if resp.APIKeys.Secret != "sk_test_x" {
		t.Errorf("resp.APIKeys.Secret: want sk_test_x, got %q", resp.APIKeys.Secret)
	}
	if resp.APIKeys.MCP != "ek_test_z" {
		t.Errorf("resp.APIKeys.MCP: want ek_test_z, got %q", resp.APIKeys.MCP)
	}
	if !strings.HasPrefix(resp.ClaimURL, "https://stripe.com/claim/") {
		t.Errorf("resp.ClaimURL: want https://stripe.com/claim/ prefix, got %q", resp.ClaimURL)
	}
}

func TestCreateClaimableSandbox_OmitsPrefillWhenNil(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"clmsbx_abc","account":{"id":"a"},"api_keys":{"secret":"s","publishable":"p","mcp":"m"},"claim_url":"u"}`)

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
