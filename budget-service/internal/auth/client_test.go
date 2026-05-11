package auth

import "testing"

func TestNormalizeSSOHost(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"bare host", "sso.godaddy.com", "https://sso.godaddy.com"},
		{"already https", "https://sso.godaddy.com", "https://sso.godaddy.com"},
		{"already http", "http://sso.dev.godaddy.com", "http://sso.dev.godaddy.com"},
		{"empty string", "", "https://"},
		{"host with port", "sso.godaddy.com:8443", "https://sso.godaddy.com:8443"},
		{"host with path", "sso.godaddy.com/v1", "https://sso.godaddy.com/v1"},
		{"https with trailing slash", "https://sso.godaddy.com/", "https://sso.godaddy.com/"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := normalizeSSOHost(tt.input)
			if got != tt.want {
				t.Errorf("normalizeSSOHost(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
