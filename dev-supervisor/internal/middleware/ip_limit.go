package middleware

import (
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// retryAfterSeconds is sent in the Retry-After header on a 429 response. A short
// value is appropriate because this is a concurrency limit, not a fixed-window
// rate limit: a slot frees the instant any in-flight request from the same IP
// completes, so a well-behaved client can often succeed on a near-immediate
// retry. Abusive clients ignore Retry-After regardless.
const retryAfterSeconds = "1"

// rejectionLogInterval throttles the rejection / bypass logs. A flood is the
// exact condition this limiter exists to contain, so logging every rejected
// request would turn an attack into a self-inflicted log firehose. At most one
// line per interval is emitted per event type, carrying a suppressed-count so
// operators can still gauge the true volume.
const rejectionLogInterval = 1 * time.Second

// throttle emits at most one event per interval, counting how many were
// suppressed in between so the next emitted log can report the true volume.
type throttle struct {
	mu         sync.Mutex
	interval   time.Duration
	last       time.Time
	suppressed int64
}

// allow reports whether an event may be logged now. The second return value is
// the number of events dropped since the previous allowed log (meaningful only
// when the first is true), so the emitted line can report the true volume.
func (t *throttle) allow() (bool, int64) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	if t.last.IsZero() || now.Sub(t.last) >= t.interval {
		dropped := t.suppressed
		t.suppressed = 0
		t.last = now
		return true, dropped
	}
	t.suppressed++
	return false, 0
}

// IPConnLimiter bounds the number of concurrent in-flight requests per client
// IP. The abuse pattern that motivated it is long-held connections (a wedged
// backend keeps each request open for a long time), so a concurrency cap is a
// better fit than a request-rate limit.
//
// The in-flight map only holds entries for IPs with at least one active
// request (entries are deleted when their count returns to zero), so its size
// is naturally bounded by the global connection cap (LimitListener) - the map
// cannot itself become a memory-exhaustion vector, and no eviction goroutine
// is needed.
type IPConnLimiter struct {
	max           int
	excludedPaths []string
	// clientIP extracts the rate-limiting key for a request. It is injected so
	// the Cf-Connecting-Ip / RemoteAddr logic lives in one place (the httpproxy
	// package) and to avoid an import cycle.
	clientIP func(*http.Request) string

	mu       sync.Mutex
	inFlight map[string]int

	// rejectLog / bypassLog throttle the two operational log lines so a flood
	// cannot turn them into a firehose.
	rejectLog throttle
	bypassLog throttle
}

// NewIPConnLimiter builds a limiter that allows at most maxPerIP concurrent
// in-flight requests per client IP. Requests whose path matches one of
// excludedPaths bypass the limit entirely so infra probes such as
// health/canary checks are never throttled. Matching uses IsPathExcluded, the
// same helper the JWT and activity-tracking middleware use, so exclusion
// semantics are identical across the chain (exact match, or prefix only when
// the excluded path ends in "/").
func NewIPConnLimiter(maxPerIP int, excludedPaths []string, clientIP func(*http.Request) string) *IPConnLimiter {
	return &IPConnLimiter{
		max:           maxPerIP,
		excludedPaths: excludedPaths,
		clientIP:      clientIP,
		inFlight:      make(map[string]int),
		rejectLog:     throttle{interval: rejectionLogInterval},
		bypassLog:     throttle{interval: rejectionLogInterval},
	}
}

// Wrap returns a handler that enforces the per-IP concurrency limit before
// delegating to next. A limiter with max <= 0 is a pass-through (disabled).
func (l *IPConnLimiter) Wrap(next http.Handler) http.Handler {
	if l == nil || l.max <= 0 {
		return next
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if IsPathExcluded(r.URL.Path, l.excludedPaths) {
			next.ServeHTTP(w, r)
			return
		}

		key := l.clientIP(r)
		if key == "" {
			// No identifiable client key. In production the key extractor falls
			// back to RemoteAddr, so this is effectively unreachable; if it ever
			// fires, the proxy is being reached without a usable source address
			// - the same misconfiguration that defeats this layer - so surface
			// it (throttled) rather than silently bypassing.
			if ok, suppressed := l.bypassLog.allow(); ok {
				slog.WarnContext(r.Context(), "http.ratelimit.empty_key",
					"remote_addr", r.RemoteAddr,
					"path", r.URL.Path,
					"cf_ray", r.Header.Get("Cf-Ray"),
					"suppressed", suppressed)
			}
			next.ServeHTTP(w, r)
			return
		}

		if !l.acquire(key) {
			// Log at Warn (throttled) so the flood this limiter exists to
			// contain is visible at the production LOG_LEVEL=info default.
			if ok, suppressed := l.rejectLog.allow(); ok {
				slog.WarnContext(r.Context(), "http.ratelimit.rejected",
					"client_ip", key,
					"path", r.URL.Path,
					"cf_ray", r.Header.Get("Cf-Ray"),
					"max_conns_per_ip", l.max,
					"suppressed", suppressed)
			}
			w.Header().Set("Retry-After", retryAfterSeconds)
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		defer l.release(key)

		next.ServeHTTP(w, r)
	})
}

// acquire reserves an in-flight slot for key, returning false if the IP is
// already at its concurrency limit.
func (l *IPConnLimiter) acquire(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.inFlight[key] >= l.max {
		return false
	}
	l.inFlight[key]++
	return true
}

// release returns an in-flight slot for key, deleting the entry when it reaches
// zero so the map stays bounded by the number of currently-active IPs.
func (l *IPConnLimiter) release(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if l.inFlight[key] <= 1 {
		delete(l.inFlight, key)
		return
	}
	l.inFlight[key]--
}
