package smtp

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"net"
	"net/mail"
	"sync"

	"github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

// Proxy is an SMTP proxy that injects custom headers into emails.
// It listens on localhost and forwards to a configured destination SMTP server.
type Proxy struct {
	listenAddr      string
	destinationAddr string
	customHeaders   map[string]string
	server          *smtp.Server
	listener        net.Listener
	mu              sync.Mutex
	running         bool
}

// New creates a new SMTP proxy with configuration from environment variables.
func New() *Proxy {
	listenAddr := config.GetEnvStringWithDefault("SMTP_LISTEN_ADDR", "127.0.0.1:25")
	destinationAddr := config.GetEnvStringWithDefault("SMTP_DESTINATION", "relay-hosting.secureserver.net:25")

	proxy := &Proxy{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		customHeaders:   make(map[string]string),
	}

	proxy.LoadHeaders()

	return proxy
}

// NewForTesting creates a new SMTP proxy with custom parameters for testing.
func NewForTesting(listenAddr, destinationAddr string, customHeaders map[string]string) *Proxy {
	if customHeaders == nil {
		customHeaders = make(map[string]string)
	}
	return &Proxy{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		customHeaders:   customHeaders,
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
func (p *Proxy) LoadHeaders() {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.customHeaders = map[string]string{
		"X-SITE-UID":    config.GetEnvStringWithDefault("SITE_ID", "unknown"),
		"X-PRODUCT":     config.GetEnvStringWithDefault("PRODUCT", "airo-app-builder"),
		"X-ENVIRONMENT": config.GetEnvStringWithDefault("NODE_ENV", "unknown"),
		"X-DATACENTER":  config.GetEnvStringWithDefault("NOMAD_DC", "unknown"),
	}

	slog.Info("loaded SMTP custom headers", "count", len(p.customHeaders))
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
}

func (b *proxyBackend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	return &proxySession{
		backend: b,
		conn:    c,
	}, nil
}

type proxySession struct {
	backend *proxyBackend
	conn    *smtp.Conn
	from    string
	to      []string
}

func (s *proxySession) AuthPlain(_, _ string) error {
	return nil
}

func (s *proxySession) Mail(from string, _ *smtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *proxySession) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

func (s *proxySession) Data(r io.Reader) error {
	if s.backend == nil {
		return errors.New("backend not initialized")
	}

	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("failed to read email data: %w", err)
	}

	modifiedData, err := injectHeaders(data, s.backend.customHeaders)
	if err != nil {
		slog.Warn("failed to inject headers, forwarding original email", "error", err)
		modifiedData = data
	}

	client, err := smtp.Dial(s.backend.destinationAddr)
	if err != nil {
		return fmt.Errorf("failed to connect to destination SMTP server: %w", err)
	}
	defer client.Close()

	if mailErr := client.Mail(s.from, nil); mailErr != nil {
		return fmt.Errorf("failed to send MAIL FROM: %w", mailErr)
	}

	for _, rcpt := range s.to {
		if rcptErr := client.Rcpt(rcpt, nil); rcptErr != nil {
			return fmt.Errorf("failed to send RCPT TO: %w", rcptErr)
		}
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("failed to start DATA: %w", err)
	}

	if _, err := w.Write(modifiedData); err != nil {
		//nolint:gosec // G104: Intentionally ignoring error
		w.Close()
		return fmt.Errorf("failed to write email data: %w", err)
	}

	if err := w.Close(); err != nil {
		return fmt.Errorf("failed to close DATA writer: %w", err)
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

func injectHeaders(data []byte, headers map[string]string) ([]byte, error) {
	if len(headers) == 0 {
		return data, nil
	}

	msg, err := mail.ReadMessage(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to parse email: %w", err)
	}

	var buf bytes.Buffer

	for key, value := range msg.Header {
		for _, v := range value {
			fmt.Fprintf(&buf, "%s: %s\r\n", key, v)
		}
	}

	for key, value := range headers {
		fmt.Fprintf(&buf, "%s: %s\r\n", key, value)
	}

	buf.WriteString("\r\n")

	body, err := io.ReadAll(msg.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read email body: %w", err)
	}

	buf.Write(body)

	return buf.Bytes(), nil
}
