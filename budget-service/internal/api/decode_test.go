package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type decodeSample struct {
	Foo string `json:"foo"`
}

func TestDecodeJSONBodyValidObject(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"foo":"bar"}`))
	req.Header.Set("Content-Type", "application/json")
	if !decodeJSONBody(rec, req, &dst, false) {
		t.Fatalf("expected success, body %s", rec.Body.String())
	}
	if dst.Foo != "bar" {
		t.Fatalf("foo %q", dst.Foo)
	}
}

func TestDecodeJSONBodyUnknownField(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"foo":"a","extra":1}`))
	req.Header.Set("Content-Type", "application/json")
	if decodeJSONBody(rec, req, &dst, false) {
		t.Fatal("expected failure")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "unknown field") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestDecodeJSONBodyTrailingValue(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"foo":"a"}{"foo":"b"}`))
	req.Header.Set("Content-Type", "application/json")
	if decodeJSONBody(rec, req, &dst, false) {
		t.Fatal("expected failure")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
	var env map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env["code"] != "BAD_REQUEST" || !strings.Contains(env["error"], "invalid JSON body") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestDecodeJSONBodyMalformed(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{`))
	req.Header.Set("Content-Type", "application/json")
	if decodeJSONBody(rec, req, &dst, false) {
		t.Fatal("expected failure")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestDecodeJSONBodyEmptyNotAllowed(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	if decodeJSONBody(rec, req, &dst, false) {
		t.Fatal("expected failure")
	}
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestDecodeJSONBodyEmptyAllowed(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(""))
	req.Header.Set("Content-Type", "application/json")
	if !decodeJSONBody(rec, req, &dst, true) {
		t.Fatalf("expected success with allowEmpty, body %s", rec.Body.String())
	}
}

func TestDecodeJSONBodyPayloadTooLarge(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	large := `{"foo":"` + strings.Repeat("a", budgetMaxBodyBytes) + `"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(large))
	req.Header.Set("Content-Type", "application/json")
	if decodeJSONBody(rec, req, &dst, false) {
		t.Fatal("expected failure")
	}
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"PAYLOAD_TOO_LARGE"`) {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestWriteDecodeErrorMaxBytes(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeDecodeError(rec, &http.MaxBytesError{Limit: 99})
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "PAYLOAD_TOO_LARGE") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestWriteDecodeErrorUnknownFieldString(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	// Matches encoding/json unknown-field errors; writeDecodeError surfaces the message as-is.
	writeDecodeError(rec, errors.New("json: unknown field \"nope\""))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "unknown field") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestWriteDecodeErrorGeneric(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeDecodeError(rec, errors.New("some other problem"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
	var env map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env["error"] != "invalid JSON body" {
		t.Fatalf("error %q", env["error"])
	}
}

func TestDecodeJSONBodySecondDecodeEOF(t *testing.T) {
	t.Parallel()
	var dst decodeSample
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"foo":"ok"} `))
	req.Header.Set("Content-Type", "application/json")
	if !decodeJSONBody(rec, req, &dst, false) {
		t.Fatalf("expected success, %s", rec.Body.String())
	}
}
