// Package emailhttp implements the dev-supervisor HTTP email gateway.
//
// Customer apps POST JSON to http://localhost:2525/api/email/send. The
// gateway authors the outbound RFC-5322 message — From and Reply-To are
// derived from the platform's sender-identity policy (see
// internal/email.DeriveOutbound), tracking headers come from
// internal/email.LoadTrackingHeaders, and delivery to the configured
// SMTP destination goes through internal/email.ForwardSMTP. The same
// SMTP_DESTINATION env var the legacy SMTP proxy reads is reused, so
// local dev (Mailpit on host.docker.internal:1025) and production
// (relay-hosting.secureserver.net:25) both work without a second knob.
//
// The gateway never accepts a customer-supplied From: it's the whole
// point of moving customer email submissions off SMTP onto a structured
// API. Rejecting the field via DisallowUnknownFields is the contract
// the email skill leans on.
package emailhttp

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

const (
	// DefaultListenAddr is the address the gateway listens on when
	// EMAIL_GATEWAY_LISTEN_ADDR is unset.
	DefaultListenAddr = "127.0.0.1:2525"

	// SendPath is the HTTP path that accepts outbound email submissions.
	SendPath = "/api/email/send"

	// fallbackDefaultDomain is used when AIRO_DEFAULT_SENDER_DOMAIN is
	// not configured. Production value; non-prod environments override
	// via the env var.
	fallbackDefaultDomain = "airoapp.ai"

	readHeaderTimeout = 5 * time.Second
	// readTimeout bounds the total time spent reading a request, headers
	// included. Without it, a caller can stay within MaxBytesReader's
	// byte cap by trickling 5 MB at <1 byte/sec and hold a handler
	// goroutine for hours. Loopback is the only legitimate caller and
	// 5 MB on loopback is sub-millisecond, so a generous 30s is loose
	// enough to never trip a real client and tight enough to cut off
	// the slow-body vector before goroutine pressure matters.
	readTimeout     = 30 * time.Second
	writeTimeout    = 10 * time.Second
	idleTimeout     = 30 * time.Second
	shutdownTimeout = 5 * time.Second

	// maxBodyBytes caps a single send payload. 5 MB accommodates a
	// reasonable HTML email with inline assets while bounding memory if
	// a buggy customer app loops or a misuse attempts a DoS.
	maxBodyBytes = 5 * 1024 * 1024

	// maxRecipients is a per-send hard cap across To+Cc+Bcc. The relay
	// will refuse very large fanouts anyway; failing fast keeps a
	// runaway loop from chewing through memory before the relay
	// notices.
	maxRecipients = 100

	// Body field caps applied on top of maxBodyBytes. The HTTP body cap
	// catches accidental megabytes of base64 in HTML; the per-field caps
	// give clearer errors for malformed callers.
	maxSubjectBytes  = 998 // RFC 5322 line length minus "Subject: "
	maxBodyFieldSize = 1 * 1024 * 1024
	maxAddressBytes  = 254 // RFC 5321 §4.5.3.1.3
	maxFromNameBytes = 128 // raw UTF-8 byte cap on display name; RFC 2047 encoded form may be longer but mail.Address.String() handles folding

	// Attachment caps. maxAttachmentBytes is the decoded size; the
	// base64 inflation (~4/3) plus the maxBodyBytes cap means a caller
	// can't reach 10×2 MB worth of attachments in a single send — the
	// HTTP body cap will trip first. The pair is documented as a contract
	// rather than a tight bound: "you can attach up to 10 files, each up
	// to 2 MB, and the whole request must stay under 5 MB."
	maxAttachments      = 10
	maxAttachmentBytes  = 2 * 1024 * 1024
	maxFilenameBytes    = 255
	maxContentTypeBytes = 200
)

// SendRequest is the JSON shape POSTed to SendPath. Either Text, HTML,
// or both must be present. Subject is required.
//
// From is optional but policy-checked when set: the address must live on
// a domain the app has verified-attached, or on the platform default
// domain with the app's local-part. A claim that fails IsAllowedSender
// returns a 400 with a helpful error listing the verified domains —
// fail-loud is the deliberate contrast with the SMTP proxy's silent
// rewrite (which is forced by the protocol; the HTTP API can refuse
// before anything is sent). Omitting From defaults to the canonical
// "<AppID>@<PrimaryDomain>" so apps without a custom domain still send.
//
// FromName is an optional display name placed in the From header's
// RFC 5322 name-addr form. When set, the final From header becomes
// "FromName" <resolved-addr>. When omitted, the From header contains
// the bare addr-spec as before. FromName itself is validated (length
// ≤ maxFromNameBytes, no CR/LF) but has no effect on sender-identity
// policy — that checks only the addr-spec.
//
// ReplyTo is just Reply-To: it sets the Reply-To header verbatim. No
// domain-matching, no promotion, no special cases. To control the
// sender's local-part, attach the relevant domain and pass From.
type SendRequest struct {
	To          []string     `json:"to"`
	From        string       `json:"from,omitempty"`
	FromName    string       `json:"fromName,omitempty"`
	CC          []string     `json:"cc,omitempty"`
	BCC         []string     `json:"bcc,omitempty"`
	Subject     string       `json:"subject"`
	Text        string       `json:"text,omitempty"`
	HTML        string       `json:"html,omitempty"`
	ReplyTo     string       `json:"replyTo,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

// Attachment is a single file attached to an outbound message.
//
// Filename is required and used for both the on-the-wire `name`/`filename`
// MIME parameters. Header injection bytes (CR, LF, quote, backslash) are
// rejected outright by validate — truncating would yield meaningless
// filenames and silently mangling the customer's data is worse than a
// clear 400.
//
// Content is the file body, base64-encoded. The gateway decodes it once
// and re-encodes on the wire with RFC 2045 line wrapping. Sending raw
// bytes through JSON would require some other transport entirely; base64
// is the universal default.
//
// ContentType is optional. When set it must parse via mime.ParseMediaType
// — that catches CR/LF, stray semicolons, and other malformed values that
// could break header framing. When unset the gateway defaults to
// application/octet-stream.
type Attachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"contentType,omitempty"`
}

// SendResponse is the JSON shape returned for every request.
//
// On success: {success: true, messageId: "..."}.
// On validation/dispatch error: {success: false, messageId?: "...", error: "..."}.
// MessageID is included on dispatch errors so the caller can correlate
// with audit log lines (the gateway already minted one before dispatch
// failed).
type SendResponse struct {
	Success   bool   `json:"success"`
	MessageID string `json:"messageId,omitempty"`
	Error     string `json:"error,omitempty"`
}

// SignFunc signs the outbound message body and injects the JWS-bearing
// relay-trust headers (X-GD-DKIM-SIGN / X-GD-DKIM-PUB-KEY) before
// forwarding. When set on a Gateway, the signature matches
// signing.Signer.SignMessage so a *signing.Signer's method value plugs
// in directly.
//
// A nil SignFunc disables signing — the gateway forwards unsigned. The
// production wiring in cmd/dev-supervisor leaves it unset when no key
// material is mounted (local dev / Mailpit).
type SignFunc func(body []byte, siteID, from string) []byte

// Gateway is the HTTP server lifecycle wrapper. One per dev-supervisor
// process.
type Gateway struct {
	listenAddr      string
	destinationAddr string
	identityFn      func() (email.Identity, error)
	forward         func(destAddr, envelopeFrom string, rcpts []string, body []byte) error
	signFn          SignFunc
	now             func() time.Time

	// verboseErrors controls whether customer-facing error responses (400
	// validation/policy errors and 502 forward errors) include the
	// underlying detail or a generic placeholder. Verbose helps the AI
	// agent self-correct in preview iterations — a 400 with "Verified:
	// airoapp.ai (platform default), acme.com" tells the agent which
	// domain to attach or to omit `from` entirely; a 502 with "550 sender
	// quota exceeded" tells the agent the failure is non-retryable.
	//
	// Sanitized is appropriate for production for two reasons:
	//   - The 502 may surface to end-users of the customer's app; leaking
	//     relay text and infrastructure addresses adds nothing useful.
	//   - The verbose 400 includes the customer's attached-domain list,
	//     which is sensitive (reveals the brand setup) and is enumerable
	//     by an attacker probing the gateway with intentional misuse.
	//
	// Driven by NODE_ENV in New(): "production" → sanitized, anything else
	// → verbose. Reuses the env var dev-supervisor already reads for the
	// X-ENVIRONMENT tracking header instead of inventing a new knob.
	// slog always carries the full error regardless.
	verboseErrors bool

	server   *http.Server
	listener net.Listener
	mu       sync.Mutex
	running  bool
}

// New constructs an env-driven Gateway. SMTP_DESTINATION is shared with
// the legacy SMTP proxy on purpose — same default, same override, same
// destination from the relay's perspective.
func New() *Gateway {
	siteID := config.GetEnvStringWithDefault("SITE_ID", "")
	defaultDomain := config.GetEnvStringWithDefault("AIRO_DEFAULT_SENDER_DOMAIN", fallbackDefaultDomain)
	loader := allocconfig.Default()
	return &Gateway{
		listenAddr:      config.GetEnvStringWithDefault("EMAIL_GATEWAY_LISTEN_ADDR", DefaultListenAddr),
		destinationAddr: config.GetEnvStringWithDefault("SMTP_DESTINATION", "relay-hosting.secureserver.net:25"),
		identityFn: func() (email.Identity, error) {
			return email.IdentityFromAllocConfig(loader, siteID, defaultDomain)
		},
		forward:       email.ForwardSMTP,
		now:           time.Now,
		verboseErrors: !strings.EqualFold(config.GetEnvStringWithDefault("NODE_ENV", ""), "production"),
	}
}

// NewForTesting injects all collaborators. Used by tests that pin the
// destination, supply a deterministic Identity, or stub out the SMTP
// forward to capture wire bytes without standing up a relay.
//
// verboseErrors controls 502 body content (see field doc on Gateway).
// Tests default to true so the existing assertion patterns ("body contains
// 'relay rejected'") keep working without env juggling; the sanitization
// path has its own dedicated test that passes false.
func NewForTesting(
	listenAddr string,
	destinationAddr string,
	identityFn func() (email.Identity, error),
	forward func(destAddr, envelopeFrom string, rcpts []string, body []byte) error,
	now func() time.Time,
	verboseErrors bool,
) *Gateway {
	if forward == nil {
		forward = email.ForwardSMTP
	}
	if now == nil {
		now = time.Now
	}
	return &Gateway{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		identityFn:      identityFn,
		forward:         forward,
		now:             now,
		verboseErrors:   verboseErrors,
	}
}

// SetSigner installs the JWS signing function. Must be called before
// Start — the handler reads the function under the gateway lock per
// request, so changes after Start take effect on subsequent requests
// without restart, but production wiring sets this once at startup.
//
// Pass nil to disable signing.
func (g *Gateway) SetSigner(fn SignFunc) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.signFn = fn
}

// Start binds the listener and serves HTTP until Stop is called.
// Returns nil on success even though Serve runs in a goroutine — the
// listener is bound before this returns, so any port binding failure
// surfaces here synchronously.
func (g *Gateway) Start() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.running {
		return errors.New("email gateway already running")
	}

	mux := http.NewServeMux()
	mux.HandleFunc(SendPath, g.handleSend)

	//nolint:noctx // Long-lived listener; no request context available.
	listener, err := net.Listen("tcp", g.listenAddr)
	if err != nil {
		return fmt.Errorf("email gateway listen: %w", err)
	}
	g.listener = listener

	g.server = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
	g.running = true

	slog.Info("email gateway started",
		"listen_addr", listener.Addr().String(),
		"destination", g.destinationAddr,
	)

	go func() {
		if err := g.server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			g.mu.Lock()
			stillRunning := g.running
			g.mu.Unlock()
			if stillRunning {
				slog.Error("email gateway server error", "error", err)
			}
		}
	}()

	return nil
}

// Stop gracefully shuts the gateway down with a short deadline.
func (g *Gateway) Stop() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if !g.running {
		return nil
	}
	g.running = false

	if g.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := g.server.Shutdown(ctx); err != nil {
			slog.Warn("email gateway shutdown error", "error", err)
		}
	}

	slog.Info("email gateway stopped")
	return nil
}

// Addr returns the bound listen address. Empty if not yet started.
// Useful in tests using ":0" so they can dial the actual port.
func (g *Gateway) Addr() string {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.listener != nil {
		return g.listener.Addr().String()
	}
	return ""
}

func (g *Gateway) handleSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, SendResponse{Error: "method not allowed"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)

	var req SendRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		// MaxBytesReader's error path produces "http: request body too
		// large" which we forward as 413; everything else is a 400.
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "request body too large") {
			status = http.StatusRequestEntityTooLarge
		}
		slog.Warn("email_gateway.request_decode_failed", "error", err, "status", status)
		writeJSON(w, status, SendResponse{
			Error: g.publicError(fmt.Sprintf("invalid request body: %v", err), "request invalid"),
		})
		return
	}
	if err := req.validate(); err != nil {
		slog.Warn("email_gateway.request_validation_failed", "error", err)
		writeJSON(w, http.StatusBadRequest, SendResponse{
			Error: g.publicError(err.Error(), "request invalid"),
		})
		return
	}

	id, err := g.identityFn()
	if err != nil {
		// Fail closed — same posture as the SMTP proxy. An empty
		// Identity would silently rewrite every From to
		// "unknown@<DefaultDomain>", which is worse than refusing the
		// send and letting the customer retry.
		slog.Error("email_gateway.identity_load_failed", "error", err)
		writeJSON(w, http.StatusServiceUnavailable, SendResponse{Error: "sender identity unavailable"})
		return
	}

	// From-address policy. Symmetric with Identity.IsAllowedSender on the
	// SMTP path (same allow rules, same Identity), but failure is loud:
	// 400 with the list of verified domains so the customer's code can
	// surface a deterministic error instead of getting silently rewritten
	// after the fact.
	from := req.From
	fromSource := "explicit"
	switch {
	case from == "":
		from = id.CanonicalSender()
		fromSource = "default"
	case !id.IsAllowedSender(from):
		slog.Warn("email_gateway.from_unverified",
			"claimed_from", from,
			"app_id", id.AppID,
			"verified_domains", id.AttachedDomains,
			"default_domain", id.DefaultDomain,
		)
		writeJSON(w, http.StatusBadRequest, SendResponse{
			Error: g.publicError(unverifiedFromMessage(from, id), "from address not permitted"),
		})
		return
	}

	// Same-domain fallback: if the resolved From shares a domain with any
	// recipient, fall back to the platform domain. Some mail security
	// filters like ProofPoint quarantine messages arriving from an
	// external relay that claim a From on the recipient's own domain
	// (seen as impersonation).
	allRecipients := make([]string, 0, len(req.To)+len(req.CC)+len(req.BCC))
	allRecipients = append(allRecipients, req.To...)
	allRecipients = append(allRecipients, req.CC...)
	allRecipients = append(allRecipients, req.BCC...)

	if id.HasSameDomainConflict(from, allRecipients) {
		originalFrom := from
		from = id.DefaultDomainSender()
		slog.Info("email_gateway.same_domain_fallback",
			"original_from", originalFrom,
			"fallback_from", from,
			"app_id", id.AppID,
		)
		fromSource = "same_domain_fallback"
	}

	if req.FromName != "" {
		bare, _ := addrSpec(from)
		from = (&mail.Address{Name: req.FromName, Address: bare}).String()
	}

	attachments, err := decodeAttachments(req.Attachments)
	if err != nil {
		// Decode failures are caller-fixable (malformed base64 or oversized
		// content) — same posture as validate() failures.
		slog.Warn("email_gateway.attachment_decode_failed", "error", err)
		writeJSON(w, http.StatusBadRequest, SendResponse{
			Error: g.publicError(err.Error(), "attachment invalid"),
		})
		return
	}

	prepared := preparedMessage{
		MessageID:   newMessageID(),
		From:        from,
		ReplyTo:     req.ReplyTo,
		To:          req.To,
		CC:          req.CC,
		BCC:         req.BCC,
		Subject:     req.Subject,
		Text:        req.Text,
		HTML:        req.HTML,
		Attachments: attachments,
	}

	body, err := buildMessage(prepared, email.LoadTrackingHeaders(), g.now)
	if err != nil {
		slog.Error("email_gateway.build_failed",
			"error", err,
			"message_id", prepared.MessageID,
			"app_id", id.AppID,
		)
		writeJSON(w, http.StatusInternalServerError, SendResponse{
			MessageID: prepared.MessageID,
			Error:     "failed to build message",
		})
		return
	}

	envelopeFrom, err := addrSpec(prepared.From)
	if err != nil {
		// validate() already parsed an explicit From; CanonicalSender
		// produces a fixed-shape "<local>@<domain>". Reaching this means
		// either Identity carried a malformed default-domain value (an
		// alloc-config bug) or req.From got past validate's parser
		// somehow. Either way, fail loud rather than 502 the customer.
		slog.Error("email_gateway.invalid_envelope_from",
			"error", err,
			"derived_from", prepared.From,
			"from_source", fromSource,
			"message_id", prepared.MessageID,
		)
		writeJSON(w, http.StatusInternalServerError, SendResponse{
			MessageID: prepared.MessageID,
			Error:     "internal: derived sender unparseable",
		})
		return
	}

	rcpts, err := buildEnvelopeRcpts(prepared)
	if err != nil {
		// validate() already parsed each address, so reaching this is
		// effectively impossible — but treat it as an internal error
		// rather than 400 so we notice if it ever happens.
		slog.Error("email_gateway.envelope_rcpt_build",
			"error", err,
			"message_id", prepared.MessageID,
		)
		writeJSON(w, http.StatusInternalServerError, SendResponse{
			MessageID: prepared.MessageID,
			Error:     "internal: envelope build failed",
		})
		return
	}

	// JWS sign for relay trust. The body_hash claim covers the message
	// as it leaves buildMessage (tracking headers included, signing
	// headers not yet injected) — the relay strips X-GD-DKIM-* before
	// hashing, so the relay's reconstruction matches what we signed
	// over. A nil signFn or signing failure forwards unsigned.
	g.mu.Lock()
	signFn := g.signFn
	g.mu.Unlock()
	headersInjected := false
	if signFn != nil {
		bodyBefore := len(body)
		body = signFn(body, id.AppID, envelopeFrom)
		headersInjected = len(body) > bodyBefore
		slog.Info("email_gateway.jws_sign.applied",
			"app_id", id.AppID,
			"from", envelopeFrom,
			"body_size_before", bodyBefore,
			"body_size_after", len(body),
			"headers_injected", headersInjected,
		)
	}

	if err := g.forward(g.destinationAddr, envelopeFrom, rcpts, body); err != nil {
		// slog always carries the verbose error — operators with log
		// access see everything regardless of NODE_ENV.
		slog.Error("email_gateway.forward_failed",
			"error", err,
			"message_id", prepared.MessageID,
			"destination", g.destinationAddr,
			"app_id", id.AppID,
		)
		writeJSON(w, http.StatusBadGateway, SendResponse{
			MessageID: prepared.MessageID,
			Error: g.publicError(
				err.Error(),
				"upstream relay failed; see message_id in dev-supervisor logs",
			),
		})
		return
	}

	slog.Info("email_gateway.send.ok",
		"message_id", prepared.MessageID,
		"from_source", fromSource,
		"to_count", len(prepared.To),
		"cc_count", len(prepared.CC),
		"bcc_count", len(prepared.BCC),
		"attachment_count", len(prepared.Attachments),
		"body_size", len(body),
		"signing_applied", headersInjected,
		"destination", g.destinationAddr,
		"app_id", id.AppID,
	)
	writeJSON(w, http.StatusOK, SendResponse{Success: true, MessageID: prepared.MessageID})
}

// validate runs structural and bounds checks on the request. Address
// shape is checked here (mail.ParseAddress) because the relay only
// accepts addr-spec / name-addr — we want to fail fast with a clear
// 400 rather than push malformed data to ForwardSMTP and surface a 502.
func (r SendRequest) validate() error {
	if len(r.To) == 0 {
		return errors.New("to is required")
	}
	if len(r.To)+len(r.CC)+len(r.BCC) > maxRecipients {
		return fmt.Errorf("too many recipients: %d > %d", len(r.To)+len(r.CC)+len(r.BCC), maxRecipients)
	}
	if err := validateAddresses("to", r.To); err != nil {
		return err
	}
	if err := validateAddresses("cc", r.CC); err != nil {
		return err
	}
	if err := validateAddresses("bcc", r.BCC); err != nil {
		return err
	}
	if strings.TrimSpace(r.Subject) == "" {
		return errors.New("subject is required")
	}
	if len(r.Subject) > maxSubjectBytes {
		return fmt.Errorf("subject too long: %d > %d", len(r.Subject), maxSubjectBytes)
	}
	if strings.TrimSpace(r.Text) == "" && strings.TrimSpace(r.HTML) == "" {
		return errors.New("at least one of text or html is required")
	}
	if len(r.Text) > maxBodyFieldSize {
		return fmt.Errorf("text too long: %d > %d", len(r.Text), maxBodyFieldSize)
	}
	if len(r.HTML) > maxBodyFieldSize {
		return fmt.Errorf("html too long: %d > %d", len(r.HTML), maxBodyFieldSize)
	}
	if r.ReplyTo != "" {
		if len(r.ReplyTo) > maxAddressBytes {
			return fmt.Errorf("replyTo too long: %d > %d", len(r.ReplyTo), maxAddressBytes)
		}
		if _, err := mail.ParseAddress(r.ReplyTo); err != nil {
			return fmt.Errorf("invalid replyTo %q: %w", r.ReplyTo, err)
		}
	}
	if r.From != "" {
		if len(r.From) > maxAddressBytes {
			return fmt.Errorf("from too long: %d > %d", len(r.From), maxAddressBytes)
		}
		if _, err := mail.ParseAddress(r.From); err != nil {
			return fmt.Errorf("invalid from %q: %w", r.From, err)
		}
	}
	if r.FromName != "" {
		if len(r.FromName) > maxFromNameBytes {
			return fmt.Errorf("fromName too long: %d > %d", len(r.FromName), maxFromNameBytes)
		}
		if strings.ContainsAny(r.FromName, "\r\n") {
			return errors.New("fromName contains forbidden characters")
		}
	}
	if len(r.Attachments) > maxAttachments {
		return fmt.Errorf("too many attachments: %d > %d", len(r.Attachments), maxAttachments)
	}
	for i, att := range r.Attachments {
		if err := att.validate(i); err != nil {
			return err
		}
	}
	return nil
}

// validate runs structural checks on a single attachment. Decoded-size
// checks happen separately in decodeAttachments because they require
// actually decoding the base64 payload.
func (a Attachment) validate(idx int) error {
	if strings.TrimSpace(a.Filename) == "" {
		return fmt.Errorf("attachment[%d]: filename is required", idx)
	}
	if len(a.Filename) > maxFilenameBytes {
		return fmt.Errorf("attachment[%d]: filename too long: %d > %d",
			idx, len(a.Filename), maxFilenameBytes)
	}
	// Reject (don't truncate) header-injection-adjacent bytes: CR/LF
	// would smuggle headers; quote/backslash would break the `name="..."`
	// and `filename="..."` framing. Truncation is what we do for free-form
	// header values like Subject, where the data is naturally lossy; for
	// attachment filenames the customer's intent is to round-trip the
	// name to the recipient and a silently mangled filename is worse than
	// a 400 they can fix.
	if strings.ContainsAny(a.Filename, "\r\n\"\\") {
		return fmt.Errorf("attachment[%d]: filename contains forbidden characters (CR, LF, quote, backslash)", idx)
	}
	if a.Content == "" {
		return fmt.Errorf("attachment[%d]: content is required", idx)
	}
	if a.ContentType != "" {
		if len(a.ContentType) > maxContentTypeBytes {
			return fmt.Errorf("attachment[%d]: contentType too long: %d > %d",
				idx, len(a.ContentType), maxContentTypeBytes)
		}
		if strings.ContainsAny(a.ContentType, "\r\n") {
			return fmt.Errorf("attachment[%d]: contentType contains CR/LF", idx)
		}
		// Require type/subtype shape. mime.ParseMediaType is lenient about
		// missing slashes (returns "no-slash-here" with no error), but a
		// valid Content-Type MUST have one — without it the receiver can't
		// route to a handler and the value is almost certainly a typo.
		if !strings.Contains(strings.SplitN(a.ContentType, ";", 2)[0], "/") {
			return fmt.Errorf(
				"attachment[%d]: invalid contentType %q: missing type/subtype separator",
				idx, a.ContentType,
			)
		}
		// mime.ParseMediaType catches the rest (stray semicolons, bogus
		// parameter syntax). We don't keep the parsed result — message.go
		// writes the caller's original string verbatim — but the parse
		// acts as a validator.
		if _, _, err := mime.ParseMediaType(a.ContentType); err != nil {
			return fmt.Errorf("attachment[%d]: invalid contentType %q: %w", idx, a.ContentType, err)
		}
	}
	return nil
}

// decodeAttachments base64-decodes each attachment's Content and
// enforces the per-attachment decoded-size cap. The handler runs this
// after req.validate() because validation is the structural gate;
// decoding is the size-bounded transformation that produces
// preparedAttachment values for message.go.
func decodeAttachments(in []Attachment) ([]preparedAttachment, error) {
	if len(in) == 0 {
		return nil, nil
	}
	out := make([]preparedAttachment, len(in))
	for i, att := range in {
		// Strict() rejects trailing garbage and non-canonical encodings
		// — a more useful failure mode than silently dropping bytes.
		raw, err := base64.StdEncoding.Strict().DecodeString(att.Content)
		if err != nil {
			return nil, fmt.Errorf("attachment[%d] %q: invalid base64 content: %w", i, att.Filename, err)
		}
		if len(raw) > maxAttachmentBytes {
			return nil, fmt.Errorf("attachment[%d] %q: decoded size %d > %d",
				i, att.Filename, len(raw), maxAttachmentBytes)
		}
		if len(raw) == 0 {
			return nil, fmt.Errorf("attachment[%d] %q: decoded content is empty", i, att.Filename)
		}
		ct := strings.TrimSpace(att.ContentType)
		if ct == "" {
			ct = "application/octet-stream"
		}
		out[i] = preparedAttachment{
			Filename:    att.Filename,
			ContentType: ct,
			Content:     raw,
		}
	}
	return out, nil
}

func validateAddresses(field string, addrs []string) error {
	for _, a := range addrs {
		if len(a) > maxAddressBytes {
			return fmt.Errorf("%s address too long: %d > %d", field, len(a), maxAddressBytes)
		}
		if _, err := mail.ParseAddress(a); err != nil {
			return fmt.Errorf("invalid %s address %q: %w", field, a, err)
		}
	}
	return nil
}

// buildEnvelopeRcpts collapses To/Cc/Bcc into the SMTP RCPT-TO list,
// stripping display names so each entry is a bare addr-spec — the
// shape the relay expects.
func buildEnvelopeRcpts(p preparedMessage) ([]string, error) {
	all := make([]string, 0, len(p.To)+len(p.CC)+len(p.BCC))
	all = append(all, p.To...)
	all = append(all, p.CC...)
	all = append(all, p.BCC...)
	out := make([]string, 0, len(all))
	for _, a := range all {
		spec, err := addrSpec(a)
		if err != nil {
			return nil, fmt.Errorf("invalid recipient %q: %w", a, err)
		}
		out = append(out, spec)
	}
	return out, nil
}

// newMessageID returns a 32-char random hex string. Collision
// probability is negligible at the volumes this gateway handles.
func newMessageID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// rand.Read is effectively infallible on modern platforms; the
		// fallback exists so a hypothetical entropy failure doesn't
		// lose the audit-correlation handle.
		return fmt.Sprintf("ts-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

// publicError returns whichever of verbose/generic should appear in the
// customer-facing response body, based on g.verboseErrors. Operators
// always see verbose via slog regardless — call sites are expected to
// emit a slog line with the full error before invoking this helper.
func (g *Gateway) publicError(verbose, generic string) string {
	if g.verboseErrors {
		return verbose
	}
	return generic
}

// unverifiedFromMessage builds the verbose 400 error returned when a
// customer claim fails IsAllowedSender. Lists the verified domains so
// the customer's code can surface a remedy without a round-trip through
// docs. Includes the explicit "omit from" escape hatch so a caller
// that doesn't care about branding has a clear next step.
//
// Production callers see a sanitized version via publicError — the
// verified-domains list is sensitive (reveals customer brand setup) and
// enumerable through deliberate probing.
func unverifiedFromMessage(claimed string, id email.Identity) string {
	verified := make([]string, 0, len(id.AttachedDomains)+1)
	if d := strings.TrimSpace(id.DefaultDomain); d != "" {
		verified = append(verified, d+" (platform default)")
	}
	verified = append(verified, id.AttachedDomains...)

	if len(verified) == 0 {
		return fmt.Sprintf(
			"from %q rejected: this app has no verified sender domains. "+
				"Attach a domain in Settings or omit 'from' to use the platform default.",
			claimed,
		)
	}
	return fmt.Sprintf(
		"from %q rejected: domain not verified for this app. "+
			"Verified: %s. Attach the domain first, or omit 'from' to use the default sender.",
		claimed, strings.Join(verified, ", "),
	)
}

func writeJSON(w http.ResponseWriter, status int, body SendResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		slog.Warn("email_gateway.response_encode_error", "error", err)
	}
}
