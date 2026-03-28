package gocode

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

type stubTokenProvider struct {
	token string
	err   error
}

func (s *stubTokenProvider) Token(_ context.Context) (string, error) {
	return s.token, s.err
}

func TestS2sTransport_SetsAuthorizationHeader(t *testing.T) {
	var gotHeader string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeader = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	transport := &s2sTransport{
		tokens: &stubTokenProvider{token: "Bearer fake-iam-jwt"},
		base:   http.DefaultTransport,
	}

	req, _ := http.NewRequest(http.MethodGet, backend.URL+"/v1/chat/completions", nil)
	resp, err := transport.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip failed: %v", err)
	}
	defer resp.Body.Close()

	if gotHeader != "Bearer fake-iam-jwt" {
		t.Errorf("Authorization = %q, want %q", gotHeader, "Bearer fake-iam-jwt")
	}
}

func TestS2sTransport_ReturnsErrorOnTokenFailure(t *testing.T) {
	transport := &s2sTransport{
		tokens: &stubTokenProvider{err: errors.New("token expired")},
		base:   http.DefaultTransport,
	}

	req, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	_, err := transport.RoundTrip(req)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestS2sTransport_DoesNotMutateOriginalRequest(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	transport := &s2sTransport{
		tokens: &stubTokenProvider{token: "Bearer test"},
		base:   http.DefaultTransport,
	}

	original, _ := http.NewRequest(http.MethodGet, backend.URL, nil)
	original.Header.Set("X-Custom", "keep-me")

	resp, err := transport.RoundTrip(original)
	if err != nil {
		t.Fatalf("RoundTrip failed: %v", err)
	}
	defer resp.Body.Close()

	if got := original.Header.Get("Authorization"); got != "" {
		t.Errorf("original request mutated: Authorization = %q", got)
	}
	if got := original.Header.Get("X-Custom"); got != "keep-me" {
		t.Errorf("original X-Custom header lost: got %q", got)
	}
}
