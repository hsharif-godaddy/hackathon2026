package smtp

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/mail"
	"strings"
	"sync"

	"github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

// SignFunc signs the outbound message and injects the JWS-bearing
// relay-trust headers (X-GD-DKIM-SIGN / X-GD-DKIM-PUB-KEY) into body
// before it is forwarded. When set on a Proxy, the signature
// matches signing.Signer.SignMessage so a *signing.Signer's method
// value plugs in directly.
//
// A nil SignFunc disables signing — the proxy forwards unsigned. The
// production wiring in cmd/dev-supervisor leaves it unset when no key
// material is mounted (local dev / Mailpit).
type SignFunc func(body []byte, siteID, from string) []byte

// Proxy is an SMTP proxy that injects custom headers into emails and enforces
// the platform sender-identity policy on both envelope and header From.
// It listens on localhost and forwards to a configured destination SMTP server.
type Proxy struct {
	listenAddr      string
	destinationAddr string
	customHeaders   map[string]string
	identityFn      func() (email.Identity, error)
	signFn          SignFunc
	server          *smtp.Server
	listener        net.Listener
	mu              sync.Mutex
	running         bool
}

// New creates a new SMTP proxy with configuration from environment variables.
// The sender-identity policy is sourced from /alloc/config.json (DOMAINS
// secret) via the process-wide allocconfig.Default() loader.
func New() *Proxy {
	listenAddr := config.GetEnvStringWithDefault("SMTP_LISTEN_ADDR", "127.0.0.1:25")
	destinationAddr := config.GetEnvStringWithDefault("SMTP_DESTINATION", "relay-hosting.secureserver.net:25")
	siteID := config.GetEnvStringWithDefault("SITE_ID", "")
	defaultDomain := config.GetEnvStringWithDefault("AIRO_DEFAULT_SENDER_DOMAIN", "")

	loader := allocconfig.Default()
	identityFn := func() (email.Identity, error) {
		return email.IdentityFromAllocConfig(loader, siteID, defaultDomain)
	}

	proxy := &Proxy{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		customHeaders:   make(map[string]string),
		identityFn:      identityFn,
	}

	proxy.LoadHeaders()

	return proxy
}

// NewForTesting creates a new SMTP proxy with custom parameters for testing.
// identity is used verbatim for every session; pass email.Identity{} for the
// "no attached domains, empty default" extreme that exercises canonical
// fallback to the package's hardcoded "airoapp.ai".
func NewForTesting(
	listenAddr, destinationAddr string,
	customHeaders map[string]string,
	identity email.Identity,
) *Proxy {
	if customHeaders == nil {
		customHeaders = make(map[string]string)
	}
	return &Proxy{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		customHeaders:   customHeaders,
		identityFn:      func() (email.Identity, error) { return identity, nil },
	}
}

// LoadHeaders loads custom headers from environment variables.
// This is called automatically by New() but can be called explicitly to reload headers.
//
// IMPORTANT: Must be called before Start(). Calling LoadHeaders() after Start()
// will not update headers for the running server, as proxyBackend captures the
// header map reference at startup time. To update headers for a running server,
// stop the server, call LoadHeaders(), then start again.
//
// Thread-safe: Multiple concurrent calls to LoadHeaders() are safe (uses mutex protection).
//
// The actual header set comes from email.LoadTrackingHeaders, which the
// HTTP email gateway also consumes — keeps the relay's spam-attribution
// pipeline seeing a single shape regardless of submission path.
func (p *Proxy) LoadHeaders() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.customHeaders = email.LoadTrackingHeaders()

	slog.Info("loaded SMTP custom headers", "count", len(p.customHeaders))
}

// SetSigner installs the JWS signing function. Must be called before
// Start — the active backend snapshots the function by reference, so
// post-Start changes don't reach in-flight or future sessions until
// the proxy is stopped and restarted.
//
// Pass nil to disable signing.
func (p *Proxy) SetSigner(fn SignFunc) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.signFn = fn
}

// GetHeaders returns a copy of the custom headers for testing/inspection.
func (p *Proxy) GetHeaders() map[string]string {
	p.mu.Lock()
	defer p.mu.Unlock()

	headers := make(map[string]string, len(p.customHeaders))
	maps.Copy(headers, p.customHeaders)
	return headers
}

func (p *Proxy) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return errors.New("SMTP proxy already running")
	}

	// Snapshot headers to prevent races if LoadHeaders() is called after Start()
	headersCopy := make(map[string]string, len(p.customHeaders))
	maps.Copy(headersCopy, p.customHeaders)

	backend := &proxyBackend{
		destinationAddr: p.destinationAddr,
		customHeaders:   headersCopy,
		identityFn:      p.identityFn,
		signFn:          p.signFn,
	}

	p.server = smtp.NewServer(backend)
	p.server.Addr = p.listenAddr
	p.server.Domain = "localhost"
	p.server.AllowInsecureAuth = true

	//nolint:noctx // Long-lived SMTP server listener, no request context available
	listener, err := net.Listen("tcp", p.listenAddr)
	if err != nil {
		return fmt.Errorf("failed to start SMTP proxy: %w", err)
	}

	p.listener = listener
	p.running = true

	actualAddr := listener.Addr().String()
	slog.Info("SMTP proxy started", "listen_addr", actualAddr, "destination", p.destinationAddr)

	// Capture running flag under lock for goroutine
	go func() {
		if err := p.server.Serve(listener); err != nil {
			// Check running status under lock to avoid race
			p.mu.Lock()
			stillRunning := p.running
			p.mu.Unlock()
			if stillRunning {
				slog.Error("SMTP server error", "error", err)
			}
		}
	}()

	return nil
}

func (p *Proxy) Addr() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.listener != nil {
		return p.listener.Addr().String()
	}
	return ""
}

func (p *Proxy) Stop() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return nil
	}

	p.running = false

	if p.server != nil {
		if err := p.server.Close(); err != nil {
			slog.Warn("error closing SMTP server", "error", err)
		}
	}

	slog.Info("SMTP proxy stopped")
	return nil
}

type proxyBackend struct {
	destinationAddr string
	customHeaders   map[string]string
	identityFn      func() (email.Identity, error)
	signFn          SignFunc
}

// NewSession is called by go-smtp once per inbound connection. It
// loads the per-app sender Identity (typically from /alloc/config.json
// via IdentityFromAllocConfig) and refuses the session if that load
// fails.
//
// Why we fail closed instead of substituting an empty Identity. An
// earlier version of this code logged the load error and continued
// with email.Identity{}, on the theory that "empty Identity allows
// nothing through except CanonicalSender's hard fallback" was a safe
// degraded mode. It isn't. Empty Identity makes IsAllowedSender
// return false for every input, so every claim — including legitimate
// claims on the customer's own attached domain — gets rewritten to
// CanonicalSender(), which on Identity{} resolves to
// "unknown@airoapp.ai" via the hardcoded last-ditch fallback. During
// an alloc-config outage, every customer in this dev-supervisor
// process would silently send mail as "unknown@airoapp.ai":
// cross-customer attribution destroyed, platform-domain reputation
// poisoned, customers confused about why their mail looks wrong.
//
// Returning an error from NewSession causes go-smtp to emit a 421
// "Service not available, closing transmission channel" response.
// Standard SMTP semantics: clients close the connection and queue
// the message for retry. When alloc-config recovers, retries succeed.
// The customer experiences a transient delay rather than a silent
// brand-damaging substitution, and the failure is loud enough to
// alert on.
func (b *proxyBackend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	id, err := b.identityFn()
	if err != nil {
		slog.Error("smtp.identity_load_failed",
			"error", err,
		)
		return nil, fmt.Errorf("sender identity unavailable: %w", err)
	}
	return &proxySession{
		backend:  b,
		conn:     c,
		identity: id,
	}, nil
}

type proxySession struct {
	backend  *proxyBackend
	conn     *smtp.Conn
	identity email.Identity
	from     string
	to       []string
}

func (s *proxySession) AuthPlain(_, _ string) error {
	return nil
}

// Mail enforces the sender-identity policy on the SMTP envelope From
// (RFC 5321.MailFrom). The address forwarded upstream is always the
// policy-approved value, so SPF and bounce-handling align with what the
// platform actually authorized.
//
// Null reverse-path handling. RFC 5321 §4.5.5 reserves the empty
// MAIL FROM (`<>`) as the null reverse-path used by bounces and DSNs.
// We deliberately treat this as a policy violation rather than a
// reserved value: the Airo platform's contract with customer apps is
// that every outbound transaction declares a sender identity.
// Customer apps don't generate bounces — they generate forward mail —
// so an empty MAIL FROM in this code path indicates either a
// misconfigured client or an attempt to obscure identity. We
// canonicalize it like any other unauthorized claim. The audit log
// entry carries reason="null_reverse_path" so log analysis can
// distinguish this case from a foreign-domain rewrite.
func (s *proxySession) Mail(from string, _ *smtp.MailOptions) error {
	final, rewritten := s.identity.EnforceSender(from)
	if rewritten {
		attrs := []any{
			"surface", "envelope",
			"original", from,
			"final", final,
			"app_id", s.identity.AppID,
		}
		if from == "" {
			attrs = append(attrs, "reason", "null_reverse_path")
		}
		slog.Info("smtp.sender_rewritten", attrs...)
	}
	s.from = final
	return nil
}

func (s *proxySession) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

// Data reads the message, enforces sender identity on the From: header
// (RFC 5322.From — what recipients see in their mail client), then
// injects the platform's tracking headers and forwards to the destination.
//
// Both surfaces (envelope in Mail() and header here) are enforced because
// DMARC alignment requires the From: header to match SPF (envelope) or
// DKIM. Enforcing only the envelope leaves the user-visible impersonation
// surface open; enforcing only the header lets bounces and SPF-aligned
// metadata reach the wrong place.
func (s *proxySession) Data(r io.Reader) error {
	if s.backend == nil {
		return errors.New("backend not initialized")
	}

	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("failed to read email data: %w", err)
	}

	enforced := enforceMessageFrom(data, s.identity)

	// Same-domain conflict detection (observe-only). Key on the RFC 5322
	// header From (not envelope) because ProofPoint-style filters
	// quarantine based on the visible From:. The SMTP path does not
	// support the opt-in sameDomainFallback flag (no request body);
	// apps hitting same-domain quarantine should migrate to the HTTP
	// gateway (port 2525) and pass sameDomainFallback: true.
	headerFrom := extractHeaderFrom(enforced)
	if headerFrom != "" && s.identity.HasSameDomainConflict(headerFrom, s.to) {
		slog.Warn("smtp.same_domain_conflict_not_mitigated",
			"header_from", headerFrom,
			"to", s.to,
			"app_id", s.identity.AppID,
		)
	}

	modifiedData := injectHeaders(enforced, s.backend.customHeaders)

	// JWS sign for relay trust. The signer's body_hash claim covers
	// modifiedData (post-tracking-headers, pre-signing-headers), which
	// is what the relay reconstructs after stripping X-GD-DKIM-* before
	// applying RFC DKIM. A nil signFn or signing failure forwards the
	// message unsigned — the relay will reject if its policy demands a
	// signature, but availability beats a transient signing bug.
	if s.backend.signFn != nil {
		modifiedData = s.backend.signFn(modifiedData, s.identity.AppID, s.from)
	}

	if err := email.ForwardSMTP(s.backend.destinationAddr, s.from, s.to, modifiedData); err != nil {
		return err
	}

	slog.Info("email proxied successfully", "from", s.from, "to", s.to, "destination", s.backend.destinationAddr)

	return nil
}

func (s *proxySession) Reset() {
	s.from = ""
	s.to = nil
}

func (s *proxySession) Logout() error {
	return nil
}

// enforceMessageFrom parses the message, runs the From: header through
// id.EnforceSender, and returns the message bytes with the header
// rewritten if the policy required it. A missing From: header is
// inserted as id.CanonicalSender() — RFC 5322 requires one anyway, and
// we'd rather be helpful than reject.
//
// Scope. Only the RFC 5322 §3.6.2 From: header is enforced here. The
// other originator headers in §3.6.2 (Sender:, Reply-To:) and the
// §3.6.6 Resent-* family pass through unchanged. A customer-set
// Sender: or Reply-To: pointing at a foreign domain still renders in
// the recipient's mail client alongside the rewritten From:, so the
// user-visible identity enforcement is partial by design. Closing the
// gap is deferred to the planned migration to a structured HTTP send
// route, which removes customer-controlled header injection as an
// attack surface entirely (the server constructs the RFC 5322 message
// from a fixed-shape request). Until that lands, this function is one
// half of a two-half policy and the SMTP path remains transitional.
//
// When a rewrite is required, the implementation walks the original
// bytes line-by-line, substituting only the From: line (and consuming
// any folded continuation lines that belonged to it). Every other byte
// — header order, header-name casing, exact whitespace, folded values
// on non-From headers, body bytes — passes through verbatim. This is
// deliberately the smallest possible edit: rebuilding from a parsed
// header map would reshuffle keys (Go map iteration is non-deterministic),
// collapse folded values, and re-canonicalize header-name casing,
// breaking Received-chain ordering, DKIM signatures on inbound mail
// being relayed, and downstream loop detection.
//
// Parse-failure handling. If mail.ReadMessage rejects the input
// (deliberately malformed bytes, 8-bit content in a header value,
// missing terminator, etc.), we cannot run the policy decision —
// but we also cannot forward the original bytes, because the bypass
// primitive is precisely "construct a message that mail.ReadMessage
// rejects but a downstream MTA accepts, smuggling a foreign From:".
// Instead we fail closed by feeding rewriteFromHeader the canonical
// sender unconditionally. rewriteFromHeader operates on bytes (no
// parser dependency) and will replace any From: line(s) it finds, or
// insert a canonical From: at the end of the header block if none
// exist. The output is guaranteed to carry exactly one
// platform-approved From:, regardless of what the input looked like.
func enforceMessageFrom(data []byte, id email.Identity) []byte {
	newFrom, rewritten, err := decideMessageFrom(data, id)
	if err != nil {
		// Fail closed: the parser rejected the input but a downstream
		// MTA might still accept it. Rewriting unconditionally to
		// canonical preserves the policy guarantee even on bytes the
		// parser can't make sense of.
		slog.Warn("smtp.parse_failure_force_rewrite",
			"error", err,
			"app_id", id.AppID)
		return rewriteFromHeader(data, id.CanonicalSender())
	}
	if !rewritten {
		// Claim was allowed verbatim. Return the original bytes
		// untouched.
		return data
	}
	return rewriteFromHeader(data, newFrom)
}

// decideMessageFrom runs the From-header policy on data and emits the
// audit log line for any rewrite. Returns the From value the rewriter
// should emit, whether a rewrite is required, or an error if data isn't
// a parseable RFC 5322 message.
func decideMessageFrom(data []byte, id email.Identity) (string, bool, error) {
	msg, err := mail.ReadMessage(bytes.NewReader(data))
	if err != nil {
		return "", false, fmt.Errorf("parse message: %w", err)
	}
	fromHeaders := msg.Header["From"]
	if len(fromHeaders) == 0 {
		newFrom := id.CanonicalSender()
		slog.Info("smtp.sender_rewritten",
			"surface", "header",
			"original", "",
			"final", newFrom,
			"app_id", id.AppID,
			"reason", "missing_from")
		return newFrom, true, nil
	}
	// RFC 5322 §3.6.2 permits multiple From: addresses inside a single
	// header value (group syntax), but multiple From: header *fields*
	// in the same message are vanishingly rare in practice and DMARC
	// disallows them. Treat any such message as suspicious: force the
	// rewrite path so rewriteFromHeader emits exactly one canonical
	// From: line and drops the rest. Without this, msg.Header.Get
	// would only see the first header, which is exploitable as a
	// smuggling primitive: a customer with an attached domain could
	// send "From: support@allowed.com\r\nFrom: noreply@victim.com"
	// and the second line would reach upstream verbatim.
	if len(fromHeaders) > 1 {
		newFrom := id.CanonicalSender()
		slog.Info("smtp.sender_rewritten",
			"surface", "header",
			"original", strings.Join(fromHeaders, " | "),
			"final", newFrom,
			"app_id", id.AppID,
			"reason", "multiple_from")
		return newFrom, true, nil
	}
	originalFrom := fromHeaders[0]
	newFrom, rewritten := id.EnforceSender(originalFrom)
	if rewritten {
		slog.Info("smtp.sender_rewritten",
			"surface", "header",
			"original", originalFrom,
			"final", newFrom,
			"app_id", id.AppID)
	}
	return newFrom, rewritten, nil
}

// rewriteFromHeader walks data line-by-line, substituting any From:
// header (and its folded continuation lines) with exactly one
// canonical "From: newFrom" line. If no From: header is found, the
// canonical one is inserted at the end of the header block
// (immediately before the header/body separator). Every other line
// passes through byte-identical.
//
// Multiple From: headers in the input are collapsed to one in the
// output: the first match emits "From: newFrom"; subsequent From:
// fields (and their folded continuations) are dropped. This pairs
// with decideMessageFrom's multiple_from policy — together they
// guarantee the upstream MTA sees a single, policy-approved From:
// regardless of what the customer sent.
//
// Lenient on input line endings (accepts CRLF or bare LF for the
// separator) but emits CRLF on the line we synthesize, which is what
// SMTP DATA mandates per RFC 5321.
func rewriteFromHeader(data []byte, newFrom string) []byte {
	var out bytes.Buffer
	r := bufio.NewReader(bytes.NewReader(data))
	fromWritten := false
	inHeaders := true
	skippingFromContinuation := false
	for {
		line, readErr := r.ReadBytes('\n')

		switch {
		case !inHeaders:
			// Body — pass through verbatim.
			out.Write(line)

		case isBlankLine(line):
			// End of headers. If we never encountered a From: header,
			// insert the canonical one now (immediately before the
			// separator).
			if !fromWritten {
				fmt.Fprintf(&out, "From: %s\r\n", newFrom)
				fromWritten = true
			}
			out.Write(line)
			inHeaders = false

		case isContinuationLine(line):
			// Folded continuation of the previous header. Skip if it
			// belongs to a From we just rewrote (or a duplicate From
			// we're dropping); otherwise pass through.
			if !skippingFromContinuation {
				out.Write(line)
			}

		case isFromHeaderLine(line):
			// First From: in the input becomes the canonical line.
			// Subsequent From: fields are dropped entirely so the
			// output carries exactly one From: regardless of input.
			if !fromWritten {
				fmt.Fprintf(&out, "From: %s\r\n", newFrom)
				fromWritten = true
			}
			skippingFromContinuation = true

		default:
			// Some other header — pass through verbatim. Reset the
			// continuation-skip flag since we're starting a new header.
			skippingFromContinuation = false
			out.Write(line)
		}

		if readErr != nil {
			break
		}
	}
	return out.Bytes()
}

// isBlankLine reports whether line is the header/body separator (just
// CRLF or LF, possibly the final line of the input with no trailing
// newline at all).
func isBlankLine(line []byte) bool {
	return bytes.Equal(line, []byte("\r\n")) || bytes.Equal(line, []byte("\n"))
}

// isContinuationLine reports whether line is a folded-header
// continuation (RFC 5322 §2.2.3 — starts with WSP).
func isContinuationLine(line []byte) bool {
	return len(line) > 0 && (line[0] == ' ' || line[0] == '\t')
}

// isFromHeaderLine reports whether line begins a "From:" header.
// Field-name comparison is case-insensitive per RFC 5322 §1.2.2.
// Tolerates whitespace between the field name and the colon for
// robustness on slightly-malformed input.
func isFromHeaderLine(line []byte) bool {
	name, _, found := bytes.Cut(line, []byte(":"))
	if !found {
		return false
	}
	return bytes.EqualFold(bytes.TrimRight(name, " \t"), []byte("From"))
}

// extractHeaderFrom parses the RFC 5322 From header from message bytes.
// Returns the first From address, or "" if unparseable.
func extractHeaderFrom(data []byte) string {
	msg, err := mail.ReadMessage(bytes.NewReader(data))
	if err != nil {
		return ""
	}
	return msg.Header.Get("From")
}

// injectHeaders is a thin wrapper around email.InjectHeaders kept here
// so the SMTP proxy's call sites stay readable. The shared package
// owns the algorithm (also used by the JWS signing path).
func injectHeaders(data []byte, headers map[string]string) []byte {
	return email.InjectHeaders(data, headers)
}
