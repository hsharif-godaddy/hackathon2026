package main

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-smtp"
)

func TestSMTPProxyStartStop(t *testing.T) {
	t.Parallel()

	proxy := &SMTPProxy{
		listenAddr:      "127.0.0.1:0",
		destinationAddr: "127.0.0.1:25",
		customHeaders:   make(map[string]string),
	}

	err := proxy.Start()
	if err != nil {
		t.Fatalf("Failed to start SMTP proxy: %v", err)
	}

	time.Sleep(100 * time.Millisecond)

	err = proxy.Stop()
	if err != nil {
		t.Fatalf("Failed to stop SMTP proxy: %v", err)
	}
}

func TestSMTPProxyHeaderInjection(t *testing.T) {
	t.Setenv("SITE_ID", "test-site-123")
	t.Setenv("PRODUCT", "test-product")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("NOMAD_DC", "test-dc")

	proxy := &SMTPProxy{
		listenAddr:      "127.0.0.1:0",
		destinationAddr: "127.0.0.1:25",
		customHeaders:   make(map[string]string),
	}

	proxy.loadHeaders()

	if len(proxy.customHeaders) != 4 {
		t.Errorf("Expected 4 headers, got %d", len(proxy.customHeaders))
	}

	if proxy.customHeaders["X-SITE-UID"] != "test-site-123" {
		t.Errorf("Expected 'test-site-123', got '%s'", proxy.customHeaders["X-SITE-UID"])
	}

	if proxy.customHeaders["X-PRODUCT"] != "test-product" {
		t.Errorf("Expected 'test-product', got '%s'", proxy.customHeaders["X-PRODUCT"])
	}

	if proxy.customHeaders["X-ENVIRONMENT"] != "test" {
		t.Errorf("Expected 'test', got '%s'", proxy.customHeaders["X-ENVIRONMENT"])
	}

	if proxy.customHeaders["X-DATACENTER"] != "test-dc" {
		t.Errorf("Expected 'test-dc', got '%s'", proxy.customHeaders["X-DATACENTER"])
	}
}

func TestSMTPProxyE2E(t *testing.T) {
	t.Setenv("SITE_ID", "e2e-site-456")
	t.Setenv("PRODUCT", "e2e-product")
	t.Setenv("NODE_ENV", "e2e-test")
	t.Setenv("NOMAD_DC", "e2e-dc")

	mockBackend := &mockSMTPBackend{
		receivedEmails: make(chan *mockEmail, 1),
	}

	mockServer := smtp.NewServer(mockBackend)
	mockServer.Addr = "127.0.0.1:0"
	mockServer.Domain = "test.local"
	mockServer.AllowInsecureAuth = true

	mockListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("Failed to create mock listener: %v", err)
	}

	mockAddr := mockListener.Addr().String()

	go func() {
		if serveErr := mockServer.Serve(mockListener); serveErr != nil {
			t.Logf("Mock server error: %v", serveErr)
		}
	}()

	time.Sleep(200 * time.Millisecond)

	proxy := &SMTPProxy{
		listenAddr:      "127.0.0.1:0",
		destinationAddr: mockAddr,
		customHeaders:   make(map[string]string),
	}

	proxy.loadHeaders()

	err = proxy.Start()
	if err != nil {
		t.Fatalf("Failed to start proxy: %v", err)
	}
	defer func() {
		if stopErr := proxy.Stop(); stopErr != nil {
			t.Logf("Failed to stop proxy: %v", stopErr)
		}
	}()
	defer mockServer.Close()

	time.Sleep(200 * time.Millisecond)

	proxyAddr := proxy.Addr()
	if proxyAddr == "" {
		t.Fatal("Proxy address is empty")
	}

	client, err := smtp.Dial(proxyAddr)
	if err != nil {
		t.Fatalf("Failed to connect to proxy at %s: %v", proxyAddr, err)
	}
	defer client.Close()

	if mailErr := client.Mail("sender@example.com", nil); mailErr != nil {
		t.Fatalf("Failed to send MAIL FROM: %v", mailErr)
	}

	if rcptErr := client.Rcpt("recipient@example.com", nil); rcptErr != nil {
		t.Fatalf("Failed to send RCPT TO: %v", rcptErr)
	}

	w, err := client.Data()
	if err != nil {
		t.Fatalf("Failed to start DATA: %v", err)
	}

	message := "From: sender@example.com\r\n" +
		"To: recipient@example.com\r\n" +
		"Subject: Test Email\r\n" +
		"\r\n" +
		"This is a test email body.\r\n"

	if _, err := w.Write([]byte(message)); err != nil {
		t.Fatalf("Failed to write email: %v", err)
	}

	if err := w.Close(); err != nil {
		t.Fatalf("Failed to close DATA: %v", err)
	}

	select {
	case email := <-mockBackend.receivedEmails:
		if email.from != "sender@example.com" {
			t.Errorf("Expected from 'sender@example.com', got '%s'", email.from)
		}

		if len(email.to) != 1 || email.to[0] != "recipient@example.com" {
			t.Errorf("Expected to 'recipient@example.com', got %v", email.to)
		}

		emailStr := string(email.data)
		if !strings.Contains(emailStr, "X-SITE-UID: e2e-site-456") {
			t.Errorf("Expected header 'X-SITE-UID: e2e-site-456' not found in email:\n%s", emailStr)
		}

		if !strings.Contains(emailStr, "X-PRODUCT: e2e-product") {
			t.Errorf("Expected header 'X-PRODUCT: e2e-product' not found in email:\n%s", emailStr)
		}

		if !strings.Contains(emailStr, "X-ENVIRONMENT: e2e-test") {
			t.Errorf("Expected header 'X-ENVIRONMENT: e2e-test' not found in email:\n%s", emailStr)
		}

		if !strings.Contains(emailStr, "X-DATACENTER: e2e-dc") {
			t.Errorf("Expected header 'X-DATACENTER: e2e-dc' not found in email:\n%s", emailStr)
		}

	case <-time.After(5 * time.Second):
		t.Fatal("Timeout waiting for email to be received")
	}
}

type mockEmail struct {
	from string
	to   []string
	data []byte
}

type mockSMTPBackend struct {
	receivedEmails chan *mockEmail
}

func (b *mockSMTPBackend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &mockSMTPSession{backend: b}, nil
}

type mockSMTPSession struct {
	backend *mockSMTPBackend
	from    string
	to      []string
}

func (s *mockSMTPSession) AuthPlain(_, _ string) error {
	return nil
}

func (s *mockSMTPSession) Mail(from string, _ *smtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *mockSMTPSession) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

func (s *mockSMTPSession) Data(r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("failed to read email data: %w", err)
	}

	email := &mockEmail{
		from: s.from,
		to:   s.to,
		data: data,
	}

	select {
	case s.backend.receivedEmails <- email:
	default:
	}

	return nil
}

func (s *mockSMTPSession) Reset() {
	s.from = ""
	s.to = nil
}

func (s *mockSMTPSession) Logout() error {
	return nil
}
