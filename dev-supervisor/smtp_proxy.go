package main

import (
	"bytes"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/mail"
	"sync"

	"github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
)

type SMTPProxy struct {
	listenAddr      string
	destinationAddr string
	customHeaders   map[string]string
	server          *smtp.Server
	listener        net.Listener
	mu              sync.Mutex
	running         bool
}

func NewSMTPProxy() *SMTPProxy {
	listenAddr := config.GetEnvStringWithDefault("SMTP_LISTEN_ADDR", "127.0.0.1:25")
	destinationAddr := config.GetEnvStringWithDefault("SMTP_DESTINATION", "relay-hosting.secureserver.net:25")

	proxy := &SMTPProxy{
		listenAddr:      listenAddr,
		destinationAddr: destinationAddr,
		customHeaders:   make(map[string]string),
	}

	proxy.loadHeaders()

	return proxy
}

func (p *SMTPProxy) loadHeaders() {
	p.customHeaders = map[string]string{
		"X-SITE-UID":    config.GetEnvStringWithDefault("SITE_ID", "unknown"),
		"X-PRODUCT":     config.GetEnvStringWithDefault("PRODUCT", "airo-app-builder"),
		"X-ENVIRONMENT": config.GetEnvStringWithDefault("NODE_ENV", "unknown"),
		"X-DATACENTER":  config.GetEnvStringWithDefault("NOMAD_DC", "unknown"),
	}

	slog.Info("loaded SMTP custom headers", "count", len(p.customHeaders))
}

func (p *SMTPProxy) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.running {
		return fmt.Errorf("SMTP proxy already running")
	}

	backend := &proxyBackend{
		destinationAddr: p.destinationAddr,
		customHeaders:   p.customHeaders,
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

	go func() {
		if err := p.server.Serve(listener); err != nil && p.running {
			slog.Error("SMTP server error", "error", err)
		}
	}()

	return nil
}

func (p *SMTPProxy) Addr() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.listener != nil {
		return p.listener.Addr().String()
	}
	return ""
}

func (p *SMTPProxy) Stop() error {
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
		return fmt.Errorf("backend not initialized")
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
