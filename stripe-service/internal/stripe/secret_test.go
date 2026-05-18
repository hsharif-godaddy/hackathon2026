package stripe

import (
	"strings"
	"testing"
)

func TestParsePlatformKey_AcceptsRawTestKey(t *testing.T) {
	out, err := ParsePlatformKey("sk_test_abc123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_test_abc123" {
		t.Errorf("want sk_test_abc123, got %q", out)
	}
}

func TestParsePlatformKey_AcceptsRawLiveKey(t *testing.T) {
	out, err := ParsePlatformKey("sk_live_abc123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_live_abc123" {
		t.Errorf("want sk_live_abc123, got %q", out)
	}
}

func TestParsePlatformKey_TrimsWhitespace(t *testing.T) {
	out, err := ParsePlatformKey("\n\tsk_test_abc123\n")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_test_abc123" {
		t.Errorf("want sk_test_abc123, got %q", out)
	}
}

func TestParsePlatformKey_AcceptsJSONWrapperWithAPIKeyField(t *testing.T) {
	out, err := ParsePlatformKey(`{"apiKey":"sk_test_abc123"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_test_abc123" {
		t.Errorf("want sk_test_abc123, got %q", out)
	}
}

func TestParsePlatformKey_AcceptsJSONWrapperWithSecretKeyField(t *testing.T) {
	out, err := ParsePlatformKey(`{"secretKey":"sk_test_xyz"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_test_xyz" {
		t.Errorf("want sk_test_xyz, got %q", out)
	}
}

func TestParsePlatformKey_AcceptsJSONWrapperWithKeyField(t *testing.T) {
	out, err := ParsePlatformKey(`{"key":"sk_live_xyz"}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_live_xyz" {
		t.Errorf("want sk_live_xyz, got %q", out)
	}
}

func TestParsePlatformKey_TrimsInsideJSONWrapper(t *testing.T) {
	out, err := ParsePlatformKey(`{"apiKey":"  sk_test_abc  "}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out != "sk_test_abc" {
		t.Errorf("want sk_test_abc, got %q", out)
	}
}

func TestParsePlatformKey_RejectsEmpty(t *testing.T) {
	_, err := ParsePlatformKey("")
	if err == nil {
		t.Fatal("want error for empty input, got nil")
	}
	if !strings.Contains(err.Error(), "empty") {
		t.Errorf("error should mention empty; got %q", err.Error())
	}
}

func TestParsePlatformKey_RejectsWhitespaceOnly(t *testing.T) {
	_, err := ParsePlatformKey("   \n\t  ")
	if err == nil {
		t.Fatal("want error for whitespace-only input, got nil")
	}
}

func TestParsePlatformKey_RejectsWrongPrefix(t *testing.T) {
	_, err := ParsePlatformKey("pk_test_abc")
	if err == nil {
		t.Fatal("want error for non-secret-key prefix, got nil")
	}
	if !strings.Contains(err.Error(), "sk_test_") {
		t.Errorf("error should mention required prefix; got %q", err.Error())
	}
}

func TestParsePlatformKey_RejectsMalformedJSON(t *testing.T) {
	_, err := ParsePlatformKey(`{"apiKey": "sk_test_abc"`) // missing closing brace
	if err == nil {
		t.Fatal("want error for malformed JSON, got nil")
	}
	if !strings.Contains(err.Error(), "JSON") {
		t.Errorf("error should mention JSON parse failure; got %q", err.Error())
	}
}

func TestParsePlatformKey_RejectsJSONWrapperMissingFields(t *testing.T) {
	_, err := ParsePlatformKey(`{"someOtherField":"sk_test_abc"}`)
	if err == nil {
		t.Fatal("want error for JSON wrapper without recognized field, got nil")
	}
}

// TestParsePlatformKey_JSONWrapperFieldPrecedence pins the order in
// which firstNonEmpty considers fields when multiple are populated.
// Without this, a future swap of the field order in
// firstNonEmpty(APIKey, SecretKey, Key) would silently change which
// value an operator's secret resolves to.
func TestParsePlatformKey_JSONWrapperFieldPrecedence(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "apiKey wins over secretKey and key",
			raw:  `{"apiKey":"sk_test_a","secretKey":"sk_test_b","key":"sk_test_c"}`,
			want: "sk_test_a",
		},
		{
			name: "secretKey wins over key when apiKey is absent",
			raw:  `{"secretKey":"sk_test_b","key":"sk_test_c"}`,
			want: "sk_test_b",
		},
		{
			name: "key only",
			raw:  `{"key":"sk_test_c"}`,
			want: "sk_test_c",
		},
		{
			name: "apiKey whitespace-only does NOT shadow populated secretKey",
			raw:  `{"apiKey":"   ","secretKey":"sk_test_b"}`,
			want: "sk_test_b",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out, err := ParsePlatformKey(c.raw)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if out != c.want {
				t.Errorf("want %q, got %q", c.want, out)
			}
		})
	}
}

func TestParsePlatformKey_RejectsWrongPrefixInsideJSONWrapper(t *testing.T) {
	// Symmetric to TestParsePlatformKey_RejectsWrongPrefix but exercises
	// the JSON-wrapped path, which has its own code path through
	// firstNonEmpty + TrimSpace before the prefix check.
	_, err := ParsePlatformKey(`{"apiKey":"pk_test_x"}`)
	if err == nil {
		t.Fatal("want error for non-secret-key prefix inside JSON wrapper, got nil")
	}
	if !strings.Contains(err.Error(), "sk_test_") {
		t.Errorf("error should mention required prefix; got %q", err.Error())
	}
}
