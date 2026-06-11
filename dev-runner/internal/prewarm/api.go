package prewarm

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net/http"
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

// WarmAPI waits for baseURL to accept connections, then GETs every route in
// Routes SEQUENTIALLY (one at a time) to force Next.js dev compilation. The
// requests are intentionally serial: `next dev` compiles on a single shared
// compiler, so concurrent GETs cannot seal entries in parallel — they only
// thrash that one compiler (inflating each route's wall time — e.g. jwks took
// ~98s under a 12-way concurrent burst vs ~4ms once sealed) and obscure the
// per-route seal timing. One request at a time matches how the dev compiler
// actually works and yields clean, meaningful per-route durations. Per-route
// failures are written to out and ignored — the goal is compilation, not a
// successful response. It returns an error only if the server never becomes
// ready before ctx is done.
func WarmAPI(ctx context.Context, baseURL string, out io.Writer) error {
	client := insecureClient()

	if err := waitForReady(ctx, client, baseURL, out); err != nil {
		return err
	}
	fmt.Fprintf(out, "[prewarm] up; warming %d routes\n", len(Routes))

	for _, path := range Routes {
		warmRoute(ctx, client, baseURL, path, out)
	}
	fmt.Fprintln(out, "[prewarm] done")
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
