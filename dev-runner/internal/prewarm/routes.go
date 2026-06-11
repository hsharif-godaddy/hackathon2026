package prewarm

// Routes is the core set of app paths GETted by the opt-in prewarm (`pnpm run dev prewarm`, or the
// `w` keybinding) to force Next.js dev compilation of the route ENTRIES a developer hits on the hot
// path: the homepage, the apps list, creating an app, and opening the develop page plus its
// first-paint API fan-out. Page paths use the bare (no-market) form; Gasket middleware rewrites
// `/foo` to `/<market>/foo`, compiling the same entry. `_warmup` stands in for any dynamic segment.
// A GET against a POST/PATCH-only route returns 405, but Next.js compiles the handler entry either
// way (401/405/500 all seal the entry; only a 404 — a non-matching path — is a wasted warm).
//
// Scope: this list is deliberately limited to the create->develop->chat critical path, derived from
// 6 instrumented dev captures + per-flow static analysis. The dev compiler seals each entry on first
// hit (12-90s for heavy routes), serialized on one compiler — and a long synchronous seal starves the
// dev worker's event loop (the cause of the agents register cascade and the slow time-to-chat).
// Pre-sealing these entries ONLY helps because dev runs with on-demand-entry eviction disabled
// (onDemandEntries in app/next.config.js); without that, warmed entries evict within 60s and the warm
// is wasted. Long-tail surfaces (publish, transfer, dkim, database, domains panel, marketing,
// analytics) are intentionally omitted: they cold-compile once on first use, then stay warm via
// no-eviction. Maintenance: if a new route lands on the hot path (a "new victim" that cold-compiles
// at create/develop time), add it here — but keep the list lean; every entry adds to the prewarm wall.
var Routes = []string{
	// Pages (market-less; the heaviest entries)
	"/",
	"/apps",
	"/develop/_warmup",

	// Create action + agent registration (create button + register-JWT validation path)
	"/.well-known/jwks.json",
	"/api/sites/quick-create",
	"/api/auth/agent-token",
	"/api/referral-link",

	// Auth, config, readiness
	"/api/auth/token",
	"/api/auth/validate",
	"/api/config",
	"/api/health",
	"/api/client-logs",

	// Sites (develop first-paint + just-after-create polling)
	"/api/sites",
	"/api/sites/_warmup",
	"/api/sites/_warmup/archive-status",
	"/api/sites/_warmup/variables",
	"/api/sites/_warmup/image-status",
	"/api/sites/_warmup/deploy",

	// Apps
	"/api/apps/_warmup/git/remote/status",
	"/api/apps/_warmup/deployments",

	// Servers
	"/api/servers/_warmup",

	// Subscriptions, grants, pricing
	"/api/subscriptions",
	"/api/subscriptions/_warmup",
	"/api/credits/grants",
	"/api/pricing/offers",

	// Venture, domains
	"/api/venture",
	"/api/domains",

	// Secrets
	"/api/secrets/_warmup/diff",

	// Develop-adjacent (job stage, conversations, context)
	"/api/jobs/_warmup",
	"/api/conversations",
	"/api/develop/_warmup/context",
}
