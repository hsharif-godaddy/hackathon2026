package smtp_test

import (
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	gosmtp "github.com/emersion/go-smtp"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/smtp"
)

// permissiveIdentity returns an Identity that allows any sender via its
// AttachedDomains list — used by tests that aren't exercising enforcement
// and just need the proxy machinery to work.
func permissiveIdentity(attached ...string) email.Identity {
	return email.Identity{
		AppID:           "test-site",
		AttachedDomains: attached,
		DefaultDomain:   "test-airoapp.ai",
	}
}

func TestSMTPProxyStartStop(t *testing.T) {
	t.Parallel()

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string), email.Identity{})

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

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string), email.Identity{})
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

	// E2E uses example.com as the customer's verified-attached domain so
	// the existing "From: sender@example.com" claim passes through
	// unchanged. Enforcement-rewrite is exercised separately in
	// TestSMTPProxyEnforcesSender.
	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, make(map[string]string), permissiveIdentity("example.com"))
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

	// Recipient on a different domain than the sender to avoid triggering
	// the same-domain fallback (tested separately in
	// TestSMTPProxySameDomainFallback_KeysOnHeaderFrom).
	if rcptErr := client.Rcpt("recipient@example.net", nil); rcptErr != nil {
		t.Fatalf("Failed to send RCPT TO: %v", rcptErr)
	}

	w, err := client.Data()
	if err != nil {
		t.Fatalf("Failed to start DATA: %v", err)
	}

	message := "From: sender@example.com\r\n" +
		"To: recipient@example.net\r\n" +
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

		if len(email.to) != 1 || email.to[0] != "recipient@example.net" {
			t.Errorf("Expected to 'recipient@example.net', got %v", email.to)
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

	proxy := smtp.NewForTesting("127.0.0.1:0", "127.0.0.1:25", make(map[string]string), email.Identity{})

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

// TestSMTPProxyEnforcesSender verifies that both the envelope From
// (RFC 5321.MailFrom seen at the upstream MAIL FROM) and the header From
// (RFC 5322.From in the DATA payload that the recipient sees) are
// rewritten to the canonical sender when a customer claims a domain
// they don't own.
func TestSMTPProxyEnforcesSender(t *testing.T) {
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

	// Customer's app is identified as "attacker1" with attached domain
	// "attacker.com". They're going to claim a foreign domain on both
	// envelope and header — the proxy should rewrite both.
	identity := email.Identity{
		AppID:           "attacker1",
		AttachedDomains: []string{"attacker.com"},
		PrimaryDomain:   "attacker.com",
		DefaultDomain:   "test-airoapp.ai",
	}
	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, make(map[string]string), identity)

	if startErr := proxy.Start(); startErr != nil {
		t.Fatalf("Failed to start proxy: %v", startErr)
	}
	defer func() {
		if stopErr := proxy.Stop(); stopErr != nil {
			t.Logf("Failed to stop proxy: %v", stopErr)
		}
	}()
	defer mockServer.Close()
	time.Sleep(200 * time.Millisecond)

	client, err := gosmtp.Dial(proxy.Addr())
	if err != nil {
		t.Fatalf("Failed to connect to proxy: %v", err)
	}
	defer client.Close()

	// Customer claims a victim domain on both envelope and header.
	if mailErr := client.Mail("noreply@kimsorrelle.com", nil); mailErr != nil {
		t.Fatalf("MAIL FROM: %v", mailErr)
	}
	if rcptErr := client.Rcpt("recipient@example.com", nil); rcptErr != nil {
		t.Fatalf("RCPT TO: %v", rcptErr)
	}
	w, err := client.Data()
	if err != nil {
		t.Fatalf("DATA: %v", err)
	}
	message := "From: noreply@kimsorrelle.com\r\n" +
		"To: recipient@example.com\r\n" +
		"Subject: Phishing Attempt\r\n" +
		"\r\n" +
		"Hello.\r\n"
	if _, err := w.Write([]byte(message)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	select {
	case received := <-mockBackend.receivedEmails:
		// Envelope: rewritten to canonical (PrimaryDomain).
		if received.from != "attacker1@attacker.com" {
			t.Errorf("envelope From = %q, want %q (canonical)", received.from, "attacker1@attacker.com")
		}
		// Header: also rewritten to canonical.
		emailStr := string(received.data)
		if !strings.Contains(emailStr, "From: attacker1@attacker.com") {
			t.Errorf("expected rewritten From: header in DATA, got:\n%s", emailStr)
		}
		// And the original phishing claim must NOT appear in the From
		// header.
		if strings.Contains(emailStr, "From: noreply@kimsorrelle.com") {
			t.Errorf("original From: header leaked through unchanged:\n%s", emailStr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for email")
	}
}

// TestSMTPProxyAllowedClaimPassesThrough verifies that a claim matching
// an attached domain reaches the upstream verbatim — display name, address
// part, and all. This is the customer-friendly path; enforcement is
// invisible to legitimate uses.
func TestSMTPProxyAllowedClaimPassesThrough(t *testing.T) {
	mockBackend := &mockSMTPBackend{receivedEmails: make(chan *mockEmail, 1)}
	mockServer := gosmtp.NewServer(mockBackend)
	mockServer.Addr = "127.0.0.1:0"
	mockServer.Domain = "test.local"
	mockServer.AllowInsecureAuth = true
	mockListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	mockAddr := mockListener.Addr().String()
	go func() { _ = mockServer.Serve(mockListener) }()
	time.Sleep(200 * time.Millisecond)

	identity := email.Identity{
		AppID:           "abc1234567",
		AttachedDomains: []string{"acme.com"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "test-airoapp.ai",
	}
	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, make(map[string]string), identity)
	if startErr := proxy.Start(); startErr != nil {
		t.Fatalf("start: %v", startErr)
	}
	defer func() { _ = proxy.Stop() }()
	defer mockServer.Close()
	time.Sleep(200 * time.Millisecond)

	client, err := gosmtp.Dial(proxy.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer client.Close()

	if mailErr := client.Mail("support@acme.com", nil); mailErr != nil {
		t.Fatalf("mail: %v", mailErr)
	}
	if rcptErr := client.Rcpt("recipient@example.com", nil); rcptErr != nil {
		t.Fatalf("rcpt: %v", rcptErr)
	}
	w, err := client.Data()
	if err != nil {
		t.Fatalf("data: %v", err)
	}
	const message = "From: \"Acme Support\" <support@acme.com>\r\n" +
		"To: recipient@example.com\r\n" +
		"Subject: Welcome\r\n" +
		"\r\n" +
		"Hi.\r\n"
	if _, writeErr := w.Write([]byte(message)); writeErr != nil {
		t.Fatalf("write: %v", writeErr)
	}
	if closeErr := w.Close(); closeErr != nil {
		t.Fatalf("close: %v", closeErr)
	}

	select {
	case received := <-mockBackend.receivedEmails:
		if received.from != "support@acme.com" {
			t.Errorf("envelope From = %q, want %q (passthrough)", received.from, "support@acme.com")
		}
		emailStr := string(received.data)
		if !strings.Contains(emailStr, `From: "Acme Support" <support@acme.com>`) {
			t.Errorf("display-name + address should pass through unchanged, got:\n%s", emailStr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for email")
	}
}

// TestSMTPProxySameDomainFallback_KeysOnHeaderFrom verifies that the
// same-domain check uses the RFC 5322 From header, not the envelope.
// Scenario: envelope is on the platform domain (exempt from fallback)
// but the header From is on the customer's custom domain — same domain
// as the recipient. The fallback must fire based on the header.
func TestSMTPProxySameDomainFallback_KeysOnHeaderFrom(t *testing.T) {
	mockBackend := &mockSMTPBackend{receivedEmails: make(chan *mockEmail, 1)}
	mockServer := gosmtp.NewServer(mockBackend)
	mockServer.Addr = "127.0.0.1:0"
	mockServer.Domain = "test.local"
	mockServer.AllowInsecureAuth = true
	mockListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	mockAddr := mockListener.Addr().String()
	go func() { _ = mockServer.Serve(mockListener) }()
	time.Sleep(200 * time.Millisecond)

	identity := email.Identity{
		AppID:           "abc1234567",
		AttachedDomains: []string{"acme.com"},
		PrimaryDomain:   "acme.com",
		DefaultDomain:   "test-airoapp.ai",
	}
	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, make(map[string]string), identity)
	if startErr := proxy.Start(); startErr != nil {
		t.Fatalf("start: %v", startErr)
	}
	defer func() { _ = proxy.Stop() }()
	defer mockServer.Close()
	time.Sleep(200 * time.Millisecond)

	client, err := gosmtp.Dial(proxy.Addr())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer client.Close()

	// Envelope From is on the platform domain (exempt from fallback on
	// its own), but the header From is on the custom domain — same as
	// the recipient.
	if mailErr := client.Mail("abc1234567@test-airoapp.ai", nil); mailErr != nil {
		t.Fatalf("mail: %v", mailErr)
	}
	if rcptErr := client.Rcpt("john@acme.com", nil); rcptErr != nil {
		t.Fatalf("rcpt: %v", rcptErr)
	}
	w, err := client.Data()
	if err != nil {
		t.Fatalf("data: %v", err)
	}
	message := "From: support@acme.com\r\n" +
		"To: john@acme.com\r\n" +
		"Subject: Same-domain test\r\n" +
		"\r\n" +
		"Hello.\r\n"
	if _, writeErr := w.Write([]byte(message)); writeErr != nil {
		t.Fatalf("write: %v", writeErr)
	}
	if closeErr := w.Close(); closeErr != nil {
		t.Fatalf("close: %v", closeErr)
	}

	select {
	case received := <-mockBackend.receivedEmails:
		// Both envelope and header should be rewritten to platform domain.
		if received.from != "abc1234567@test-airoapp.ai" {
			t.Errorf("envelope From = %q, want %q", received.from, "abc1234567@test-airoapp.ai")
		}
		emailStr := string(received.data)
		if !strings.Contains(emailStr, "From: abc1234567@test-airoapp.ai") {
			t.Errorf("header From not rewritten to platform domain, got:\n%s", emailStr)
		}
		if strings.Contains(emailStr, "From: support@acme.com") {
			t.Errorf("original header From leaked through:\n%s", emailStr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for email")
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
