package stripe

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
)

// fakeCreator records its inputs and returns canned outputs. Stubs both
// stripeAPIClient methods (CreateClaimableSandbox + CreateAPIKey) so the
// same fake can be reused across sandbox tests and live-key tests; tests
// that don't exercise CreateAPIKey just leave its fields at zero.
type fakeCreator struct {
	// Sandbox-side fields.
	out *stripeapi.CreateClaimableSandboxResponse
	err error

	callCount   int
	lastIdemKey string
	lastReq     stripeapi.CreateClaimableSandboxRequest

	// API-key-side fields (separate so a sandbox-only test doesn't accidentally
	// trip on a stale apiKeyOut/apiKeyErr from a previous test).
	apiKeyOut       *stripeapi.CreateAPIKeyResponse
	apiKeyErr       error
	apiKeyCalls     int
	apiKeyLastIdem  string
	apiKeyLastCtx   string
	apiKeyLastReq   stripeapi.CreateAPIKeyRequest
	apiKeyResponses map[stripeapi.APIKeyType]*stripeapi.CreateAPIKeyResponse // optional per-type override
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

func (f *fakeCreator) CreateAPIKey(
	_ context.Context,
	idempotencyKey string,
	stripeContext string,
	req stripeapi.CreateAPIKeyRequest,
) (*stripeapi.CreateAPIKeyResponse, error) {
	f.apiKeyCalls++
	f.apiKeyLastIdem = idempotencyKey
	f.apiKeyLastCtx = stripeContext
	f.apiKeyLastReq = req
	if f.apiKeyErr != nil {
		return nil, f.apiKeyErr
	}
	if perType, ok := f.apiKeyResponses[req.Type]; ok && perType != nil {
		return perType, nil
	}
	return f.apiKeyOut, nil
}

func TestNewRealClient_RejectsNil(t *testing.T) {
	if _, err := NewRealClient(nil, nil, nil, nil); err == nil {
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
	rc, err := NewRealClient(fc, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewRealClient: %v", err)
	}

	_, err = rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{
		AppID:          "app-1",
		PrefillEmail:   "airo@godaddy.com",
		PrefillCountry: "us",
	})
	if err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if fc.callCount != 1 {
		t.Errorf("call count: want 1, got %d", fc.callCount)
	}
	if fc.lastIdemKey != "sandbox-app-1" {
		t.Errorf("idempotency key: want sandbox-app-1, got %q", fc.lastIdemKey)
	}
	if fc.lastReq.Prefill == nil {
		t.Fatalf("Prefill: want non-nil")
	}
	// Email and Country come from the operator-configured PrefillEmail/PrefillCountry
	// fields, NOT from the caller. The values here match what was passed in.
	if fc.lastReq.Prefill.Email != "airo@godaddy.com" {
		t.Errorf("Prefill.Email: want operator-configured value, got %q", fc.lastReq.Prefill.Email)
	}
	if fc.lastReq.Prefill.Country != "us" {
		t.Errorf("Prefill.Country: want operator-configured value, got %q", fc.lastReq.Prefill.Country)
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

// Pin: the idempotency key is stable and app-scoped. Two retries for the same
// app must produce the same key so Stripe replays the cached response instead
// of minting a second sandbox. Email is intentionally absent from the key —
// it was removed because accepting a caller-supplied email enabled phishing
// on the Stripe claim flow (see CreateSandboxInput).
func TestRealClient_CreateClaimableSandbox_IdempotencyKeyIsAppScoped(t *testing.T) {
	fc := &fakeCreator{
		out: &stripeapi.CreateClaimableSandboxResponse{ID: "clmsbx_X"},
	}
	rc, err := NewRealClient(fc, nil, nil, nil)
	if err != nil {
		t.Fatalf("NewRealClient: %v", err)
	}
	const wantKey = "sandbox-app-1"
	for i := 0; i < 2; i++ {
		if _, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{
			AppID:          "app-1",
			PrefillEmail:   "airo@godaddy.com",
			PrefillCountry: "us",
		}); err != nil {
			t.Fatalf("call %d: CreateClaimableSandbox: %v", i, err)
		}
		if fc.lastIdemKey != wantKey {
			t.Errorf("call %d: idempotency key: want %q, got %q", i, wantKey, fc.lastIdemKey)
		}
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
	rc, _ := NewRealClient(fc, nil, nil, nil)

	sb, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1", PrefillEmail: "airo@godaddy.com", PrefillCountry: "us"})
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
	rc, _ := NewRealClient(fc, nil, nil, nil)

	_, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1", PrefillEmail: "airo@godaddy.com", PrefillCountry: "us"})
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
	rc, _ := NewRealClient(fc, nil, nil, nil)

	_, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1", PrefillEmail: "airo@godaddy.com", PrefillCountry: "us"})
	if !errors.Is(err, transportErr) {
		t.Errorf("want errors.Is(transportErr), got %v", err)
	}
}

// --- MintLiveAPIKeys ---

// fakePEMFetcher implements pemFetcher for tests.
type fakePEMFetcher struct {
	pem string
	err error
}

func (f *fakePEMFetcher) PEM(_ context.Context) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	return f.pem, nil
}

// fakeJWEDecrypter implements jweDecrypter for tests. Maps the input JWE
// string to a fixed plaintext so tests can set up "decrypt this ciphertext
// → that key" mappings.
type fakeJWEDecrypter struct {
	mapping map[string][]byte
	err     error
}

func (f *fakeJWEDecrypter) Decrypt(_ context.Context, jwe string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if pt, ok := f.mapping[jwe]; ok {
		return pt, nil
	}
	return nil, fmt.Errorf("fakeJWEDecrypter: no mapping for %q", jwe)
}

func TestRealClient_MintLiveAPIKeys_HappyPath(t *testing.T) {
	// Two distinct fakes — one for the test-mode platform client (innerTest,
	// used by CreateClaimableSandbox) and one for the live-mode platform
	// client (innerLive, used by MintLiveAPIKeys). The mint path MUST NOT
	// route any apiKeys.create call to innerTest: doing so would mint live
	// keys against the test platform account (sk_test_* against
	// apiKeys.create returns 401 in live mode, sk_live_* against
	// claimableSandboxes.create is mode-rejected). This test pins the
	// routing invariant — see fcTest.apiKeyCalls assertion below.
	fcLive := &fakeCreator{
		apiKeyResponses: map[stripeapi.APIKeyType]*stripeapi.CreateAPIKeyResponse{
			stripeapi.APIKeyTypeSecret: {
				Type: stripeapi.APIKeyTypeSecret,
				SecretKey: &stripeapi.EncryptedField{
					EncryptedSecret: stripeapi.EncryptedSecret{Ciphertext: "JWE_SECRET"},
				},
			},
			stripeapi.APIKeyTypePublishable: {
				Type:           stripeapi.APIKeyTypePublishable,
				PublishableKey: stripeapi.PublishableKeyValue{Value: "pk_live_merchant_abc"},
			},
			stripeapi.APIKeyTypeMCP: {
				Type: stripeapi.APIKeyTypeMCP,
				MCPKey: &stripeapi.EncryptedField{
					EncryptedSecret: stripeapi.EncryptedSecret{Ciphertext: "JWE_MCP"},
				},
			},
		},
	}
	fcTest := &fakeCreator{}
	pem := &fakePEMFetcher{pem: "-----BEGIN PUBLIC KEY-----\nfake\n-----END PUBLIC KEY-----"}
	dec := &fakeJWEDecrypter{mapping: map[string][]byte{
		"JWE_SECRET": []byte("sk_live_merchant_abc"),
		"JWE_MCP":    []byte("ek_live_merchant_abc"),
	}}
	rc, err := NewRealClient(fcTest, fcLive, pem, dec)
	if err != nil {
		t.Fatalf("NewRealClient: %v", err)
	}

	keys, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount:   "acct_103UBD2K7Tp1dUfp",
		IdempotencyKey: "evt_test_xyz",
	})
	if err != nil {
		t.Fatalf("MintLiveAPIKeys: %v", err)
	}

	if got, want := keys.SecretKey, "sk_live_merchant_abc"; got != want {
		t.Errorf("SecretKey: want %q, got %q", want, got)
	}
	if got, want := keys.PublishableKey, "pk_live_merchant_abc"; got != want {
		t.Errorf("PublishableKey: want %q, got %q", want, got)
	}
	// MCP key is intentionally empty: Stripe's v2.iam.api_keys doesn't yet
	// accept type=mcp_key in live mode (plan §9 Q9). The mint skips the
	// call and returns "" so the caller can omit the MCP op when pushing
	// to hosting; the existing ek_test_* placed at sandbox creation
	// stays in the alloc env. When Stripe enables mcp_key, restore the
	// call in MintLiveAPIKeys and update this test to expect ek_live_*.
	if got := keys.MCPKey; got != "" {
		t.Errorf("MCPKey: want empty (mcp_key step is skipped per plan §9 Q9), got %q", got)
	}

	// Pin: stripeContext is the merchant account, NOT the sandbox account.
	// The orchestrator must pass OwnerAccount through unmodified — passing
	// anything else would mint keys against the wrong account.
	if got, want := fcLive.apiKeyLastCtx, "acct_103UBD2K7Tp1dUfp"; got != want {
		t.Errorf("apiKeyLastCtx: want %q, got %q", want, got)
	}
	// Routing invariant: the mint path uses innerLive only. Two
	// apiKeys.create calls land on the live client (secret + publishable;
	// mcp skipped per plan §9 Q9), and zero land on the test client.
	if got, want := fcLive.apiKeyCalls, 2; got != want {
		t.Errorf("fcLive.apiKeyCalls: want 2 (secret+publishable on innerLive), got %d", got)
	}
	if got := fcTest.apiKeyCalls; got != 0 {
		t.Errorf("fcTest.apiKeyCalls: want 0 (mint path must NOT route to innerTest), got %d", got)
	}
	if got := fcTest.callCount; got != 0 {
		t.Errorf("fcTest.callCount: want 0 (mint path must NOT touch innerTest), got %d", got)
	}
}

func TestRealClient_MintLiveAPIKeys_RejectsEmptyOwnerAccount(t *testing.T) {
	rc, _ := NewRealClient(&fakeCreator{}, &fakeCreator{}, &fakePEMFetcher{pem: "x"}, &fakeJWEDecrypter{})
	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		IdempotencyKey: "evt_x",
	})
	if err == nil {
		t.Errorf("want error for empty OwnerAccount, got nil")
	}
}

func TestRealClient_MintLiveAPIKeys_RejectsEmptyIdempotencyKey(t *testing.T) {
	rc, _ := NewRealClient(&fakeCreator{}, &fakeCreator{}, &fakePEMFetcher{pem: "x"}, &fakeJWEDecrypter{})
	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount: "acct_x",
	})
	if err == nil {
		t.Errorf("want error for empty IdempotencyKey, got nil")
	}
}

func TestRealClient_MintLiveAPIKeys_NilLiveClient_ReturnsError(t *testing.T) {
	// innerLive=nil is permitted at construction (the live platform key may
	// not be populated yet in dev/test envs) but MUST NOT panic when the
	// live-key path is taken — return a clear error so operators know
	// which secret is missing.
	rc, _ := NewRealClient(&fakeCreator{}, nil, &fakePEMFetcher{pem: "x"}, &fakeJWEDecrypter{})
	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount: "acct_x", IdempotencyKey: "evt_x",
	})
	if err == nil {
		t.Errorf("want error for nil live client, got nil")
	}
}

func TestRealClient_MintLiveAPIKeys_NilPEMFetcher_ReturnsError(t *testing.T) {
	// pem=nil is permitted at construction (sandbox-only deployments) but
	// MUST NOT panic when the live-key path is taken — return a clear
	// error instead.
	rc, _ := NewRealClient(&fakeCreator{}, &fakeCreator{}, nil, &fakeJWEDecrypter{})
	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount: "acct_x", IdempotencyKey: "evt_x",
	})
	if err == nil {
		t.Errorf("want error for nil pem fetcher, got nil")
	}
}

func TestRealClient_MintLiveAPIKeys_NilJWEDecrypter_ReturnsError(t *testing.T) {
	rc, _ := NewRealClient(&fakeCreator{}, &fakeCreator{}, &fakePEMFetcher{pem: "x"}, nil)
	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount: "acct_x", IdempotencyKey: "evt_x",
	})
	if err == nil {
		t.Errorf("want error for nil jwe decrypter, got nil")
	}
}

func TestRealClient_MintLiveAPIKeys_PropagatesAPIError(t *testing.T) {
	stripeErr := &stripeapi.StripeError{HTTPStatus: 403, Code: "permission_denied"}
	fcLive := &fakeCreator{apiKeyErr: stripeErr}
	fcTest := &fakeCreator{}
	rc, _ := NewRealClient(fcTest, fcLive, &fakePEMFetcher{pem: "x"}, &fakeJWEDecrypter{})

	_, err := rc.MintLiveAPIKeys(context.Background(), MintLiveAPIKeysInput{
		OwnerAccount: "acct_x", IdempotencyKey: "evt_x",
	})
	if !errors.Is(err, stripeErr) {
		t.Errorf("want errors.Is(stripeErr), got %v", err)
	}
	// Even on the error path, the routing invariant holds: the failed
	// call must have hit innerLive, not innerTest.
	if got := fcTest.apiKeyCalls; got != 0 {
		t.Errorf("fcTest.apiKeyCalls: want 0 on mint-error path, got %d", got)
	}
	if got := fcLive.apiKeyCalls; got != 1 {
		t.Errorf("fcLive.apiKeyCalls: want 1 (short-circuited at first failure), got %d", got)
	}
}

// TestRealClient_CreateClaimableSandbox_RoutesToInnerTest is the inverse of
// the MintLiveAPIKeys routing assertion: the sandbox path must use innerTest
// (the sk_test_* platform client) and never touch innerLive. A swap would
// mint a sandbox against the live platform key, which Stripe rejects in live
// mode.
func TestRealClient_CreateClaimableSandbox_RoutesToInnerTest(t *testing.T) {
	fcTest := &fakeCreator{
		out: &stripeapi.CreateClaimableSandboxResponse{ID: "clmsbx_X"},
	}
	fcLive := &fakeCreator{}
	rc, err := NewRealClient(fcTest, fcLive, nil, nil)
	if err != nil {
		t.Fatalf("NewRealClient: %v", err)
	}

	if _, err := rc.CreateClaimableSandbox(context.Background(), CreateSandboxInput{
		AppID: "app-1",
	}); err != nil {
		t.Fatalf("CreateClaimableSandbox: %v", err)
	}

	if got := fcTest.callCount; got != 1 {
		t.Errorf("fcTest.callCount: want 1 (sandbox lands on innerTest), got %d", got)
	}
	if got := fcLive.callCount; got != 0 {
		t.Errorf("fcLive.callCount: want 0 (sandbox path must NOT touch innerLive), got %d", got)
	}
	if got := fcLive.apiKeyCalls; got != 0 {
		t.Errorf("fcLive.apiKeyCalls: want 0 on sandbox path, got %d", got)
	}
}
