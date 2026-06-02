package email_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

func TestInjectHeaders_EmptyHeaders(t *testing.T) {
	data := []byte("Subject: Test\r\n\r\nBody\r\n")
	got := email.InjectHeaders(data, nil)
	assert.Equal(t, data, got)

	got = email.InjectHeaders(data, map[string]string{})
	assert.Equal(t, data, got)
}

func TestInjectHeaders_WellFormedMessage(t *testing.T) {
	data := []byte("From: a@b.com\r\nSubject: Test\r\n\r\nBody\r\n")
	got := email.InjectHeaders(data, map[string]string{
		"X-Foo": "bar",
		"X-Baz": "qux",
	})
	gotStr := string(got)

	// Headers injected before separator, sorted alphabetically.
	assert.Contains(t, gotStr, "From: a@b.com\r\n")
	assert.Contains(t, gotStr, "Subject: Test\r\n")
	assert.Contains(t, gotStr, "X-Baz: qux\r\n")
	assert.Contains(t, gotStr, "X-Foo: bar\r\n")
	assert.Contains(t, gotStr, "\r\n\r\nBody\r\n")

	// Determinism: X-Baz comes before X-Foo (alphabetical).
	assert.Less(t, strings.Index(gotStr, "X-Baz"), strings.Index(gotStr, "X-Foo"))
}

func TestInjectHeaders_NoBodySeparator(t *testing.T) {
	data := []byte("Subject: headers only")
	got := email.InjectHeaders(data, map[string]string{"X-Tag": "1"})
	gotStr := string(got)

	assert.Contains(t, gotStr, "Subject: headers only")
	assert.Contains(t, gotStr, "X-Tag: 1\r\n")
	assert.True(t, strings.HasSuffix(gotStr, "\r\n"))
}

func TestInjectHeaders_LFLineEndings(t *testing.T) {
	data := []byte("From: a@b.com\nSubject: Test\n\nBody\n")
	got := email.InjectHeaders(data, map[string]string{"X-Tag": "1"})
	gotStr := string(got)

	// Original LF endings preserved on existing headers and body.
	assert.Contains(t, gotStr, "From: a@b.com\n")
	assert.Contains(t, gotStr, "Subject: Test\n")
	// Injected line uses CRLF.
	assert.Contains(t, gotStr, "X-Tag: 1\r\n")
	// Separator + body preserved.
	assert.Contains(t, gotStr, "\n\nBody\n")
}
