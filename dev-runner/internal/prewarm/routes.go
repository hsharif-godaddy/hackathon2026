package prewarm

// Routes is the list of app paths to GET to force Next.js dev compilation.
// Ported from app/scripts/prewarm.mjs. Page paths use the bare (no-market)
// form; middleware rewrites `/foo` to `/<market>/foo`, compiling the same
// chunk. `_warmup` stands in for any dynamic segment. GETting a POST-only
// route returns 405, but Next.js compiles the handler either way.
var Routes = []string{
	// Pages
	"/",
	"/apps",
	"/create",
	"/develop/_warmup",
	"/develop/_warmup/context",
	"/explore",
	"/explore/_warmup",
	"/manage-plan",
	"/share/_warmup",

	// Auth, config, well-known
	"/.well-known/jwks.json",
	"/api/auth/agent-token",
	"/api/auth/logout",
	"/api/auth/token",
	"/api/auth/validate",
	"/api/config",
	"/api/health",
	"/api/i18n/package",

	// Apps
	"/api/apps/_warmup/deployments",
	"/api/apps/_warmup/dkim/offboard",
	"/api/apps/_warmup/dkim/onboard",
	"/api/apps/_warmup/dkim/status",
	"/api/apps/_warmup/dns-check-conflict",
	"/api/apps/_warmup/domain/check",
	"/api/apps/_warmup/download",
	"/api/apps/_warmup/email-signing/debug",
	"/api/apps/_warmup/events",
	"/api/apps/_warmup/exports",
	"/api/apps/_warmup/git/return",
	"/api/apps/_warmup/project-domain",
	"/api/apps/_warmup/publish-snapshots",
	"/api/apps/_warmup/purge-cache",
	"/api/apps/_warmup/share",
	"/api/apps/_warmup/subscription",
	"/api/apps/_warmup/transfer",
	"/api/apps/_warmup/transfer/cancel",
	"/api/apps/_warmup/transfer/validate",
	"/api/apps/_warmup/unpublish",

	// Sites
	"/api/sites",
	"/api/sites/_warmup",
	"/api/sites/_warmup/archive-restore",
	"/api/sites/_warmup/archive-status",
	"/api/sites/_warmup/deploy",
	"/api/sites/_warmup/domain-dns-ownership",
	"/api/sites/_warmup/domain-errors",
	"/api/sites/_warmup/domains",
	"/api/sites/_warmup/domains/job",
	"/api/sites/_warmup/image-status",
	"/api/sites/_warmup/reload-images",
	"/api/sites/_warmup/resume",
	"/api/sites/_warmup/variables",
	"/api/sites/quick-create",

	// Servers
	"/api/servers",
	"/api/servers/_warmup",

	// Subscriptions, entitlements, pricing, grants, token budget
	"/api/credits/grants",
	"/api/ecomm-subscription/auto-renew",
	"/api/ecomm-subscription/status",
	"/api/entitlements",
	"/api/entitlements/_warmup/update",
	"/api/pricing/offers",
	"/api/subscription-cache",
	"/api/subscription/exports/status",
	"/api/subscriptions",
	"/api/subscriptions/_warmup",
	"/api/subscriptions/_warmup/acknowledge",
	"/api/subscriptions/renew",
	"/api/token-budget/_warmup",

	// Database
	"/api/database/_warmup/tables",
	"/api/database/_warmup/tables/_warmup/data",
	"/api/database/_warmup/tables/_warmup/export",
	"/api/database/_warmup/tables/_warmup/rows",
	"/api/database/_warmup/tables/_warmup/schema",

	// Domains
	"/api/domains",
	"/api/domains/config",
	"/api/domains/isc-session",
	"/api/domains/search",

	// Develop, conversations, jobs, projects, venture, transfer
	"/api/conversations",
	"/api/develop/_warmup/context",
	"/api/jobs/_warmup",
	"/api/projects",
	"/api/transfer",
	"/api/venture",

	// Secrets, security
	"/api/secrets/_warmup/diff",
	"/api/secrets/_warmup/sync",
	"/api/secrets/_warmup/variants/_warmup",
	"/api/security-report/_warmup",

	// Analytics, logs, feedback, referrals, misc
	"/api/analytics/graphql",
	"/api/analytics/insights-feedback",
	"/api/cds-log",
	"/api/client-logs",
	"/api/crm/case",
	"/api/es-logs",
	"/api/eval-snapshots",
	"/api/feedback/s3-store",
	"/api/marketing/calendar",
	"/api/mcp/proxy",
	"/api/referral-link",
	"/api/referral/track",
	"/api/slack-webhook/feedback",
	// NOTE: /api/testpilot/[taskid] is intentionally omitted — it is not part
	// of the core local-dev flow and its handler times out frequently during
	// warmup, slowing the whole prewarm for no benefit.
}
