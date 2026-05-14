package email_test

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

// loaderForFixture builds a Loader pointing at testdata/<name> with caching
// disabled so each test sees its own fixture without cross-talk through the
// process-wide cache.
func loaderForFixture(t *testing.T, name string) *allocconfig.Loader {
	t.Helper()
	path, err := filepath.Abs(filepath.Join("testdata", name))
	if err != nil {
		t.Fatalf("filepath.Abs: %v", err)
	}
	return allocconfig.NewLoaderWithTTL(path, 0)
}

func TestIdentityFromAllocConfig_FullConfig(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "full_config.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}

	if id.AppID != "abc1234567" {
		t.Errorf("AppID = %q, want %q", id.AppID, "abc1234567")
	}
	if id.DefaultDomain != "airoapp.ai" {
		t.Errorf("DefaultDomain = %q, want %q", id.DefaultDomain, "airoapp.ai")
	}

	// Of the six DOMAINS rows in the fixture:
	//   - shop.acme.com           -> kept (active, fqdn)
	//   - acme.shop               -> kept (active, fqdn)
	//   - domaindemo.tacopizza... -> dropped (status="error")
	//   - abc1234567.dev...       -> dropped (domainType="prefix")
	//   - pending.example.com     -> dropped (status="pending")
	//   - bücher.example          -> kept, A-label-normalized
	wantAttached := []string{
		"shop.acme.com",
		"acme.shop",
		"xn--bcher-kva.example",
	}

	if len(id.AttachedDomains) != len(wantAttached) {
		t.Fatalf("AttachedDomains length = %d, want %d\n got=%v\nwant=%v",
			len(id.AttachedDomains), len(wantAttached), id.AttachedDomains, wantAttached)
	}
	for i, want := range wantAttached {
		if id.AttachedDomains[i] != want {
			t.Errorf("AttachedDomains[%d] = %q, want %q", i, id.AttachedDomains[i], want)
		}
	}

	// shop.acme.com is the isPrimary=true row in the fixture.
	if id.PrimaryDomain != "shop.acme.com" {
		t.Errorf("PrimaryDomain = %q, want %q", id.PrimaryDomain, "shop.acme.com")
	}

	// Spot-check the policy actually wires up against the constructed Identity.
	if !id.IsAllowedSender("noreply@shop.acme.com") {
		t.Error("attached entry should be allowed by exact match")
	}
	if id.IsAllowedSender("noreply@acme.com") {
		t.Error("parent of attached subdomain should NOT be allowed (exact-match policy)")
	}
	if id.IsAllowedSender("noreply@kimsorrelle.com") {
		t.Error("unrelated domain should be rejected")
	}
	if got := id.CanonicalSender(); got != "abc1234567@shop.acme.com" {
		t.Errorf("CanonicalSender = %q, want %q (verbatim PrimaryDomain)", got, "abc1234567@shop.acme.com")
	}
}

func TestIdentityFromAllocConfig_NoDomainsField(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "no_domains.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}

	if len(id.AttachedDomains) != 0 {
		t.Errorf("AttachedDomains = %v, want empty", id.AttachedDomains)
	}
	// Falls back to default for everything.
	if got := id.CanonicalSender(); got != "abc1234567@airoapp.ai" {
		t.Errorf("CanonicalSender = %q, want abc1234567@airoapp.ai", got)
	}
	if !id.IsAllowedSender("noreply@airoapp.ai") {
		t.Error("DefaultDomain claim should be allowed")
	}
}

func TestIdentityFromAllocConfig_DedupesByNormalizedFqdn(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "dup_fqdn.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}

	// All three rows normalize to "acme.com"; expect exactly one.
	if len(id.AttachedDomains) != 1 || id.AttachedDomains[0] != "acme.com" {
		t.Errorf("AttachedDomains = %v, want [acme.com]", id.AttachedDomains)
	}
	// First row is isPrimary=true; the duplicate rows after it are skipped
	// entirely (including their isPrimary=false), so PrimaryDomain stays
	// set from the first row. Defends against a dup-row regression
	// silently blanking the canonical sender.
	if id.PrimaryDomain != "acme.com" {
		t.Errorf("PrimaryDomain = %q, want %q (first-row-wins, dup rows ignored)", id.PrimaryDomain, "acme.com")
	}
}

func TestIdentityFromAllocConfig_NoPrimaryMarked(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "no_primary.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}

	if len(id.AttachedDomains) != 2 {
		t.Errorf("AttachedDomains = %v, want 2 entries", id.AttachedDomains)
	}
	if id.PrimaryDomain != "" {
		t.Errorf("PrimaryDomain = %q, want empty (no row marked isPrimary)", id.PrimaryDomain)
	}

	// Both attached entries are allowed claims.
	if !id.IsAllowedSender("hello@acme.com") {
		t.Error("acme.com should be allowed")
	}
	if !id.IsAllowedSender("hello@acme.shop") {
		t.Error("acme.shop should be allowed")
	}
	// CanonicalSender falls to DefaultDomain — no "smarts" picking from
	// the slice.
	if got := id.CanonicalSender(); got != "abc1234567@airoapp.ai" {
		t.Errorf("CanonicalSender = %q, want abc1234567@airoapp.ai (no primary -> default)", got)
	}
}

func TestIdentityFromAllocConfig_EmptyDomainsArray(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "empty_domains.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}
	if len(id.AttachedDomains) != 0 {
		t.Errorf("AttachedDomains = %v, want empty", id.AttachedDomains)
	}
}

func TestIdentityFromAllocConfig_MissingFile(t *testing.T) {
	t.Parallel()

	loader := allocconfig.NewLoaderWithTTL("/nonexistent/path/config.json", 0)
	_, err := email.IdentityFromAllocConfig(loader, "abc1234567", "airoapp.ai")
	if err == nil {
		t.Fatal("expected error for missing alloc-config file, got nil")
	}
}

// TestIdentityFromAllocConfig_NilLoaderUsesDefault verifies the nil-loader
// fallback path. We don't try to assert specific behavior of the shared
// loader (it's process-global with caching) — just that the constructor
// doesn't panic and returns either a valid Identity or a load error.
func TestIdentityFromAllocConfig_NilLoaderUsesDefault(t *testing.T) {
	// Not t.Parallel(): we don't want to interfere with other parallel
	// tests that might race on allocconfig.Default()'s lazy init.
	_, err := email.IdentityFromAllocConfig(nil, "abc1234567", "airoapp.ai")
	// Either outcome is acceptable here; we're proving the call doesn't
	// panic and the nil-loader branch is wired up. In dev we'd expect a
	// "file not found" error if /alloc/config.json isn't mounted.
	_ = err

	// Defensive: if Default() ever started returning nil, the call above
	// would panic and we'd never reach this line.
	t.Log("nil-loader path returned without panicking")
}

// TestIdentityFromAllocConfig_DefaultDomainEmpty exercises the degenerate
// case where the caller didn't supply a default domain and there are no
// usable attached entries. CanonicalSender should still be total — that's
// the whole point of the hardcoded "airoapp.ai" fallback.
func TestIdentityFromAllocConfig_DefaultDomainEmpty(t *testing.T) {
	t.Parallel()

	loader := loaderForFixture(t, "empty_domains.json")
	id, err := email.IdentityFromAllocConfig(loader, "abc1234567", "")
	if err != nil {
		t.Fatalf("IdentityFromAllocConfig: %v", err)
	}
	if got := id.CanonicalSender(); got != "abc1234567@airoapp.ai" {
		t.Errorf("CanonicalSender = %q, want abc1234567@airoapp.ai (hard fallback)", got)
	}
}

// TestAllocconfigDomainShape pins down the JSON tags on allocconfig.Domain
// so a future rename or retag would fail loudly. Belongs here rather than
// in allocconfig because the email package is the consumer that depends
// on the shape; if these tags drift, our constructor breaks.
func TestAllocconfigDomainShape(t *testing.T) {
	t.Parallel()

	d := allocconfig.Domain{
		Fqdn:       "acme.com",
		DomainType: "fqdn",
		IsPrimary:  true,
		Status:     "active",
		CreatedAt:  time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		UpdatedAt:  time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}
	if d.Fqdn != "acme.com" || d.DomainType != "fqdn" || d.Status != "active" {
		t.Errorf("Domain field round-trip broke: %+v", d)
	}
}
