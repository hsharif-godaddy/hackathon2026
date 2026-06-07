package smtp_test

import (
	"bytes"
	"io"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	gosmtp "github.com/emersion/go-smtp"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing/testkeys"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/smtp"
)

// TestSMTPProxy_JWSSigning_E2E verifies that when a Signer is installed
// on the proxy, outbound mail carries the X-GD-DKIM-SIGN and
// X-GD-DKIM-PUB-KEY headers, and the JWS verifies against the signer's
// public key. The body_hash claim must match the message bytes the
// relay reconstructs after stripping the two signing headers — the
// load-bearing invariant for the relay's verify step.
func TestSMTPProxy_JWSSigning_E2E(t *testing.T) {
	t.Setenv("SITE_ID", "site-jws-1")
	t.Setenv("PRODUCT", "airo-app-builder")

	signer := newTestSigner(t)

	mockBackend := &jwsRecorder{received: make(chan []byte, 1)}
	mockServer := gosmtp.NewServer(mockBackend)
	mockServer.Domain = "test.local"
	mockServer.AllowInsecureAuth = true
	mockListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	mockAddr := mockListener.Addr().String()
	go func() { _ = mockServer.Serve(mockListener) }()
	time.Sleep(100 * time.Millisecond)

	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, nil, permissiveIdentity("example.com"))
	proxy.LoadHeaders()
	proxy.SetSigner(signer.SignMessage)
	require.NoError(t, proxy.Start())
	defer func() { _ = proxy.Stop() }()
	defer mockServer.Close()
	time.Sleep(100 * time.Millisecond)

	// Send a message through the proxy.
	client, err := gosmtp.Dial(proxy.Addr())
	require.NoError(t, err)
	defer client.Close()

	// Recipient on a different domain to avoid triggering same-domain fallback.
	require.NoError(t, client.Mail("sender@example.com", nil))
	require.NoError(t, client.Rcpt("recipient@example.net", nil))

	w, err := client.Data()
	require.NoError(t, err)
	msgBody := "From: sender@example.com\r\n" +
		"To: recipient@example.net\r\n" +
		"Subject: signed test\r\n" +
		"\r\n" +
		"hello\r\n"
	_, err = w.Write([]byte(msgBody))
	require.NoError(t, err)
	require.NoError(t, w.Close())

	var got []byte
	select {
	case got = <-mockBackend.received:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for forwarded message")
	}

	// Both signing headers present.
	parsed, err := mail.ReadMessage(bytes.NewReader(got))
	require.NoError(t, err)
	jws := parsed.Header.Get("X-GD-DKIM-SIGN")
	pubKey := parsed.Header.Get("X-GD-DKIM-PUB-KEY")
	require.NotEmpty(t, jws, "X-GD-DKIM-SIGN header must be present")
	require.NotEmpty(t, pubKey, "X-GD-DKIM-PUB-KEY header must be present")

	// JWS verifies against the signer's public key. The relay schema
	// only carries domain / timestamp / from / body_hash — the SMTP
	// proxy's identity.AppID is NOT in the payload (it's used for
	// audit logging instead).
	claims, err := signer.VerifyForTesting(jws)
	require.NoError(t, err)
	assert.Equal(t, "sender@example.com", claims["from"])
	assert.Equal(t, "example.com", claims["domain"])
	assert.NotEmpty(t, claims["timestamp"])

	// body_hash is the canonical hash of the BODY portion of what the
	// relay reconstructs (after stripping X-GD-DKIM-* and extracting
	// bytes after the blank line).
	strippedBody := extractBodyBytes(stripSigningHeaders(got))
	assert.Equal(t, signing.CanonicalBodyHash(strippedBody), claims["body_hash"],
		"body_hash must match canonical hash of the post-strip body")
}

// TestSMTPProxy_NoSigner_NoHeaders verifies the pass-through case:
// without a signer, no JWS headers are added.
func TestSMTPProxy_NoSigner_NoHeaders(t *testing.T) {
	t.Setenv("SITE_ID", "site-nosign")

	mockBackend := &jwsRecorder{received: make(chan []byte, 1)}
	mockServer := gosmtp.NewServer(mockBackend)
	mockServer.Domain = "test.local"
	mockServer.AllowInsecureAuth = true
	mockListener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	mockAddr := mockListener.Addr().String()
	go func() { _ = mockServer.Serve(mockListener) }()
	time.Sleep(100 * time.Millisecond)

	proxy := smtp.NewForTesting("127.0.0.1:0", mockAddr, nil, permissiveIdentity("example.com"))
	proxy.LoadHeaders()
	// Deliberately NOT calling SetSigner.
	require.NoError(t, proxy.Start())
	defer func() { _ = proxy.Stop() }()
	defer mockServer.Close()
	time.Sleep(100 * time.Millisecond)

	client, err := gosmtp.Dial(proxy.Addr())
	require.NoError(t, err)
	defer client.Close()
	// Recipient on a different domain to avoid triggering same-domain fallback.
	require.NoError(t, client.Mail("sender@example.com", nil))
	require.NoError(t, client.Rcpt("rcpt@example.net", nil))
	w, err := client.Data()
	require.NoError(t, err)
	_, err = w.Write([]byte("From: sender@example.com\r\nSubject: t\r\n\r\nbody\r\n"))
	require.NoError(t, err)
	require.NoError(t, w.Close())

	var got []byte
	select {
	case got = <-mockBackend.received:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}

	parsed, err := mail.ReadMessage(bytes.NewReader(got))
	require.NoError(t, err)
	assert.Empty(t, parsed.Header.Get("X-GD-DKIM-SIGN"))
	assert.Empty(t, parsed.Header.Get("X-GD-DKIM-PUB-KEY"))
}

// newTestSigner builds a Signer from ephemeral key material generated
// by the signing/testkeys helper. No on-disk fixtures — the previous
// approach committed a real RSA key, which trips every secret scanner
// in the supply chain.
func newTestSigner(t *testing.T) *signing.Signer {
	t.Helper()
	mat := testkeys.Generate(t)
	s, err := signing.NewForTesting(mat.KeyPEM, mat.CertPEM, mat.KeyID, "test-cell")
	require.NoError(t, err)
	return s
}

// extractBodyBytes returns everything after the first blank line of an
// RFC 5322 message — what the relay hashes after the X-GD-DKIM-*
// headers have been stripped.
func extractBodyBytes(message []byte) []byte {
	if _, after, ok := bytes.Cut(message, []byte("\r\n\r\n")); ok {
		return after
	}
	if _, after, ok := bytes.Cut(message, []byte("\n\n")); ok {
		return after
	}
	return nil
}

// stripSigningHeaders removes the X-GD-DKIM-SIGN and X-GD-DKIM-PUB-KEY
// header lines from data byte-identically. This mirrors what the relay
// must do before recomputing body_hash on the JWS-protected message.
func stripSigningHeaders(data []byte) []byte {
	var out bytes.Buffer
	r := bytes.NewReader(data)
	scanner := newCRLFScanner(r)
	skip := false
	inHeaders := true
	for scanner.scan() {
		line := scanner.line()
		switch {
		case !inHeaders:
			out.Write(line)
		case len(line) == 2 && line[0] == '\r' && line[1] == '\n':
			out.Write(line)
			inHeaders = false
			skip = false
		case len(line) > 0 && (line[0] == ' ' || line[0] == '\t'):
			if !skip {
				out.Write(line)
			}
		default:
			lower := strings.ToLower(string(line))
			if strings.HasPrefix(lower, "x-gd-dkim-sign:") || strings.HasPrefix(lower, "x-gd-dkim-pub-key:") {
				skip = true
				continue
			}
			skip = false
			out.Write(line)
		}
	}
	return out.Bytes()
}

// crlfScanner reads CRLF-terminated lines preserving the terminator.
type crlfScanner struct {
	r       io.Reader
	buf     []byte
	current []byte
}

func newCRLFScanner(r io.Reader) *crlfScanner {
	all, _ := io.ReadAll(r)
	return &crlfScanner{r: nil, buf: all}
}

func (s *crlfScanner) scan() bool {
	if len(s.buf) == 0 {
		s.current = nil
		return false
	}
	idx := bytes.Index(s.buf, []byte("\n"))
	if idx < 0 {
		s.current = s.buf
		s.buf = nil
		return true
	}
	s.current = s.buf[:idx+1]
	s.buf = s.buf[idx+1:]
	return true
}

func (s *crlfScanner) line() []byte { return s.current }

// jwsRecorder is a minimal mock SMTP backend that records the DATA
// bytes of each delivered message into a channel.
type jwsRecorder struct {
	received chan []byte
}

func (b *jwsRecorder) NewSession(_ *gosmtp.Conn) (gosmtp.Session, error) {
	return &jwsRecorderSession{backend: b}, nil
}

type jwsRecorderSession struct {
	backend *jwsRecorder
}

func (s *jwsRecorderSession) AuthPlain(_, _ string) error                { return nil }
func (s *jwsRecorderSession) Mail(_ string, _ *gosmtp.MailOptions) error { return nil }
func (s *jwsRecorderSession) Rcpt(_ string, _ *gosmtp.RcptOptions) error { return nil }
func (s *jwsRecorderSession) Reset()                                     {}
func (s *jwsRecorderSession) Logout() error                              { return nil }
func (s *jwsRecorderSession) Data(r io.Reader) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	select {
	case s.backend.received <- data:
	default:
	}
	return nil
}

// Compile-time guard that email.Identity zero-value still works for
// the helper used above.
var _ = email.Identity{}
