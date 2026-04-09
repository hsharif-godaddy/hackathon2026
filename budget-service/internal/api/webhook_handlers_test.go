package api

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

func TestPostWebhookRejectsBadURL(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"eventType":"report.created","productKey":"x","url":"ftp://example.com/hook"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostWebhookRejectsRelativeURL(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"eventType":"report.created","productKey":"x","url":"/relative"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestPostWebhookRejectsUnsupportedEventType(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"eventType":"report.deleted","productKey":"x","url":"https://example.com/hook"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "eventType must be one of:") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestPostWebhookRejectsMissingEventType(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"x","url":"https://example.com/hook"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "eventType is required") {
		t.Fatalf("expected 'eventType is required' error, got %s", rec.Body.String())
	}
}

func TestDeleteWebhookInsertsWebhooksHistory(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "wh-prod-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	wid := uuid.NewString()
	if err := st.CreateWebhook(ctx, wid, "report.created", pk, "https://example.com/hook"); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/webhooks/{webhookId}", s.deleteWebhook).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/webhooks/"+wid, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete webhook status %d body %s", rec.Code, rec.Body.String())
	}
	db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	var n int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM webhooks_history WHERE webhook_id = $1`, wid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("webhooks_history rows %d want 1", n)
	}
}

func TestPostWebhookReturnsSamePayloadAsGetWebhook(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "wh-parity-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	auth := goauth.NewMiddleware("none", "")
	h := NewRouter(&Server{Store: st}, auth)

	body := `{"eventType":"report.created","productKey":"` + pk + `","url":"https://example.com/hook"}`
	recPost := httptest.NewRecorder()
	reqPost := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks", strings.NewReader(body))
	reqPost.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPost, reqPost)
	if recPost.Code != http.StatusCreated {
		t.Fatalf("post webhook status %d body %s", recPost.Code, recPost.Body.String())
	}
	postResp := decodeJSONMapUseNumber(t, recPost.Body.String())
	webhookID := postResp["webhookId"].(string)

	recGet := httptest.NewRecorder()
	reqGet := httptest.NewRequest(http.MethodGet, "/api/v1/webhooks/"+webhookID, nil)
	h.ServeHTTP(recGet, reqGet)
	if recGet.Code != http.StatusOK {
		t.Fatalf("get webhook status %d body %s", recGet.Code, recGet.Body.String())
	}
	getResp := decodeJSONMapUseNumber(t, recGet.Body.String())
	assertJSONMapEqual(t, "post webhook vs get webhook", postResp, getResp)
}
