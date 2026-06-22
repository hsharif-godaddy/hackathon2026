package stripe

import (
	"context"
	"strings"
	"testing"
)

func TestFakeClient_CreateClaimableSandbox_HasExpectedPrefixes(t *testing.T) {
	sb, err := FakeClient{}.CreateClaimableSandbox(context.Background(), CreateSandboxInput{AppID: "app-1"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	cases := []struct {
		name, got, wantPrefix string
	}{
		{"SandboxID", sb.SandboxID, "cbsbx_fake_"},
		{"AccountID", sb.AccountID, "acct_fake_"},
		{"PublishableKey", sb.PublishableKey, "pk_test_fake_"},
		{"SecretKey", sb.SecretKey, "sk_test_fake_"},
		{"MCPKey", sb.MCPKey, "ek_test_fake_"},
		{"ClaimURL", sb.ClaimURL, "https://dashboard.stripe.com/fake-claim/cbsbx_fake_"},
	}
	for _, c := range cases {
		if !strings.HasPrefix(c.got, c.wantPrefix) {
			t.Errorf("%s: want prefix %q, got %q", c.name, c.wantPrefix, c.got)
		}
	}

	// ClaimURL suffix should match SandboxID for easy cross-reference.
	if !strings.HasSuffix(sb.ClaimURL, sb.SandboxID) {
		t.Errorf("ClaimURL %q should end with SandboxID %q", sb.ClaimURL, sb.SandboxID)
	}
}

func TestFakeClient_RenewOnboardingLink_RequiresFields(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		name string
		in   RenewOnboardingLinkInput
	}{
		{"empty SandboxID", RenewOnboardingLinkInput{IdempotencyKey: "k"}},
		{"empty IdempotencyKey", RenewOnboardingLinkInput{SandboxID: "cbsbx_x"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := FakeClient{}.RenewOnboardingLink(ctx, c.in)
			if err == nil {
				t.Errorf("want error for %s, got nil", c.name)
			}
		})
	}
}

func TestFakeClient_RenewOnboardingLink_ReturnsFreshURL(t *testing.T) {
	ctx := context.Background()
	in := RenewOnboardingLinkInput{
		SandboxID:      "cbsbx_test_abc",
		IdempotencyKey: "k-1",
	}
	got, err := FakeClient{}.RenewOnboardingLink(ctx, in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.ClaimURL == "" {
		t.Error("ClaimURL: want non-empty")
	}
	if got.ExpiresAt.IsZero() {
		t.Error("ExpiresAt: want non-zero")
	}
	// Renewed URL should contain the sandbox ID so callers can log it.
	if !strings.Contains(got.ClaimURL, in.SandboxID) {
		t.Errorf("ClaimURL %q should contain SandboxID %q", got.ClaimURL, in.SandboxID)
	}
	// Two calls with same (sandboxId, idempotencyKey) must produce the
	// same URL — simulates Stripe's idempotency contract.
	got2, err := FakeClient{}.RenewOnboardingLink(ctx, in)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if got.ClaimURL != got2.ClaimURL {
		t.Errorf("idempotency: same inputs should produce same URL; got %q then %q", got.ClaimURL, got2.ClaimURL)
	}
}

func TestFakeClient_RenewOnboardingLink_DifferentKeyProducesDifferentURL(t *testing.T) {
	ctx := context.Background()
	base := RenewOnboardingLinkInput{SandboxID: "cbsbx_abc"}
	r1, _ := FakeClient{}.RenewOnboardingLink(ctx, RenewOnboardingLinkInput{SandboxID: base.SandboxID, IdempotencyKey: "k-1"})
	r2, _ := FakeClient{}.RenewOnboardingLink(ctx, RenewOnboardingLinkInput{SandboxID: base.SandboxID, IdempotencyKey: "k-2"})
	if r1.ClaimURL == r2.ClaimURL {
		t.Errorf("different idempotency keys should produce different URLs; both got %q", r1.ClaimURL)
	}
}

// Compile-time check: FakeClient still satisfies Client after the new field.
var _ Client = FakeClient{}

// Intentionally compile-only check that FakeClient.RenewOnboardingLink exists.
var _ = func() { _, _ = FakeClient{}.RenewOnboardingLink(context.Background(), RenewOnboardingLinkInput{}) }

func TestFakeClient_CreateClaimableSandbox_Unique(t *testing.T) {
	ctx := context.Background()
	a, err := FakeClient{}.CreateClaimableSandbox(ctx, CreateSandboxInput{})
	if err != nil {
		t.Fatalf("call 1: %v", err)
	}
	b, err := FakeClient{}.CreateClaimableSandbox(ctx, CreateSandboxInput{})
	if err != nil {
		t.Fatalf("call 2: %v", err)
	}
	if a.SandboxID == b.SandboxID {
		t.Errorf("two calls produced same SandboxID %q — entropy path broken", a.SandboxID)
	}
}
