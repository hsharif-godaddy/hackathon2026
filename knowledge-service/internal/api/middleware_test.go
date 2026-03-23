package api

import (
	"testing"
)

func TestSanitizeLogValue_CleanASCII(t *testing.T) {
	input := "/api/v1/search"
	if sanitizeLogValue(input) != input {
		t.Errorf("expected clean ASCII to pass through unchanged, got %q", sanitizeLogValue(input))
	}
}

func TestSanitizeLogValue_EmbeddedNewline(t *testing.T) {
	result := sanitizeLogValue("/path\ninjected-line")
	if result != "/pathinjected-line" {
		t.Errorf("expected newline stripped, got %q", result)
	}
}

func TestSanitizeLogValue_CarriageReturn(t *testing.T) {
	result := sanitizeLogValue("/path\rinjected")
	if result != "/pathinjected" {
		t.Errorf("expected carriage return stripped, got %q", result)
	}
}

func TestSanitizeLogValue_ANSIEscape(t *testing.T) {
	result := sanitizeLogValue("\x1b[31mred\x1b[0m")
	if result != "[31mred[0m" {
		t.Errorf("expected ANSI escape bytes stripped, got %q", result)
	}
}

func TestSanitizeLogValue_NullByte(t *testing.T) {
	result := sanitizeLogValue("prefix\x00suffix")
	if result != "prefixsuffix" {
		t.Errorf("expected null byte stripped, got %q", result)
	}
}

func TestSanitizeLogValue_EmptyString(t *testing.T) {
	if sanitizeLogValue("") != "" {
		t.Error("expected empty string to remain empty")
	}
}

func TestSanitizeLogValue_MultipleControlChars(t *testing.T) {
	result := sanitizeLogValue("a\nb\rc\td")
	// \n and \r are control chars and get stripped; \t is also control
	for _, r := range result {
		if r == '\n' || r == '\r' || r == '\t' {
			t.Errorf("expected all control chars stripped, found %q in result %q", r, result)
		}
	}
}
