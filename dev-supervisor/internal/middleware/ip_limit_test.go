package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/middleware"
)

// ipFromHeader mimics the production key extractor (Cf-Connecting-Ip) without
// pulling in the httpproxy package.
func ipFromHeader(r *http.Request) string {
	return r.Header.Get("Cf-Connecting-Ip")
}

func requestWithIP(path, ip string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if ip != "" {
		req.Header.Set("Cf-Connecting-Ip", ip)
	}
	return req
}

// blockingHandler signals on entered when a request arrives and blocks until
// release is closed, so tests can hold a known number of requests in-flight.
func blockingHandler(entered chan<- struct{}, release <-chan struct{}) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		entered <- struct{}{}
		<-release
		w.WriteHeader(http.StatusOK)
	})
}

func TestIPConnLimiter_RejectsOverLimitAndFreesSlots(t *testing.T) {
	const maxPerIP = 2
	entered := make(chan struct{}, 10)
	release := make(chan struct{})
	h := middleware.NewIPConnLimiter(maxPerIP, nil, ipFromHeader).Wrap(blockingHandler(entered, release))

	// Hold maxPerIP requests in-flight for the same IP.
	var wg sync.WaitGroup
	codes := make([]int, maxPerIP)
	for i := range maxPerIP {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
			codes[i] = rr.Code
		}(i)
	}
	for range maxPerIP {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("timed out waiting for in-flight requests to enter handler")
		}
	}

	// The next request from the same IP must be rejected.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("over-limit request: got status %d, want %d", rr.Code, http.StatusTooManyRequests)
	}
	if got := rr.Header().Get("Retry-After"); got == "" {
		t.Error("over-limit response missing Retry-After header")
	}

	// Releasing the in-flight requests frees their slots.
	close(release)
	wg.Wait()
	for i, c := range codes {
		if c != http.StatusOK {
			t.Errorf("in-flight request %d: got status %d, want 200", i, c)
		}
	}

	// A fresh request now succeeds (slot was returned, not leaked).
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for post-release request")
	}
	if rr.Code != http.StatusOK {
		t.Errorf("post-release request: got status %d, want 200", rr.Code)
	}
}

func TestIPConnLimiter_LimitsArePerIP(t *testing.T) {
	entered := make(chan struct{}, 10)
	release := make(chan struct{})
	h := middleware.NewIPConnLimiter(1, nil, ipFromHeader).Wrap(blockingHandler(entered, release))

	var wg sync.WaitGroup
	wg.Add(2)

	// Occupy the only slot for IP A.
	go func() {
		defer wg.Done()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/api/x", "10.0.0.1"))
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for IP A request")
	}

	// A different IP has its own independent budget.
	go func() {
		defer wg.Done()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/api/x", "10.0.0.2"))
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("different IP was incorrectly blocked by IP A's in-flight request")
	}

	close(release)
	wg.Wait()
}

func TestIPConnLimiter_ExcludedPathsBypass(t *testing.T) {
	entered := make(chan struct{}, 10)
	release := make(chan struct{})
	limiter := middleware.NewIPConnLimiter(1, []string{"/airo/health"}, ipFromHeader)
	h := limiter.Wrap(blockingHandler(entered, release))

	var wg sync.WaitGroup
	wg.Add(2)

	// Saturate the IP's single slot with a blocked /api request.
	go func() {
		defer wg.Done()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for /api request")
	}

	// An excluded health probe from the same IP must still pass.
	go func() {
		defer wg.Done()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/airo/health", "1.2.3.4"))
	}()
	// The excluded request reaches the (blocking) handler, proving it bypassed
	// the saturated limiter.
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("excluded path was blocked by the per-IP limit")
	}

	close(release)
	wg.Wait()
}

// TestIPConnLimiter_ExcludedPrefixDoesNotOverMatch pins the exclusion semantics
// inherited from IsPathExcluded: an excluded path without a trailing slash
// matches exactly, so a path that merely shares its prefix ("/airo/healthcheck"
// vs excluded "/airo/health") must still be rate-limited. This guards against a
// regression to naive prefix matching, which would let an attacker bypass the
// per-IP limit by appending characters to a health path.
func TestIPConnLimiter_ExcludedPrefixDoesNotOverMatch(t *testing.T) {
	entered := make(chan struct{}, 10)
	release := make(chan struct{})
	limiter := middleware.NewIPConnLimiter(1, []string{"/airo/health"}, ipFromHeader)
	h := limiter.Wrap(blockingHandler(entered, release))

	var wg sync.WaitGroup
	wg.Add(1)

	// Occupy the IP's single slot with a non-excluded request.
	go func() {
		defer wg.Done()
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for initial request")
	}

	// "/airo/healthcheck" only shares a prefix with "/airo/health"; it is NOT
	// excluded and must be rejected now that the IP's slot is taken.
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, requestWithIP("/airo/healthcheck", "1.2.3.4"))
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("/airo/healthcheck should be rate-limited (prefix is not an exclusion): got %d, want %d",
			rr.Code, http.StatusTooManyRequests)
	}

	close(release)
	wg.Wait()
}

func TestIPConnLimiter_DisabledIsPassthrough(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := middleware.NewIPConnLimiter(0, nil, ipFromHeader).Wrap(ok)

	for i := range 5 {
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, requestWithIP("/api/x", "1.2.3.4"))
		if rr.Code != http.StatusOK {
			t.Fatalf("disabled limiter request %d: got status %d, want 200", i, rr.Code)
		}
	}
}

func TestIPConnLimiter_EmptyKeyIsNotLimited(t *testing.T) {
	entered := make(chan struct{}, 10)
	release := make(chan struct{})
	defer close(release)
	h := middleware.NewIPConnLimiter(1, nil, ipFromHeader).Wrap(blockingHandler(entered, release))

	// Two concurrent requests with no identifiable key must both proceed
	// rather than share (and exhaust) a single counter.
	for range 2 {
		go func() {
			rr := httptest.NewRecorder()
			h.ServeHTTP(rr, requestWithIP("/api/x", ""))
		}()
	}
	for range 2 {
		select {
		case <-entered:
		case <-time.After(2 * time.Second):
			t.Fatal("keyless request was incorrectly rate-limited")
		}
	}
}
