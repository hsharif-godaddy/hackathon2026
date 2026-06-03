// Package seclog emits ECS-shaped security events tagged for SIEM routing.
//
// Output is JSON to stdout via slog. Every event carries `tags:["security",
// "application"]` so the Katana Fluent Bit sidecar forwards it to GoDaddy's
// Splunk SIEM intake while still surfacing in the standard application log
// stream for engineering visibility.
//
// SIEM contract: every event reaches stdout regardless of the application's
// LOG_LEVEL setting. seclog wraps slog.Default()'s handler in a level-bypass
// shim at emit time so that LOG_LEVEL=warn/error tunings filter only regular
// application logs — never security events. The wrapped handler's internal
// mutex still serializes writes, so the single-writer guarantee holds.
//
// The schema follows Elastic Common Schema (ECS) — nested `event.*`,
// `client.*`, `http.*`, `url.*`, `user.*`, `service.*`, `host.*`, `cloud.*`,
// `error.*`, and free-form `labels.*`. Splunk maps ECS to its Common
// Information Model in its ingest pipelines, so the Application Security
// Logging Standard remains satisfied.
//
// Aligned with @godaddy/security-logger (gdcorp-engineering/node-security-logger)
// for cross-language parity.
//
// See:
//   - https://tdl.int.gdcorp.tools/docs/products/security-identity-compliance/app-sec-log/
//   - https://tdl.int.gdcorp.tools/docs/products/compute/managed/katana/monitoring/#logging-security-events-into-siem
//   - https://github.com/gdcorp-engineering/node-security-logger
package seclog

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

// outcome mirrors ECS event.outcome. Unexported: external callers don't pick
// outcomes — the public helpers (AuthFailure, AuthSuccess, AuthzFailure) select
// the correct combination, preventing illegal pairings (e.g. success + denied).
type outcome string

const (
	outcomeSuccess outcome = "success"
	outcomeFailure outcome = "failure"
)

// category mirrors ECS event.category. Unexported (see outcome).
type category string

const (
	categoryAuthentication category = "authentication"
	categoryIAM            category = "iam"
)

// evType mirrors ECS event.type. Unexported (see outcome).
type evType string

const (
	typeAllowed evType = "allowed"
	typeDenied  evType = "denied"
)

const (
	defaultServiceName = "budget-service"
	authActionValidate = "auth.validate"
)

// Event is the per-call payload describing a security event. Fields populate
// ECS keys: Reason → event.reason, Status → http.response.status_code,
// User → user.name, Err → error.message. Labels are emitted under labels.*.
type Event struct {
	Reason string
	// Status is the HTTP response status the handler will return. Note:
	// AuthSuccess silently discards Status — the protected handler hasn't run
	// yet, so there is no response status to record. Set Status only on
	// AuthFailure / AuthzFailure events.
	Status int
	User   string
	Err    error
	// Action overrides event.action; defaults to "auth.validate" for the auth helpers.
	Action string
	Labels []slog.Attr
}

// Config sets the process-level identity fields shared across every event.
// Pass to Configure once at startup. Empty fields fall back to defaults:
//   - ServiceName: KATANA_APP env var, then "budget-service"
//   - Hostname:    os.Hostname()
//   - AWSAccountID: empty → cloud.account block omitted from output
//
// Mirrors the explicit-config pattern of @godaddy/security-logger
// (gdcorp-engineering/node-security-logger), which requires aws.accountId to
// be passed in by the caller rather than auto-discovered.
type Config struct {
	ServiceName  string
	AWSAccountID string
	Hostname     string
}

// identityCfg is the internal resolved identity snapshot used per emit().
// The slog handler / writer is owned by the consuming application via
// slog.Default(); this package never builds its own.
type identityCfg struct {
	serviceName  string
	hostname     string
	awsAccountID string
}

func resolveServiceName(explicit string) string {
	if v := strings.TrimSpace(explicit); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("KATANA_APP")); v != "" {
		return v
	}
	return defaultServiceName
}

func buildCfg(c Config) identityCfg {
	host := c.Hostname
	if host == "" {
		host, _ = os.Hostname()
	}
	return identityCfg{
		serviceName:  resolveServiceName(c.ServiceName),
		hostname:     host,
		awsAccountID: strings.TrimSpace(c.AWSAccountID),
	}
}

var (
	cfgMu sync.RWMutex
	cfg   = buildCfg(Config{})
)

// Configure sets the package-level configuration. Call once during startup
// before any AuthFailure / AuthSuccess / AuthzFailure calls. Safe to call
// again to update fields. Empty fields fall back to defaults documented on
// Config.
func Configure(c Config) {
	cfgMu.Lock()
	defer cfgMu.Unlock()
	cfg = buildCfg(c)
}

// setLoggerForTest swaps slog.Default() for the duration of a test and
// returns a restore func. Pass nil to also reset Configure'd identity fields
// to defaults — used at the start of a test to clear state from prior tests.
// Tests using this must not run in parallel.
func setLoggerForTest(l *slog.Logger) (restore func()) {
	prevLogger := slog.Default()

	cfgMu.Lock()
	prevCfg := cfg
	if l == nil {
		cfg = buildCfg(Config{})
	}
	cfgMu.Unlock()

	if l != nil {
		slog.SetDefault(l)
	}

	return func() {
		slog.SetDefault(prevLogger)
		cfgMu.Lock()
		cfg = prevCfg
		cfgMu.Unlock()
	}
}

func current() identityCfg {
	cfgMu.RLock()
	defer cfgMu.RUnlock()
	return cfg
}

// AuthFailure emits an authentication failure (event.category=authentication,
// event.outcome=failure, event.type=denied).
func AuthFailure(r *http.Request, ev Event) {
	emit(r, ev, categoryAuthentication, outcomeFailure, typeDenied, slog.LevelWarn)
}

// AuthSuccess emits a successful authentication (event.category=authentication,
// event.outcome=success, event.type=allowed). Note: Event.Status is silently
// discarded — the protected handler has not yet run, so there is no response
// status to record.
func AuthSuccess(r *http.Request, ev Event) {
	ev.Status = 0
	emit(r, ev, categoryAuthentication, outcomeSuccess, typeAllowed, slog.LevelInfo)
}

// AuthzFailure emits an authorization failure (event.category=iam,
// event.outcome=failure, event.type=denied). Use for allowlist denials and
// privileged-action checks where the principal is known.
func AuthzFailure(r *http.Request, ev Event) {
	emit(r, ev, categoryIAM, outcomeFailure, typeDenied, slog.LevelWarn)
}

func emit(r *http.Request, ev Event, cat category, outc outcome, typ evType, lvl slog.Level) {
	c := current()
	action := ev.Action
	if action == "" {
		action = authActionValidate
	}
	msg := "auth: " + ev.Reason
	if ev.Reason == "" {
		msg = "auth: " + string(outc)
	}

	attrs := make([]slog.Attr, 0, 12)
	attrs = append(attrs,
		slog.Any("tags", []string{"security", "application"}),
		slog.Group("event",
			slog.String("kind", "event"),
			slog.String("category", string(cat)),
			slog.String("type", string(typ)),
			slog.String("outcome", string(outc)),
			slog.String("action", action),
			slog.String("reason", ev.Reason),
		),
		slog.Group("service", slog.String("name", c.serviceName)),
		slog.Group("host", slog.String("name", c.hostname)),
	)
	if c.awsAccountID != "" {
		attrs = append(attrs, slog.Group("cloud",
			slog.Group("account", slog.String("id", c.awsAccountID)),
		))
	}
	attrs = append(attrs, requestAttrs(r, ev.Status)...)
	if ev.User != "" {
		attrs = append(attrs, slog.Group("user", slog.String("name", ev.User)))
	}
	if ev.Err != nil {
		attrs = append(attrs, slog.Group("error", slog.String("message", ev.Err.Error())))
	}
	if len(ev.Labels) > 0 {
		labelAttrs := make([]any, 0, len(ev.Labels))
		for _, a := range ev.Labels {
			labelAttrs = append(labelAttrs, a)
		}
		attrs = append(attrs, slog.Group("labels", labelAttrs...))
	}

	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}
	// Wrap the default handler so seclog bypasses the application's LOG_LEVEL
	// filter. Security events are SIEM-bound and must flow regardless of how
	// operators tune log noise — at LOG_LEVEL=warn AuthSuccess (LevelInfo)
	// would otherwise be silently dropped, leaving Splunk with denials but no
	// allows. The wrapped JSONHandler's internal mutex still serializes writes,
	// so this preserves the single-writer guarantee from the iteration-1 fix.
	logger := slog.New(&alwaysEmitHandler{inner: slog.Default().Handler()})
	logger.LogAttrs(ctx, lvl, msg, attrs...)
}

// alwaysEmitHandler delegates to an inner slog.Handler but reports Enabled=true
// for every level. Used by emit() to bypass the application's LOG_LEVEL filter
// while still going through the inner handler's writer + mutex.
type alwaysEmitHandler struct {
	inner slog.Handler
}

func (h *alwaysEmitHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h *alwaysEmitHandler) Handle(ctx context.Context, r slog.Record) error {
	return h.inner.Handle(ctx, r)
}
func (h *alwaysEmitHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &alwaysEmitHandler{inner: h.inner.WithAttrs(attrs)}
}
func (h *alwaysEmitHandler) WithGroup(name string) slog.Handler {
	return &alwaysEmitHandler{inner: h.inner.WithGroup(name)}
}

// requestAttrs builds the ECS-shaped client/http/url/user_agent groups from r.
// Returns an empty slice when r is nil. status==0 omits http.response.
func requestAttrs(r *http.Request, status int) []slog.Attr {
	if r == nil {
		return nil
	}
	ip := clientIP(r)
	httpAttrs := []any{
		slog.Group("request", slog.String("method", r.Method)),
	}
	if status > 0 {
		httpAttrs = append(httpAttrs, slog.Group("response", slog.Int("status_code", status)))
	}

	out := []slog.Attr{
		slog.Group("client",
			slog.String("ip", ip),
			slog.String("address", ip),
		),
		slog.Group("http", httpAttrs...),
	}
	if r.URL != nil {
		out = append(out, slog.Group("url",
			slog.String("path", r.URL.Path),
			slog.String("original", r.URL.RequestURI()),
		))
	}
	if ua := r.Header.Get("User-Agent"); ua != "" {
		out = append(out, slog.Group("user_agent", slog.String("original", ua)))
	}
	return out
}

// clientIP returns the originating client IP for use in SIEM-bound logs.
//
// Trust boundary: AWS ALB in default ("append") mode preserves any inbound
// X-Forwarded-For and appends the connecting client's IP to the right. The
// leftmost XFF entry is therefore client-supplied and attacker-spoofable; only
// the rightmost entry is attributable to the ALB. We take the rightmost XFF
// value, falling back to RemoteAddr (port stripped) when the header is absent
// or empty.
//
// If the deployment topology changes (additional trusted reverse proxies in
// front of the ALB, or the ALB is reconfigured to "preserve" mode and stops
// appending), this rule must be revisited — peel one entry off the right per
// trusted hop, or rely on RemoteAddr only.
func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		if comma := strings.LastIndexByte(xff, ','); comma >= 0 {
			return strings.TrimSpace(xff[comma+1:])
		}
		return xff
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
