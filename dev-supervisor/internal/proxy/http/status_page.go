package httpproxy

import (
	_ "embed"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync/atomic"
	"syscall"
)

//go:embed status_page.html
var statusPageTemplateSrc string

// statusPageTpl is parsed once at init. Using html/template (not the manual
// substitution it replaced) lets the renderer apply context-aware escaping
// to the Title/Message fields and silences SAST warnings about writing
// unescaped data to http.ResponseWriter.
var statusPageTpl = template.Must(template.New("status_page").Parse(statusPageTemplateSrc))

const (
	defaultComingSoonTitle   = "Coming Soon!"
	defaultComingSoonMessage = "Your application is being prepared. Please check back soon."
	defaultSuspendedTitle    = "Site Suspended"
	defaultSuspendedMessage  = "Access to this site is not currently available, " +
		"please contact support if you are the owner of this site."
)

// StatusPageConfig configures the embedded fallback status page.
type StatusPageConfig struct {
	// Suspended marks the site as suspended at startup. Sticky: even if a
	// /dist/current symlink later appears, Active() stays true while Suspended.
	Suspended bool

	// DistDir is the directory holding the publish archive. The page is active
	// whenever DistDir/current is missing. Defaults to "/dist".
	DistDir string

	// Title overrides the default page title. Empty = default for the mode.
	Title string

	// Message overrides the default page body. Empty = default for the mode.
	Message string
}

// statusPageData is the template data exposed to status_page.html.
type statusPageData struct {
	Title   string
	Message string
}

// StatusPage is the fallback HTML page served by dev-supervisor when the
// publish container has no app to proxy to (suspended, or no /dist/current).
// Rendering happens per-request via html/template.Execute so that escaping
// always flows through the templating engine.
type StatusPage struct {
	data      statusPageData
	suspended bool
	active    atomic.Bool
}

// NewStatusPage resolves the title/message copy, validates the embedded
// template renders cleanly, and probes the initial fallback state.
// Returns an error if the embedded template fails to render — essentially
// unreachable given template.Must at init, but matches the error-returning
// pattern of the surrounding boot code (TLS load, JWKS init, etc.).
func NewStatusPage(cfg StatusPageConfig) (*StatusPage, error) {
	distDir := cfg.DistDir
	if distDir == "" {
		distDir = "/dist"
	}

	title, message := resolveCopy(cfg)

	sp := &StatusPage{
		data:      statusPageData{Title: title, Message: message},
		suspended: cfg.Suspended,
	}
	// Smoke-test the template once at construction so any malformed
	// embedded content surfaces at startup, not on the first failover.
	if err := statusPageTpl.Execute(io.Discard, sp.data); err != nil {
		return nil, fmt.Errorf("status_page: template execute failed: %w", err)
	}

	// Initial active state. Suspended sites are always active. Otherwise
	// the page is active iff /dist/current is missing — but distinguish
	// ENOENT (the expected pre-publish state) from other errors (broken
	// mount permissions, I/O failure) so the operational signal isn't
	// lost. Defaulting to active on unexpected errors is safer than
	// proxying to a never-running backend.
	distCurrent := filepath.Join(distDir, "current")
	_, statErr := os.Lstat(distCurrent)
	switch {
	case cfg.Suspended:
		sp.active.Store(true)
	case statErr == nil:
		sp.active.Store(false)
	case errors.Is(statErr, os.ErrNotExist):
		sp.active.Store(true)
	default:
		slog.Warn("status_page.dist_probe_failed",
			"error", statErr,
			"dist_current", distCurrent,
			"fallback_active", true)
		sp.active.Store(true)
	}
	return sp, nil
}

func resolveCopy(cfg StatusPageConfig) (string, string) {
	title := defaultComingSoonTitle
	message := defaultComingSoonMessage
	if cfg.Suspended {
		title = defaultSuspendedTitle
		message = defaultSuspendedMessage
	}
	if cfg.Title != "" {
		title = cfg.Title
	}
	if cfg.Message != "" {
		message = cfg.Message
	}
	return title, message
}

// Active reports whether the fallback page should be served instead of
// proxying to the customer app.
func (sp *StatusPage) Active() bool {
	return sp.active.Load()
}

// MarkPublished signals that a publish archive is now current. Suspension is
// sticky: a suspended site stays active even after publish.
func (sp *StatusPage) MarkPublished() {
	if sp.suspended {
		sp.active.Store(true)
		return
	}
	sp.active.Store(false)
}

// MarkUnpublished signals that the publish archive is gone.
func (sp *StatusPage) MarkUnpublished() {
	sp.active.Store(true)
}

// ServeHTTP renders the embedded template directly to the response writer
// with HTTP 200. Per-request execution (rather than serving a cached []byte)
// keeps escaping inside html/template so static analyzers see the data flow
// they expect.
func (sp *StatusPage) ServeHTTP(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if err := statusPageTpl.Execute(w, sp.data); err != nil {
		// EPIPE / broken pipe is normal traffic noise (client closed the
		// connection mid-write) and not actionable. Anything else is a
		// genuine render-time failure that should be visible in production
		// logs, so log it at Warn rather than the previous blanket Debug.
		if errors.Is(err, syscall.EPIPE) {
			slog.Debug("status_page.client_disconnect", "error", err)
		} else {
			slog.Warn("status_page.render_failed", "error", err)
		}
	}
}

// fallbackBypassPaths skip the status-page middleware so that infra and
// load-balancer probes keep working even when a site is suspended.
var fallbackBypassPaths = map[string]struct{}{
	"/airo/health":        {},
	"/airo/canary_checks": {},
}

// statusPageMiddleware short-circuits the proxy chain with the cached HTML
// when sp.Active(). A nil sp disables the middleware (no behavior change).
// /airo/health and /airo/canary_checks always pass through so health probes
// keep functioning while a site is suspended or unpublished.
func statusPageMiddleware(sp *StatusPage) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if sp == nil {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, bypass := fallbackBypassPaths[r.URL.Path]; bypass {
				next.ServeHTTP(w, r)
				return
			}
			if sp.Active() {
				setHandler(r.Context(), "status_page")
				sp.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
