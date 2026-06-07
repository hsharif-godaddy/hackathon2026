package email_test

import (
	"fmt"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

func TestIdentity_IsAllowedSender(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		id   email.Identity
		addr string
		want bool
	}{
		{
			name: "canonical claim on default domain — allowed",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			// The only legitimate local-part on the platform domain is
			// the AppID — the canonical sender form.
			addr: "abc1234567@airoapp.ai",
			want: true,
		},
		{
			name: "non-canonical local-part on default domain — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			// Customers can't claim platform-shaped addresses like
			// "support@airoapp.ai" on our own domain; these names belong
			// to the platform, not any individual app.
			addr: "support@airoapp.ai",
			want: false,
		},
		{
			name: "noreply on default domain — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			addr: "noreply@airoapp.ai",
			want: false,
		},
		{
			name: "address on attached custom domain — allowed",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "support@acme.com",
			want: true,
		},
		{
			name: "address matches second of multiple attached domains",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com", "acme.shop"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "hello@acme.shop",
			want: true,
		},
		{
			name: "address on different tenant's domain — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "noreply@kimsorrelle.com",
			want: false,
		},
		{
			name: "subdomain of attached — rejected (only the verified name matches)",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			// mhp-core verified "acme.com", not subdomains under it. Even
			// if the customer probably owns the whole zone, we don't trust
			// what we didn't verify — they should attach each subdomain
			// they actually intend to send from.
			addr: "noreply@shop.acme.com",
			want: false,
		},
		{
			name: "apex when subdomain attached — rejected (verification doesn't climb)",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"shop.acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			// The customer might have only a subdomain delegation from
			// someone else's acme.com. We can't tell from the verified
			// attach, so we don't grant the parent.
			addr: "noreply@acme.com",
			want: false,
		},
		{
			name: "sibling under same registrable — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"shop.acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "noreply@mail.acme.com",
			want: false,
		},
		{
			name: "near-miss with shared suffix — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			// Common typo-squat shape: "evil-acme.com" shares the trailing
			// "acme.com" but is a wholly different registration. Exact
			// match rejects it without us needing a label-boundary check.
			addr: "noreply@evil-acme.com",
			want: false,
		},
		{
			name: "PaaS subdomain trap — different tenant rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"evil.github.io"},
				DefaultDomain:   "airoapp.ai",
			},
			// Each tenant under github.io is its own attached entry; one
			// tenant's verified attach can't impersonate a sibling.
			addr: "noreply@victim.github.io",
			want: false,
		},
		{
			name: "DefaultDomain stays exact-match — subdomain of platform rejected",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			addr: "noreply@evil.airoapp.ai",
			want: false,
		},
		{
			name: "case-insensitive domain match (canonical local-part)",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			// Domain compared case-insensitively; local-part also case-
			// insensitive (RFC 5321 says local-parts are technically
			// case-sensitive but mainstream receivers don't enforce it).
			addr: "ABC1234567@AIROAPP.AI",
			want: true,
		},
		{
			name: "case-insensitive domain match with non-canonical local-part — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			addr: "Hello@AIROAPP.AI",
			want: false,
		},
		{
			name: "name-addr form — domain extracted from addr-spec",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: `"Acme Support" <support@acme.com>`,
			want: true,
		},
		{
			name: "name-addr form on foreign domain — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: `"CEO" <ceo@victim.com>`,
			want: false,
		},
		{
			name: "empty AttachedDomains doesn't accidentally allow anything",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			addr: "any@example.com",
			want: false,
		},
		{
			name: "empty-string entry inside AttachedDomains is ignored",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{""},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "any@example.com",
			want: false,
		},
		{
			name: "malformed address — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			addr: "not-an-email",
			want: false,
		},
		{
			name: "quoted local-part on attached domain — allowed",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			// net/mail accepts a quoted local-part containing an @; we extract
			// the trailing host with LastIndex so the policy still resolves to
			// the real domain rather than getting fooled by the inner @.
			addr: `"weird@local"@acme.com`,
			want: true,
		},
		{
			name: "quoted local-part on foreign domain — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: `"acme.com@local"@victim.com`,
			want: false,
		},
		{
			name: "empty address — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			addr: "",
			want: false,
		},
		{
			name: "whitespace-only address — rejected",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			addr: "   ",
			want: false,
		},
		{
			name: "trailing-dot FQDN form — rejected (relay does not normalize)",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "airoapp.ai"},
			// We deliberately do NOT strip the trailing dot. mail.ParseAddress
			// rejects this form, so the address is not allowed. Customers
			// don't write addresses this way; the choice keeps the policy
			// strict.
			addr: "noreply@airoapp.ai.",
			want: false,
		},
		{
			name: "non-prod default domain accepted (canonical local-part)",
			id:   email.Identity{AppID: "xyz0987654", DefaultDomain: "test-airoapp.ai"},
			addr: "xyz0987654@test-airoapp.ai",
			want: true,
		},
		{
			name: "default domain with surrounding whitespace in identity",
			id:   email.Identity{AppID: "abc1234567", DefaultDomain: "  airoapp.ai  "},
			addr: "abc1234567@airoapp.ai",
			want: true,
		},
		{
			name: "default domain with empty AppID — rejected (no local-part to anchor)",
			id:   email.Identity{DefaultDomain: "airoapp.ai"},
			// Empty AppID disables the DefaultDomain branch entirely;
			// without a known canonical local-part, nothing can match.
			addr: "anything@airoapp.ai",
			want: false,
		},
		{
			name: "attached domain with mixed case in identity",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"ACME.com"},
				DefaultDomain:   "airoapp.ai",
			},
			addr: "support@acme.com",
			want: true,
		},
		{
			name: "U-label claim matches A-label attached entry",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"xn--bcher-kva.example"},
				DefaultDomain:   "airoapp.ai",
			},
			// Constructor normalizes attached entries to A-label; matcher
			// must do the same on the claim or SMTPUTF8 customers using
			// IDN domains would silently get their mail rewritten.
			addr: "noreply@bücher.example",
			want: true,
		},
		{
			name: "U-label claim with mismatched IDN — rejected",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"xn--bcher-kva.example"},
				DefaultDomain:   "airoapp.ai",
			},
			// Different U-label, different A-label, no match.
			addr: "noreply@straße.example",
			want: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := tc.id.IsAllowedSender(tc.addr)
			if got != tc.want {
				t.Errorf("IsAllowedSender(%q) = %v, want %v\nidentity: %+v", tc.addr, got, tc.want, tc.id)
			}
		})
	}
}

func TestIdentity_CanonicalSender(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		id   email.Identity
		want string
	}{
		{
			name: "PrimaryDomain set — used verbatim for branded fallback",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				PrimaryDomain:   "acme.com",
				DefaultDomain:   "airoapp.ai",
			},
			want: "abc1234567@acme.com",
		},
		{
			name: "PrimaryDomain is a subdomain — kept verbatim, not collapsed",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"shop.acme.com"},
				PrimaryDomain:   "shop.acme.com",
				DefaultDomain:   "airoapp.ai",
			},
			// DKIM/SPF onboarding lives at the exact attached name, not at
			// some inferred apex. PrimaryDomain is whatever mhp-core marked
			// isPrimary on, character-for-character.
			want: "abc1234567@shop.acme.com",
		},
		{
			name: "AttachedDomains present but no PrimaryDomain — falls to default",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com", "acme.shop"},
				DefaultDomain:   "airoapp.ai",
			},
			// No "smarts": if alloc-config didn't mark a primary, we don't
			// pick one from the slice. The platform default takes over.
			want: "abc1234567@airoapp.ai",
		},
		{
			name: "no attached domains, no primary — uses default",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			want: "abc1234567@airoapp.ai",
		},
		{
			name: "non-prod default domain honored when no primary",
			id: email.Identity{
				AppID:         "xyz0987654",
				DefaultDomain: "test-airoapp.ai",
			},
			want: "xyz0987654@test-airoapp.ai",
		},
		{
			name: "empty AppID degrades to unknown@default",
			id: email.Identity{
				DefaultDomain: "airoapp.ai",
			},
			want: "unknown@airoapp.ai",
		},
		{
			name: "empty AppID with PrimaryDomain — unknown local-part, branded domain",
			id: email.Identity{
				AttachedDomains: []string{"acme.com"},
				PrimaryDomain:   "acme.com",
				DefaultDomain:   "airoapp.ai",
			},
			want: "unknown@acme.com",
		},
		{
			name: "completely empty identity falls back to unknown@airoapp.ai",
			id:   email.Identity{},
			want: "unknown@airoapp.ai",
		},
		{
			name: "PrimaryDomain values are lowercased and trimmed",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"  ACME.com  "},
				PrimaryDomain:   "  ACME.com  ",
				DefaultDomain:   "airoapp.ai",
			},
			want: "abc1234567@acme.com",
		},
		{
			name: "AppID local-part is preserved verbatim (no case folding)",
			id: email.Identity{
				AppID:         "AbC1234567",
				DefaultDomain: "airoapp.ai",
			},
			// AppIDs are alphanumeric in practice, but if a future change
			// allows mixed case the local-part should round-trip exactly.
			want: "AbC1234567@airoapp.ai",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := tc.id.CanonicalSender()
			if got != tc.want {
				t.Errorf("CanonicalSender() = %q, want %q\nidentity: %+v", got, tc.want, tc.id)
			}
		})
	}
}

func TestIdentity_EnforceSender(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name             string
		id               email.Identity
		claimed          string
		wantFinal        string
		wantWasRewritten bool
	}{
		{
			name: "canonical claim on default domain — passes through",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			claimed:          "abc1234567@airoapp.ai",
			wantFinal:        "abc1234567@airoapp.ai",
			wantWasRewritten: false,
		},
		{
			name: "non-canonical local-part on default domain — rewritten to canonical",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			// Customer can't claim platform-shaped addresses on our own
			// domain — gets rewritten back to canonical.
			claimed:          "noreply@airoapp.ai",
			wantFinal:        "abc1234567@airoapp.ai",
			wantWasRewritten: true,
		},
		{
			name: "claimed on attached domain — passes through, display name preserved",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			claimed:          `"Acme Support" <support@acme.com>`,
			wantFinal:        `"Acme Support" <support@acme.com>`,
			wantWasRewritten: false,
		},
		{
			name: "claimed on second attached domain — also passes through",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com", "acme.shop"},
				DefaultDomain:   "airoapp.ai",
			},
			claimed:          "hello@acme.shop",
			wantFinal:        "hello@acme.shop",
			wantWasRewritten: false,
		},
		{
			name: "claimed on victim domain — rewritten to canonical (uses PrimaryDomain)",
			id: email.Identity{
				AppID:           "attacker1",
				AttachedDomains: []string{"attacker.com"},
				PrimaryDomain:   "attacker.com",
				DefaultDomain:   "airoapp.ai",
			},
			claimed:          "noreply@kimsorrelle.com",
			wantFinal:        "attacker1@attacker.com",
			wantWasRewritten: true,
		},
		{
			name: "claimed empty — rewritten to canonical",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			claimed:          "",
			wantFinal:        "abc1234567@airoapp.ai",
			wantWasRewritten: true,
		},
		{
			name: "no attached domains, claimed on different domain — rewritten to default",
			id: email.Identity{
				AppID:         "abc1234567",
				DefaultDomain: "airoapp.ai",
			},
			claimed:          "noreply@kimsorrelle.com",
			wantFinal:        "abc1234567@airoapp.ai",
			wantWasRewritten: true,
		},
		{
			name: "claimed on subdomain when only apex attached — rewritten to PrimaryDomain",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				PrimaryDomain:   "acme.com",
				DefaultDomain:   "airoapp.ai",
			},
			// Customer attached the apex; a claim at a subdomain isn't
			// what was verified. Rewritten to the verbatim primary.
			claimed:          "noreply@shop.acme.com",
			wantFinal:        "abc1234567@acme.com",
			wantWasRewritten: true,
		},
		{
			name: "claimed on apex when only subdomain attached — rewritten to PrimaryDomain",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"shop.acme.com"},
				PrimaryDomain:   "shop.acme.com",
				DefaultDomain:   "airoapp.ai",
			},
			claimed:          "noreply@acme.com",
			wantFinal:        "abc1234567@shop.acme.com",
			wantWasRewritten: true,
		},
		{
			name: "AttachedDomains without PrimaryDomain — canonical falls to default",
			id: email.Identity{
				AppID:           "abc1234567",
				AttachedDomains: []string{"acme.com"},
				DefaultDomain:   "airoapp.ai",
			},
			// IsAllowedSender still accepts the claim (it's in
			// AttachedDomains), so this is the pass-through path. Included
			// to pin the "no primary, no smarts" rule even when claim is
			// allowed.
			claimed:          "support@acme.com",
			wantFinal:        "support@acme.com",
			wantWasRewritten: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			final, rewritten := tc.id.EnforceSender(tc.claimed)
			if final != tc.wantFinal {
				t.Errorf("EnforceSender(%q) final = %q, want %q", tc.claimed, final, tc.wantFinal)
			}
			if rewritten != tc.wantWasRewritten {
				t.Errorf("EnforceSender(%q) wasRewritten = %v, want %v", tc.claimed, rewritten, tc.wantWasRewritten)
			}
		})
	}
}

// TestIdentity_EnforceSenderConsistency keeps EnforceSender wired to its
// two primitives so we don't accidentally drift the convenience method
// from the building blocks.
func TestIdentity_EnforceSenderConsistency(t *testing.T) {
	t.Parallel()

	id := email.Identity{
		AppID:           "abc1234567",
		AttachedDomains: []string{"acme.com", "acme.shop"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "airoapp.ai",
	}

	probes := []string{
		"support@acme.com",
		"hello@acme.shop",
		"shop@anything.acme.com", // subdomain of attached — now rejected
		"noreply@airoapp.ai",
		"Hello@AIROAPP.AI",
		`"Acme Support" <support@acme.com>`,
		"hello@victim.com",
		"noreply@github.io", // unrelated — never matches
		"",
		"not-an-email",
		"   ",
		`"CEO" <ceo@victim.com>`,
		`"weird@local"@acme.com`,
	}

	for _, p := range probes {
		// fmt.Sprintf(%q, ...) keeps probe-name unique even when the only
		// difference is whitespace ("" vs "   ").
		t.Run(fmt.Sprintf("%q", p), func(t *testing.T) {
			t.Parallel()
			final, rewritten := id.EnforceSender(p)
			allowed := id.IsAllowedSender(p)
			if allowed && rewritten {
				t.Errorf("EnforceSender(%q) rewrote an allowed claim", p)
			}
			if !allowed && !rewritten {
				t.Errorf("EnforceSender(%q) failed to rewrite a disallowed claim", p)
			}
			if allowed && final != p {
				t.Errorf("EnforceSender(%q) returned %q for an allowed claim, want passthrough", p, final)
			}
			if !allowed && final != id.CanonicalSender() {
				t.Errorf("EnforceSender(%q) returned %q, want canonical %q", p, final, id.CanonicalSender())
			}
		})
	}
}

func TestIdentity_DefaultDomainSender(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		id   email.Identity
		want string
	}{
		{
			name: "uses DefaultDomain ignoring PrimaryDomain",
			id: email.Identity{
				AppID:         "abc1234567",
				PrimaryDomain: "acme.com",
				DefaultDomain: "airoapp.ai",
			},
			want: "abc1234567@airoapp.ai",
		},
		{
			name: "empty AppID falls back to unknown",
			id:   email.Identity{DefaultDomain: "airoapp.ai"},
			want: "unknown@airoapp.ai",
		},
		{
			name: "empty DefaultDomain falls back to hard default",
			id:   email.Identity{AppID: "abc1234567"},
			want: "abc1234567@airoapp.ai",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := tc.id.DefaultDomainSender()
			if got != tc.want {
				t.Errorf("DefaultDomainSender() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestIdentity_HasSameDomainConflict(t *testing.T) {
	t.Parallel()

	baseID := email.Identity{
		AppID:           "abc1234567",
		AttachedDomains: []string{"acme.com"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "airoapp.ai",
	}

	cases := []struct {
		name       string
		id         email.Identity
		from       string
		recipients []string
		want       bool
	}{
		{
			name:       "no overlap — no conflict",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: []string{"buyer@gmail.com"},
			want:       false,
		},
		{
			name:       "one recipient on same domain — conflict",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: []string{"john@acme.com"},
			want:       true,
		},
		{
			name:       "mixed recipients — one match triggers conflict",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: []string{"buyer@gmail.com", "admin@acme.com"},
			want:       true,
		},
		{
			name:       "from already on DefaultDomain — no conflict even if recipient matches",
			id:         baseID,
			from:       "abc1234567@airoapp.ai",
			recipients: []string{"someone@airoapp.ai"},
			want:       false,
		},
		{
			name:       "case-insensitive domain match — conflict",
			id:         baseID,
			from:       "abc1234567@ACME.COM",
			recipients: []string{"user@acme.com"},
			want:       true,
		},
		{
			name:       "from with display name — conflict detected",
			id:         baseID,
			from:       `"Acme App" <abc1234567@acme.com>`,
			recipients: []string{"john@acme.com"},
			want:       true,
		},
		{
			name:       "recipient with display name — conflict detected",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: []string{`"John Smith" <john@acme.com>`},
			want:       true,
		},
		{
			name:       "empty recipients — no conflict",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: nil,
			want:       false,
		},
		{
			name:       "malformed from — no conflict",
			id:         baseID,
			from:       "not-an-email",
			recipients: []string{"john@acme.com"},
			want:       false,
		},
		{
			name:       "subdomain does not match parent — no conflict",
			id:         baseID,
			from:       "abc1234567@acme.com",
			recipients: []string{"user@sub.acme.com"},
			want:       false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := tc.id.HasSameDomainConflict(tc.from, tc.recipients)
			if got != tc.want {
				t.Errorf("HasSameDomainConflict() = %v, want %v", got, tc.want)
			}
		})
	}
}
