package email

import (
	"strings"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

// Tracking-header env vars. The first four ship on every outbound message
// — that's the long-standing contract the SMTP proxy and the hosting relay's
// spam-attribution pipeline rely on. The latter three are optional; we
// emit them only when set so the relay doesn't see "unknown"-noise for
// data mgmt-airo hasn't wired up yet.
const (
	envSiteID             = "SITE_ID"
	envProduct            = "PRODUCT"
	envEnv                = "NODE_ENV"
	envDatacenter         = "NOMAD_DC"
	envAccountCreatedDate = "ACCOUNT_CREATED_DATE"
	envShopperID          = "SHOPPER_ID"
	envOriginatingIP      = "ORIGINATING_IP"
)

// LoadTrackingHeaders returns the platform tracking headers injected on
// every outbound message — both the SMTP proxy (which copies a customer-
// authored message through and tacks these on) and the HTTP gateway
// (which builds its own RFC-5322 message) consume the same set so the
// hosting relay sees a consistent shape regardless of submission path.
//
// The four legacy headers (X-SITE-UID, X-PRODUCT, X-ENVIRONMENT,
// X-DATACENTER) are always present and default to "unknown" when their
// env var is absent, matching the SMTP proxy's pre-consolidation
// behavior.
//
// The three optional headers (X-ACCOUNT-CREATED-DATE, X-SHOPPER-ID,
// X-Originating-IP) are emitted only when their env var is set and
// non-whitespace. Until mgmt-airo populates those vars, they are
// effectively no-ops on every send — which is what we want.
func LoadTrackingHeaders() map[string]string {
	h := map[string]string{
		"X-SITE-UID":    config.GetEnvStringWithDefault(envSiteID, "unknown"),
		"X-PRODUCT":     config.GetEnvStringWithDefault(envProduct, "airo-app-builder"),
		"X-ENVIRONMENT": config.GetEnvStringWithDefault(envEnv, "unknown"),
		"X-DATACENTER":  config.GetEnvStringWithDefault(envDatacenter, "unknown"),
	}
	if v := strings.TrimSpace(config.GetEnvStringWithDefault(envAccountCreatedDate, "")); v != "" {
		h["X-ACCOUNT-CREATED-DATE"] = v
	}
	if v := strings.TrimSpace(config.GetEnvStringWithDefault(envShopperID, "")); v != "" {
		h["X-SHOPPER-ID"] = v
	}
	if v := strings.TrimSpace(config.GetEnvStringWithDefault(envOriginatingIP, "")); v != "" {
		h["X-Originating-IP"] = v
	}
	return h
}
