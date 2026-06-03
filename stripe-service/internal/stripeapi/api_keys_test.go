package stripeapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

const fakePEM = "-----BEGIN PUBLIC KEY-----\nMIIBIj...\n-----END PUBLIC KEY-----\n"

func TestCreateAPIKey_SecretKeyRequestRoundTrip(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_secret","type":"secret_key","secret_key":{"encrypted_secret":{"ciphertext":"hdr.cek.iv.ct.tag"}}}`)

	resp, err := c.CreateAPIKey(
		context.Background(),
		"evt_rotated_001",
		"acct_merchant_xyz",
		CreateAPIKeyRequest{
			Type: APIKeyTypeSecret,
			Name: "GoDaddy Airo App key",
			PublicKey: &PublicKey{
				PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"},
			},
		},
	)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}

	if got.Path != "/v2/iam/api_keys" {
		t.Errorf("path: want /v2/iam/api_keys, got %q", got.Path)
	}
	if got.Idempotency != "evt_rotated_001" {
		t.Errorf("Idempotency-Key: want evt_rotated_001, got %q", got.Idempotency)
	}
	if got.StripeContext != "acct_merchant_xyz" {
		t.Errorf("Stripe-Context: want acct_merchant_xyz, got %q", got.StripeContext)
	}

	// Body shape — round-trip through Unmarshal to catch field-name typos.
	var parsed struct {
		Type      string `json:"type"`
		Name      string `json:"name"`
		PublicKey *struct {
			PEMKey struct {
				Data      string `json:"data"`
				Algorithm string `json:"algorithm"`
			} `json:"pem_key"`
		} `json:"public_key"`
	}
	if err := json.Unmarshal(got.Body, &parsed); err != nil {
		t.Fatalf("unmarshal: %v (raw=%q)", err, string(got.Body))
	}
	if parsed.Type != "secret_key" {
		t.Errorf("type: want secret_key, got %q", parsed.Type)
	}
	if parsed.PublicKey == nil {
		t.Fatalf("public_key missing (raw=%q)", string(got.Body))
	}
	if parsed.PublicKey.PEMKey.Data != fakePEM {
		t.Errorf("pem_key.data didn't round-trip; got %q", parsed.PublicKey.PEMKey.Data)
	}
	if parsed.PublicKey.PEMKey.Algorithm != "RSA" {
		t.Errorf("pem_key.algorithm: want RSA, got %q", parsed.PublicKey.PEMKey.Algorithm)
	}

	// Response shape — JWE round-trip.
	if resp.SecretKey == nil {
		t.Fatalf("resp.SecretKey missing")
	}
	if resp.SecretKey.EncryptedSecret.Ciphertext != "hdr.cek.iv.ct.tag" {
		t.Errorf("ciphertext: want hdr.cek.iv.ct.tag, got %q", resp.SecretKey.EncryptedSecret.Ciphertext)
	}
}

func TestCreateAPIKey_PublishableKeyOmitsPublicKey(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_pub","type":"publishable_key","publishable_key":"pk_live_abc"}`)

	resp, err := c.CreateAPIKey(
		context.Background(),
		"k",
		"acct_x",
		CreateAPIKeyRequest{Type: APIKeyTypePublishable},
	)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}

	// `omitempty` on PublicKey: the marshaled body must not contain the
	// public_key field at all.
	if strings.Contains(string(got.Body), `"public_key"`) {
		t.Errorf("publishable request should not contain public_key; got %q", string(got.Body))
	}
	if resp.PublishableKey.Value != "pk_live_abc" {
		t.Errorf("PublishableKey: want pk_live_abc, got %q", resp.PublishableKey.Value)
	}
	if resp.SecretKey != nil {
		t.Errorf("SecretKey: want nil for publishable_key response, got %+v", resp.SecretKey)
	}
}

func TestCreateAPIKey_PublishableKey_AcceptsWrappedObjectShape(t *testing.T) {
	// Stripe's preview API (observed against API version 2026-03-25.dahlia
	// in live mode on 2026-05-28) returns publishable_key as a single-key
	// wrapper object rather than a bare string. Pin acceptance of the
	// wrapped shape so the JSON unmarshal succeeds end-to-end.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_pub","type":"publishable_key","publishable_key":{"key":"pk_live_wrapped_xyz"}}`)

	resp, err := c.CreateAPIKey(
		context.Background(),
		"k",
		"acct_x",
		CreateAPIKeyRequest{Type: APIKeyTypePublishable},
	)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if resp.PublishableKey.Value != "pk_live_wrapped_xyz" {
		t.Errorf("PublishableKey.Value: want pk_live_wrapped_xyz, got %q", resp.PublishableKey.Value)
	}
}

func TestPublishableKeyValue_UnmarshalJSON_BareString(t *testing.T) {
	var p PublishableKeyValue
	if err := p.UnmarshalJSON([]byte(`"pk_live_abc"`)); err != nil {
		t.Fatalf("unmarshal bare string: %v", err)
	}
	if p.Value != "pk_live_abc" {
		t.Errorf("Value: want pk_live_abc, got %q", p.Value)
	}
}

func TestPublishableKeyValue_UnmarshalJSON_WrappedObject(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		// "token" is the actual shape Stripe ships in live mode against
		// API version 2026-03-25.dahlia (observed 2026-05-28). Pin
		// first so a future regression on the lookup order shows up
		// in this test before it shows up in production.
		{"token field (live mode shape)", `{"token":"pk_live_real"}`, "pk_live_real"},
		{"key field", `{"key":"pk_live_a"}`, "pk_live_a"},
		{"value field", `{"value":"pk_live_b"}`, "pk_live_b"},
		{"publishable_key field", `{"publishable_key":"pk_live_c"}`, "pk_live_c"},
		{"plaintext field", `{"plaintext":"pk_live_d"}`, "pk_live_d"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var p PublishableKeyValue
			if err := p.UnmarshalJSON([]byte(tc.in)); err != nil {
				t.Fatalf("unmarshal %q: %v", tc.in, err)
			}
			if p.Value != tc.want {
				t.Errorf("Value: want %q, got %q", tc.want, p.Value)
			}
		})
	}
}

func TestPublishableKeyValue_UnmarshalJSON_UnknownShapeReturnsErrorWithRaw(t *testing.T) {
	// Critical for diagnosability: when Stripe rotates the schema again,
	// the error must include the raw bytes so an oncall can grep for the
	// new field name without reproducing the failure.
	var p PublishableKeyValue
	err := p.UnmarshalJSON([]byte(`{"unexpected_field":"pk_live_xyz"}`))
	if err == nil {
		t.Fatalf("want error for unknown object shape, got nil")
	}
	if !strings.Contains(err.Error(), "unexpected_field") {
		t.Errorf("error must include raw bytes for diagnosability; got %q", err.Error())
	}
}

func TestCreateAPIKey_McpKeyRequestRoundTrip(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_mcp","type":"mcp_key","mcp_key":{"encrypted_secret":{"ciphertext":"jwe.for.mcp.live.key"}}}`)

	resp, err := c.CreateAPIKey(
		context.Background(),
		"evt_mcp_001",
		"acct_merchant_xyz",
		CreateAPIKeyRequest{
			Type:      APIKeyTypeMCP,
			PublicKey: &PublicKey{PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"}},
		},
	)
	if err != nil {
		t.Fatalf("CreateAPIKey: %v", err)
	}
	if resp.MCPKey == nil {
		t.Fatalf("resp.MCPKey missing for mcp_key response")
	}
	if resp.MCPKey.EncryptedSecret.Ciphertext != "jwe.for.mcp.live.key" {
		t.Errorf("mcp ciphertext didn't round-trip; got %q", resp.MCPKey.EncryptedSecret.Ciphertext)
	}
}

func TestCreateAPIKey_RejectsEmptyIdempotencyKey(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.CreateAPIKey(context.Background(), "", "acct_x", CreateAPIKeyRequest{Type: APIKeyTypePublishable})
	if err == nil {
		t.Fatalf("want error for empty idempotencyKey, got nil")
	}
	if !strings.Contains(err.Error(), "idempotencyKey") {
		t.Errorf("error should mention idempotencyKey; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsEmptyStripeContext(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.CreateAPIKey(context.Background(), "k", "", CreateAPIKeyRequest{Type: APIKeyTypePublishable})
	if err == nil {
		t.Fatalf("want error for empty stripeContext, got nil")
	}
	if !strings.Contains(err.Error(), "stripeContext") {
		t.Errorf("error should mention stripeContext; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsInvalidType(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type: APIKeyType("not_a_real_type"),
	})
	if err == nil {
		t.Fatalf("want error for invalid type, got nil")
	}
	if !strings.Contains(err.Error(), "invalid type") {
		t.Errorf("error should mention invalid type; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsSecretKeyWithoutPEM(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type: APIKeyTypeSecret,
		// No PublicKey
	})
	if err == nil {
		t.Fatalf("want error for secret_key without PEM, got nil")
	}
	if !strings.Contains(err.Error(), "PublicKey") {
		t.Errorf("error should mention PublicKey; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsPublishableKeyWithPEM(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type:      APIKeyTypePublishable,
		PublicKey: &PublicKey{PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"}},
	})
	if err == nil {
		t.Fatalf("want error for publishable_key with PEM, got nil")
	}
	if !strings.Contains(err.Error(), "publishable_key") {
		t.Errorf("error should mention publishable_key; got %q", err.Error())
	}
}

func TestCreateAPIKey_PropagatesStripeError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusUnauthorized,
		`{"error":{"type":"authentication_error","code":"api_key_expired","message":"API key has expired."}}`)

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type:      APIKeyTypeSecret,
		PublicKey: &PublicKey{PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"}},
	})
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.HTTPStatus != 401 {
		t.Errorf("HTTPStatus: want 401, got %d", se.HTTPStatus)
	}
	if se.Code != "api_key_expired" {
		t.Errorf("Code: want api_key_expired, got %q", se.Code)
	}
}

// --- post-decode invariants (PR #3735 review fix) ---

func TestCreateAPIKey_RejectsPublishableResponseMissingKey(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_pub","type":"publishable_key"}`) // no publishable_key field

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{Type: APIKeyTypePublishable})
	if err == nil {
		t.Fatalf("want error for missing publishable_key, got nil")
	}
	if !strings.Contains(err.Error(), "publishable_key") {
		t.Errorf("error should mention publishable_key; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsSecretResponseMissingCiphertext(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_secret","type":"secret_key"}`) // no secret_key field

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type:      APIKeyTypeSecret,
		PublicKey: &PublicKey{PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"}},
	})
	if err == nil {
		t.Fatalf("want error for missing secret_key.encrypted_secret.ciphertext, got nil")
	}
	if !strings.Contains(err.Error(), "ciphertext") {
		t.Errorf("error should mention ciphertext; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsMCPResponseMissingCiphertext(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_mcp","type":"mcp_key","mcp_key":{"encrypted_secret":{"ciphertext":""}}}`)

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{
		Type:      APIKeyTypeMCP,
		PublicKey: &PublicKey{PEMKey: PEMKey{Data: fakePEM, Algorithm: "RSA"}},
	})
	if err == nil {
		t.Fatalf("want error for empty mcp_key ciphertext, got nil")
	}
	if !strings.Contains(err.Error(), "ciphertext") {
		t.Errorf("error should mention ciphertext; got %q", err.Error())
	}
}

func TestCreateAPIKey_RejectsResponseWithUnexpectedType(t *testing.T) {
	// Stripe (or a misconfigured proxy) returning a type field that
	// doesn't match any of our known constants.
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK,
		`{"id":"ak_x","type":"future_unknown_type"}`)

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{Type: APIKeyTypePublishable})
	if err == nil {
		t.Fatalf("want error for unexpected response type, got nil")
	}
	if !strings.Contains(err.Error(), "unexpected type") {
		t.Errorf("error should mention 'unexpected type'; got %q", err.Error())
	}
}

func TestCreateAPIKey_PropagatesDecodeError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, `not json`)

	_, err := c.CreateAPIKey(context.Background(), "k", "acct_x", CreateAPIKeyRequest{Type: APIKeyTypePublishable})
	if err == nil {
		t.Fatalf("want decode error, got nil")
	}
	if !strings.Contains(err.Error(), "decode response") {
		t.Errorf("error should mention 'decode response'; got %q", err.Error())
	}
}
