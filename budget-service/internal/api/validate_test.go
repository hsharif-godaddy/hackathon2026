package api

import (
	"strings"
	"testing"
)

func TestValidateIdentifier(t *testing.T) {
	t.Parallel()
	valid := []string{
		"a",
		"abc",
		"product-key",
		"my.product.key",
		"key_123",
		"a1b2c3",
		"prefix:suffix",
		"test-product-550e8400-e29b-41d4-a716-446655440000",
	}
	for _, s := range valid {
		if msg := validateIdentifier(s); msg != "" {
			t.Errorf("validateIdentifier(%q) = %q, want empty", s, msg)
		}
	}

	invalid := []string{
		"",
		" leading",
		"-starts-dash",
		".starts-dot",
		"has space",
		"has\nnewline",
		"has\ttab",
		"has;semicolon",
		"drop table",
		"<script>",
		"a&b",
		"a=b",
		"foo/bar",
		"../../etc/passwd",
		"café",
		"中文",
	}
	for _, s := range invalid {
		if msg := validateIdentifier(s); msg != "contains invalid characters" {
			t.Errorf("validateIdentifier(%q) = %q, want 'contains invalid characters'", s, msg)
		}
	}
}

func TestValidateIdentifierRejectsOversized(t *testing.T) {
	t.Parallel()
	s := strings.Repeat("a", maxFieldLen+1)
	if msg := validateIdentifier(s); msg != "exceeds maximum length" {
		t.Errorf("validateIdentifier(len=%d) = %q, want 'exceeds maximum length'", len(s), msg)
	}
}

func TestValidateIdentifierAcceptsMaxLen(t *testing.T) {
	t.Parallel()
	s := "a" + strings.Repeat("b", maxFieldLen-1)
	if msg := validateIdentifier(s); msg != "" {
		t.Errorf("validateIdentifier(len=%d) = %q, want empty", len(s), msg)
	}
}

func TestValidateLabel(t *testing.T) {
	t.Parallel()
	valid := []string{
		"x",
		"overages",
		"AI generation",
		"API calls",
		"my-label",
		"cost/revenue",
		"item_1",
		"label:type",
		"line 1.0",
	}
	for _, s := range valid {
		if msg := validateLabel(s); msg != "" {
			t.Errorf("validateLabel(%q) = %q, want empty", s, msg)
		}
	}

	invalid := []string{
		"",
		" leading-space",
		"-starts-dash",
		"has\nnewline",
		"has\ttab",
		"has;semicolon",
		"<script>",
		"a&b",
		"a=b",
		"café",
		"中文",
	}
	for _, s := range invalid {
		if msg := validateLabel(s); msg != "contains invalid characters" {
			t.Errorf("validateLabel(%q) = %q, want 'contains invalid characters'", s, msg)
		}
	}
}

func TestValidateLabelRejectsOversized(t *testing.T) {
	t.Parallel()
	s := strings.Repeat("a", maxFieldLen+1)
	if msg := validateLabel(s); msg != "exceeds maximum length" {
		t.Errorf("validateLabel(len=%d) = %q, want 'exceeds maximum length'", len(s), msg)
	}
}

func TestJsonDepth(t *testing.T) {
	t.Parallel()
	tests := []struct {
		input string
		want  int
	}{
		{`"hello"`, 0},
		{`{}`, 1},
		{`{"a":1}`, 1},
		{`{"a":{"b":1}}`, 2},
		{`{"a":{"b":{"c":1}}}`, 3},
		{`[[[1]]]`, 3},
		{`{"a":[{"b":[1]}]}`, 4},
		{`{"a":{"b":{"c":{"d":{"e":{"f":1}}}}}}`, 6},
		{`{"a":"}}}}"}`, 1},
		{`{"a":"{{{{"}`, 1},
		{`{"a":"[]]]"}`, 1},
		{`{"template":"{{user}}","data":{"k":"v"}}`, 2},
		{`{"key":"{\"nested\":\"{{{{\"}"}`, 1},
	}
	for _, tt := range tests {
		got, err := jsonDepth([]byte(tt.input))
		if err != nil {
			t.Errorf("jsonDepth(%s) unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("jsonDepth(%s) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

func TestJsonDepthReturnsErrorForMalformedJSON(t *testing.T) {
	t.Parallel()
	malformed := []string{
		`{invalid`,
		`{"a":}`,
		`{{{`,
	}
	for _, input := range malformed {
		_, err := jsonDepth([]byte(input))
		if err == nil {
			t.Errorf("jsonDepth(%s) expected error, got nil", input)
		}
	}
}
