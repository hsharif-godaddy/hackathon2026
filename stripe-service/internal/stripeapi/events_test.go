package stripeapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestFetchEvent_RejectsEmptyEventID(t *testing.T) {
	c, _ := New(Config{APIKey: "sk_test_x"})
	_, err := c.FetchEvent(context.Background(), "")
	if err == nil {
		t.Fatalf("want error for empty eventID, got nil")
	}
	if !strings.Contains(err.Error(), "eventID") {
		t.Errorf("error should mention eventID; got %q", err.Error())
	}
}

func TestFetchEvent_HappyPathReturnsBodyVerbatim(t *testing.T) {
	want := `{"id":"evt_001","type":"v2.core.claimable_sandbox.claimed","related_object":{"id":"clmsbx_abc"}}`
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusOK, want)

	body, err := c.FetchEvent(context.Background(), "evt_001")
	if err != nil {
		t.Fatalf("FetchEvent: %v", err)
	}
	if string(body) != want {
		t.Errorf("body: want %q, got %q", want, string(body))
	}
	if got.Method != http.MethodGet {
		t.Errorf("method: want GET, got %q", got.Method)
	}
	if got.Path != "/v2/core/events/evt_001" {
		t.Errorf("path: want /v2/core/events/evt_001, got %q", got.Path)
	}
	if got.ContentType != "" {
		t.Errorf("Content-Type: want absent for GET, got %q", got.ContentType)
	}
}

func TestFetchEvent_PropagatesStripeError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusNotFound,
		`{"error":{"type":"invalid_request_error","code":"resource_missing","message":"No such event: evt_bad"}}`)

	_, err := c.FetchEvent(context.Background(), "evt_bad")
	if err == nil {
		t.Fatalf("want error for 404 response, got nil")
	}
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.HTTPStatus != http.StatusNotFound {
		t.Errorf("HTTPStatus: want 404, got %d", se.HTTPStatus)
	}
	if se.Code != "resource_missing" {
		t.Errorf("Code: want resource_missing, got %q", se.Code)
	}
}

func TestFetchEvent_PropagatesServerError(t *testing.T) {
	var got recordedRequest
	c, _ := newFakeServer(t, &got, http.StatusInternalServerError,
		`{"error":{"type":"api_error","message":"An internal server error occurred."}}`)

	_, err := c.FetchEvent(context.Background(), "evt_001")
	var se *StripeError
	if !errors.As(err, &se) {
		t.Fatalf("want *StripeError, got %T (%v)", err, err)
	}
	if se.HTTPStatus != http.StatusInternalServerError {
		t.Errorf("HTTPStatus: want 500, got %d", se.HTTPStatus)
	}
	if !se.IsRetryable() {
		t.Errorf("500 should be retryable")
	}
}

func TestFetchEvent_PropagatesTransportError(t *testing.T) {
	// Closed server → connection refused; error must carry the wrap prefix.
	var got recordedRequest
	c, srv := newFakeServer(t, &got, http.StatusOK, `{}`)
	srv.Close()

	_, err := c.FetchEvent(context.Background(), "evt_001")
	if err == nil {
		t.Fatalf("want transport error, got nil")
	}
	if !strings.Contains(err.Error(), "stripeapi FetchEvent evt_001") {
		t.Errorf("error should carry FetchEvent wrap prefix; got %q", err.Error())
	}
	var se *StripeError
	if errors.As(err, &se) {
		t.Errorf("transport error should not unwrap to *StripeError")
	}
}
