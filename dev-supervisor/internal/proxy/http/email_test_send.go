package httpproxy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"
)

// emailTestSendResponse wraps dev-supervisor's existing
// /api/email/send response with the operator-facing signing-state
// fields needed to answer "did JWS fire on this send." We don't
// modify the upstream gateway — calling code that reads its response
// shape (dashboards, customer apps via nodemailer) is unaffected.
//
// On the wire:
//
//	{
//	  "signing_enabled": true,
//	  "key_id": "c4-20260520",
//	  "cell_id": "c4",
//	  "would_forward_to": "p3nlsmtpcp01-v01.prod.phx3.secureserver.net:25",
//	  "upstream_status": 200,
//	  "upstream": { ...verbatim /api/email/send body... }
//	}
//
// signing_enabled reflects the gateway's signFn at the moment of the
// proxy call: nil signFn → false (gateway forwards unsigned), non-nil
// → true (every send through that gateway gets X-GD-DKIM-{SIGN,PUB-
// KEY} injected before forward). The flag matches what the gateway
// did to the message we just proxied, modulo extreme races where the
// signer is rewired between our read and the gateway's read — not
// possible in practice (signer is set once at startup).
type emailTestSendResponse struct {
	SigningEnabled bool            `json:"signing_enabled"`
	KeyID          string          `json:"key_id,omitempty"`
	CellID         string          `json:"cell_id,omitempty"`
	WouldForwardTo string          `json:"would_forward_to,omitempty"`
	UpstreamStatus int             `json:"upstream_status"`
	Upstream       json.RawMessage `json:"upstream,omitempty"`
	UpstreamRaw    string          `json:"upstream_raw,omitempty"`
}

// localGatewayBaseURL is where dev-supervisor's email HTTP gateway
// listens. Hardcoded to the loopback default; if EMAIL_GATEWAY_LISTEN_ADDR
// is set to override, the proxy reads that too.
func localGatewayBaseURL() string {
	addr := strings.TrimSpace(os.Getenv("EMAIL_GATEWAY_LISTEN_ADDR"))
	if addr == "" {
		// Mirror emailhttp.DefaultListenAddr without importing the
		// package (avoids a dep cycle through the email gateway's
		// own http types).
		addr = "127.0.0.1:2525"
	}
	return "http://" + addr
}

// handleEmailTestSend forwards the caller's request body to the
// existing /api/email/send gateway on loopback and returns the
// upstream response wrapped with this alloc's signing state. Inert
// when DEV_SUPERVISOR_SIGN_DEBUG_ENABLED != "true".
//
// Two layers of gating, both must pass:
//
//  1. DEV_SUPERVISOR_SIGN_DEBUG_ENABLED env var on the alloc — set
//     by mhp-core's enableJwsSignDebug per-cell config. Test cells
//     only.
//  2. JWT middleware (route not in JWT_EXCLUDED_PATHS). The BFF
//     wrapper mints an agents-service token; direct nomad-alloc-exec
//     callers must supply a token themselves.
//
// On feature-off the handler returns 404 (not 403) so the surface
// area is not advertised to unauthenticated probes.
//
// IMPORTANT: this endpoint causes a REAL email to be sent through
// the existing pipeline. Use a test inbox you own as `to` — there
// is no dry-run mode here by design (the whole point is to exercise
// the same code path customer apps hit).
func (p *HTTPProxy) handleEmailTestSend(w http.ResponseWriter, r *http.Request) {
	if strings.TrimSpace(os.Getenv("DEV_SUPERVISOR_SIGN_DEBUG_ENABLED")) != "true" {
		http.NotFound(w, r)
		return
	}

	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Cap the proxied body. The email gateway has its own bounds
	// checks; this one stops a stray multi-GB attachment from
	// touching dev-supervisor's heap before the gateway can reject
	// it. 10 MiB matches the gateway's effective ceiling.
	const maxBody = 10 << 20
	bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, maxBody))
	if err != nil {
		http.Error(w, fmt.Sprintf("read body: %v", err), http.StatusBadRequest)
		return
	}

	gatewayURL := localGatewayBaseURL() + "/api/email/send"

	// Read signing state once, before the upstream call. This is the
	// value the gateway will use during this request (Go's
	// happens-before with the mu-locked read inside SetSigner makes
	// later mutations invisible to the in-flight upstream send).
	p.mu.RLock()
	signer := p.signer
	p.mu.RUnlock()

	signingEnabled := signer != nil
	keyID, cellID := "", ""
	if signer != nil {
		keyID = signer.KeyID()
		cellID = signer.CellID()
	}

	// Short timeout: localhost call to the gateway in the same
	// process. If this is slow, the gateway is wedged on its
	// SMTP forward, and we want to surface that as a 504 quickly
	// rather than tying up the BFF.
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, gatewayURL, bytes.NewReader(bodyBytes))
	if err != nil {
		http.Error(w, fmt.Sprintf("build upstream request: %v", err), http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	// Forward the alloc identity headers — the gateway's auth path
	// reads them to determine app-id for sender-policy enforcement.
	// In the BFF-wrapped flow these come from the JWT-middleware
	// rewrites; in direct-curl-via-nomad-alloc-exec the operator
	// must set X-Site-Id explicitly.
	for _, h := range []string{"X-Site-Id", "X-Customer-Id", "X-Shopper-Id", "Authorization"} {
		if v := r.Header.Get(h); v != "" {
			req.Header.Set(h, v)
		}
	}

	upstream, err := client.Do(req)
	if err != nil {
		slog.Error("email_test_send.upstream_failed",
			"error", err,
			"gateway_url", gatewayURL,
		)
		writeJSON(w, http.StatusBadGateway, emailTestSendResponse{
			SigningEnabled: signingEnabled,
			KeyID:          keyID,
			CellID:         cellID,
			WouldForwardTo: strings.TrimSpace(os.Getenv("SMTP_DESTINATION")),
			UpstreamStatus: 0,
			UpstreamRaw:    fmt.Sprintf("upstream call failed: %v", err),
		})
		return
	}
	defer upstream.Body.Close()

	upstreamBody, err := io.ReadAll(io.LimitReader(upstream.Body, maxBody))
	if err != nil {
		slog.Warn("email_test_send.upstream_read_failed", "error", err)
		writeJSON(w, http.StatusBadGateway, emailTestSendResponse{
			SigningEnabled: signingEnabled,
			KeyID:          keyID,
			CellID:         cellID,
			WouldForwardTo: strings.TrimSpace(os.Getenv("SMTP_DESTINATION")),
			UpstreamStatus: upstream.StatusCode,
			UpstreamRaw:    fmt.Sprintf("upstream body read failed: %v", err),
		})
		return
	}

	resp := emailTestSendResponse{
		SigningEnabled: signingEnabled,
		KeyID:          keyID,
		CellID:         cellID,
		WouldForwardTo: strings.TrimSpace(os.Getenv("SMTP_DESTINATION")),
		UpstreamStatus: upstream.StatusCode,
	}
	// Pass the upstream JSON through verbatim under the "upstream"
	// field if it parses; otherwise fall back to a raw string so
	// non-JSON errors (e.g. a 502 from the SMTP forward) are
	// readable.
	if json.Valid(upstreamBody) {
		resp.Upstream = json.RawMessage(upstreamBody)
	} else {
		resp.UpstreamRaw = string(upstreamBody)
	}

	slog.Info("email_test_send.ok",
		"signing_enabled", signingEnabled,
		"key_id", keyID,
		"cell", cellID,
		"upstream_status", upstream.StatusCode,
	)

	writeJSON(w, http.StatusOK, resp)
}

// writeJSON is a small helper kept local to this file to avoid
// dragging in a wider response-shaping dependency. Mirrors the
// pattern in the email gateway's handleSend.
func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Error("email_test_send.encode_failed", "error", err)
	}
}
