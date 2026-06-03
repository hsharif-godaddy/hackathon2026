package stripe

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
)

// FakeClient returns obvious-fake values (all IDs prefixed `*_fake_*`) with
// no network I/O. Used in local and dev-private.
type FakeClient struct{}

// Compile-time check that FakeClient satisfies Client.
var _ Client = FakeClient{}

// CreateClaimableSandbox returns a Sandbox with a random 8-hex-char suffix.
// Two calls produce different SandboxIDs.
func (FakeClient) CreateClaimableSandbox(_ context.Context, _ CreateSandboxInput) (Sandbox, error) {
	suffix := randomHex(8)
	sandboxID := "cbsbx_fake_" + suffix
	return Sandbox{
		SandboxID:      sandboxID,
		AccountID:      "acct_fake_" + suffix,
		PublishableKey: "pk_test_fake_" + suffix,
		SecretKey:      "sk_test_fake_" + suffix,
		MCPKey:         "ek_test_fake_" + suffix,
		ClaimURL:       "https://dashboard.stripe.com/fake-claim/" + sandboxID,
	}, nil
}

// MintLiveAPIKeys returns deterministic *_live_fake_* values keyed off the
// idempotency key (so a webhook redelivery in fake mode produces the same
// values, matching real Stripe's idempotency contract). OwnerAccount and
// IdempotencyKey are still required — empty values are rejected to keep the
// fake's argument validation aligned with the real client.
func (FakeClient) MintLiveAPIKeys(_ context.Context, in MintLiveAPIKeysInput) (LiveAPIKeys, error) {
	if in.OwnerAccount == "" {
		return LiveAPIKeys{}, errors.New("stripe.FakeClient.MintLiveAPIKeys: OwnerAccount is required")
	}
	if in.IdempotencyKey == "" {
		return LiveAPIKeys{}, errors.New("stripe.FakeClient.MintLiveAPIKeys: IdempotencyKey is required")
	}
	// Deterministic suffix off (idempotencyKey, ownerAccount) so the same
	// trigger event always maps to the same plaintext keys — preserves the
	// real-client invariant that webhook redeliveries don't churn alloc env
	// values. randomHex would break that.
	suffix := deterministicSuffix(in.IdempotencyKey, in.OwnerAccount)
	return LiveAPIKeys{
		SecretKey:      "sk_live_fake_" + suffix,
		PublishableKey: "pk_live_fake_" + suffix,
		MCPKey:         "ek_live_fake_" + suffix,
	}, nil
}

// deterministicSuffix produces a stable hex tail from concatenated inputs.
// Not security-sensitive — just enough entropy to distinguish merchants in
// local-dev logs while keeping idempotent mints stable.
func deterministicSuffix(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		_, _ = h.Write([]byte(p))
		_, _ = h.Write([]byte{0}) // delimiter so ("ab","c") != ("a","bc")
	}
	return hex.EncodeToString(h.Sum(nil))[:12]
}

func randomHex(nBytes int) string {
	b := make([]byte, nBytes)
	// crypto/rand.Read only returns an error on a platform without a working
	// CSPRNG. Panic rather than fall back to a fixed suffix: silently
	// producing collisions would break sandbox-id uniqueness, which leads to
	// DDB PutItem overwrites of earlier rows (same partition key) — a much
	// worse failure than a loud startup crash on a misconfigured host.
	if _, err := rand.Read(b); err != nil {
		panic("stripe.FakeClient: crypto/rand.Read failed: " + err.Error())
	}
	return hex.EncodeToString(b)
}
