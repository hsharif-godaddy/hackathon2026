package emailhttp_test

import (
	"bytes"
	"net/http"
	"net/mail"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing"
	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing/testkeys"
	"github.com/airo-ai-builder/dev-supervisor/internal/proxy/emailhttp"
)

// TestGateway_JWSSigning_E2E asserts that, with a Signer installed, a
// successful HTTP send produces a forwarded message that carries
// X-GD-DKIM-SIGN and X-GD-DKIM-PUB-KEY, and the signed body_hash
// matches what the relay would compute (after stripping the two
// signing headers).
func TestGateway_JWSSigning_E2E(t *testing.T) {
	t.Parallel()

	signer := newGatewayTestSigner(t)
	rec := &recordingForward{}
	gw := emailhttp.NewForTesting(
		"127.0.0.1:0",
		"smtp-test:25",
		fixedIdentity(defaultIdentity()),
		rec.fn,
		nil,
		true,
	)
	gw.SetSigner(signer.SignMessage)
	require.NoError(t, gw.Start())
	defer func() { _ = gw.Stop() }()

	url := "http://" + gw.Addr() + emailhttp.SendPath
	resp, _ := postJSON(t, url, map[string]any{
		"to":      []string{"recipient@example.com"},
		"subject": "signed",
		"text":    "hello",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	calls := rec.snapshot()
	require.Len(t, calls, 1)
	body := calls[0].body

	parsed, err := mail.ReadMessage(bytes.NewReader(body))
	require.NoError(t, err)
	jws := parsed.Header.Get("X-GD-DKIM-SIGN")
	pub := parsed.Header.Get("X-GD-DKIM-PUB-KEY")
	require.NotEmpty(t, jws, "JWS header must be set on signed gateway send")
	require.NotEmpty(t, pub, "pub-key header must be set on signed gateway send")

	claims, err := signer.VerifyForTesting(jws)
	require.NoError(t, err)
	// Default identity from gateway_test.go: AppID="abc123",
	// PrimaryDomain="acme.com" → CanonicalSender = "abc123@acme.com".
	// The relay schema only carries domain/timestamp/from/body_hash —
	// the AppID surfaces in dev-supervisor logs, not in the JWS.
	assert.Equal(t, "abc123@acme.com", claims["from"])
	assert.Equal(t, "acme.com", claims["domain"])
	assert.NotEmpty(t, claims["timestamp"])

	strippedBody := extractGatewayBodyBytes(stripGatewaySigningHeaders(body))
	assert.Equal(t, signing.CanonicalBodyHash(strippedBody), claims["body_hash"],
		"body_hash must match canonical hash of the post-strip body")
}

// TestGateway_NoSigner_NoHeaders asserts the pass-through case: a
// gateway without a signer forwards unsigned bytes.
func TestGateway_NoSigner_NoHeaders(t *testing.T) {
	t.Parallel()
	rec := &recordingForward{}
	url, cleanup := startGateway(t, fixedIdentity(defaultIdentity()), rec.fn)
	defer cleanup()

	resp, _ := postJSON(t, url, map[string]any{
		"to":      []string{"recipient@example.com"},
		"subject": "unsigned",
		"text":    "hello",
	})
	require.Equal(t, http.StatusOK, resp.StatusCode)

	calls := rec.snapshot()
	require.Len(t, calls, 1)
	parsed, err := mail.ReadMessage(bytes.NewReader(calls[0].body))
	require.NoError(t, err)
	assert.Empty(t, parsed.Header.Get("X-GD-DKIM-SIGN"))
	assert.Empty(t, parsed.Header.Get("X-GD-DKIM-PUB-KEY"))
}

func newGatewayTestSigner(t *testing.T) *signing.Signer {
	t.Helper()
	mat := testkeys.Generate(t)
	s, err := signing.NewForTesting(mat.KeyPEM, mat.CertPEM, mat.KeyID, "test-cell")
	require.NoError(t, err)
	return s
}

// extractGatewayBodyBytes returns everything after the first blank
// line — the body the relay would hash.
func extractGatewayBodyBytes(message []byte) []byte {
	if _, after, ok := bytes.Cut(message, []byte("\r\n\r\n")); ok {
		return after
	}
	if _, after, ok := bytes.Cut(message, []byte("\n\n")); ok {
		return after
	}
	return nil
}

// stripGatewaySigningHeaders mirrors what the relay does before it
// re-hashes the body to verify the JWS body_hash claim.
func stripGatewaySigningHeaders(data []byte) []byte {
	var out bytes.Buffer
	lines := bytes.SplitAfter(data, []byte("\n"))
	skip := false
	inHeaders := true
	for _, line := range lines {
		switch {
		case !inHeaders:
			out.Write(line)
		case bytes.Equal(line, []byte("\r\n")) || bytes.Equal(line, []byte("\n")):
			inHeaders = false
			skip = false
			out.Write(line)
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

// Compile-time guard that email.Identity is referenced (the package
// is otherwise unused in this file but required for type clarity).
var _ = email.Identity{}
