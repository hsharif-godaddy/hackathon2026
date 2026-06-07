// Package email provides the platform's sender-identity policy for outbound
// mail from Airo apps.
//
// It centralizes the rules for which "From" addresses an app is permitted to
// claim and supplies the canonical fallback when the customer's claim is not
// permitted. Both the SMTP proxy and the future HTTP email gateway consume
// this package so policy is enforced consistently across send paths.
//
// Policy
//
//   - An address is "allowed" if its domain exact-matches DefaultDomain
//     (typically "airoapp.ai") OR exact-matches one of the app's
//     verified-attached custom domains. Comparison is case-insensitive
//     and whitespace-trimmed; nothing more permissive than that.
//
//   - The fallback identity, used when a claim is rejected or when the
//     source path doesn't accept a customer-supplied claim at all, is
//     "<AppID>@<PrimaryDomain or DefaultDomain>". PrimaryDomain comes
//     directly from the alloc-config row whose isPrimary flag is true;
//     when no attached entry is primary (or none are attached), the
//     canonical falls through to DefaultDomain.
//
// Why exact-match and not eTLD+1
//
// mhp-core's domain-attach flow verifies DNS control of the exact FQDN the
// customer supplied — TXT challenge or CNAME at that name. It does NOT
// prove ownership of the registrable apex. A customer verified at
// "shop.acme.com" might own all of "acme.com", might have only a subdomain
// delegation, or might have CNAME-only write access via a managed-DNS
// service. We can't distinguish these from the verification artifact, so
// the only safe interpretation of an attach is "the customer controls
// exactly this name." Anything broader risks letting a subdomain-delegated
// customer impersonate the parent zone's actual owner.
//
// Customers who legitimately own multiple sender names attach each one
// explicitly. mhp-core multi-attach already supports this; the cost is one
// DNS verification per name they intend to send from.
//
// # Construction
//
// The policy methods (IsAllowedSender, CanonicalSender, EnforceSender) are
// pure functions over Identity — no I/O — so they can be tested in
// isolation with struct literals. Production callers should NOT build an
// Identity by hand: use IdentityFromAllocConfig, which reads the DOMAINS
// system-managed secret from /alloc/config.json and applies the contract
// described on AttachedDomains. Both consumers (SMTP proxy now, HTTP email
// gateway later) share that single constructor so the filtering rules
// cannot drift between call sites.
package email

import (
	"net/mail"
	"strings"

	"golang.org/x/net/idna"
)

// Identity captures the inputs needed to evaluate sender-policy decisions
// for a single Airo app. Construct via IdentityFromAllocConfig in
// production; tests can build literals directly.
type Identity struct {
	// AppID is the Airo app's unique identifier. Used as the local-part of
	// the canonical sender. Sourced from SITE_ID at the env layer.
	AppID string

	// AttachedDomains is the list of the customer's verified-attached
	// custom domains in A-label form (e.g. ["shop.acme.com", "acme.shop"]),
	// or empty when no custom domain is attached. Sourced from the DOMAINS
	// system-managed secret in /alloc/config.json. mhp-core rewrites the
	// secret on attach/detach so the policy stays current without
	// requiring a redeploy.
	//
	// Match semantics: a claim's domain must exact-match (case-insensitive,
	// whitespace-trimmed) one of these entries to be allowed. No suffix
	// match, no eTLD+1, no smarts — only what mhp-core verified.
	//
	// CONTRACT — IdentityFromAllocConfig enforces the following rules
	// when populating this slice from /alloc/config.json. The policy
	// methods on Identity assume the rules already hold and do not
	// re-validate:
	//
	//   1. Only fqdn-typed entries (domainType == "fqdn"). Prefix-typed
	//      entries (<appId>.<env>airoapp.ai) are URL-routing concerns,
	//      not sender-identity ones — they're already covered by
	//      DefaultDomain.
	//   2. Only active entries (filter by status). A pending or revoked
	//      domain is not a verified ownership claim.
	//   3. ASCII A-label form only. IDN domains are converted to
	//      punycode (e.g. "bücher.example" -> "xn--bcher-kva.example")
	//      via the IDNA Lookup profile so byte-wise comparison cannot
	//      be fooled by Cyrillic-vs-Latin homograph confusables.
	//   4. The entry must have a computable eTLD+1 (i.e. it has a
	//      registrable form). Single-label hostnames, IP literals, and
	//      bare public suffixes ("co.uk", "github.io") are dropped so a
	//      pathological alloc-config entry can't anchor a sender.
	//
	// Tests that build an Identity by hand are responsible for these
	// rules themselves — that's by design, since exercising the policy
	// methods with deliberately-shaped inputs is the whole point.
	AttachedDomains []string

	// PrimaryDomain is the customer's brand-preferred sender domain — the
	// alloc-config DOMAINS row whose isPrimary flag is true, copied
	// verbatim. Empty when no attached entry is primary (which is also
	// the case when there are no attached entries at all). When non-empty
	// it is always also present in AttachedDomains; PrimaryDomain just
	// tags which one of them owns the canonical-sender role.
	//
	// Per the data shape, isPrimary is set on at most one row at a time.
	// The constructor takes the value as-given without trying to infer
	// or fall back if it's missing — see Identity package doc.
	PrimaryDomain string

	// DefaultDomain is the platform's catch-all sender domain. Production
	// is "airoapp.ai"; non-prod environments override (e.g. "test-airoapp.ai")
	// so SPF/DKIM continue to align without a code change. Caller decides
	// the value (deployment-environment-specific); this package treats it
	// as opaque.
	//
	// Match semantics: exact-match on the domain part AND the local-part
	// must equal AppID (case-insensitively). Subdomains of DefaultDomain
	// do NOT pass the allow check — the platform domain is ours, and
	// subdomains of it are not customer territory. The local-part is
	// also pinned so a customer can't claim "support@<DefaultDomain>",
	// "noreply@<DefaultDomain>", or other platform-shaped addresses;
	// their only legitimate identity on the platform domain is the
	// canonical "<AppID>@<DefaultDomain>". Customers who want other
	// sender names must attach their own domain.
	DefaultDomain string
}

// IsAllowedSender reports whether addr may be used as a From or MAIL FROM
// identity for this app.
//
// addr can be either a bare addr-spec ("user@example.com") or a name-addr
// ("Acme Support <support@acme.com>") — the implementation parses with
// net/mail to extract the local and domain parts.
//
// Match rules:
//
//   - DefaultDomain branch: domain must equal DefaultDomain (case-
//     insensitive) AND the local-part must equal AppID (case-
//     insensitive). The local-part pinning prevents a customer from
//     claiming platform-shaped addresses like "support@<DefaultDomain>"
//     on our own domain.
//   - AttachedDomains branch: domain must exact-match any entry. The
//     customer attached and verified the whole name; any local-part
//     within it is theirs to use.
//
// Empty entries in AttachedDomains never match anything; an empty
// AppID disables the DefaultDomain branch entirely (no local-part
// to anchor against).
func (id Identity) IsAllowedSender(addr string) bool {
	local, domain := localAndDomain(addr)
	if domain == "" {
		return false
	}
	if domainMatches(domain, id.DefaultDomain) {
		appID := strings.TrimSpace(id.AppID)
		return appID != "" && strings.EqualFold(local, appID)
	}
	for _, attached := range id.AttachedDomains {
		if domainMatches(domain, attached) {
			return true
		}
	}
	return false
}

// CanonicalSender returns the platform-controlled fallback identity for this
// app. It's the address we use when the customer's claim is rejected, or
// when the call site doesn't accept a customer-supplied claim at all (the
// HTTP gateway).
//
// Resolution order for the domain part:
//  1. PrimaryDomain if non-empty — gives the legitimate custom-domain
//     customer a branded sender. Used verbatim, since DKIM/SPF onboarding
//     happens at exactly this name.
//  2. DefaultDomain otherwise.
//  3. Hard fallback to "airoapp.ai" only when both are empty (shouldn't
//     happen in practice but keeps the function total).
//
// The local-part is AppID, falling back to "unknown" when AppID is empty.
func (id Identity) CanonicalSender() string {
	if domain := normalizeDomain(id.PrimaryDomain); domain != "" {
		local := strings.TrimSpace(id.AppID)
		if local == "" {
			local = "unknown"
		}
		return local + "@" + domain
	}
	return id.DefaultDomainSender()
}

// EnforceSender returns the From address the proxy should use given a
// customer-claimed value, plus a flag indicating whether the original was
// rewritten. The flag is convenient for audit logging — when true, callers
// should also log the original claim alongside.
//
// If the claim passes IsAllowedSender, the original string is returned
// unchanged (display-name and all). Otherwise CanonicalSender is returned.
func (id Identity) EnforceSender(claimed string) (string, bool) {
	if id.IsAllowedSender(claimed) {
		return claimed, false
	}
	return id.CanonicalSender(), true
}

// HasSameDomainConflict reports whether resolvedFrom shares a domain with
// any address in recipients. When true, callers should fall back the From
// to DefaultDomainSender() — some mail security filters like ProofPoint
// quarantine messages arriving from an external relay that claim a From
// on a domain the recipient's org owns.
//
// The DefaultDomain itself is exempt: if the From is already on the
// platform domain, no fallback is needed — the platform domain is not
// owned by any recipient's org, so inbound filters won't treat it as
// impersonation.
func (id Identity) HasSameDomainConflict(resolvedFrom string, recipients []string) bool {
	_, fromDomain := localAndDomain(resolvedFrom)
	if fromDomain == "" {
		return false
	}
	if domainMatches(fromDomain, id.DefaultDomain) {
		return false
	}
	for _, rcpt := range recipients {
		_, rcptDomain := localAndDomain(rcpt)
		if rcptDomain != "" && domainMatches(fromDomain, rcptDomain) {
			return true
		}
	}
	return false
}

// DefaultDomainSender returns "<AppID>@<DefaultDomain>" regardless of
// PrimaryDomain. Used by same-domain fallback to ensure the From is on
// the platform domain.
func (id Identity) DefaultDomainSender() string {
	local := strings.TrimSpace(id.AppID)
	if local == "" {
		local = "unknown"
	}
	domain := normalizeDomain(id.DefaultDomain)
	if domain == "" {
		domain = "airoapp.ai"
	}
	return local + "@" + domain
}

// localAndDomain parses an RFC 5322 address and returns its local-part
// (verbatim, no normalization — local-parts are case-sensitive per RFC 5321
// even though most receivers treat them case-insensitively in practice;
// callers compare with strings.EqualFold) and the lowercased A-label
// domain part. Returns ("", "") if parsing failed, the address has no host
// part, or the domain cannot be converted to A-label form.
//
// IDNA Lookup conversion on the domain mirrors what the constructor does
// to attached entries (see acceptDomain): a U-label claim like
// "noreply@bücher.example" over an SMTPUTF8-enabled session is normalized
// to its A-label form ("xn--bcher-kva.example") before comparison so it
// can match the stored entry. Without this, the asymmetry would silently
// fail-closed for any IDN customer.
func localAndDomain(addr string) (string, string) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(addr))
	if err != nil {
		return "", ""
	}
	at := strings.LastIndex(parsed.Address, "@")
	if at < 0 || at == len(parsed.Address)-1 {
		return "", ""
	}
	rawDomain := parsed.Address[at+1:]
	ascii, err := idna.Lookup.ToASCII(rawDomain)
	if err != nil {
		return "", ""
	}
	return parsed.Address[:at], strings.ToLower(ascii)
}

// normalizeDomain trims whitespace and lowercases for comparison. Returns ""
// for inputs that are empty after trimming.
func normalizeDomain(d string) string {
	return strings.ToLower(strings.TrimSpace(d))
}

// domainMatches reports whether two domain strings are equal under
// normalization. The empty string never matches anything (so an unset
// DefaultDomain doesn't accidentally allow address-less claims).
func domainMatches(a, b string) bool {
	a = normalizeDomain(a)
	b = normalizeDomain(b)
	return a != "" && a == b
}
