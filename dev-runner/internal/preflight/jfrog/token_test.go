package jfrog

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// closedServerURL starts an httptest server, captures its URL, then closes
// it so subsequent connections receive a deterministic local "connection
// refused". Used in place of routing to TEST-NET-1 (192.0.2.1), which can
// be intercepted by transparent proxies in some corp/VPN environments.
func closedServerURL(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	url := srv.URL
	srv.Close()
	return url
}

func TestTokenFromNpmrcBytes(t *testing.T) {
	cases := map[string]struct {
		input string
		want  string
	}{
		"valid line": {
			input: "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc123\n",
			want:  "abc123",
		},
		"trailing whitespace": {
			input: "//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=abc123   \n",
			want:  "abc123",
		},
		"no artifactory line": {
			input: "registry=https://registry.npmjs.org/\n",
			want:  "",
		},
		"artifactory line without token": {
			input: "registry=https://gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/\n",
			want:  "",
		},
		"multiple lines picks first match": {
			input: "registry=https://registry.npmjs.org/\n" +
				"//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=first\n" +
				"//gdartifactory1.jfrog.io/other/:_authToken=second\n",
			want: "first",
		},
		"skips hash-commented stale token, returns active one": {
			input: "# //gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=stale\n" +
				"//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=active\n",
			want: "active",
		},
		"skips semicolon-commented stale token, returns active one": {
			input: "; //gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=stale\n" +
				"//gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=active\n",
			want: "active",
		},
		"only commented tokens returns empty": {
			input: "# //gdartifactory1.jfrog.io/artifactory/api/npm/node-virt/:_authToken=stale\n",
			want:  "",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := tokenFromNpmrcBytes([]byte(tc.input)); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestTokenFromProxyURL(t *testing.T) {
	cases := map[string]struct {
		input string
		want  string
	}{
		"standard artifactory proxy": {
			input: "https://:abc123@gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct",
			want:  "abc123",
		},
		"fallback entry only": {
			input: "https://proxy.golang.org,direct",
			want:  "",
		},
		"empty": {
			input: "",
			want:  "",
		},
		"artifactory url without credentials": {
			input: "https://gdartifactory1.jfrog.io/artifactory/api/go/go-virt,direct",
			want:  "",
		},
		"artifactory as second entry": {
			input: "https://proxy.golang.org,https://:xyz@gdartifactory1.jfrog.io/artifactory/api/go/go-virt",
			want:  "xyz",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := TokenFromProxyURL(tc.input); got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestProbe_Valid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer good-token" {
			t.Errorf("unexpected Authorization: %q", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	prev := ValidateEndpoint
	ValidateEndpoint = srv.URL
	t.Cleanup(func() { ValidateEndpoint = prev })

	if err := Probe(context.Background(), "good-token"); err != nil {
		t.Errorf("expected nil, got %v", err)
	}
}

func TestProbe_Unauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)

	prev := ValidateEndpoint
	ValidateEndpoint = srv.URL
	t.Cleanup(func() { ValidateEndpoint = prev })

	err := Probe(context.Background(), "bad-token")
	if !errors.Is(err, ErrUnauthorized) {
		t.Errorf("expected ErrUnauthorized, got %v", err)
	}
}

func TestProbe_Forbidden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)

	prev := ValidateEndpoint
	ValidateEndpoint = srv.URL
	t.Cleanup(func() { ValidateEndpoint = prev })

	if err := Probe(context.Background(), "revoked-token"); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("expected ErrUnauthorized for 403, got %v", err)
	}
}

func TestProbe_MissingToken(t *testing.T) {
	err := Probe(context.Background(), "")
	if !errors.Is(err, ErrMissingToken) {
		t.Errorf("expected ErrMissingToken, got %v", err)
	}
}

func TestProbe_NetworkError(t *testing.T) {
	prev := ValidateEndpoint
	// Closed local listener -> deterministic "connection refused".
	// Avoids TEST-NET-1, which transparent proxies can intercept.
	ValidateEndpoint = closedServerURL(t)
	t.Cleanup(func() { ValidateEndpoint = prev })

	prevTimeout := ProbeTimeout
	ProbeTimeout = 100 * time.Millisecond
	t.Cleanup(func() { ProbeTimeout = prevTimeout })

	err := Probe(context.Background(), "any-token")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrMissingToken) {
		t.Errorf("network error should not match auth sentinels: %v", err)
	}
}

func TestProbe_UnexpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(srv.Close)

	prev := ValidateEndpoint
	ValidateEndpoint = srv.URL
	t.Cleanup(func() { ValidateEndpoint = prev })

	err := Probe(context.Background(), "token")
	if err == nil || errors.Is(err, ErrUnauthorized) {
		t.Errorf("expected non-auth error for 500, got %v", err)
	}
}
