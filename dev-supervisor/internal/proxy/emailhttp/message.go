package emailhttp

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"maps"
	"mime"
	"net/mail"
	"net/textproto"
	"strings"
	"time"
)

// mailerName identifies the gateway in the X-Mailer header. Bumped when
// we change wire-visible parts of the outbound message format so receivers
// (and our own log analysis) can tell generations apart.
const mailerName = "airo-email-gateway/0.1"

// base64LineLength is the canonical RFC 2045 §6.8 line length for
// base64-encoded content. Lines longer than 76 chars are accepted by
// every relay we've seen but RFC-compliant tools (and some receiver-side
// scanners) wrap at this exact width.
const base64LineLength = 76

// preparedMessage is the gateway-internal shape the message builder
// receives. It's deliberately not exported — the public contract is
// SendRequest/SendResponse on gateway.go; preparedMessage is the seam
// between the handler and message.go.
type preparedMessage struct {
	MessageID   string
	From        string
	ReplyTo     string // "" → omit header
	To, CC, BCC []string
	Subject     string
	Text, HTML  string
	Attachments []preparedAttachment
}

// preparedAttachment is the gateway-internal attachment shape. Content
// is the raw bytes (already base64-decoded by the handler); message.go
// owns the on-the-wire base64 re-encoding.
//
// ContentType has a non-empty default ("application/octet-stream") set
// by the handler before this struct reaches buildMessage, so message.go
// can write it without checking for "".
type preparedAttachment struct {
	Filename    string
	ContentType string
	Content     []byte
}

// buildMessage renders the outbound RFC-5322 message from a prepared
// message plus the platform's tracking headers. now is injected so tests
// can pin the Date header.
//
// Bcc is recipient-only (placed on the SMTP envelope by the caller); it
// must never appear in the message body or the recipients leak each
// other.
func buildMessage(msg preparedMessage, tracking map[string]string, now func() time.Time) ([]byte, error) {
	if now == nil {
		now = time.Now
	}

	headers := textproto.MIMEHeader{}
	headers.Set("From", msg.From)
	if len(msg.To) > 0 {
		headers.Set("To", strings.Join(msg.To, ", "))
	}
	if len(msg.CC) > 0 {
		headers.Set("Cc", strings.Join(msg.CC, ", "))
	}
	// Bcc is envelope-only — never written to the headers.
	if msg.ReplyTo != "" {
		headers.Set("Reply-To", msg.ReplyTo)
	}
	headers.Set("Subject", encodeSubject(msg.Subject))
	headers.Set("Date", now().UTC().Format(time.RFC1123Z))
	headers.Set("Message-ID", formatMessageID(msg.MessageID, msg.From))
	headers.Set("MIME-Version", "1.0")
	headers.Set("Auto-Submitted", "auto-generated")
	headers.Set("X-Mailer", mailerName)
	for k, v := range tracking {
		headers.Set(k, v)
	}

	bodyHeaders, bodyBytes, err := renderBody(msg.Text, msg.HTML)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if len(msg.Attachments) == 0 {
		// No attachments: body part headers are merged into the top-level
		// message headers; body bytes follow directly.
		maps.Copy(headers, bodyHeaders)
		writeHeaders(&buf, headers)
		buf.WriteString("\r\n")
		buf.Write(bodyBytes)
		return buf.Bytes(), nil
	}

	// Attachments present: wrap body + attachments in multipart/mixed.
	mixedBoundary, err := generateBoundary()
	if err != nil {
		return nil, err
	}
	headers.Set("Content-Type", `multipart/mixed; boundary="`+mixedBoundary+`"`)
	writeHeaders(&buf, headers)
	buf.WriteString("\r\n")

	// First part: the body (text, html, or multipart/alternative).
	fmt.Fprintf(&buf, "--%s\r\n", mixedBoundary)
	writeHeaders(&buf, bodyHeaders)
	buf.WriteString("\r\n")
	buf.Write(bodyBytes)
	buf.WriteString("\r\n")

	// Remaining parts: one per attachment.
	for _, att := range msg.Attachments {
		fmt.Fprintf(&buf, "--%s\r\n", mixedBoundary)
		writeAttachmentPart(&buf, att)
	}
	fmt.Fprintf(&buf, "--%s--\r\n", mixedBoundary)

	return buf.Bytes(), nil
}

// renderBody returns the MIME headers and body bytes for the message
// body (text-only, html-only, or multipart/alternative). The headers
// describe just this part — Content-Type, Content-Transfer-Encoding,
// and (for multipart) the boundary. Caller decides whether to merge
// them into the top-level headers (no attachments) or emit them as a
// nested part (multipart/mixed wrapper).
func renderBody(text, html string) (textproto.MIMEHeader, []byte, error) {
	hasText := strings.TrimSpace(text) != ""
	hasHTML := strings.TrimSpace(html) != ""

	headers := textproto.MIMEHeader{}
	var buf bytes.Buffer
	switch {
	case hasText && hasHTML:
		boundary, err := generateBoundary()
		if err != nil {
			return nil, nil, err
		}
		headers.Set("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
		writeAlternativeParts(&buf, boundary, text, html)
	case hasHTML:
		headers.Set("Content-Type", "text/html; charset=utf-8")
		headers.Set("Content-Transfer-Encoding", "8bit")
		buf.WriteString(html)
	default:
		// validate() guarantees at least one of text/html is non-empty;
		// fall through to text-only here.
		headers.Set("Content-Type", "text/plain; charset=utf-8")
		headers.Set("Content-Transfer-Encoding", "8bit")
		buf.WriteString(text)
	}
	return headers, buf.Bytes(), nil
}

// writeAttachmentPart writes one MIME part for an attachment: the
// per-part headers (Content-Type, Content-Disposition, Content-Transfer-
// Encoding) followed by the base64-encoded content wrapped at
// base64LineLength chars.
//
// Filename uses RFC 2047 encoded-words for non-ASCII bytes so the
// header stays 7-bit clean. ASCII filenames pass through verbatim
// inside double quotes — the handler has already rejected CR/LF and
// quote/backslash characters that could break header framing.
func writeAttachmentPart(buf *bytes.Buffer, att preparedAttachment) {
	contentType := strings.TrimSpace(att.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	encodedName := encodeAttachmentFilename(att.Filename)
	fmt.Fprintf(buf, "Content-Type: %s; name=\"%s\"\r\n", contentType, encodedName)
	fmt.Fprintf(buf, "Content-Disposition: attachment; filename=\"%s\"\r\n", encodedName)
	buf.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")

	encoded := base64.StdEncoding.EncodeToString(att.Content)
	for start := 0; start < len(encoded); start += base64LineLength {
		end := min(start+base64LineLength, len(encoded))
		buf.WriteString(encoded[start:end])
		buf.WriteString("\r\n")
	}
}

// encodeAttachmentFilename returns name unchanged if all bytes are
// ASCII; otherwise applies RFC 2047 Q-encoding so the value is safe
// inside a header. The handler has already validated the bytes the
// caller can supply (no CR/LF, quote, or backslash).
func encodeAttachmentFilename(name string) string {
	for i := range len(name) {
		if name[i] > 127 {
			return mime.QEncoding.Encode("utf-8", name)
		}
	}
	return name
}

// writeHeaders serializes MIME headers in deterministic order and
// truncates any header value at the first CR/LF.
//
// The order is documented (RFC-required first, MIME, informational,
// tracking) so test diffs are readable and the wire shape doesn't
// shuffle if the underlying map iterates differently.
//
// CRLF truncation is the gateway's defense against header injection
// via free-form values. Subject in particular can be attacker-controlled
// (a contact form's "name" field flowing through to a notification email).
// Replacing CR/LF in place would leave the smuggled-header body as
// garbled-but-present subject text; truncating discards everything after
// the injection attempt, which is the safer failure mode.
//
// Dedup is canonical-keyed, not literal-keyed. textproto.MIMEHeader.Set
// canonicalizes its keys on store, so "Message-ID" goes in the map as
// "Message-Id"; the future-proofing second loop iterates those canonical
// keys. Tracking the `seen` set with the literal-cased order strings
// (as an earlier version did) caused every non-canonical header in
// `order` — Message-ID, MIME-Version, X-SITE-UID, X-PRODUCT,
// X-ENVIRONMENT, X-DATACENTER, X-ACCOUNT-CREATED-DATE, X-SHOPPER-ID,
// X-Originating-IP — to be emitted twice on the wire (once with our
// casing, once with textproto's). Gmail rejects messages with
// duplicate Message-ID per RFC 5322 §3.6.4 with 550 5.7.1.
// TestBuildMessage_NoDuplicateHeaders pins the regression.
func writeHeaders(buf *bytes.Buffer, h textproto.MIMEHeader) {
	order := []string{
		"From", "To", "Cc", "Reply-To", "Subject",
		"Date", "Message-ID", "MIME-Version",
		"Content-Type", "Content-Transfer-Encoding",
		"Auto-Submitted", "X-Mailer",
		"X-SITE-UID", "X-PRODUCT", "X-ENVIRONMENT", "X-DATACENTER",
		"X-ACCOUNT-CREATED-DATE", "X-SHOPPER-ID", "X-Originating-IP",
	}
	seen := map[string]bool{}
	emit := func(k string) {
		for _, v := range h.Values(k) {
			safe := v
			if i := strings.IndexAny(safe, "\r\n"); i >= 0 {
				safe = safe[:i]
			}
			fmt.Fprintf(buf, "%s: %s\r\n", k, safe)
		}
		seen[textproto.CanonicalMIMEHeaderKey(k)] = true
	}
	for _, k := range order {
		if len(h.Values(k)) > 0 {
			emit(k)
		}
	}
	// Future-proofing for headers we haven't named explicitly: emit any
	// remaining keys after the documented set so adding a tracking header
	// doesn't silently disappear from the output. `k` here is the map's
	// canonical key, so the canonical-keyed `seen` lookup matches.
	for k := range h {
		if !seen[k] {
			emit(k)
		}
	}
}

// writeAlternativeParts writes a multipart/alternative body with the
// given boundary. text part comes first per RFC 2046 §5.1.4 (least-rich
// alternative first; clients pick the best one they can render).
func writeAlternativeParts(buf *bytes.Buffer, boundary, text, html string) {
	fmt.Fprintf(buf, "--%s\r\n", boundary)
	buf.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	buf.WriteString(text)
	buf.WriteString("\r\n")
	fmt.Fprintf(buf, "--%s\r\n", boundary)
	buf.WriteString("Content-Type: text/html; charset=utf-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	buf.WriteString(html)
	buf.WriteString("\r\n")
	fmt.Fprintf(buf, "--%s--\r\n", boundary)
}

// addrSpec returns the bare addr-spec from either an addr-spec or a
// name-addr — i.e. "Name <user@host>" → "user@host". The SMTP envelope
// requires bare addr-spec; mail clients prefer the display-name form on
// headers, which buildMessage hands them via the original strings.
func addrSpec(addr string) (string, error) {
	parsed, err := mail.ParseAddress(addr)
	if err != nil {
		return "", err
	}
	return parsed.Address, nil
}

// encodeSubject RFC-2047-encodes the subject if it contains any non-ASCII
// byte. ASCII subjects pass through verbatim — keeps Loki readable when
// inspecting outbound mail.
func encodeSubject(s string) string {
	for i := range len(s) {
		if s[i] > 127 {
			return mime.QEncoding.Encode("utf-8", s)
		}
	}
	return s
}

// formatMessageID wraps the gateway's opaque message id in an RFC-5322
// Message-ID. Domain part comes from the From address so postmaster
// tools can trace the id back to our infra.
func formatMessageID(id, from string) string {
	parsed, err := mail.ParseAddress(from)
	domain := "airoapp.ai"
	if err == nil {
		if at := strings.LastIndex(parsed.Address, "@"); at >= 0 {
			domain = parsed.Address[at+1:]
		}
	}
	return "<" + id + "@" + domain + ">"
}

// generateBoundary returns a MIME multipart boundary that won't appear
// in the body by construction (random 18 bytes, base64url, prefixed
// "airo-").
func generateBoundary() (string, error) {
	var b [18]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("boundary entropy: %w", err)
	}
	return "airo-" + base64.RawURLEncoding.EncodeToString(b[:]), nil
}
