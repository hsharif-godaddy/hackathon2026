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
