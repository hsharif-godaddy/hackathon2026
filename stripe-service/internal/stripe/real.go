package stripe

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/gdcorp-partners/airo-app-builder/stripe-service/internal/stripeapi"
)

// expectedKeyPrefix maps APIKeyType to the plaintext prefix the decrypted
// (or in publishable's case, plaintext) value should carry. Used in
// breadcrumb logging to confirm shape without leaking the full value.
//
//	secret    → sk_live_
//	publishable → pk_live_
//	mcp       → ek_live_
//
// Test mode would carry _test_ but apiKeys.create is live-mode-only —
// any other prefix is a Stripe-side surprise worth flagging.
var expectedKeyPrefix = map[stripeapi.APIKeyType]string{
	stripeapi.APIKeyTypeSecret:      "sk_live_",
	stripeapi.APIKeyTypePublishable: "pk_live_",
	stripeapi.APIKeyTypeMCP:         "ek_live_",
}

// liveKeysLog is the slog key prefix for all live-key minting breadcrumbs.
// Centralized so a future rename surfaces in one spot rather than scattered
// string literals.
const liveKeysLog = "stripe_service.live_keys"

// stripeErrorAttrs pulls structured fields off a *stripeapi.StripeError for
// slog. Returns an empty slice when err is not a StripeError so callers can
// always splat the result into slog.Error/Warn args. The fields are emitted
// at well-known slog keys (stripe.httpStatus / stripe.type / stripe.code)
// so dashboards can filter by them without needing to parse the wrapped
// error message.
func stripeErrorAttrs(err error) []any {
	var se *stripeapi.StripeError
	if !errors.As(err, &se) {
		return nil
	}
	return []any{
		"stripe.httpStatus", se.HTTPStatus,
		"stripe.type", se.Type,
		"stripe.code", se.Code,
		"stripe.message", se.Message,
		"stripe.retryable", se.IsRetryable(),
	}
}

// jweHeaderForLog decodes and returns the protected header of a JWE compact
// serialization (the first base64url segment, before the first dot). The
// header is non-secret — it announces alg/enc, not key material — so
// logging it on decrypt failure is safe and surfaces algorithm-mismatch
// bugs (e.g. Stripe shipping RSA-OAEP-256 when we expect RSA-OAEP). Returns
// an empty map and a parse error if the JWE is malformed.
func jweHeaderForLog(jwe string) (map[string]any, error) {
	parts := strings.SplitN(jwe, ".", 2)
	if len(parts) < 2 || parts[0] == "" {
		return nil, errors.New("jwe: missing header segment")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("jwe: decode header: %w", err)
	}
	var hdr map[string]any
	if err := json.Unmarshal(raw, &hdr); err != nil {
		return nil, fmt.Errorf("jwe: parse header: %w", err)
	}
	return hdr, nil
}

// stripeAPIClient is the slice of *stripeapi.Client this package needs.
// Production wiring (in cmd/server/main.go) passes the real *stripeapi.Client;
// tests inject a fake implementation. Same narrow-interface pattern as
// hosting.tokenMinter / kmspubkey.keyFetcher.
type stripeAPIClient interface {
	CreateClaimableSandbox(
		ctx context.Context,
		idempotencyKey string,
		req stripeapi.CreateClaimableSandboxRequest,
	) (*stripeapi.CreateClaimableSandboxResponse, error)

	CreateAPIKey(
		ctx context.Context,
		idempotencyKey string,
		stripeContext string,
		req stripeapi.CreateAPIKeyRequest,
	) (*stripeapi.CreateAPIKeyResponse, error)
}

// pemFetcher is the public-key half of the JWE round trip: Stripe wraps the
// CEK against the PEM we pass on the apiKeys.create request. internal/
// kmspubkey.Cache satisfies this; tests pass a fake.
type pemFetcher interface {
	PEM(ctx context.Context) (string, error)
}

// jweDecrypter is the symmetric-decrypt half: KMS unwraps the wrapped CEK,
// then AES-256-GCM-decrypts the content. internal/jwedecrypt.Decrypter
// satisfies this; tests pass a fake.
type jweDecrypter interface {
	Decrypt(ctx context.Context, jwe string) ([]byte, error)
}

// RealClient implements Client by translating to/from the stripeapi
// package's request and response shapes and orchestrating the JWE pipeline
// (apiKeys.create → KMS pubkey for the request → KMS+AES decrypt for the
// response) for live-mode credentials.
//
// Two stripeAPIClient instances are held because Stripe's preview APIs are
// mode-scoped: claimableSandboxes.create exists only in test mode, so it
// requires a sk_test platform key; apiKeys.create against a claimed live
// merchant requires a sk_live platform key. The same merchant lifecycle
// touches both endpoints, so production wiring constructs two clients —
// one per mode — and routes per operation. See plan §4.2.1.
//
// The handler at internal/api/sandboxes.go and internal/api/webhook.go
// depend only on the Client interface, so swapping FakeClient for
// RealClient is a one-line change in main.go.
type RealClient struct {
	innerTest stripeAPIClient // sk_test_<platform>; CreateClaimableSandbox
	innerLive stripeAPIClient // sk_live_<platform>; MintLiveAPIKeys (may be nil if not exercising the live-key flow)
	pem       pemFetcher
	decrypt   jweDecrypter
}

// Compile-time check that RealClient satisfies Client.
var _ Client = (*RealClient)(nil)

// NewRealClient validates dependencies and returns a RealClient. innerTest is
// always required (CreateClaimableSandbox runs in test mode in every env).
// innerLive, pem, and decrypt are required for MintLiveAPIKeys; nil is
// permitted only when the deployment doesn't exercise live-key minting (e.g.
// dev environments where the live platform key isn't populated yet) —
// MintLiveAPIKeys returns an error explaining the missing dependency rather
// than panicking. CreateClaimableSandbox doesn't touch any of them.
func NewRealClient(innerTest, innerLive stripeAPIClient, pem pemFetcher, decrypt jweDecrypter) (*RealClient, error) {
	if innerTest == nil {
		return nil, errors.New("stripe.NewRealClient: innerTest stripeAPIClient is required")
	}
	return &RealClient{innerTest: innerTest, innerLive: innerLive, pem: pem, decrypt: decrypt}, nil
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
// flow through to the alloc env via the hosting service. A future
// caller that doesn't need MCP would justify a dedicated method, not a
// flag here.
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

	resp, err := r.innerTest.CreateClaimableSandbox(ctx, idempotencyKey, req)
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

// MintLiveAPIKeys issues two v2.iam.api_keys.create calls (secret,
// publishable) scoped to the merchant's account_id, JWE-decrypts the secret
// response, and returns plaintext keys ready to push into the alloc env via
// hosting. MCPKey is intentionally empty in live mode — see the
// mcp_key.skipped Warn block below for the Stripe-side gap.
//
// Failure modes are explicit: any apiKeys.create error short-circuits — we
// don't push partial credentials into the alloc env. The caller (webhook
// handler) is responsible for logging and either alerting or queueing a
// retry. The sandbox's claim_status was already advanced to "live" with
// liveAccountId set before this method is called, so the dedup row blocks
// webhook-triggered retries; recovery for a partial failure is a
// to-be-designed manual / scheduled-job operation.
//
// idempotencyKey is the trigger event_id. Stripe's idempotency window
// (24h) absorbs webhook redeliveries inside that window; outside it, a
// fresh mint with a different event_id is what we want anyway (rotation).
func (r *RealClient) MintLiveAPIKeys(ctx context.Context, in MintLiveAPIKeysInput) (LiveAPIKeys, error) {
	if in.OwnerAccount == "" {
		return LiveAPIKeys{}, errors.New("stripe.RealClient.MintLiveAPIKeys: OwnerAccount is required")
	}
	if in.IdempotencyKey == "" {
		return LiveAPIKeys{}, errors.New("stripe.RealClient.MintLiveAPIKeys: IdempotencyKey is required")
	}
	if r.innerLive == nil {
		return LiveAPIKeys{}, errors.New("stripe.RealClient.MintLiveAPIKeys: live stripeAPIClient not wired (sk_live platform key required — populate the *-airo-stripe-platform-key-live secret)")
	}
	if r.pem == nil {
		return LiveAPIKeys{}, errors.New("stripe.RealClient.MintLiveAPIKeys: pem fetcher not wired (kmspubkey.Cache is required for live-key minting)")
	}
	if r.decrypt == nil {
		return LiveAPIKeys{}, errors.New("stripe.RealClient.MintLiveAPIKeys: jwe decrypter not wired (jwedecrypt.Decrypter is required for live-key minting)")
	}

	// Anchor every breadcrumb in this mint to the same key set so dashboards
	// can group related events. ownerAccount + idempotencyKey are the
	// triage-relevant identifiers (sandboxId / appId are added by the caller
	// at provisionLiveKeys, where they're known).
	logBase := []any{
		"ownerAccount", in.OwnerAccount,
		"idempotencyKey", in.IdempotencyKey,
	}
	slog.Info(liveKeysLog+".mint.start", logBase...)

	pem, err := r.pem.PEM(ctx)
	if err != nil {
		// KMS errors carry their own structured info via aws-sdk-go-v2
		// (smithy.OperationError chains to types.NotFoundException, etc.).
		// errors.As against specific KMS types would overfit to one path;
		// the unwrapped string is the most stable diagnostic short of
		// type-specific switches.
		slog.Error(liveKeysLog+".mint.pem_fetch_failed",
			append(logBase, "error", err)...)
		return LiveAPIKeys{}, fmt.Errorf("MintLiveAPIKeys: load RSA pubkey: %w", err)
	}
	slog.Info(liveKeysLog+".mint.pem_fetched",
		append(logBase, "pemBytes", len(pem))...)
	pubKey := &stripeapi.PublicKey{
		PEMKey: stripeapi.PEMKey{Data: pem, Algorithm: "RSA"},
	}

	// 1) secret_key — JWE-encrypted response.
	secretJWE, err := r.callAPIKeys(ctx, in.IdempotencyKey, in.OwnerAccount, stripeapi.CreateAPIKeyRequest{
		Type:      stripeapi.APIKeyTypeSecret,
		PublicKey: pubKey,
	})
	if err != nil {
		attrs := append(append(logBase, "step", "secret_key.create"), stripeErrorAttrs(err)...)
		slog.Error(liveKeysLog+".mint.api_key_create_failed",
			append(attrs, "error", err)...)
		return LiveAPIKeys{}, fmt.Errorf("MintLiveAPIKeys.secret: %w", err)
	}
	slog.Info(liveKeysLog+".mint.secret_key.created",
		append(logBase, "jweBytes", len(secretJWE))...)

	secretPlaintext, err := r.decryptWithDiagnostics(ctx, "secret_key", secretJWE, logBase)
	if err != nil {
		return LiveAPIKeys{}, fmt.Errorf("MintLiveAPIKeys.secret.decrypt: %w", err)
	}
	slog.Info(liveKeysLog+".mint.secret_key.decrypted",
		append(logBase,
			"plaintextBytes", len(secretPlaintext),
			"prefixOk", strings.HasPrefix(string(secretPlaintext), expectedKeyPrefix[stripeapi.APIKeyTypeSecret]),
		)...)

	// 2) publishable_key — plaintext response (publishable keys are safe
	// to expose; the protocol skips JWE for them).
	pubResp, err := r.innerLive.CreateAPIKey(ctx, in.IdempotencyKey+"-pub", in.OwnerAccount, stripeapi.CreateAPIKeyRequest{
		Type: stripeapi.APIKeyTypePublishable,
	})
	if err != nil {
		attrs := append(append(logBase, "step", "publishable_key.create"), stripeErrorAttrs(err)...)
		slog.Error(liveKeysLog+".mint.api_key_create_failed",
			append(attrs, "error", err)...)
		return LiveAPIKeys{}, fmt.Errorf("MintLiveAPIKeys.publishable: %w", err)
	}
	if pubResp.PublishableKey.Value == "" {
		slog.Error(liveKeysLog+".mint.publishable_key.empty_response", logBase...)
		return LiveAPIKeys{}, errors.New("MintLiveAPIKeys.publishable: response missing publishable_key")
	}
	slog.Info(liveKeysLog+".mint.publishable_key.created",
		append(logBase,
			"plaintextBytes", len(pubResp.PublishableKey.Value),
			"prefixOk", strings.HasPrefix(pubResp.PublishableKey.Value, expectedKeyPrefix[stripeapi.APIKeyTypePublishable]),
		)...)

	// 3) mcp_key — SKIPPED. Stripe's v2.iam.api_keys does not currently
	// recognize type=mcp_key in live mode (observed 2026-05-28 against
	// API version 2026-03-25.dahlia: 400 invalid_fields, "valid values
	// are: publishable_key, secret_key"). This is the documented gap
	// gating Phase 3 in plan §9 Q9. We mint sk_live + pk_live only and
	// leave MCPKey empty; the caller (provisionLiveKeys) skips the
	// hosting MCP-op when the value is empty, and the existing
	// ek_test_* placed at sandbox creation remains in hosting's
	// secrets artifact. Customer-app checkout (sk + pk) works in live
	// mode; the agent's MCP integration is unavailable for that
	// merchant in live mode until Stripe ships mcp_key support.
	//
	// When Stripe enables it, restore this block (call apiKeys.create
	// with type=mcp_key + pubKey, JWE-decrypt via decryptWithDiagnostics,
	// return MCPKey: string(mcpPlaintext)). All supporting infrastructure
	// (callAPIKeys, decryptWithDiagnostics, expectedKeyPrefix) is already
	// in place.
	slog.Warn(liveKeysLog+".mint.mcp_key.skipped",
		append(logBase,
			"reason", "stripe_v2_apikeys_does_not_yet_support_mcp_key_in_live_mode",
			"ref", "STRIPE_INTEGRATION_PLAN.md §9 Q9",
		)...)

	slog.Info(liveKeysLog+".mint.success",
		append(logBase,
			"secretBytes", len(secretPlaintext),
			"publishableBytes", len(pubResp.PublishableKey.Value),
			"mcpBytes", 0,
			"mcpSkipped", true,
		)...)

	return LiveAPIKeys{
		SecretKey:      string(secretPlaintext),
		PublishableKey: pubResp.PublishableKey.Value,
		MCPKey:         "", // intentionally empty — see warn above
	}, nil
}

// decryptWithDiagnostics runs the JWE decrypter and, on failure, logs the
// JWE protected header (algorithm announcement — non-secret) plus the
// segment-shape signal so a schema mismatch (Stripe shipping a different
// alg/enc, segment count off) is obvious. step is one of "secret_key"
// or "mcp_key" so the log line is grep-able to the right path.
func (r *RealClient) decryptWithDiagnostics(ctx context.Context, step, jwe string, logBase []any) ([]byte, error) {
	plaintext, err := r.decrypt.Decrypt(ctx, jwe)
	if err == nil {
		return plaintext, nil
	}
	attrs := append(append([]any{}, logBase...),
		"step", step,
		"jweBytes", len(jwe),
		"jweSegmentCount", len(strings.Split(jwe, ".")),
		"error", err,
	)
	if hdr, hdrErr := jweHeaderForLog(jwe); hdrErr == nil {
		attrs = append(attrs, "jweHeader", hdr)
	} else {
		attrs = append(attrs, "jweHeaderParseError", hdrErr.Error())
	}
	slog.Error(liveKeysLog+".mint.jwe_decrypt_failed", attrs...)
	return nil, err
}

// callAPIKeys runs one CreateAPIKey call expected to return a JWE-encrypted
// secret (i.e. type=secret_key or type=mcp_key). Returns the JWE compact
// serialization. Centralizes the per-type response-shape extraction that
// would otherwise duplicate across the secret and mcp branches above.
//
// Always uses the live-mode client: apiKeys.create against a live merchant
// account requires the sk_live platform key.
func (r *RealClient) callAPIKeys(
	ctx context.Context,
	idempotencyKey, stripeContext string,
	req stripeapi.CreateAPIKeyRequest,
) (string, error) {
	resp, err := r.innerLive.CreateAPIKey(ctx, idempotencyKey, stripeContext, req)
	if err != nil {
		return "", err
	}
	switch req.Type {
	case stripeapi.APIKeyTypeSecret:
		if resp.SecretKey == nil || resp.SecretKey.EncryptedSecret.Ciphertext == "" {
			return "", errors.New("response missing secret_key.encrypted_secret.ciphertext")
		}
		return resp.SecretKey.EncryptedSecret.Ciphertext, nil
	case stripeapi.APIKeyTypeMCP:
		if resp.MCPKey == nil || resp.MCPKey.EncryptedSecret.Ciphertext == "" {
			return "", errors.New("response missing mcp_key.encrypted_secret.ciphertext")
		}
		return resp.MCPKey.EncryptedSecret.Ciphertext, nil
	default:
		// Caller bug: callAPIKeys is for JWE-bearing types only. Bail
		// rather than try to extract a JWE from a publishable response.
		return "", fmt.Errorf("callAPIKeys called with unsupported type %q", req.Type)
	}
}
