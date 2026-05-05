package sso

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func testConfig(serverURL string) Config {
	return Config{
		TokenURL: serverURL + "/token",
		ClientID: "test-client",
		OpenURL:  func(string) error { return nil },
	}
}

func TestRequestDeviceCode_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/x-www-form-urlencoded" {
			t.Errorf("expected form content type, got %s", ct)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if cid := r.FormValue("client_id"); cid != "test-client" {
			t.Errorf("expected client_id=test-client, got %s", cid)
		}
		json.NewEncoder(w).Encode(DeviceCodeResponse{
			DeviceCode:      "DEVICE123",
			VerificationURI: "https://example.com/verify?code=DEVICE123",
			Interval:        5,
			ExpiresIn:       600,
		})
	}))
	defer srv.Close()

	dcr, err := RequestDeviceCode(context.Background(), testConfig(srv.URL))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dcr.DeviceCode != "DEVICE123" {
		t.Errorf("expected DEVICE123, got %s", dcr.DeviceCode)
	}
	if dcr.VerificationURI != "https://example.com/verify?code=DEVICE123" {
		t.Errorf("unexpected verification URI: %s", dcr.VerificationURI)
	}
	if dcr.Interval != 5 {
		t.Errorf("expected interval=5, got %d", dcr.Interval)
	}
	if dcr.ExpiresIn != 600 {
		t.Errorf("expected expires_in=600, got %d", dcr.ExpiresIn)
	}
}

func TestRequestDeviceCode_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	_, err := RequestDeviceCode(context.Background(), testConfig(srv.URL))
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
}

func TestPollForToken_ImmediateSuccess(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "jwt-token-123"})
	}))
	defer srv.Close()

	token, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 30)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "jwt-token-123" {
		t.Errorf("expected jwt-token-123, got %s", token)
	}
}

func TestPollForToken_PendingThenSuccess(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			json.NewEncoder(w).Encode(tokenPollResponse{Error: "authorization_pending"})
			return
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "jwt-after-pending"})
	}))
	defer srv.Close()

	token, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 30)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "jwt-after-pending" {
		t.Errorf("expected jwt-after-pending, got %s", token)
	}
	if n := calls.Load(); n != 3 {
		t.Errorf("expected 3 poll calls, got %d", n)
	}
}

func TestPollForToken_PendingWith400_ThenSuccess(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := calls.Add(1)
		if n < 3 {
			w.WriteHeader(http.StatusBadRequest) // RFC 8628 actual behavior
			json.NewEncoder(w).Encode(tokenPollResponse{Error: "authorization_pending"})
			return
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "jwt-after-400-pending"})
	}))
	defer srv.Close()

	token, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 30)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "jwt-after-400-pending" {
		t.Errorf("expected jwt-after-400-pending, got %s", token)
	}
	if n := calls.Load(); n != 3 {
		t.Errorf("expected 3 poll calls, got %d", n)
	}
}

func TestPollForToken_SlowDown(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := calls.Add(1)
		if n == 1 {
			json.NewEncoder(w).Encode(tokenPollResponse{Error: "slow_down"})
			return
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "jwt-after-slowdown"})
	}))
	defer srv.Close()

	start := time.Now()
	token, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 30)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "jwt-after-slowdown" {
		t.Errorf("expected jwt-after-slowdown, got %s", token)
	}
	// First poll waits 1s, slow_down adds extra 1s sleep, second poll waits 1s = 3s total.
	if elapsed < 3*time.Second {
		t.Errorf("expected >= 3s due to slow_down extra sleep, got %v", elapsed)
	}
}

func TestPollForToken_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(tokenPollResponse{Error: "authorization_pending"})
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel after a short delay so the first poll's sleep is interrupted
	go func() {
		time.Sleep(500 * time.Millisecond)
		cancel()
	}()

	_, err := PollForToken(ctx, testConfig(srv.URL), "device123", 5, 600)
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled, got %v", err)
	}
}

func TestPollForToken_Expired(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(tokenPollResponse{Error: "authorization_pending"})
	}))
	defer srv.Close()

	_, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 2)
	if err == nil {
		t.Fatal("expected expiry error")
	}
}

func TestPollForToken_UnexpectedError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(tokenPollResponse{Error: "access_denied"})
	}))
	defer srv.Close()

	_, err := PollForToken(context.Background(), testConfig(srv.URL), "device123", 1, 30)
	if err == nil {
		t.Fatal("expected error for access_denied")
	}
	if expected := "token error: access_denied"; err.Error() != expected {
		t.Errorf("expected %q, got %q", expected, err.Error())
	}
}

func TestAcquireToken_FullFlow(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		n := calls.Add(1)
		if n == 1 {
			// First call: device code request (no device_code in form)
			if r.FormValue("device_code") != "" {
				t.Error("first request should not have device_code")
			}
			json.NewEncoder(w).Encode(DeviceCodeResponse{
				DeviceCode:      "DEV456",
				VerificationURI: "https://example.com/verify",
				Interval:        1,
				ExpiresIn:       30,
			})
			return
		}
		// Subsequent calls: poll requests
		if dc := r.FormValue("device_code"); dc != "DEV456" {
			t.Errorf("expected device_code=DEV456, got %s", dc)
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "full-flow-jwt"})
	}))
	defer srv.Close()

	var browserURL string
	cfg := Config{
		TokenURL: srv.URL + "/token",
		ClientID: "test-client",
		OpenURL: func(u string) error {
			browserURL = u
			return nil
		},
	}

	token, err := AcquireToken(context.Background(), cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "full-flow-jwt" {
		t.Errorf("expected full-flow-jwt, got %s", token)
	}
	if browserURL != "https://example.com/verify" {
		t.Errorf("expected browser to open https://example.com/verify, got %s", browserURL)
	}
}

func TestAcquireToken_BrowserOpenFails_ContinuesWithPolling(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		if n == 1 {
			json.NewEncoder(w).Encode(DeviceCodeResponse{
				DeviceCode:      "DEV789",
				VerificationURI: "https://example.com/verify",
				Interval:        1,
				ExpiresIn:       30,
			})
			return
		}
		json.NewEncoder(w).Encode(tokenPollResponse{AccessToken: "jwt-no-browser"})
	}))
	defer srv.Close()

	cfg := Config{
		TokenURL: srv.URL + "/token",
		ClientID: "test-client",
		OpenURL:  func(string) error { return fmt.Errorf("no browser") },
	}

	// Browser failure should not be fatal -- it prints the URL and continues polling
	token, err := AcquireToken(context.Background(), cfg)
	if err != nil {
		t.Fatalf("expected polling to succeed despite browser failure, got: %v", err)
	}
	if token != "jwt-no-browser" {
		t.Errorf("expected jwt-no-browser, got %s", token)
	}
}
