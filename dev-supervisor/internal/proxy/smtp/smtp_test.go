package smtp_test

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	gosmtp "github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/smtp"
)

func TestSMTPProxyStartStop(t *testing.T) {
	t.Parallel()

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string))

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

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string))
	proxy.LoadHeaders()

	headers := proxy.GetHeaders()

	if len(headers) != 4 {
		t.Errorf("Expected 4 headers, got %d", len(headers))
	}

	if headers["X-SITE-UID"] != "test-site-123" {
		t.Errorf("Expected 'test-site-123', got '%s'", headers["X-SITE-UID"])
	}

	if headers["X-PRODUCT"] != "test-product" {
		t.Errorf("Expected 'test-product', got '%s'", headers["X-PRODUCT"])
	}

	if headers["X-ENVIRONMENT"] != "test" {
		t.Errorf("Expected 'test', got '%s'", headers["X-ENVIRONMENT"])
	}

	if headers["X-DATACENTER"] != "test-dc" {
		t.Errorf("Expected 'test-dc', got '%s'", headers["X-DATACENTER"])
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

	mockServer := gosmtp.NewServer(mockBackend)
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

	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, make(map[string]string))
	proxy.LoadHeaders()

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

	client, err := gosmtp.Dial(proxyAddr)
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

func TestSMTPProxyConcurrentHeaderLoad(t *testing.T) {
	// Set up test environment variables
	t.Setenv("SITE_ID", "concurrent-test")
	t.Setenv("PRODUCT", "test-product")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("NOMAD_DC", "test-dc")

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string))

	// Call LoadHeaders() concurrently from multiple goroutines
	const numGoroutines = 10
	done := make(chan bool, numGoroutines)

	for range numGoroutines {
		go func() {
			proxy.LoadHeaders()
			done <- true
		}()
	}

	// Wait for all goroutines to complete
	for range numGoroutines {
		<-done
	}

	// Verify headers were loaded correctly
	headers := proxy.GetHeaders()
	if len(headers) != 4 {
		t.Errorf("Expected 4 headers, got %d", len(headers))
	}

	if headers["X-SITE-UID"] != "concurrent-test" {
		t.Errorf("Expected 'concurrent-test', got '%s'", headers["X-SITE-UID"])
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

func (b *mockSMTPBackend) NewSession(_ *gosmtp.Conn) (gosmtp.Session, error) {
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

func (s *mockSMTPSession) Mail(from string, _ *gosmtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *mockSMTPSession) Rcpt(to string, _ *gosmtp.RcptOptions) error {
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
