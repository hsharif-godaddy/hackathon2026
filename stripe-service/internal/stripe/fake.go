package stripe

import (
	"context"
	"crypto/rand"
	"encoding/hex"
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
