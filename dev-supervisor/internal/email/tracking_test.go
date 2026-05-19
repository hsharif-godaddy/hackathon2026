package email_test

import (
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/email"
)

// TestLoadTrackingHeaders_DefaultsAndOverrides covers the four legacy
// headers' default-vs-override matrix.
func TestLoadTrackingHeaders_DefaultsAndOverrides(t *testing.T) {
	t.Setenv("SITE_ID", "site-abc")
	t.Setenv("PRODUCT", "airo-builder-test")
	t.Setenv("NODE_ENV", "test")
	t.Setenv("NOMAD_DC", "test-dc")

	h := email.LoadTrackingHeaders()

	if got := h["X-SITE-UID"]; got != "site-abc" {
		t.Errorf("X-SITE-UID = %q, want site-abc", got)
	}
	if got := h["X-PRODUCT"]; got != "airo-builder-test" {
		t.Errorf("X-PRODUCT = %q, want airo-builder-test", got)
	}
	if got := h["X-ENVIRONMENT"]; got != "test" {
		t.Errorf("X-ENVIRONMENT = %q, want test", got)
	}
	if got := h["X-DATACENTER"]; got != "test-dc" {
		t.Errorf("X-DATACENTER = %q, want test-dc", got)
	}
	if len(h) != 4 {
		t.Errorf("len = %d, want 4 (no optional headers set), got %v", len(h), h)
	}
}

// TestLoadTrackingHeaders_LegacyDefaultsWhenUnset asserts the four
// legacy headers fall back to the documented defaults rather than being
// dropped — the SMTP proxy has injected these since it shipped, so the
// hosting relay never sees an outbound message missing X-SITE-UID etc.
func TestLoadTrackingHeaders_LegacyDefaultsWhenUnset(t *testing.T) {
	t.Setenv("SITE_ID", "")
	t.Setenv("PRODUCT", "")
	t.Setenv("NODE_ENV", "")
	t.Setenv("NOMAD_DC", "")

	h := email.LoadTrackingHeaders()

	if got := h["X-SITE-UID"]; got != "unknown" {
		t.Errorf("X-SITE-UID default = %q, want unknown", got)
	}
	if got := h["X-PRODUCT"]; got != "airo-app-builder" {
		t.Errorf("X-PRODUCT default = %q, want airo-app-builder", got)
	}
	if got := h["X-ENVIRONMENT"]; got != "unknown" {
		t.Errorf("X-ENVIRONMENT default = %q, want unknown", got)
	}
	if got := h["X-DATACENTER"]; got != "unknown" {
		t.Errorf("X-DATACENTER default = %q, want unknown", got)
	}
}

// TestLoadTrackingHeaders_OptionalHeadersOmittedWhenUnset confirms
// the three optional spam-attribution headers are absent when their env
// vars are empty — required so we don't pollute the relay with
// "unknown"-noise for fields that aren't populated yet.
func TestLoadTrackingHeaders_OptionalHeadersOmittedWhenUnset(t *testing.T) {
	t.Setenv("SITE_ID", "x")
	t.Setenv("ACCOUNT_CREATED_DATE", "")
	t.Setenv("SHOPPER_ID", "")
	t.Setenv("ORIGINATING_IP", "")

	h := email.LoadTrackingHeaders()

	for _, key := range []string{"X-ACCOUNT-CREATED-DATE", "X-SHOPPER-ID", "X-Originating-IP"} {
		if _, ok := h[key]; ok {
			t.Errorf("%s should be absent when env var unset", key)
		}
	}
}

// TestLoadTrackingHeaders_OptionalHeadersIncludedWhenSet confirms the
// optional headers are emitted (and trimmed) when their env vars carry
// non-whitespace values.
func TestLoadTrackingHeaders_OptionalHeadersIncludedWhenSet(t *testing.T) {
	t.Setenv("SITE_ID", "x")
	t.Setenv("ACCOUNT_CREATED_DATE", "  2024-06-01  ")
	t.Setenv("SHOPPER_ID", "12345")
	t.Setenv("ORIGINATING_IP", "203.0.113.7")

	h := email.LoadTrackingHeaders()

	if got := h["X-ACCOUNT-CREATED-DATE"]; got != "2024-06-01" {
		t.Errorf("X-ACCOUNT-CREATED-DATE = %q, want 2024-06-01 (trimmed)", got)
	}
	if got := h["X-SHOPPER-ID"]; got != "12345" {
		t.Errorf("X-SHOPPER-ID = %q, want 12345", got)
	}
	if got := h["X-Originating-IP"]; got != "203.0.113.7" {
		t.Errorf("X-Originating-IP = %q, want 203.0.113.7", got)
	}
}

// TestLoadTrackingHeaders_OptionalHeadersWhitespaceOnlyOmitted ensures
// values that trim to empty don't sneak through as zero-length headers.
func TestLoadTrackingHeaders_OptionalHeadersWhitespaceOnlyOmitted(t *testing.T) {
	t.Setenv("SITE_ID", "x")
	t.Setenv("ACCOUNT_CREATED_DATE", "   ")
	t.Setenv("SHOPPER_ID", "\t")
	t.Setenv("ORIGINATING_IP", "\n")

	h := email.LoadTrackingHeaders()
	for _, key := range []string{"X-ACCOUNT-CREATED-DATE", "X-SHOPPER-ID", "X-Originating-IP"} {
		if _, ok := h[key]; ok {
			t.Errorf("%s should be absent for whitespace-only env value", key)
		}
	}
}
