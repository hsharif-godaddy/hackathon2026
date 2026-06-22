package stripe

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"
)

// FakeClient returns obvious-fake values (all IDs prefixed `*_fake_*`) with
// no network I/O. Used in local and dev-private.
type FakeClient struct{}

// Compile-time check that FakeClient satisfies Client.
var _ Client = FakeClient{}

// fakeNow lets tests override the wall clock used to derive synthetic
// expires_at values. Production callers don't touch it; the default
// time.Now is fine for everything but deterministic tests.
var fakeNow = time.Now

// CreateClaimableSandbox returns a Sandbox with a random 8-hex-char suffix.
// Two calls produce different SandboxIDs.
//
// ExpiresAt and OnboardingLinkExpiresAt mirror Stripe's documented 60-day
// / 7-day windows so handler-level expiry logic (warnings, auto-renew)
// exercises with realistic timestamps in fake-mode tests.
func (FakeClient) CreateClaimableSandbox(_ context.Context, _ CreateSandboxInput) (Sandbox, error) {
	suffix := randomHex(8)
	sandboxID := "cbsbx_fake_" + suffix
	now := fakeNow().UTC()
	return Sandbox{
		SandboxID:               sandboxID,
		AccountID:               "acct_fake_" + suffix,
		PublishableKey:          "pk_test_fake_" + suffix,
		SecretKey:               "sk_test_fake_" + suffix,
		MCPKey:                  "ek_test_fake_" + suffix,
		ClaimURL:                "https://dashboard.stripe.com/fake-claim/" + sandboxID,
		ExpiresAt:               now.AddDate(0, 0, 60),
		OnboardingLinkExpiresAt: now.AddDate(0, 0, 7),
	}, nil
}

// RenewOnboardingLink returns a fresh fake-claim URL whose suffix differs
// from the original (so callers persisting the new value can confirm a
// round-trip) and a new 7-day expires_at.
func (FakeClient) RenewOnboardingLink(_ context.Context, in RenewOnboardingLinkInput) (RenewedOnboardingLink, error) {
	if in.SandboxID == "" {
		return RenewedOnboardingLink{}, errors.New("stripe.FakeClient.RenewOnboardingLink: SandboxID is required")
	}
	if in.IdempotencyKey == "" {
		return RenewedOnboardingLink{}, errors.New("stripe.FakeClient.RenewOnboardingLink: IdempotencyKey is required")
	}
	suffix := deterministicSuffix(in.SandboxID, in.IdempotencyKey)
	return RenewedOnboardingLink{
		ClaimURL:  "https://dashboard.stripe.com/fake-claim/" + in.SandboxID + "?renewed=" + suffix,
		ExpiresAt: fakeNow().UTC().AddDate(0, 0, 7),
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
