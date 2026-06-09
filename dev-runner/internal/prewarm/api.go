package prewarm

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"
)

const (
	readyPollInterval = 1 * time.Second
	readyProbeTimeout = 5 * time.Second
	routeTimeout      = 120 * time.Second
	// readyTimeout mirrors the original prewarm.mjs READY_TIMEOUT_MS (120 s).
	// It bounds only the server-ready poll in waitForReady; route GETs and
	// image warming are intentionally unbounded (long docker builds are fine).
	readyTimeout = 120 * time.Second
	// maxConcurrency bounds simultaneous in-flight route GETs so we don't
	// open ~140 sockets at once (the script's unbounded Promise.all).
	maxConcurrency = 12
)

// insecureClient trusts the dev proxy's mkcert cert (Go's bundle rejects it
// with UNABLE_TO_VERIFY_LEAF_SIGNATURE). Scoped to this package; never used
// for anything but localhost dev warming. redirect:manual mirrors the script.
func insecureClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			// InsecureSkipVerify trusts the localhost mkcert dev cert only;
			// MinVersion pins TLS 1.3 so the dev client still negotiates a
			// modern protocol despite skipping cert chain verification.
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS13}, //nolint:gosec // localhost dev cert only
		},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// syncWriter serializes concurrent writes from the route-warming goroutines so
// callers can pass any io.Writer (WarmAPI fans out across many goroutines).
type syncWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

// WarmAPI waits for baseURL to accept connections, then GETs every route in
// Routes (bounded concurrency) to force Next.js dev compilation. Per-route
// failures are written to out and ignored — the goal is compilation, not a
// successful response. It returns an error only if the server never becomes
// ready before ctx is done. Writes to out are serialized internally, so any
// io.Writer is safe to pass regardless of its own concurrency guarantees.
func WarmAPI(ctx context.Context, baseURL string, out io.Writer) error {
	sw := &syncWriter{w: out}
	client := insecureClient()

	if err := waitForReady(ctx, client, baseURL, sw); err != nil {
		return err
	}
	fmt.Fprintf(sw, "[prewarm] up; warming %d routes\n", len(Routes))

	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	for _, path := range Routes {
		wg.Add(1)
		sem <- struct{}{}
		go func(path string) {
			defer wg.Done()
			defer func() { <-sem }()
			warmRoute(ctx, client, baseURL, path, sw)
		}(path)
	}
	wg.Wait()
	fmt.Fprintln(sw, "[prewarm] done")
	return nil
}

func waitForReady(ctx context.Context, client *http.Client, baseURL string, out io.Writer) error {
	// Bound the ready-wait phase to readyTimeout (120 s), restoring the
	// prewarm.mjs READY_TIMEOUT_MS behaviour.  context.WithTimeout respects
	// the earlier of the two deadlines, so a caller-supplied shorter ctx
	// (e.g. the 200 ms test context) still wins.
	readyCtx, cancel := context.WithTimeout(ctx, readyTimeout)
	defer cancel()

	fmt.Fprintf(out, "[prewarm] waiting for %s ...\n", baseURL)
	for {
		if readyCtx.Err() != nil {
			return fmt.Errorf("timed out waiting for %s to become ready after %s", baseURL, readyTimeout)
		}
		probeCtx, probeCancel := context.WithTimeout(readyCtx, readyProbeTimeout)
		req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, baseURL+"/", nil)
		if err != nil {
			probeCancel()
			return fmt.Errorf("building probe request for %s: %w", baseURL, err)
		}
		resp, err := client.Do(req)
		probeCancel()
		if err == nil {
			_ = resp.Body.Close()
			return nil
		}
		select {
		case <-readyCtx.Done():
			return fmt.Errorf("timed out waiting for %s to become ready after %s", baseURL, readyTimeout)
		case <-time.After(readyPollInterval):
		}
	}
}

func warmRoute(ctx context.Context, client *http.Client, baseURL, path string, out io.Writer) {
	start := time.Now()
	reqCtx, cancel := context.WithTimeout(ctx, routeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, baseURL+path, nil)
	if err != nil {
		fmt.Fprintf(out, "  ERR  %6dms  %s  (%v)\n", time.Since(start).Milliseconds(), path, err)
		return
	}
	resp, err := client.Do(req)
	ms := time.Since(start).Milliseconds()
	if err != nil {
		fmt.Fprintf(out, "  ERR  %6dms  %s  (%v)\n", ms, path, err)
		return
	}
	_ = resp.Body.Close()
	fmt.Fprintf(out, "  %3d  %6dms  %s\n", resp.StatusCode, ms, path)
}
