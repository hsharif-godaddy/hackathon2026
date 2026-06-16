package signing //nolint:testpackage // tests access unexported functions (loadRSAKey, extractBody, etc.)

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/airo-ai-builder/dev-supervisor/internal/email/signing/testkeys"
)

const testCellID = "test-cell"

// loadTestSigner builds a Signer from ephemeral key material generated
// per-test. Replaces the old testdata/* fixtures so we never commit a
// real RSA key (which would trip every secret scanner from here to
// the relay).
func loadTestSigner(t *testing.T) *Signer {
	t.Helper()
	mat := testkeys.Generate(t)
	s, err := NewForTesting(mat.KeyPEM, mat.CertPEM, mat.KeyID, testCellID)
	require.NoError(t, err)
	return s
}

func TestLoad_EmptyPath(t *testing.T) {
	t.Setenv(envKeyPath, "")
	s, err := Load()
	require.NoError(t, err)
	assert.Nil(t, s, "signing disabled when JWS_PRIVATE_KEY_PATH is empty")
}

func TestLoad_ValidFixtures(t *testing.T) {
	mat := testkeys.Generate(t)
	t.Setenv(envKeyPath, mat.KeyPath)
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, mat.KeyIDPath)
	t.Setenv(envCellID, testCellID)

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, mat.KeyID, s.KeyID())
	assert.Equal(t, testCellID, s.CellID())
	assert.NotNil(t, s.PublicKey())
}

func TestLoad_CellFallsBackToNomadDC(t *testing.T) {
	mat := testkeys.Generate(t)
	t.Setenv(envKeyPath, mat.KeyPath)
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, mat.KeyIDPath)
	t.Setenv(envCellID, "")
	t.Setenv(envNomadDC, "dc1")

	s, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "dc1", s.CellID())
}

func TestLoad_MissingCertPath(t *testing.T) {
	mat := testkeys.Generate(t)
	t.Setenv(envKeyPath, mat.KeyPath)
	t.Setenv(envCertPath, "")
	t.Setenv(envKeyIDPath, mat.KeyIDPath)

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), envCertPath)
}

func TestLoad_MissingKeyIDPath(t *testing.T) {
	mat := testkeys.Generate(t)
	t.Setenv(envKeyPath, mat.KeyPath)
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, "")

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), envKeyIDPath)
}

func TestLoad_KeyFileMissing(t *testing.T) {
	mat := testkeys.Generate(t)
	t.Setenv(envKeyPath, filepath.Join(t.TempDir(), "does-not-exist.pem"))
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, mat.KeyIDPath)

	_, err := Load()
	require.Error(t, err)
}

func TestLoad_InvalidPEM(t *testing.T) {
	mat := testkeys.Generate(t)
	dir := t.TempDir()
	bogus := filepath.Join(dir, "bogus.pem")
	require.NoError(t, os.WriteFile(bogus, []byte("not a pem file"), 0o600))

	t.Setenv(envKeyPath, bogus)
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, mat.KeyIDPath)

	_, err := Load()
	require.Error(t, err)
}

func TestLoad_EmptyKeyIDFile(t *testing.T) {
	mat := testkeys.Generate(t)
	dir := t.TempDir()
	emptyKeyID := filepath.Join(dir, "key_id")
	require.NoError(t, os.WriteFile(emptyKeyID, []byte("   \n"), 0o600))

	t.Setenv(envKeyPath, mat.KeyPath)
	t.Setenv(envCertPath, mat.CertPath)
	t.Setenv(envKeyIDPath, emptyKeyID)

	_, err := Load()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

func TestLoad_PrefersMountWhenPresent(t *testing.T) {
	allocMat := testkeys.Generate(t)
	mountMat := testkeys.Generate(t)

	t.Setenv(envKeyPath, allocMat.KeyPath)
	t.Setenv(envCertPath, allocMat.CertPath)
	t.Setenv(envKeyIDPath, allocMat.KeyIDPath)
	t.Setenv(envMountKeyPath, mountMat.KeyPath)
	t.Setenv(envMountCertPath, mountMat.CertPath)
	t.Setenv(envMountKeyIDPath, mountMat.KeyIDPath)

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, mountMat.KeyID, s.KeyID(), "mount material wins when fully present")
	assert.NotEqual(t, allocMat.KeyID, mountMat.KeyID, "fixtures must differ for the assertion to mean anything")
}

func TestLoad_FallsBackToAllocWhenMountFileMissing(t *testing.T) {
	allocMat := testkeys.Generate(t)

	t.Setenv(envKeyPath, allocMat.KeyPath)
	t.Setenv(envCertPath, allocMat.CertPath)
	t.Setenv(envKeyIDPath, allocMat.KeyIDPath)
	// Mount env vars set, but the files don't exist on disk.
	missingDir := t.TempDir()
	t.Setenv(envMountKeyPath, filepath.Join(missingDir, "key.pem"))
	t.Setenv(envMountCertPath, filepath.Join(missingDir, "cert.pem"))
	t.Setenv(envMountKeyIDPath, filepath.Join(missingDir, "key-id"))

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, allocMat.KeyID, s.KeyID(), "falls back to alloc when mount files are absent")
}

func TestLoad_FallsBackToAllocWhenMountPartiallyConfigured(t *testing.T) {
	allocMat := testkeys.Generate(t)
	mountMat := testkeys.Generate(t)

	t.Setenv(envKeyPath, allocMat.KeyPath)
	t.Setenv(envCertPath, allocMat.CertPath)
	t.Setenv(envKeyIDPath, allocMat.KeyIDPath)
	// Only the mount key path is set — cert/key-id mount paths are empty,
	// so the all-or-nothing gate must reject the mount and use alloc.
	t.Setenv(envMountKeyPath, mountMat.KeyPath)

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, allocMat.KeyID, s.KeyID(), "partial mount config falls back to alloc")
}

func TestLoad_FallsBackToAllocWhenMountPathIsDir(t *testing.T) {
	allocMat := testkeys.Generate(t)
	mountMat := testkeys.Generate(t)

	t.Setenv(envKeyPath, allocMat.KeyPath)
	t.Setenv(envCertPath, allocMat.CertPath)
	t.Setenv(envKeyIDPath, allocMat.KeyIDPath)
	// Mount cert/key-id are valid files, but the private-key mount path is a
	// directory (a misprovisioned host). The gate must reject the mount and
	// fall back to alloc rather than hard-failing when Load reads the key.
	t.Setenv(envMountKeyPath, t.TempDir())
	t.Setenv(envMountCertPath, mountMat.CertPath)
	t.Setenv(envMountKeyIDPath, mountMat.KeyIDPath)

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, allocMat.KeyID, s.KeyID(), "directory at a mount path falls back to alloc")
}

func TestLoad_MountOnlyWhenAllocUnset(t *testing.T) {
	mountMat := testkeys.Generate(t)

	// No alloc env vars — only the mount source is configured. This is
	// the end-state after the prestart fetch is retired.
	t.Setenv(envKeyPath, "")
	t.Setenv(envCertPath, "")
	t.Setenv(envKeyIDPath, "")
	t.Setenv(envMountKeyPath, mountMat.KeyPath)
	t.Setenv(envMountCertPath, mountMat.CertPath)
	t.Setenv(envMountKeyIDPath, mountMat.KeyIDPath)

	s, err := Load()
	require.NoError(t, err)
	require.NotNil(t, s)
	assert.Equal(t, mountMat.KeyID, s.KeyID())
}

func TestSignMessage_NilSigner(t *testing.T) {
	body := []byte("Subject: test\r\n\r\nbody\r\n")
	var s *Signer // nil
	got := s.SignMessage(body, "site1", "a@b.com")
	assert.Equal(t, body, got, "nil signer is a no-op")
}

func TestSignMessage_InjectsBothHeaders(t *testing.T) {
	s := loadTestSigner(t)
	body := []byte("From: sender@example.com\r\nSubject: hello\r\n\r\nhello world\r\n")

	got := s.SignMessage(body, "siteABC", "sender@example.com")
	gotStr := string(got)

	assert.Contains(t, gotStr, signingHeaderJWS+":")
	assert.Contains(t, gotStr, signingHeaderPubKey+":")
	assert.Contains(t, gotStr, "hello world\r\n", "body preserved")
	assert.Contains(t, gotStr, "From: sender@example.com\r\n", "original headers preserved")
}

func TestSignMessage_BodyHashIsCanonical(t *testing.T) {
	// Match the cPanel/relay format: hash is over the canonicalized
	// body — first 5000 bytes → \s+ collapsed → trim → 1000-rune cap →
	// SHA-256 → uppercase hex.
	s := loadTestSigner(t)
	rawBody := "  hello\t  world\r\n  with   weird\nspaces\r\n"
	msg := []byte("Subject: x\r\n\r\n" + rawBody)
	expected := CanonicalBodyHash([]byte(rawBody))
	require.NotEmpty(t, expected)
	require.Regexp(t, `^[0-9A-F]{64}$`, expected, "must be uppercase hex SHA-256")

	signed := s.SignMessage(msg, "site1", "a@b.com")

	parsed, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	jws := parsed.Header.Get(signingHeaderJWS)
	require.NotEmpty(t, jws)

	payload, err := s.VerifyForTesting(jws)
	require.NoError(t, err)
	assert.Equal(t, expected, payload["body_hash"])
}

func TestSignMessage_PayloadShape(t *testing.T) {
	// Mirrors scripts/test_dkim_send_mail.py's payload exactly:
	//   {"domain", "timestamp", "from", "body_hash"} — no iss/sub/aud/
	//   exp/iat/jti/cell/product. Anything we add here will get the
	//   relay to reject.
	s := loadTestSigner(t)
	msg := []byte("From: noreply@example.com\r\n\r\nbody\r\n")

	signed := s.SignMessage(msg, "siteXYZ", "Acme <noreply@example.com>")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	jws := mailMsg.Header.Get(signingHeaderJWS)
	require.NotEmpty(t, jws)

	payload, err := s.VerifyForTesting(jws)
	require.NoError(t, err)

	allowed := map[string]struct{}{
		"domain":    {},
		"timestamp": {},
		"from":      {},
		"body_hash": {},
	}
	for k := range payload {
		_, ok := allowed[k]
		assert.True(t, ok, "unexpected payload claim %q (relay schema only accepts domain/timestamp/from/body_hash)", k)
	}

	assert.Equal(t, "Acme <noreply@example.com>", payload["from"])
	assert.Equal(t, "example.com", payload["domain"])
	assert.NotEmpty(t, payload["timestamp"])
	assert.NotEmpty(t, payload["body_hash"])
}

func TestSignMessage_EmptyBodyOmitsBodyHash(t *testing.T) {
	// The Python reference omits body_hash when the body is empty.
	// canonicalBodyHash returns "" for empty input; the sign path
	// drops the field rather than emitting "body_hash":"".
	s := loadTestSigner(t)
	// Header-only message, no separator → no body.
	msg := []byte("Subject: header only")

	signed := s.SignMessage(msg, "site1", "a@b.com")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	jws := mailMsg.Header.Get(signingHeaderJWS)

	payload, err := s.VerifyForTesting(jws)
	require.NoError(t, err)
	_, hasBodyHash := payload["body_hash"]
	assert.False(t, hasBodyHash, "body_hash should be omitted when body is empty")
}

func TestSignMessage_EmptyFromOmitsFrom(t *testing.T) {
	s := loadTestSigner(t)
	msg := []byte("Subject: x\r\n\r\nbody")

	signed := s.SignMessage(msg, "site1", "")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	jws := mailMsg.Header.Get(signingHeaderJWS)

	payload, err := s.VerifyForTesting(jws)
	require.NoError(t, err)
	_, hasFrom := payload["from"]
	assert.False(t, hasFrom, "from should be omitted when empty")
}

func TestSignMessage_HeaderShape(t *testing.T) {
	// JOSE header must be exactly {"typ":"JWT","alg":"RS256"} — no kid,
	// no extra fields. The relay parser ignores unknown fields but is
	// strict about required ones.
	s := loadTestSigner(t)
	signed := s.SignMessage([]byte("Subject: x\r\n\r\nbody"), "site", "a@b.com")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	jws := mailMsg.Header.Get(signingHeaderJWS)

	header, err := DecodeHeaderForTesting(jws)
	require.NoError(t, err)
	assert.Equal(t, "JWT", header["typ"])
	assert.Equal(t, "RS256", header["alg"])
	_, hasKid := header["kid"]
	assert.False(t, hasKid, "kid must NOT be in the JOSE header")
}

func TestSignMessage_PubKeyHeaderIsInnerBase64Only(t *testing.T) {
	// X-GD-DKIM-PUB-KEY contains the leaf cert's inner base64 with
	// every PEM marker and every whitespace character stripped. The
	// relay reconstructs the cert by re-base64-decoding this string
	// directly.
	s := loadTestSigner(t)
	signed := s.SignMessage([]byte("Subject: x\r\n\r\nbody"), "site", "a@b.com")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	pub := mailMsg.Header.Get(signingHeaderPubKey)
	require.NotEmpty(t, pub)

	assert.NotContains(t, pub, "BEGIN CERTIFICATE", "must not contain PEM begin marker")
	assert.NotContains(t, pub, "END CERTIFICATE", "must not contain PEM end marker")
	// The header value may contain RFC 5322 fold whitespace (CRLF + SP)
	// because cert inner-base64 exceeds the 998-octet hard line limit.
	// Strip whitespace before the base64-alphabet assertion — this
	// mirrors what the relay verifier does (and matches the cPanel
	// reference's `"".join(s.split())`).
	stripped := stripAllWhitespace(pub)
	assert.NotEmpty(t, stripped, "header value empty after whitespace strip")
	for _, r := range stripped {
		ok := (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') ||
			(r >= '0' && r <= '9') || r == '+' || r == '/' || r == '=' ||
			r == '-' || r == '_'
		assert.True(t, ok, "non-base64 char in pub-key header: %q", r)
	}
}

func TestSignMessage_BodyExtractsAfterCRLFSeparator(t *testing.T) {
	// The body is the bytes after the FIRST blank line. Subsequent
	// blank lines (multipart MIME with empty parts, etc.) are part of
	// the body, not boundaries.
	s := loadTestSigner(t)
	msg := []byte("Subject: x\r\nFrom: a@b.com\r\n\r\nfirst\r\n\r\nsecond")
	expected := CanonicalBodyHash([]byte("first\r\n\r\nsecond"))

	signed := s.SignMessage(msg, "site", "a@b.com")
	mailMsg, err := mail.ReadMessage(bytes.NewReader(signed))
	require.NoError(t, err)
	payload, err := s.VerifyForTesting(mailMsg.Header.Get(signingHeaderJWS))
	require.NoError(t, err)
	assert.Equal(t, expected, payload["body_hash"])
}

func TestSignMessage_AcceptsBareLFSeparator(t *testing.T) {
	// SMTP requires CRLF but tolerant parsers (us included) accept
	// bare LF for the header/body separator.
	s := loadTestSigner(t)
	msg := []byte("Subject: x\nFrom: a@b.com\n\nbody bytes")
	expected := CanonicalBodyHash([]byte("body bytes"))

	signed := s.SignMessage(msg, "site", "a@b.com")
	// NOTE: net/mail.ReadMessage requires CRLF; for this test we parse
	// the JWS out manually since we know the injected header line ends CRLF.
	jws := extractHeaderValue(t, signed, signingHeaderJWS)
	payload, err := s.VerifyForTesting(jws)
	require.NoError(t, err)
	assert.Equal(t, expected, payload["body_hash"])
}

// extractHeaderValue does a line-walking lookup to find a header in a
// message that might use bare-LF line endings (which net/mail rejects).
// Honors RFC 5322 §2.2.3 folding: continuation lines (starting with
// SP or HTAB) are concatenated onto the value. VerifyForTesting will
// strip any embedded whitespace before parsing JWS segments.
func extractHeaderValue(t *testing.T, msg []byte, name string) string {
	t.Helper()
	prefix := name + ": "
	lines := strings.Split(string(msg), "\n")
	for i, line := range lines {
		line = strings.TrimRight(line, "\r")
		if !strings.HasPrefix(line, prefix) {
			continue
		}
		var b strings.Builder
		b.WriteString(strings.TrimPrefix(line, prefix))
		for j := i + 1; j < len(lines); j++ {
			cont := strings.TrimRight(lines[j], "\r")
			if cont == "" || (cont[0] != ' ' && cont[0] != '\t') {
				break
			}
			b.WriteString(cont)
		}
		return strings.TrimSpace(b.String())
	}
	t.Fatalf("header %q not found", name)
	return ""
}

func TestCanonicalBodyHash_MatchesPythonReference(t *testing.T) {
	// Pin the canonical-hash algorithm against vectors derived from
	// scripts/test_dkim_send_mail.py's compute_canonical_body_hash.
	// If any of these changes, the relay will reject our signatures.
	cases := []struct {
		name string
		in   string
	}{
		{"plain", "hello world"},
		{"crlf", "line one\r\nline two\r\n"},
		{"tabs_and_spaces", "  hello\t\tworld   "},
		{"newlines_collapsed", "a\n\n\nb"},
		{"mixed", "  \t\nfoo\r\n\tbar  baz   "},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CanonicalBodyHash([]byte(tc.in))
			assert.Regexp(t, `^[0-9A-F]{64}$`, got)
			// Algorithmically: collapse \s+ → " ", trim, hash, upper-hex.
			normalized := runsOfWhitespace.ReplaceAllString(tc.in, " ")
			normalized = strings.TrimSpace(normalized)
			expected := strings.ToUpper(sha256Hex(normalized))
			assert.Equal(t, expected, got)
		})
	}
}

func TestCanonicalBodyHash_EmptyBody(t *testing.T) {
	assert.Empty(t, CanonicalBodyHash(nil))
	assert.Empty(t, CanonicalBodyHash([]byte{}))
	// All-whitespace input collapses to empty after trim, hashes empty
	// string. SHA-256 of empty is well-known.
	got := CanonicalBodyHash([]byte("   \t\n  "))
	assert.Equal(t,
		strings.ToUpper("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
		got, "all-whitespace body collapses to empty before SHA-256")
}

func TestCanonicalBodyHash_TruncatesAt5000Bytes(t *testing.T) {
	// Inputs > 5000 bytes are byte-truncated before the rest of the
	// pipeline. After truncation, two inputs that differ ONLY past the
	// 5000-byte mark must hash identically.
	a := strings.Repeat("a", 5000) + "DIFF1"
	b := strings.Repeat("a", 5000) + "DIFF2"
	assert.Equal(t, CanonicalBodyHash([]byte(a)), CanonicalBodyHash([]byte(b)))
}

func TestCanonicalBodyHash_CapsAt1000Bytes(t *testing.T) {
	// After whitespace collapse + trim, inputs are byte-truncated to
	// 1000 bytes. Two inputs differing only past the 1000-byte mark
	// (post-normalization) must hash identically. Byte (not rune)
	// truncation matches the cPanel Perl reference's substr-on-bytes
	// behavior and the Cloudmark relay verifier confirmed in cross-
	// team alignment.
	a := strings.Repeat("a", 1000) + "tail-A"
	b := strings.Repeat("a", 1000) + "tail-B"
	assert.Equal(t, CanonicalBodyHash([]byte(a)), CanonicalBodyHash([]byte(b)))
}

// sha256Hex is a deliberately minimal reference implementation used by
// tests to cross-check canonicalBodyHash. Kept separate from the
// production helpers so a refactor can't silently make both sides
// agree on a wrong answer.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func TestExtractBody(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"Subject: x\r\n\r\nbody", "body"},
		{"Subject: x\n\nbody", "body"},
		{"Subject: x\r\n\r\n", ""},
		{"no separator at all", ""},
		{"From: a@b\r\nSubject: x\r\n\r\nfirst\r\n\r\nsecond", "first\r\n\r\nsecond"},
	}
	for _, tc := range cases {
		got := extractBody([]byte(tc.in))
		assert.Equal(t, tc.want, string(got), tc.in)
	}
}

func TestDomainOf(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"a@b.com", "b.com"},
		{"Acme <noreply@example.com>", "example.com"},
		{"NoReply@Example.COM", "example.com"},
		{"   sender@host.io  ", "host.io"},
		{"not-an-address", ""},
		{"", ""},
		{"@host.com", ""},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			assert.Equal(t, tc.want, domainOf(tc.in))
		})
	}
}

func TestLeafCertInnerBase64_StripsMarkersAndWhitespace(t *testing.T) {
	// Use ephemeral material so pem.Decode is happy; we verify only the
	// stripping invariants — no markers, no whitespace, base64-ish chars
	// only. The canonical "ABC/DEF" synthetic-PEM is not valid base64,
	// so it would never round-trip through pem.Decode anyway.
	mat := testkeys.Generate(t)
	got, err := leafCertInnerBase64(string(mat.CertPEM))
	require.NoError(t, err)

	assert.NotContains(t, got, "BEGIN CERTIFICATE")
	assert.NotContains(t, got, "END CERTIFICATE")
	assert.NotContains(t, got, "\n")
	assert.NotContains(t, got, "\r")
	assert.NotContains(t, got, " ")
	assert.NotEmpty(t, got)
}

func TestLeafCertInnerBase64_NoCertsErrors(t *testing.T) {
	_, err := leafCertInnerBase64("not a pem at all")
	require.Error(t, err)
}

func TestSigner_KeyIDAndCellID_NilReceiver(t *testing.T) {
	var s *Signer
	assert.Empty(t, s.KeyID())
	assert.Empty(t, s.CellID())
	assert.Nil(t, s.PublicKey())
}

func TestNewForTesting_BadPEM(t *testing.T) {
	_, err := NewForTesting([]byte("nope"), []byte("cert"), "id", "cell")
	require.Error(t, err)
}
