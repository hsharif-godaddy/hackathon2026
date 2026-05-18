package email

import (
	"fmt"
	"log/slog"
	"strings"

	"golang.org/x/net/idna"
	"golang.org/x/net/publicsuffix"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
)

// IdentityFromAllocConfig reads /alloc/config.json via the supplied loader,
// applies the AttachedDomains contract (active-status, fqdn-typed,
// A-label-normalized via IDNA Lookup, PSL-resolvable), and returns a
// ready-to-use Identity for the given app. The PrimaryDomain field is
// populated from the alloc-config row whose isPrimary flag is true; if no
// row is primary, PrimaryDomain is empty and CanonicalSender falls through
// to defaultDomain.
//
// This is the single canonical constructor used by every consumer of the
// policy (SMTP proxy, future HTTP email gateway). Filtering rules live
// here rather than in caller comments so the contract cannot drift out
// of the call sites.
//
// loader nil falls back to the process-wide allocconfig.Default(); pass an
// explicit loader in tests so each case can use its own /alloc/config.json
// fixture without colliding with the shared cache.
//
// Inputs that are caller responsibilities (env-derived, not in alloc-config):
//
//   - appID: the Airo app's unique identifier. Production callers source
//     this from SITE_ID. Empty produces an Identity that still works for
//     IsAllowedSender but yields "unknown@..." in CanonicalSender.
//   - defaultDomain: the platform catch-all sender domain. "airoapp.ai"
//     in prod; "test-airoapp.ai" (or similar) in non-prod. Caller decides
//     since environment-to-domain mapping is a deployment concern, not a
//     policy concern.
//
// Errors are returned only for unrecoverable I/O or parse failures on the
// alloc-config file. A config file that simply has no DOMAINS entry is not
// an error: the resulting Identity has empty AttachedDomains and falls back
// to defaultDomain for both allow-checks and canonical sender.
func IdentityFromAllocConfig(loader *allocconfig.Loader, appID, defaultDomain string) (Identity, error) {
	if loader == nil {
		loader = allocconfig.Default()
	}
	cfg, err := loader.Load()
	if err != nil {
		return Identity{}, fmt.Errorf("load alloc-config for sender identity: %w", err)
	}
	return identityFromConfig(cfg, appID, defaultDomain), nil
}

// identityFromConfig is the pure-logic core of IdentityFromAllocConfig,
// extracted so the filtering rules can be exercised in tests without
// having to stand up a Loader and on-disk fixture for every case.
//
// Defends against duplicate fqdn rows by deduping post-normalization. The
// data contract from mhp-core's RefreshDomainsSecretTask says rows are
// unique, but a retry race or migration glitch could violate that. A
// duplicate row would otherwise grow AttachedDomains and let a later
// isPrimary value silently override an earlier one — neither is wrong,
// but both are surprises we don't need.
func identityFromConfig(cfg *allocconfig.Config, appID, defaultDomain string) Identity {
	id := Identity{
		AppID:         appID,
		DefaultDomain: defaultDomain,
	}
	if cfg == nil || cfg.Domains == nil {
		return id
	}
	seen := make(map[string]struct{}, len(cfg.Domains.Value))
	// acceptedPrimaries collects the A-label form of every isPrimary row
	// that survives the acceptDomain filter (deduped). We expect exactly
	// zero or one — anything else is an mhp-core contract violation we
	// want logged so somebody can investigate.
	var acceptedPrimaries []string
	for _, d := range cfg.Domains.Value {
		name, ok := acceptDomain(d)
		if !ok {
			continue
		}
		if _, dup := seen[name]; dup {
			continue
		}
		seen[name] = struct{}{}
		id.AttachedDomains = append(id.AttachedDomains, name)
		if d.IsPrimary {
			// Per the data contract there's at most one isPrimary row;
			// last-wins on the off chance more than one is set, which
			// degrades safely (we still pick a valid attached entry).
			id.PrimaryDomain = name
			acceptedPrimaries = append(acceptedPrimaries, name)
		}
	}
	if len(acceptedPrimaries) > 1 {
		// Contract violation: mhp-core's RefreshDomainsSecretTask is
		// supposed to keep at most one isPrimary row. We don't fail —
		// last-wins keeps mail flowing on a still-valid attached
		// domain — but we log loudly so an operator sees the anomaly
		// in Loki and can chase down the source. Volume is bounded by
		// the loader's cache TTL (default 5s), so a persistent multi-
		// primary state will still be visible without flooding.
		slog.Warn("smtp.identity.multiple_primary",
			"app_id", appID,
			"count", len(acceptedPrimaries),
			"candidates", acceptedPrimaries,
			"selected", id.PrimaryDomain,
		)
	}
	return id
}

// acceptDomain returns the A-label form of d.Fqdn and true if d satisfies
// the AttachedDomains contract; "", false otherwise. Filtering rules,
// applied in order:
//
//  1. domainType must equal "fqdn". Prefix-typed entries are URL-routing
//     concerns and are already covered by Identity.DefaultDomain.
//  2. status must equal "active". Pending, error, and revoked rows are
//     not verified ownership claims.
//  3. fqdn must convert cleanly to ASCII A-label form via IDNA "Lookup"
//     profile (the profile mail clients use when resolving a recipient
//     domain). Non-convertible inputs (empty, malformed, U-label that
//     cannot be encoded) are dropped.
//  4. The A-label form must have a computable eTLD+1 (i.e. it sits below
//     a known public suffix). This rejects bare public suffixes
//     ("co.uk", "github.io"), single-label hostnames ("localhost"), and
//     IP literals — none of which can legitimately anchor a sender.
//
// We deliberately do NOT use the PSL result for matching — only for
// validation. The policy decision in IsAllowedSender is exact-match.
func acceptDomain(d allocconfig.Domain) (string, bool) {
	if d.DomainType != "fqdn" {
		return "", false
	}
	if d.Status != "active" {
		return "", false
	}
	name := strings.TrimSpace(d.Fqdn)
	if name == "" {
		return "", false
	}
	ascii, err := idna.Lookup.ToASCII(name)
	if err != nil {
		return "", false
	}
	ascii = strings.ToLower(ascii)
	if _, err := publicsuffix.EffectiveTLDPlusOne(ascii); err != nil {
		return "", false
	}
	return ascii, true
}
