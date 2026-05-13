package webhook

import (
	"strings"
	"testing"
)

func TestParseSigningSecret_AcceptsRawPlaintext(t *testing.T) {
	got, err := ParseSigningSecret("whsec_abc123")
	if err != nil {
		t.Fatalf("ParseSigningSecret: %v", err)
	}
	if got != "whsec_abc123" {
		t.Errorf("want whsec_abc123, got %q", got)
	}
}

func TestParseSigningSecret_AcceptsJSONWrapper(t *testing.T) {
	got, err := ParseSigningSecret(`{"signingSecret":"whsec_abc123"}`)
	if err != nil {
		t.Fatalf("ParseSigningSecret: %v", err)
	}
	if got != "whsec_abc123" {
		t.Errorf("want whsec_abc123, got %q", got)
	}
}

func TestParseSigningSecret_TrimsSurroundingWhitespace(t *testing.T) {
	got, err := ParseSigningSecret("  whsec_abc123\n")
	if err != nil {
		t.Fatalf("ParseSigningSecret: %v", err)
	}
	if got != "whsec_abc123" {
		t.Errorf("want whsec_abc123, got %q", got)
	}
}

func TestParseSigningSecret_TrimsWhitespaceInsideJSONWrapper(t *testing.T) {
	got, err := ParseSigningSecret(`{"signingSecret":"  whsec_abc123  "}`)
	if err != nil {
		t.Fatalf("ParseSigningSecret: %v", err)
	}
	if got != "whsec_abc123" {
		t.Errorf("want whsec_abc123, got %q", got)
	}
}

func TestParseSigningSecret_RejectsEmpty(t *testing.T) {
	if _, err := ParseSigningSecret(""); err == nil {
		t.Errorf("want error for empty value, got nil")
	}
	if _, err := ParseSigningSecret("   "); err == nil {
		t.Errorf("want error for whitespace-only value, got nil")
	}
}

func TestParseSigningSecret_RejectsCDKPlaceholder(t *testing.T) {
	// CDK provisions the secret as {"signingSecret":"REPLACE_ME"} — if an
	// operator forgets to replace the placeholder, Parse must fail loud at
	// startup rather than letting the service 401 every webhook silently.
	_, err := ParseSigningSecret(`{"signingSecret":"REPLACE_ME"}`)
	if err == nil {
		t.Fatalf("want error for placeholder, got nil")
	}
	if !strings.Contains(err.Error(), "whsec_") {
		t.Errorf("error should mention whsec_ prefix; got %q", err.Error())
	}
}

func TestParseSigningSecret_RejectsRawValueWithoutPrefix(t *testing.T) {
	_, err := ParseSigningSecret("just-some-string")
	if err == nil {
		t.Fatalf("want error for missing whsec_ prefix, got nil")
	}
}

func TestParseSigningSecret_RejectsMalformedJSON(t *testing.T) {
	_, err := ParseSigningSecret(`{not valid json`)
	if err == nil {
		t.Fatalf("want error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse JSON") {
		t.Errorf("error should mention JSON parse; got %q", err.Error())
	}
}

func TestParseSigningSecret_RejectsJSONMissingField(t *testing.T) {
	_, err := ParseSigningSecret(`{"otherKey":"whsec_abc"}`)
	if err == nil {
		t.Fatalf("want error for missing signingSecret field, got nil")
	}
}

func TestParseSigningSecret_RejectsJSONEmptyField(t *testing.T) {
	_, err := ParseSigningSecret(`{"signingSecret":""}`)
	if err == nil {
		t.Fatalf("want error for empty signingSecret field, got nil")
	}
}

func TestParseSigningSecret_RejectsJSONFieldWithoutPrefix(t *testing.T) {
	_, err := ParseSigningSecret(`{"signingSecret":"not-a-real-key"}`)
	if err == nil {
		t.Fatalf("want error for JSON field without whsec_ prefix, got nil")
	}
}
