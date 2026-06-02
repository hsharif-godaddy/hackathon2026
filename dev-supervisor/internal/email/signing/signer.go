// Package signing provides JWS (JSON Web Signature) signing of outbound
// email for the Airo platform. It is consumed by both the SMTP proxy
// and the HTTP email gateway in dev-supervisor; both call SignMessage
// to inject the X-GD-DKIM-SIGN and X-GD-DKIM-PUB-KEY headers the
// hosting relay verifies before applying RFC DKIM signatures on the
// customer domain.
//
// # Wire format
//
// Mirrors the cPanel reference implementation in
// /etc/gd_domain_validation.pl on shared hosting (and the Python
// reference at scripts/test_dkim_send_mail.py in this repo). The
// relay's verifier expects:
//
//   - JOSE header:  {"typ":"JWT","alg":"RS256"}             (no kid)
//   - Payload:      {"domain":"…","timestamp":<unix>,"from":"…","body_hash":"…"}
//     from is omitted when empty; body_hash when empty.
//   - Signature:    RS256 over <header_b64>.<payload_b64>
//   - body_hash:    UPPERCASE hex of SHA-256 over the canonicalized
//     message body (see canonicalBodyHash).
//   - X-GD-DKIM-PUB-KEY: inner base64 of the LEAF certificate, with
//     BEGIN/END markers and all whitespace stripped.
//
// Deviating from this format means the relay rejects every signed
// message — every claim shape, header shape, body-hash algorithm, and
// pubkey-header encoding has to match.
//
// # Key isolation
//
// The private key is mounted into the Nomad allocation at a path under
// ${NOMAD_ALLOC_DIR} that is NOT in the customer-process Landlock
// allowlist (see internal/sandbox/profile.go). Customer code therefore
// cannot read the file even though it shares the filesystem namespace.
// dev-supervisor itself is PID1, never passes through airo-sandbox, and
// retains full filesystem access. SELinux file labels (smtp_signing_key_t)
// provide defense-in-depth — see docs/jws-email-signing.md §6 for the
// full threat model.
//
// # Graceful disable
//
// When JWS_PRIVATE_KEY_PATH is empty (local dev, Mailpit), Load returns
// (nil, nil) and a nil *Signer is the no-op receiver SignMessage returns
// the body unchanged from. This lets local dev send mail through
// dev-supervisor without standing up signing infrastructure.
package signing

import (
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/airo-ai-builder/dev-supervisor/internal/config"
	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

const (
	// signingHeaderJWS carries the compact JWS that asserts the relay
	// trust signal. Stripped at the relay before delivery.
	signingHeaderJWS = "X-GD-DKIM-SIGN"

	// signingHeaderPubKey carries the leaf cert (inner base64 only —
	// BEGIN/END stripped) the relay uses to verify the JWS chains to the
	// trusted intermediate CA. Stripped at the relay before delivery.
	signingHeaderPubKey = "X-GD-DKIM-PUB-KEY"

	// envKeyPath / envCertPath / envKeyIDPath name the alloc-dir files
	// produced by the prestart task that fetches per-cell material from
	// ASM. See docs/jws-email-signing.md §4.2 for the prestart-task
	// definition and §5 for the full configuration ladder.
	envKeyPath   = "JWS_PRIVATE_KEY_PATH"
	envCertPath  = "JWS_CERT_PATH"
	envKeyIDPath = "JWS_KEY_ID_PATH"

	// envCellID and envNomadDC source the cell identifier used in
	// startup / sign-failure logs. The cell is NOT in the JWS payload —
	// the relay's payload schema doesn't include it — but it remains a
	// useful operator-facing field on the Signer for diagnostics.
	envCellID  = "CELL_ID"
	envNomadDC = "NOMAD_DC"

	// canonicalBodyMaxBytes mirrors the EXIM_BODY_VISIBLE_BYTES constant
	// in the cPanel script. The first 5000 bytes of the body (UTF-8
	// safe-decoded) feed the canonical-hash pipeline; everything past
	// that is ignored.
	canonicalBodyMaxBytes = 5000

	// canonicalBodyMaxBytesAfter caps the post-normalization byte length
	// before SHA-256. Mirrors the cPanel Perl script's
	// "if (length($raw_body) > 1000) { $raw_body = substr($raw_body, 0, 1000); }"
	// — Perl length/substr operate on bytes (no `use utf8`), and the
	// Cloudmark relay verifier confirmed byte-truncation, not rune-
	// truncation, in the cross-team alignment thread. Byte-truncating
	// matters for non-ASCII bodies: a rune-truncate would diverge from
	// the relay's hash and silently fail JWS verify on any UTF-8 input.
	canonicalBodyMaxBytesAfter = 1000
)

// runsOfWhitespace matches Python's re.sub(r"\s+", " ", ...) — any run
// of one or more whitespace characters (Unicode \s in Python regex
// includes [ \t\n\r\f\v] plus other whitespace; Go's regexp \s matches
// the same set).
var runsOfWhitespace = regexp.MustCompile(`\s+`)

// Signer holds the loaded RSA signing material and per-cell metadata.
// One instance per dev-supervisor process; both email send paths call
// SignMessage on the same Signer so the relay sees a single shape.
//
// A nil *Signer is a valid no-op — SignMessage returns its input
// unchanged. Production callers obtain a Signer via Load; tests can
// build one with NewForTesting.
type Signer struct {
	privateKey *rsa.PrivateKey
	// certInnerB64 is the X-GD-DKIM-PUB-KEY value: the leaf cert's
	// inner base64 with all PEM markers and whitespace stripped, ready
	// to drop into the header verbatim.
	certInnerB64 string
	keyID        string
	cellID       string
}

// Load reads the per-cell signing material from the env-named paths.
//
// Returns (nil, nil) when JWS_PRIVATE_KEY_PATH is empty: the caller
// treats this as "signing disabled" (local dev, Mailpit). This is
// distinct from (nil, error), which means the env asked for signing
// but the material couldn't be loaded — startup logs the error and
// continues unsigned, but operators see the failure.
//
// Cell ID is sourced from CELL_ID first, then NOMAD_DC. An empty cell
// is permitted (used only for logs) but logged at warn.
func Load() (*Signer, error) {
	keyPath := strings.TrimSpace(config.GetEnvStringWithDefault(envKeyPath, ""))
	if keyPath == "" {
		return nil, nil //nolint:nilnil // nil signer + nil error = signing disabled (intentional API contract)
	}

	certPath := strings.TrimSpace(config.GetEnvStringWithDefault(envCertPath, ""))
	if certPath == "" {
		return nil, fmt.Errorf("%s set but %s is empty", envKeyPath, envCertPath)
	}
	keyIDPath := strings.TrimSpace(config.GetEnvStringWithDefault(envKeyIDPath, ""))
	if keyIDPath == "" {
		return nil, fmt.Errorf("%s set but %s is empty", envKeyPath, envKeyIDPath)
	}

	// Log the paths and their file info for debugging. This surfaces in
	// dev-supervisor startup logs so operators can see exactly what Load()
	// is working with — file exists? readable? permissions? size?
	for _, p := range []string{keyPath, certPath, keyIDPath} {
		info, statErr := os.Stat(p)
		if statErr != nil {
			slog.Warn("jws.signing.file_stat",
				"path", p,
				"error", statErr.Error(),
			)
		} else {
			slog.Info("jws.signing.file_stat",
				"path", p,
				"size", info.Size(),
				"mode", info.Mode().String(),
				"uid", info.Sys(),
			)
		}
	}

	// The fetch-signing-key prestart runs as root and may write the key
	// with restrictive permissions (chmod 400). The preview/publish task
	// runs as a non-root uid. If the file exists but isn't readable,
	// attempt to chmod it to world-readable before reading. This is a
	// belt-and-suspenders fix: the prestart SHOULD write 444 (per the
	// libsonnet), but if an older prestart ran with 400, this unblocks
	// signing without requiring another full alloc cycle.
	if os.Getenv("DEV_SUPERVISOR_SANDBOX_ENABLED") == "true" {
		for _, p := range []string{keyPath, certPath, keyIDPath} {
			//nolint:gosec // G302: world-readable is safe because Landlock blocks customer access
			if err := os.Chmod(p, 0444); err != nil {
				slog.Info("jws.signing.chmod_attempt",
					"path", p,
					"error", err.Error(),
				)
			}
		}
	}

	key, err := loadRSAKey(keyPath)
	if err != nil {
		return nil, fmt.Errorf("load private key %q: %w", keyPath, err)
	}

	certPEM, err := os.ReadFile(certPath)
	if err != nil {
		return nil, fmt.Errorf("read cert %q: %w", certPath, err)
	}
	if len(certPEM) == 0 {
		return nil, fmt.Errorf("cert %q is empty", certPath)
	}

	certInner, err := leafCertInnerBase64(string(certPEM))
	if err != nil {
		return nil, fmt.Errorf("extract leaf cert from %q: %w", certPath, err)
	}

	keyIDBytes, err := os.ReadFile(keyIDPath)
	if err != nil {
		return nil, fmt.Errorf("read key id %q: %w", keyIDPath, err)
	}
	keyID := strings.TrimSpace(string(keyIDBytes))
	if keyID == "" {
		return nil, fmt.Errorf("key id %q is empty", keyIDPath)
	}

	cellID := strings.TrimSpace(config.GetEnvStringWithDefault(envCellID, ""))
	if cellID == "" {
		cellID = strings.TrimSpace(config.GetEnvStringWithDefault(envNomadDC, ""))
	}
	if cellID == "" {
		slog.Warn("jws.signing.cell_id_missing",
			"env_checked", []string{envCellID, envNomadDC},
		)
	}

	slog.Info("jws.signing.load_success",
		"key_path", keyPath,
		"cert_path", certPath,
		"key_id", keyID,
		"cell_id", cellID,
	)

	// Write a status file to the alloc dir so operators can read the
	// signing load outcome from inside the container without needing
	// access to the log pipeline. Mirrors jws-fetch-status.json pattern.
	allocDir := os.Getenv("NOMAD_ALLOC_DIR")
	if allocDir == "" {
		allocDir = "/alloc"
	}
	statusPath := allocDir + "/jws-signing-status.json"
	statusJSON := fmt.Sprintf(
		`{"loaded":true,"key_path":%q,"cert_path":%q,"key_id":%q,"cell_id":%q,"error":""}`,
		keyPath, certPath, keyID, cellID,
	)
	if err := os.WriteFile(statusPath, []byte(statusJSON+"\n"), 0600); err != nil {
		slog.Warn("jws.signing.status_write_failed", "path", statusPath, "error", err)
	}

	return &Signer{
		privateKey:   key,
		certInnerB64: certInner,
		keyID:        keyID,
		cellID:       cellID,
	}, nil
}

// NewForTesting constructs a Signer from in-memory PEM bytes. Used by
// tests that don't want to write fixtures to disk.
func NewForTesting(privateKeyPEM, certPEM []byte, keyID, cellID string) (*Signer, error) {
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, errors.New("decode private key PEM: no block found")
	}
	key, err := parseRSAPrivateKey(block)
	if err != nil {
		return nil, err
	}
	certInner, err := leafCertInnerBase64(string(certPEM))
	if err != nil {
		return nil, err
	}
	return &Signer{
		privateKey:   key,
		certInnerB64: certInner,
		keyID:        keyID,
		cellID:       cellID,
	}, nil
}

// KeyID returns the loaded key identifier (for startup logs / metrics).
// Returns "" on a nil receiver. NOTE: the kid is NOT placed in the JWS
// header — the relay's verify path does not look at it. We carry it
// for diagnostics only.
func (s *Signer) KeyID() string {
	if s == nil {
		return ""
	}
	return s.keyID
}

// CellID returns the loaded cell identifier. Returns "" on a nil
// receiver. Like KeyID, this is for diagnostics only — the JWS payload
// does not include the cell.
func (s *Signer) CellID() string {
	if s == nil {
		return ""
	}
	return s.cellID
}

// SignMessage produces a JWS over the message body and injects the
// X-GD-DKIM-SIGN and X-GD-DKIM-PUB-KEY headers into the RFC 5322
// header block. Returns the modified message bytes.
//
//   - A nil receiver is a no-op: the message is returned unchanged.
//     This is the local-dev path where signing is disabled.
//   - A signing failure is logged at warn and the message is returned
//     unchanged. The send proceeds unsigned because availability
//     beats signing — the relay will reject the unsigned message
//     itself if policy demands it, but a transient signing bug should
//     not break the customer's send path.
//
// `siteID` is unused by the JWS payload (the relay verifier doesn't
// read it) but is retained on the call signature for log correlation;
// callers pass the app id and we surface it on sign-failure log lines.
//
// `from` is the envelope-from address. It populates the JWS `from`
// claim and is also the source for the `domain` claim (the part after
// '@'). Both are omitted from the payload when from is empty.
//
// Wire format
//
//	JOSE header  {"typ":"JWT","alg":"RS256"}
//	Payload      {"domain":"…","timestamp":<unix>,"from":"…","body_hash":"…"}
//	Signature    RS256
//
// `body_hash` is computed via canonicalBodyHash on the body portion of
// `message` (everything after the first blank line). The relay strips
// X-GD-DKIM-SIGN and X-GD-DKIM-PUB-KEY before recomputing the same hash
// and comparing. This invariant is the load-bearing test:
// signing_test.go's TestSignMessage_BodyHashCoversCanonicalBody pins it.
func (s *Signer) SignMessage(message []byte, siteID, from string) []byte {
	if s == nil {
		return message
	}

	jws, err := s.sign(message, from)
	if err != nil {
		slog.Warn("jws.signing.sign_failed",
			"error", err,
			"site_id", siteID,
			"key_id", s.keyID,
		)
		return message
	}

	return email.InjectHeaders(message, map[string]string{
		signingHeaderJWS:    jws,
		signingHeaderPubKey: s.certInnerB64,
	})
}

func (s *Signer) sign(message []byte, from string) (string, error) {
	bodyHash := canonicalBodyHash(extractBody(message))

	// Payload field order is irrelevant — JWS verification reads parsed
	// JSON. We use a sorted key map to ensure deterministic output for
	// snapshot tests; cPanel's verifier does not care about order.
	payload := map[string]any{
		"domain":    domainOf(from),
		"timestamp": time.Now().Unix(),
	}
	if from != "" {
		payload["from"] = from
	}
	if bodyHash != "" {
		payload["body_hash"] = bodyHash
	}

	header := map[string]string{
		"typ": "JWT",
		"alg": "RS256",
	}

	headerJSON, err := json.Marshal(header)
	if err != nil {
		return "", fmt.Errorf("marshal header: %w", err)
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}

	signingInput := encodeBase64URL(headerJSON) + "." + encodeBase64URL(payloadJSON)

	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(nil, s.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}

	return signingInput + "." + encodeBase64URL(signature), nil
}

// canonicalBodyHash computes the SHA-256 of the message body matching
// the cPanel relay's verification expectation. Steps mirror the
// reference implementation in /etc/gd_domain_validation.pl and
// scripts/test_dkim_send_mail.py:
//
//  1. Take the first canonicalBodyMaxBytes (5000) bytes of the body.
//  2. Decode UTF-8 with errors='ignore' (drop invalid sequences).
//  3. Collapse runs of whitespace (\s+) to a single space.
//  4. Trim leading and trailing whitespace.
//  5. Truncate to canonicalBodyMaxBytesAfter (1000) bytes.
//  6. SHA-256 → UPPERCASE hex.
//
// Empty body → empty string (skipped from the JWS payload).
func canonicalBodyHash(body []byte) string {
	if len(body) == 0 {
		return ""
	}

	// Step 1+2: byte-truncate, then drop invalid UTF-8 (errors='ignore').
	truncated := body
	if len(truncated) > canonicalBodyMaxBytes {
		truncated = truncated[:canonicalBodyMaxBytes]
	}
	// bytes.ToValidUTF8 with a nil replacement drops invalid sequences
	// — equivalent to Python's decode(errors='ignore').
	s := string(bytes.ToValidUTF8(truncated, nil))

	// Step 3+4: collapse whitespace, trim.
	s = runsOfWhitespace.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)

	// Step 5: byte-truncate. cPanel's Perl substr operates on bytes, and
	// the Cloudmark verifier confirmed byte semantics in cross-team
	// alignment. Truncating mid-UTF-8 is intentional — the relay does
	// the same byte cut and feeds raw bytes to SHA-256, so any
	// half-truncated multi-byte sequence is hashed verbatim on both
	// sides.
	if len(s) > canonicalBodyMaxBytesAfter {
		s = s[:canonicalBodyMaxBytesAfter]
	}

	// Step 6: SHA-256 → uppercase hex (NOT base64 — the relay verifier
	// compares as uppercase hex).
	sum := sha256.Sum256([]byte(s))
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

// extractBody returns the bytes after the first blank line in an
// RFC 5322 message — i.e. the body portion that the relay would
// extract on its side after stripping the X-GD-DKIM-* headers. CRLF
// and bare LF separators are both accepted; missing separator returns
// nil (treated as empty body, which canonicalBodyHash maps to "").
func extractBody(message []byte) []byte {
	if _, after, ok := bytes.Cut(message, []byte("\r\n\r\n")); ok {
		return after
	}
	if _, after, ok := bytes.Cut(message, []byte("\n\n")); ok {
		return after
	}
	return nil
}

// leafCertInnerBase64 finds the leaf (non-CA) certificate in a PEM
// bundle and returns its inner base64 with all PEM markers and
// whitespace stripped. This is the value that goes into the
// X-GD-DKIM-PUB-KEY header verbatim.
//
// If the bundle has no certs, returns an error. If every cert is a CA
// (operator misconfiguration), returns the first one and logs at warn
// — better to ship a (likely-invalid) cert and let the relay surface
// the verify failure than to ship no header at all.
//
// Identifies CA-vs-leaf via the BasicConstraints extension. Certs
// without that extension are treated as leaf (matches openssl's
// default interpretation).
func leafCertInnerBase64(certPEM string) (string, error) {
	rest := []byte(certPEM)
	var leafPEM []byte
	var firstPEM []byte
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		blockPEM := pem.EncodeToMemory(block)
		if firstPEM == nil {
			firstPEM = blockPEM
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			// Skip unparseable blocks but keep scanning — the bundle
			// may have a valid leaf later in the file.
			continue
		}
		if cert.IsCA {
			continue
		}
		leafPEM = blockPEM
		break
	}

	pickedPEM := leafPEM
	if pickedPEM == nil {
		if firstPEM == nil {
			return "", errors.New("no CERTIFICATE blocks found in PEM")
		}
		// Fallback: ship the first block we found. Operators should see
		// an empty `leaf == nil` path as a misconfiguration but the
		// relay-side error surfaces it more loudly than a startup
		// refusal would.
		pickedPEM = firstPEM
		slog.Warn("jws.signing.no_leaf_cert_found",
			"reason", "every cert in bundle is a CA; using first block",
		)
	}

	// Strip BEGIN/END markers and ALL whitespace — matches
	// host_cert_b64_from_pem in the Python reference.
	s := string(pickedPEM)
	s = strings.ReplaceAll(s, "-----BEGIN CERTIFICATE-----", "")
	s = strings.ReplaceAll(s, "-----END CERTIFICATE-----", "")
	s = stripAllWhitespace(s)
	if s == "" {
		return "", errors.New("certificate block empty after stripping PEM headers")
	}
	return s, nil
}

func stripAllWhitespace(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\v' || r == '\f' {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// loadRSAKey reads a PEM file and parses an RSA private key out of it.
// Accepts both PKCS#1 ("RSA PRIVATE KEY") and PKCS#8 ("PRIVATE KEY")
// blocks because openssl genrsa emits PKCS#1 by default and Terraform's
// tls_private_key resource emits PKCS#8 — operators may produce either.
func loadRSAKey(path string) (*rsa.PrivateKey, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("no PEM block found")
	}
	return parseRSAPrivateKey(block)
}

func parseRSAPrivateKey(block *pem.Block) (*rsa.PrivateKey, error) {
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "PRIVATE KEY":
		anyKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PKCS8: %w", err)
		}
		rsaKey, ok := anyKey.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("PKCS8 key is %T, want *rsa.PrivateKey", anyKey)
		}
		return rsaKey, nil
	default:
		return nil, fmt.Errorf("unsupported PEM block type %q", block.Type)
	}
}

// domainOf returns the lowercased domain part of an addr-spec or
// name-addr, or "" if the input cannot be parsed.
func domainOf(addr string) string {
	parsed, err := mail.ParseAddress(strings.TrimSpace(addr))
	if err != nil {
		return ""
	}
	at := strings.LastIndex(parsed.Address, "@")
	if at < 0 {
		return ""
	}
	return strings.ToLower(parsed.Address[at+1:])
}

// encodeBase64URL is the JWS standard base64url encoding (RFC 7515 §2):
// URL-safe alphabet, NO padding.
func encodeBase64URL(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

// PublicKey returns the signing public key. Used in tests that verify
// the JWS round-trips. Returns nil on a nil receiver.
func (s *Signer) PublicKey() *rsa.PublicKey {
	if s == nil {
		return nil
	}
	return &s.privateKey.PublicKey
}

// VerifyForTesting parses the JWS and verifies the signature against
// the Signer's own public key. Tests-only — production code never calls
// this (verification is the relay's job). Returns the decoded payload
// as a generic map so callers can assert on whichever claims they care
// about.
//
// Strips all whitespace from the token before parsing, mirroring the
// cPanel reference verifier's `"".join(v.split())` step. Header
// folding inserts CRLF + SP into the header value; net/mail and
// textproto unfold by removing the CRLF but preserve the SP, leaving
// embedded whitespace inside the JWS that base64 strict decoders
// reject. The relay does the same whitespace-strip before decoding.
func (s *Signer) VerifyForTesting(token string) (map[string]any, error) {
	if s == nil {
		return nil, errors.New("nil Signer")
	}
	token = stripAllWhitespace(token)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("expected 3 JWS segments, got %d", len(parts))
	}

	signingInput := parts[0] + "." + parts[1]
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("decode signature: %w", err)
	}
	digest := sha256.Sum256([]byte(signingInput))
	if verifyErr := rsa.VerifyPKCS1v15(&s.privateKey.PublicKey, crypto.SHA256, digest[:], sig); verifyErr != nil {
		return nil, fmt.Errorf("verify: %w", verifyErr)
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("decode payload: %w", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal payload: %w", err)
	}
	return payload, nil
}

// DecodeHeaderForTesting returns the parsed JOSE header without
// verifying the signature. Tests use this to assert {alg, typ}
// without a full verify. Whitespace-tolerant — see VerifyForTesting
// for the rationale.
func DecodeHeaderForTesting(token string) (map[string]any, error) {
	token = stripAllWhitespace(token)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("expected 3 JWS segments, got %d", len(parts))
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("decode header: %w", err)
	}
	var header map[string]any
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("unmarshal header: %w", err)
	}
	return header, nil
}

// CanonicalBodyHash exposes the body-hash function for tests that need
// to assert the dev-supervisor side computes the same value the relay
// will compute on the wire.
func CanonicalBodyHash(body []byte) string {
	return canonicalBodyHash(body)
}
