package emailhttp

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

// decodeBase64Part reads a multipart part whose CTE is base64, strips
// the line wrapping, and returns the decoded bytes. The stdlib
// multipart reader hands back raw transport bytes — base64 encoded —
// so tests have to decode themselves.
func decodeBase64Part(t *testing.T, part *multipart.Part) []byte {
	t.Helper()
	raw, err := io.ReadAll(part)
	if err != nil {
		t.Fatalf("read part: %v", err)
	}
	// Strip CR/LF that the wire format inserts every 76 chars.
	cleaned := strings.ReplaceAll(strings.ReplaceAll(string(raw), "\r\n", ""), "\n", "")
	decoded, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		t.Fatalf("base64 decode: %v\nraw=%q", err, raw)
	}
	return decoded
}

// fixedNow returns a deterministic clock so tests can pin Date headers.
func fixedNow() func() time.Time {
	t := time.Date(2026, 5, 18, 12, 0, 0, 0, time.UTC)
	return func() time.Time { return t }
}

// readBuiltMessage parses the bytes buildMessage produced and returns
// the parsed message + the raw bytes. Failing to round-trip is itself a
// regression — the gateway must produce mail.ReadMessage-parseable
// output.
func readBuiltMessage(t *testing.T, msg preparedMessage, tracking map[string]string) (*mail.Message, []byte) {
	t.Helper()
	body, err := buildMessage(msg, tracking, fixedNow())
	if err != nil {
		t.Fatalf("buildMessage: %v", err)
	}
	parsed, err := mail.ReadMessage(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("mail.ReadMessage: %v\n--- bytes ---\n%s", err, body)
	}
	return parsed, body
}

func TestBuildMessage_TextOnly(t *testing.T) {
	t.Parallel()
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "plain body",
	}, map[string]string{"X-SITE-UID": "site-1"})

	if got := parsed.Header.Get("From"); got != "abc123@airoapp.ai" {
		t.Errorf("From = %q", got)
	}
	if got := parsed.Header.Get("To"); got != "u@example.com" {
		t.Errorf("To = %q", got)
	}
	if got := parsed.Header.Get("Subject"); got != "hi" {
		t.Errorf("Subject = %q", got)
	}
	if got := parsed.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/plain") {
		t.Errorf("Content-Type = %q, want text/plain", got)
	}
	if got := parsed.Header.Get("X-SITE-UID"); got != "site-1" {
		t.Errorf("X-SITE-UID = %q", got)
	}
	read, _ := io.ReadAll(parsed.Body)
	if string(read) != "plain body" {
		t.Errorf("body = %q, want %q", string(read), "plain body")
	}
	if !bytes.Contains(body, []byte("Date: Mon, 18 May 2026 12:00:00")) {
		t.Errorf("Date header missing or unexpected: %q", body)
	}
}

func TestBuildMessage_HTMLOnly(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		HTML:      "<p>hi</p>",
	}, nil)

	if got := parsed.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Errorf("Content-Type = %q, want text/html", got)
	}
}

func TestBuildMessage_Multipart(t *testing.T) {
	t.Parallel()
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "plain body",
		HTML:      "<p>html body</p>",
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "multipart/alternative") {
		t.Fatalf("Content-Type = %q, want multipart/alternative", ct)
	}

	_, params, err := mime.ParseMediaType(ct)
	if err != nil {
		t.Fatalf("ParseMediaType: %v", err)
	}
	boundary := params["boundary"]
	if boundary == "" {
		t.Fatal("boundary param missing")
	}

	mr := multipart.NewReader(parsed.Body, boundary)
	parts := []string{}
	contentTypes := []string{}
	for {
		part, perr := mr.NextPart()
		if perr == io.EOF {
			break
		}
		if perr != nil {
			t.Fatalf("NextPart: %v", perr)
		}
		data, _ := io.ReadAll(part)
		parts = append(parts, strings.TrimSpace(string(data)))
		contentTypes = append(contentTypes, part.Header.Get("Content-Type"))
	}

	if len(parts) != 2 {
		t.Fatalf("got %d parts, want 2: %v", len(parts), parts)
	}
	// Plain text first per RFC 2046 §5.1.4 (least-rich first).
	if !strings.HasPrefix(contentTypes[0], "text/plain") {
		t.Errorf("first part Content-Type = %q, want text/plain", contentTypes[0])
	}
	if !strings.HasPrefix(contentTypes[1], "text/html") {
		t.Errorf("second part Content-Type = %q, want text/html", contentTypes[1])
	}
	if parts[0] != "plain body" {
		t.Errorf("plain part = %q", parts[0])
	}
	if parts[1] != "<p>html body</p>" {
		t.Errorf("html part = %q", parts[1])
	}

	// Boundary must not appear inside the body bytes (other than in the
	// boundary delimiters themselves) — generateBoundary picks random
	// 18 bytes precisely so this can't happen, but the test guards
	// against future "helpful" rewrites of the generator.
	if strings.Count(string(body), "--"+boundary) != 3 {
		t.Errorf("expected 2 boundary delimiters + 1 closing, got %d occurrences",
			strings.Count(string(body), "--"+boundary))
	}
}

func TestBuildMessage_BccNeverInHeaders(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		BCC:       []string{"secret@example.com"},
		Subject:   "hi",
		Text:      "x",
	}, nil)

	if got := parsed.Header.Get("Bcc"); got != "" {
		t.Errorf("Bcc header should be absent, got %q", got)
	}
}

func TestBuildMessage_ReplyToOmittedWhenEmpty(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "x",
	}, nil)
	if got := parsed.Header.Get("Reply-To"); got != "" {
		t.Errorf("Reply-To should be absent, got %q", got)
	}
}

func TestBuildMessage_ReplyToWritten(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		ReplyTo:   "ken@example.com",
		Subject:   "hi",
		Text:      "x",
	}, nil)
	if got := parsed.Header.Get("Reply-To"); got != "ken@example.com" {
		t.Errorf("Reply-To = %q", got)
	}
}

func TestBuildMessage_SubjectRFC2047(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "Café",
		Text:      "x",
	}, nil)

	dec := mime.WordDecoder{}
	got, err := dec.DecodeHeader(parsed.Header.Get("Subject"))
	if err != nil {
		t.Fatalf("DecodeHeader: %v", err)
	}
	if got != "Café" {
		t.Errorf("decoded subject = %q, want Café", got)
	}
}

// TestBuildMessage_SubjectCRLFInjectionTruncated is the security-
// relevant case: a contact-form-derived subject with embedded CRLF
// and a fake header should not let the attacker smuggle a Bcc.
func TestBuildMessage_SubjectCRLFInjectionTruncated(t *testing.T) {
	t.Parallel()
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi\r\nBcc: evil@example.com",
		Text:      "x",
	}, nil)

	if got := parsed.Header.Get("Subject"); got != "hi" {
		t.Errorf("Subject = %q, want %q (truncated at CR)", got, "hi")
	}
	if got := parsed.Header.Get("Bcc"); got != "" {
		t.Errorf("Bcc smuggled via Subject CRLF = %q", got)
	}
	if bytes.Contains(body, []byte("Bcc: evil")) {
		t.Errorf("Bcc smuggled into bytes:\n%s", body)
	}
}

func TestBuildMessage_HeaderOrderDeterministic(t *testing.T) {
	t.Parallel()
	_, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "x",
	}, map[string]string{
		"X-SITE-UID": "s1",
		"X-PRODUCT":  "p1",
	})

	// Documented order: From, To, ..., Subject, Date, Message-ID,
	// MIME-Version, Content-Type, Content-Transfer-Encoding,
	// Auto-Submitted, X-Mailer, X-SITE-UID, X-PRODUCT, ...
	want := []string{"From:", "To:", "Subject:", "Date:", "Message-ID:", "MIME-Version:",
		"Content-Type:", "Content-Transfer-Encoding:", "Auto-Submitted:", "X-Mailer:",
		"X-SITE-UID:", "X-PRODUCT:"}
	prev := -1
	for _, h := range want {
		idx := bytes.Index(body, []byte(h))
		if idx < 0 {
			t.Fatalf("header %q not found in:\n%s", h, body)
		}
		if idx <= prev {
			t.Errorf("header %q appears before previous header (idx %d <= prev %d)", h, idx, prev)
		}
		prev = idx
	}
}

func TestBuildMessage_MessageIDFormat(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "deadbeef",
		From:      "abc123@acme.com",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "x",
	}, nil)
	want := "<deadbeef@acme.com>"
	if got := parsed.Header.Get("Message-ID"); got != want {
		t.Errorf("Message-ID = %q, want %q", got, want)
	}
}

// TestBuildMessage_NoDuplicateHeaders pins the regression that produced
// Gmail 550 5.7.1 ("multiple Message-ID headers") in production: every
// header in writeHeaders' `order` slice whose literal casing differed
// from textproto's canonical form (Message-ID → Message-Id, MIME-Version
// → Mime-Version, X-SITE-UID → X-Site-Uid, etc.) was emitted twice —
// once with our literal casing in the first ordered loop, once with the
// canonical form in the "future-proofing" map-iteration loop, because
// the `seen` set was keyed by literal string while h's actual map keys
// are stored canonical.
//
// The earlier tests checked header presence (`bytes.Index` for substring,
// `parsed.Header.Get` which canonicalizes the lookup), so duplicates
// slipped past CI for every header that happened to be in non-canonical
// case. This test counts.
func TestBuildMessage_NoDuplicateHeaders(t *testing.T) {
	t.Parallel()
	// Tracking input includes the optional X-ACCOUNT-CREATED-DATE,
	// X-SHOPPER-ID, and X-Originating-IP entries so we exercise every
	// non-canonical header at once. (LoadTrackingHeaders only emits
	// these when their env vars are set; the test injects them directly
	// to skip the env round-trip.)
	tracking := map[string]string{
		"X-SITE-UID":             "site-1",
		"X-PRODUCT":              "airo-app-builder",
		"X-ENVIRONMENT":          "production",
		"X-DATACENTER":           "phx",
		"X-ACCOUNT-CREATED-DATE": "2026-01-01",
		"X-SHOPPER-ID":           "12345",
		"X-Originating-IP":       "127.0.0.1",
	}
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "deadbeef",
		From:      "noreply@acme.com",
		To:        []string{"u@example.com"},
		ReplyTo:   "support@acme.com",
		Subject:   "hi",
		Text:      "x",
	}, tracking)

	// mail.ReadMessage stores headers under their canonical key. Two
	// wire lines `Message-ID:` and `Message-Id:` both canonicalize to
	// `Message-Id` and append to the same slice — so `len > 1` for any
	// header here means duplicates landed on the wire and the bug is
	// back.
	allHeaders := []string{
		"From", "To", "Reply-To", "Subject", "Date",
		"Message-ID", "MIME-Version", "Content-Type", "Content-Transfer-Encoding",
		"Auto-Submitted", "X-Mailer",
		"X-SITE-UID", "X-PRODUCT", "X-ENVIRONMENT", "X-DATACENTER",
		"X-ACCOUNT-CREATED-DATE", "X-SHOPPER-ID", "X-Originating-IP",
	}
	for _, name := range allHeaders {
		key := textproto.CanonicalMIMEHeaderKey(name)
		if got := len(parsed.Header[key]); got != 1 {
			t.Errorf("header %s appeared %d times, want 1\n--- bytes ---\n%s", name, got, body)
		}
	}

	// Wire shape: receivers (the relay's spam-attribution pipeline in
	// particular) expect the literal casing the gateway has always
	// advertised. Confirm the bytes carry the documented uppercase form
	// rather than textproto's canonical title-case. If a future change
	// switches to canonical wire shape, those filters need to update
	// first; this assertion forces the conversation.
	wireShape := []string{
		"\r\nMessage-ID:",
		"\r\nMIME-Version:",
		"\r\nX-SITE-UID:",
		"\r\nX-PRODUCT:",
		"\r\nX-ENVIRONMENT:",
		"\r\nX-DATACENTER:",
		"\r\nX-ACCOUNT-CREATED-DATE:",
		"\r\nX-SHOPPER-ID:",
		"\r\nX-Originating-IP:",
	}
	for _, want := range wireShape {
		if !bytes.Contains(body, []byte(want)) {
			t.Errorf("missing wire shape %q in:\n%s", want, body)
		}
		// Confirm the canonical-cased variant does NOT also appear.
		// e.g. "Message-Id:" should be absent if "Message-ID:" is the
		// only line emitted for that header.
		name := want[2 : len(want)-1] // strip the leading "\r\n" and trailing ":"
		canonical := "\r\n" + textproto.CanonicalMIMEHeaderKey(name) + ":"
		if canonical != want && bytes.Contains(body, []byte(canonical)) {
			t.Errorf("duplicate canonical-cased header %q present alongside %q in:\n%s", canonical, want, body)
		}
	}
}

// TestBuildMessage_RFC5322FieldCardinality enforces RFC 5322 §3.6 header
// cardinality independently of writeHeaders' `order` slice. The earlier
// duplicate-Message-ID bug was a §3.6.4 violation; that defect is also
// pinned by TestBuildMessage_NoDuplicateHeaders, but THIS test stays
// honest if the order slice ever changes shape: it asserts cardinality
// against the RFC's universe of fields, not against whatever the gateway
// happens to emit today. A future bug that, say, emitted two `To:` lines
// from a different code path would still trip this even though `To` was
// never in the duplicate set.
func TestBuildMessage_RFC5322FieldCardinality(t *testing.T) {
	t.Parallel()
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "deadbeef",
		From:      "from@acme.com",
		To:        []string{"to@example.com"},
		CC:        []string{"cc@example.com"},
		BCC:       []string{"bcc@example.com"},
		ReplyTo:   "support@acme.com",
		Subject:   "hi",
		Text:      "x",
	}, nil)

	headerCount := func(name string) int {
		return len(parsed.Header[textproto.CanonicalMIMEHeaderKey(name)])
	}

	// RFC 5322 §3.6.1 (Date), §3.6.2 (From), §3.6.4 (Message-ID).
	// The gateway always populates these, so the cardinality is `== 1`.
	// "Required exactly once" violations break SPF/DKIM alignment, DMARC
	// reports, and trip Gmail's RFC-compliance enforcement (the failure
	// mode that produced this test's existence).
	requiredOnce := []string{"From", "Date", "Message-ID"}
	for _, name := range requiredOnce {
		if got := headerCount(name); got != 1 {
			t.Errorf("RFC 5322 requires exactly one %s; got %d\n--- bytes ---\n%s",
				name, got, body)
		}
	}

	// RFC 5322 §3.6 — each of these may appear at most once. Asserts
	// `<= 1` so absent headers (e.g. Sender, In-Reply-To when not set)
	// pass cleanly; only duplicates fail.
	atMostOnce := []string{
		"Sender", "Reply-To",
		"To", "Cc", "Bcc",
		"In-Reply-To", "References",
		"Subject",
	}
	for _, name := range atMostOnce {
		if got := headerCount(name); got > 1 {
			t.Errorf("RFC 5322 §3.6 allows %s at most once; got %d\n--- bytes ---\n%s",
				name, got, body)
		}
	}

	// Gateway-specific invariant beyond the RFC: Bcc is envelope-only,
	// never written to the message headers (otherwise recipients leak
	// each other on delivery). TestBuildMessage_BccNeverInHeaders covers
	// the same rule for the byte-level absence; counting via the parser
	// catches a future writer that emits a syntactically-valid Bcc line
	// that bytes.Index might miss.
	if got := headerCount("Bcc"); got != 0 {
		t.Errorf("Bcc must not appear in message headers; got %d\n--- bytes ---\n%s",
			got, body)
	}
}

// TestBuildMessage_AttachmentSingle confirms a text-only message with
// one attachment is wrapped in multipart/mixed: first part is the body,
// second part is the attachment with base64 encoding and the right
// Content-Disposition.
func TestBuildMessage_AttachmentSingle(t *testing.T) {
	t.Parallel()
	icsContent := []byte("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n")
	parsed, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "your appointment",
		Text:      "see attached",
		Attachments: []preparedAttachment{
			{
				Filename:    "appointment.ics",
				ContentType: "text/calendar; charset=utf-8; method=REQUEST",
				Content:     icsContent,
			},
		},
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "multipart/mixed") {
		t.Fatalf("Content-Type = %q, want multipart/mixed", ct)
	}
	_, params, err := mime.ParseMediaType(ct)
	if err != nil {
		t.Fatalf("ParseMediaType: %v", err)
	}
	mr := multipart.NewReader(parsed.Body, params["boundary"])

	bodyPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("body part: %v", err)
	}
	bodyBytes, _ := io.ReadAll(bodyPart)
	if !strings.HasPrefix(bodyPart.Header.Get("Content-Type"), "text/plain") {
		t.Errorf("body part Content-Type = %q, want text/plain", bodyPart.Header.Get("Content-Type"))
	}
	if strings.TrimSpace(string(bodyBytes)) != "see attached" {
		t.Errorf("body = %q", string(bodyBytes))
	}

	attPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("attachment part: %v", err)
	}
	attCT := attPart.Header.Get("Content-Type")
	if !strings.HasPrefix(attCT, "text/calendar") {
		t.Errorf("attachment Content-Type = %q", attCT)
	}
	if !strings.Contains(attCT, `name="appointment.ics"`) {
		t.Errorf("attachment Content-Type missing name= param: %q", attCT)
	}
	disp := attPart.Header.Get("Content-Disposition")
	if !strings.HasPrefix(disp, "attachment") || !strings.Contains(disp, `filename="appointment.ics"`) {
		t.Errorf("Content-Disposition = %q, want attachment; filename=...", disp)
	}
	if attPart.Header.Get("Content-Transfer-Encoding") != "base64" {
		t.Errorf("Content-Transfer-Encoding = %q, want base64",
			attPart.Header.Get("Content-Transfer-Encoding"))
	}
	decoded := decodeBase64Part(t, attPart)
	if !bytes.Equal(decoded, icsContent) {
		t.Errorf("decoded attachment = %q, want %q", decoded, icsContent)
	}

	if _, err := mr.NextPart(); err != io.EOF {
		t.Errorf("expected EOF after 2 parts, got %v", err)
	}

	// Sanity: top-level body must NOT carry text/calendar content-type
	// — the attachment has its own Content-Type at the part level.
	if bytes.Count(body, []byte("Content-Type: text/calendar")) != 1 {
		t.Errorf("text/calendar should appear exactly once (in part headers):\n%s", body)
	}
}

// TestBuildMessage_AttachmentWithMultipartAlternative confirms
// multipart/mixed wraps multipart/alternative when both attachment and
// text+html bodies are present. The body part's Content-Type is
// multipart/alternative with its own boundary, distinct from the outer
// mixed boundary.
func TestBuildMessage_AttachmentWithMultipartAlternative(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "plain",
		HTML:      "<p>html</p>",
		Attachments: []preparedAttachment{
			{Filename: "doc.txt", ContentType: "text/plain", Content: []byte("file contents")},
		},
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "multipart/mixed") {
		t.Fatalf("outer Content-Type = %q", ct)
	}
	_, outerParams, _ := mime.ParseMediaType(ct)
	outerBoundary := outerParams["boundary"]

	mr := multipart.NewReader(parsed.Body, outerBoundary)
	bodyPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("body part: %v", err)
	}
	innerCT := bodyPart.Header.Get("Content-Type")
	if !strings.HasPrefix(innerCT, "multipart/alternative") {
		t.Fatalf("body part Content-Type = %q, want multipart/alternative", innerCT)
	}
	_, innerParams, _ := mime.ParseMediaType(innerCT)
	innerBoundary := innerParams["boundary"]
	if innerBoundary == outerBoundary {
		t.Errorf("inner boundary == outer boundary (%q), must be distinct", innerBoundary)
	}

	innerReader := multipart.NewReader(bodyPart, innerBoundary)
	textPart, err := innerReader.NextPart()
	if err != nil {
		t.Fatalf("text part: %v", err)
	}
	textBytes, _ := io.ReadAll(textPart)
	if strings.TrimSpace(string(textBytes)) != "plain" {
		t.Errorf("text part = %q", textBytes)
	}
	htmlPart, err := innerReader.NextPart()
	if err != nil {
		t.Fatalf("html part: %v", err)
	}
	htmlBytes, _ := io.ReadAll(htmlPart)
	if strings.TrimSpace(string(htmlBytes)) != "<p>html</p>" {
		t.Errorf("html part = %q", htmlBytes)
	}

	// Back to outer reader: attachment part must follow the body.
	attPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("attachment part: %v", err)
	}
	if !strings.HasPrefix(attPart.Header.Get("Content-Type"), "text/plain") {
		t.Errorf("attachment Content-Type = %q", attPart.Header.Get("Content-Type"))
	}
	decoded := decodeBase64Part(t, attPart)
	if string(decoded) != "file contents" {
		t.Errorf("attachment decoded = %q", decoded)
	}
}

// TestBuildMessage_AttachmentMultiple confirms multiple attachments
// appear in the order supplied — preserving caller intent (e.g.
// invoice + receipt order matters when the recipient reads them).
func TestBuildMessage_AttachmentMultiple(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "see files",
		Attachments: []preparedAttachment{
			{Filename: "first.txt", ContentType: "text/plain", Content: []byte("one")},
			{Filename: "second.txt", ContentType: "text/plain", Content: []byte("two")},
			{Filename: "third.txt", ContentType: "text/plain", Content: []byte("three")},
		},
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	_, params, _ := mime.ParseMediaType(ct)
	mr := multipart.NewReader(parsed.Body, params["boundary"])

	// Skip body part.
	if _, err := mr.NextPart(); err != nil {
		t.Fatalf("body part: %v", err)
	}

	wantNames := []string{"first.txt", "second.txt", "third.txt"}
	wantBodies := []string{"one", "two", "three"}
	for i := range wantNames {
		part, err := mr.NextPart()
		if err != nil {
			t.Fatalf("attachment[%d]: %v", i, err)
		}
		disp := part.Header.Get("Content-Disposition")
		if !strings.Contains(disp, `filename="`+wantNames[i]+`"`) {
			t.Errorf("attachment[%d] Content-Disposition = %q, want filename=%q", i, disp, wantNames[i])
		}
		decoded := decodeBase64Part(t, part)
		if string(decoded) != wantBodies[i] {
			t.Errorf("attachment[%d] decoded = %q, want %q", i, decoded, wantBodies[i])
		}
	}
	if _, err := mr.NextPart(); err != io.EOF {
		t.Errorf("expected EOF after 3 attachments, got %v", err)
	}
}

// TestBuildMessage_AttachmentBase64LineWrapping confirms base64 lines
// are wrapped at 76 chars per RFC 2045 §6.8. Some receiver-side
// scanners are strict about line length; long unbroken base64 fields
// have been silently rejected by mail filters in the wild.
func TestBuildMessage_AttachmentBase64LineWrapping(t *testing.T) {
	t.Parallel()
	// 1 KB of repeating bytes — small enough to keep the test fast,
	// large enough to require many wrapped lines.
	content := bytes.Repeat([]byte("A"), 1024)
	_, body := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "see file",
		Attachments: []preparedAttachment{
			{Filename: "data.bin", ContentType: "application/octet-stream", Content: content},
		},
	}, nil)

	// Find the base64 region (between the "Content-Transfer-Encoding:
	// base64" header and the next boundary line) and verify every line
	// is <= 76 chars.
	_, tail, ok := bytes.Cut(body, []byte("Content-Transfer-Encoding: base64\r\n\r\n"))
	if !ok {
		t.Fatalf("no base64 part in body:\n%s", body)
	}
	region, _, ok := bytes.Cut(tail, []byte("\r\n--"))
	if !ok {
		t.Fatalf("no closing boundary after base64 region:\n%s", tail)
	}
	lines := strings.Split(string(region), "\r\n")
	for i, line := range lines {
		if len(line) > base64LineLength {
			t.Errorf("line %d too long: %d > %d (%q)", i, len(line), base64LineLength, line)
		}
	}
	// Sanity: last non-empty line should generally be <= 76 chars (a
	// short remainder).
	if len(lines) < 2 {
		t.Errorf("expected multiple wrapped lines, got %d", len(lines))
	}
}

// TestBuildMessage_AttachmentNonASCIIFilename confirms the filename
// is RFC 2047-encoded when it contains non-ASCII bytes. The receiver
// gets back "rapport.pdf" once decoded — without encoding, the raw
// bytes would either break header framing (some chars are invalid in
// quoted-string) or display as garbled in some clients.
func TestBuildMessage_AttachmentNonASCIIFilename(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "x",
		Attachments: []preparedAttachment{
			{Filename: "rapport-café.pdf", ContentType: "application/pdf", Content: []byte("pdf bytes")},
		},
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	_, params, _ := mime.ParseMediaType(ct)
	mr := multipart.NewReader(parsed.Body, params["boundary"])
	if _, err := mr.NextPart(); err != nil {
		t.Fatalf("body part: %v", err)
	}
	attPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("attachment part: %v", err)
	}
	disp := attPart.Header.Get("Content-Disposition")
	// The raw header MUST be 7-bit clean (no UTF-8 bytes) — that's the
	// whole point of RFC 2047.
	for i := range len(disp) {
		if disp[i] > 127 {
			t.Errorf("Content-Disposition contains raw non-ASCII at byte %d: %q", i, disp)
		}
	}
	// Decoded value should match what the caller sent.
	dec := mime.WordDecoder{}
	decoded, err := dec.DecodeHeader(disp)
	if err != nil {
		t.Fatalf("DecodeHeader: %v", err)
	}
	if !strings.Contains(decoded, "rapport-café.pdf") {
		t.Errorf("decoded Content-Disposition = %q, want to contain 'rapport-café.pdf'", decoded)
	}
}

// TestBuildMessage_AttachmentDefaultsToOctetStream is the empty-
// ContentType path: message.go falls back to application/octet-stream.
// preparedAttachment normally arrives from the handler with a non-empty
// default, but this guards the fallback against future regressions.
func TestBuildMessage_AttachmentDefaultsToOctetStream(t *testing.T) {
	t.Parallel()
	parsed, _ := readBuiltMessage(t, preparedMessage{
		MessageID: "abc",
		From:      "abc123@airoapp.ai",
		To:        []string{"u@example.com"},
		Subject:   "hi",
		Text:      "x",
		Attachments: []preparedAttachment{
			{Filename: "blob", ContentType: "", Content: []byte("anything")},
		},
	}, nil)

	ct := parsed.Header.Get("Content-Type")
	_, params, _ := mime.ParseMediaType(ct)
	mr := multipart.NewReader(parsed.Body, params["boundary"])
	if _, err := mr.NextPart(); err != nil {
		t.Fatalf("body part: %v", err)
	}
	attPart, err := mr.NextPart()
	if err != nil {
		t.Fatalf("attachment part: %v", err)
	}
	if !strings.HasPrefix(attPart.Header.Get("Content-Type"), "application/octet-stream") {
		t.Errorf("Content-Type = %q, want application/octet-stream",
			attPart.Header.Get("Content-Type"))
	}
}

func TestAddrSpec(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in, out string
	}{
		{"u@example.com", "u@example.com"},
		{"Acme Support <support@acme.com>", "support@acme.com"},
		{"  spaces@example.com  ", "spaces@example.com"},
	}
	for _, tc := range cases {
		got, err := addrSpec(tc.in)
		if err != nil {
			t.Errorf("addrSpec(%q): %v", tc.in, err)
			continue
		}
		if got != tc.out {
			t.Errorf("addrSpec(%q) = %q, want %q", tc.in, got, tc.out)
		}
	}
}
