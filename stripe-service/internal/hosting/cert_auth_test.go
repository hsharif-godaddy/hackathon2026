package hosting

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// makeSelfSignedPEM generates an RSA-2048 self-signed cert valid for 1h and
// returns the cert and key as PEM bytes. Used to satisfy NewCertSSOAuth's
// tls.X509KeyPair call without requiring a real GD-issued cert.
func makeSelfSignedPEM(t *testing.T) (certPEM, keyPEM []byte) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test.airo-builder.test.authclient.int.godaddy.com"},
		NotBefore:    time.Now().Add(-1 * time.Minute),
		NotAfter:     time.Now().Add(1 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		t.Fatalf("x509.CreateCertificate: %v", err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(priv)})
	return certPEM, keyPEM
}

// roundTripFunc lets a test plug a custom RoundTripper into CertSSOAuth's
// httpClient without going through a TLS handshake. The fetchToken path
// calls a.httpClient.Do(req) — anything that satisfies RoundTripper works
// once the auth is constructed.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestNewCertSSOAuth_RejectsEmptyPEM(t *testing.T) {
	if _, err := NewCertSSOAuth("sso.test-godaddy.com", nil, nil); err == nil {
		t.Errorf("want error for empty PEM, got nil")
	}
	certPEM, _ := makeSelfSignedPEM(t)
	if _, err := NewCertSSOAuth("sso.test-godaddy.com", certPEM, nil); err == nil {
		t.Errorf("want error for empty key PEM, got nil")
	}
}

func TestNewCertSSOAuth_RejectsEmptyHost(t *testing.T) {
	certPEM, keyPEM := makeSelfSignedPEM(t)

	for _, host := range []string{"", "  ", "https://", "http://"} {
		if _, err := NewCertSSOAuth(host, certPEM, keyPEM); err == nil {
			t.Errorf("want error for host %q, got nil", host)
		}
	}
}

func TestNewCertSSOAuth_RejectsBadKeypair(t *testing.T) {
	bad := []byte("not a real cert")
	if _, err := NewCertSSOAuth("sso.test-godaddy.com", bad, bad); err == nil {
		t.Errorf("want error for bad PEM, got nil")
	}
}

func TestNewCertSSOAuth_StripsProtocolAndTrailingSlash(t *testing.T) {
	certPEM, keyPEM := makeSelfSignedPEM(t)

	cases := []struct{ in, want string }{
		{"sso.test-godaddy.com", "sso.test-godaddy.com"},
		{"https://sso.godaddy.com", "sso.godaddy.com"},
		{"http://sso.dev-godaddy.com", "sso.dev-godaddy.com"},
		{" sso.godaddy.com/ ", "sso.godaddy.com"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			a, err := NewCertSSOAuth(c.in, certPEM, keyPEM)
			if err != nil {
				t.Fatalf("NewCertSSOAuth: %v", err)
			}
			if a.ssoHost != c.want {
				t.Errorf("ssoHost: want %q, got %q", c.want, a.ssoHost)
			}
		})
	}
}

func TestCertSSOAuth_Name(t *testing.T) {
	a := &CertSSOAuth{}
	if got := a.Name(); got != "cert" {
		t.Errorf("Name: want cert, got %q", got)
	}
}

// makeJWT builds a valid-shaped JWT (no signature verification on the
// receiving side) with the given exp claim. Header and signature are
// placeholders — extractJWTExpiry only base64-decodes the payload.
func makeJWT(exp int64) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload, _ := json.Marshal(struct {
		Exp int64 `json:"exp"`
	}{exp})
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}

func TestExtractJWTExpiry_ValidToken(t *testing.T) {
	want := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC).Unix()
	got := extractJWTExpiry(makeJWT(want))
	if got.Unix() != want {
		t.Errorf("expiry: want unix %d, got %d", want, got.Unix())
	}
}

func TestExtractJWTExpiry_FallsBackOnGarbage(t *testing.T) {
	// Tight ±2min window around 1h locks in certTokenFallbackTTL — a
	// silent regression that bumped or shrank it would still fall inside
	// a looser ±10min check.
	before := time.Now().Add(58 * time.Minute)
	got := extractJWTExpiry("not.a.jwt")
	after := time.Now().Add(62 * time.Minute)
	if got.Before(before) || got.After(after) {
		t.Errorf("fallback expiry: want 1h±2min from now, got %v", got)
	}
}

func TestExtractJWTExpiry_FallsBackOnMissingExp(t *testing.T) {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"sub":"test"}`))
	noExp := header + "." + payload + ".sig"

	before := time.Now().Add(58 * time.Minute)
	got := extractJWTExpiry(noExp)
	after := time.Now().Add(62 * time.Minute)
	if got.Before(before) || got.After(after) {
		t.Errorf("fallback expiry on missing exp: want 1h±2min from now, got %v", got)
	}
}

// newAuthForTest constructs a CertSSOAuth with a real cert keypair PEM and
// swaps in a roundtripper-only http client so tests can run without a real
// TLS handshake to SSO.
func newAuthForTest(t *testing.T, rt http.RoundTripper) *CertSSOAuth {
	t.Helper()
	certPEM, keyPEM := makeSelfSignedPEM(t)
	a, err := NewCertSSOAuth("sso.test-godaddy.com", certPEM, keyPEM)
	if err != nil {
		t.Fatalf("NewCertSSOAuth: %v", err)
	}
	a.httpClient = &http.Client{Transport: rt, Timeout: 5 * time.Second}
	return a
}

func TestCertSSOAuth_AttachesSsoJwtHeaderFromMintedToken(t *testing.T) {
	calls := 0
	tok := makeJWT(time.Now().Add(1 * time.Hour).Unix())
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if got, want := req.Method, http.MethodPost; got != want {
			t.Errorf("SSO method: want %s, got %s", want, got)
		}
		if got, want := req.URL.String(), "https://sso.test-godaddy.com/secure/api/token"; got != want {
			t.Errorf("SSO URL: want %s, got %s", want, got)
		}
		body, _ := io.ReadAll(req.Body)
		if string(body) != "realm=cert" {
			t.Errorf("SSO body: want realm=cert, got %s", string(body))
		}
		envelope := fmt.Sprintf(`{"type":"success","code":1,"message":"ok","data":%q}`, tok)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(envelope)),
			Header:     make(http.Header),
		}, nil
	})
	a := newAuthForTest(t, rt)

	req := httptest.NewRequest("POST", "http://example/x", nil)
	if err := a.ApplyAuth(context.Background(), req); err != nil {
		t.Fatalf("ApplyAuth: %v", err)
	}
	if got, want := req.Header.Get("Authorization"), "sso-jwt "+tok; got != want {
		t.Errorf("Authorization: want %q, got %q", want, got)
	}
	if calls != 1 {
		t.Errorf("SSO calls: want 1, got %d", calls)
	}

	// Second ApplyAuth must reuse the cached token — no new SSO call.
	req2 := httptest.NewRequest("POST", "http://example/y", nil)
	if err := a.ApplyAuth(context.Background(), req2); err != nil {
		t.Fatalf("ApplyAuth (cached): %v", err)
	}
	if calls != 1 {
		t.Errorf("SSO calls (after cache hit): want 1, got %d", calls)
	}
}

func TestCertSSOAuth_RefreshesNearExpiry(t *testing.T) {
	calls := 0
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		// Token expires 30s from now — well inside the 60s refresh margin
		// so the SECOND ApplyAuth must trigger a refetch. Suffix the call
		// count so the two minted tokens are distinguishable; verifies the
		// refreshed token actually replaces the cached one (not just that
		// fetchToken was called twice).
		tok := makeJWT(time.Now().Add(30*time.Second).Unix()) + fmt.Sprintf(".call%d", calls)
		envelope := fmt.Sprintf(`{"type":"success","code":1,"message":"ok","data":%q}`, tok)
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(envelope)),
			Header:     make(http.Header),
		}, nil
	})
	a := newAuthForTest(t, rt)

	req1 := httptest.NewRequest("POST", "http://example/x", nil)
	if err := a.ApplyAuth(context.Background(), req1); err != nil {
		t.Fatalf("ApplyAuth #1: %v", err)
	}
	auth1 := req1.Header.Get("Authorization")

	req2 := httptest.NewRequest("POST", "http://example/y", nil)
	if err := a.ApplyAuth(context.Background(), req2); err != nil {
		t.Fatalf("ApplyAuth #2: %v", err)
	}
	auth2 := req2.Header.Get("Authorization")

	if calls != 2 {
		t.Errorf("SSO calls: want 2 (refresh near expiry), got %d", calls)
	}
	if !strings.HasSuffix(auth1, ".call1") {
		t.Errorf("first token: want suffix .call1, got %q", auth1)
	}
	if !strings.HasSuffix(auth2, ".call2") {
		t.Errorf("second token (refreshed): want suffix .call2, got %q", auth2)
	}
	if auth1 == auth2 {
		t.Errorf("refresh did not produce a new Authorization header (cache stale): %q", auth1)
	}
}

func TestCertSSOAuth_PropagatesNon2xx(t *testing.T) {
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 401,
			Body:       io.NopCloser(strings.NewReader("unauthorized")),
			Header:     make(http.Header),
		}, nil
	})
	a := newAuthForTest(t, rt)

	req := httptest.NewRequest("POST", "http://example/x", nil)
	err := a.ApplyAuth(context.Background(), req)
	if err == nil {
		t.Fatalf("want error on 401, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should include status; got %q", err.Error())
	}
	if got := req.Header.Get("Authorization"); got != "" {
		t.Errorf("Authorization should be empty on SSO failure; got %q", got)
	}
}

func TestCertSSOAuth_PropagatesEnvelopeFailure(t *testing.T) {
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: 200,
			Body:       io.NopCloser(strings.NewReader(`{"type":"error","code":2,"message":"cert revoked","data":""}`)),
			Header:     make(http.Header),
		}, nil
	})
	a := newAuthForTest(t, rt)

	req := httptest.NewRequest("POST", "http://example/x", nil)
	err := a.ApplyAuth(context.Background(), req)
	if err == nil {
		t.Fatalf("want error on envelope failure, got nil")
	}
	if !strings.Contains(err.Error(), "cert revoked") {
		t.Errorf("error should include SSO message; got %q", err.Error())
	}
}

func TestCertSSOAuth_HonorsContextCancellation(t *testing.T) {
	rt := roundTripFunc(func(req *http.Request) (*http.Response, error) {
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	a := newAuthForTest(t, rt)

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest("POST", "http://example/x", nil)

	start := time.Now()
	err := a.ApplyAuth(ctx, req)
	elapsed := time.Since(start)
	if err == nil {
		t.Fatalf("want error on ctx timeout, got nil")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("error should wrap DeadlineExceeded; got %q", err.Error())
	}
	if elapsed > 250*time.Millisecond {
		t.Errorf("ApplyAuth should return promptly on cancellation; took %v", elapsed)
	}
}
