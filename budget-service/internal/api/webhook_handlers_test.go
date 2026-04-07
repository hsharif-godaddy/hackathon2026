package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gdcorp-identity/authz-lib-go/pkg/oauth"
	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"
	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
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

type fakeWebhookDeliverStore struct {
	hooks  []store.WebhookRow
	report *store.SessionReportDetail
}

func (f *fakeWebhookDeliverStore) ListWebhooksForReportCreated(ctx context.Context, productKey string) ([]store.WebhookRow, error) {
	return f.hooks, nil
}

func (f *fakeWebhookDeliverStore) GetSessionReport(ctx context.Context, budgetID, sessionID, reportID string) (*store.SessionReportDetail, error) {
	return f.report, nil
}

type stubWebhookOAuth struct {
	token string
	typ   string
	err   error
}

func (s *stubWebhookOAuth) GetAccessToken(ctx context.Context, scopes ...string) (*oauth.TokenResponse, error) {
	if s.err != nil {
		return nil, s.err
	}
	typ := s.typ
	if typ == "" {
		typ = "Bearer"
	}
	return &oauth.TokenResponse{AccessToken: s.token, TokenType: typ}, nil
}

func TestDeliverReportCreatedWebhooksSetsBearerWhenOAuthConfigured(t *testing.T) {
	t.Parallel()
	var mu sync.Mutex
	var gotAuth string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	pk := "pk-oauth"
	fstore := &fakeWebhookDeliverStore{
		hooks: []store.WebhookRow{{ID: uuid.NewString(), EventType: "report.created", ProductKey: pk, URL: srv.URL + "/hook"}},
		report: &store.SessionReportDetail{
			ProductKey:       pk,
			BudgetID:         uuid.NewString(),
			SessionID:        uuid.NewString(),
			ReportID:         uuid.NewString(),
			BudgetCostTotal:  "0.000000",
			ProductCostTotal: "0.000000",
			CreditsAvailable: "0.000000",
			Items:            nil,
		},
	}
	s := &Server{
		WebhookDataStore: fstore,
		WebhookOAuth:     &stubWebhookOAuth{token: "test-access-token"},
		WebhookClient:    srv.Client(),
	}
	s.deliverReportCreatedWebhooks(fstore.report.BudgetID, fstore.report.SessionID, fstore.report.ReportID, pk)
	mu.Lock()
	g := gotAuth
	mu.Unlock()
	if g != "Bearer test-access-token" {
		t.Fatalf("Authorization %q want Bearer test-access-token", g)
	}
}

func TestDeliverReportCreatedWebhooksOmitsAuthWithoutOAuth(t *testing.T) {
	t.Parallel()
	var mu sync.Mutex
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	pk := "pk-noauth"
	fstore := &fakeWebhookDeliverStore{
		hooks: []store.WebhookRow{{ID: uuid.NewString(), EventType: "report.created", ProductKey: pk, URL: srv.URL + "/hook"}},
		report: &store.SessionReportDetail{
			ProductKey:       pk,
			BudgetID:         uuid.NewString(),
			SessionID:        uuid.NewString(),
			ReportID:         uuid.NewString(),
			BudgetCostTotal:  "0.000000",
			ProductCostTotal: "0.000000",
			CreditsAvailable: "0.000000",
			Items:            nil,
		},
	}
	s := &Server{WebhookDataStore: fstore, WebhookOAuth: nil}
	s.deliverReportCreatedWebhooks(fstore.report.BudgetID, fstore.report.SessionID, fstore.report.ReportID, pk)
	mu.Lock()
	g := gotAuth
	mu.Unlock()
	if g != "" {
		t.Fatalf("Authorization %q want empty", g)
	}
}

func TestDeliverReportCreatedWebhooksSkipsDeliveryOnWhitespaceOnlyAccessToken(t *testing.T) {
	t.Parallel()
	var requests atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	pk := "pk-oauth-blanktok"
	fstore := &fakeWebhookDeliverStore{
		hooks: []store.WebhookRow{{ID: uuid.NewString(), EventType: "report.created", ProductKey: pk, URL: srv.URL + "/hook"}},
		report: &store.SessionReportDetail{
			ProductKey:       pk,
			BudgetID:         uuid.NewString(),
			SessionID:        uuid.NewString(),
			ReportID:         uuid.NewString(),
			BudgetCostTotal:  "0.000000",
			ProductCostTotal: "0.000000",
			CreditsAvailable: "0.000000",
			Items:            nil,
		},
	}
	s := &Server{
		WebhookDataStore: fstore,
		WebhookOAuth:     &stubWebhookOAuth{token: "  \t  "},
		WebhookClient:    srv.Client(),
	}
	s.deliverReportCreatedWebhooks(fstore.report.BudgetID, fstore.report.SessionID, fstore.report.ReportID, pk)
	if requests.Load() != 0 {
		t.Fatalf("handler invoked %d times, want 0 (no delivery on empty token)", requests.Load())
	}
}

func TestDeliverReportCreatedWebhooksSkipsDeliveryOnOAuthTokenError(t *testing.T) {
	t.Parallel()
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	pk := "pk-oauth-err"
	fstore := &fakeWebhookDeliverStore{
		hooks: []store.WebhookRow{{ID: uuid.NewString(), EventType: "report.created", ProductKey: pk, URL: srv.URL + "/hook"}},
		report: &store.SessionReportDetail{
			ProductKey:       pk,
			BudgetID:         uuid.NewString(),
			SessionID:        uuid.NewString(),
			ReportID:         uuid.NewString(),
			BudgetCostTotal:  "0.000000",
			ProductCostTotal: "0.000000",
			CreditsAvailable: "0.000000",
			Items:            nil,
		},
	}
	s := &Server{
		WebhookDataStore: fstore,
		WebhookOAuth:     &stubWebhookOAuth{err: errors.New("token denied")},
	}
	s.deliverReportCreatedWebhooks(fstore.report.BudgetID, fstore.report.SessionID, fstore.report.ReportID, pk)
	if requests.Load() != 0 {
		t.Fatalf("handler invoked %d times, want 0 (no delivery on token error)", requests.Load())
	}
}

func TestDeliverReportCreatedWebhooksOAuthOmitsAuthOnHTTPURL(t *testing.T) {
	t.Parallel()
	var mu sync.Mutex
	var gotAuth string
	var requests atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)

	pk := "pk-oauth-http"
	fstore := &fakeWebhookDeliverStore{
		hooks: []store.WebhookRow{{ID: uuid.NewString(), EventType: "report.created", ProductKey: pk, URL: srv.URL + "/hook"}},
		report: &store.SessionReportDetail{
			ProductKey:       pk,
			BudgetID:         uuid.NewString(),
			SessionID:        uuid.NewString(),
			ReportID:         uuid.NewString(),
			BudgetCostTotal:  "0.000000",
			ProductCostTotal: "0.000000",
			CreditsAvailable: "0.000000",
			Items:            nil,
		},
	}
	s := &Server{
		WebhookDataStore: fstore,
		WebhookOAuth:     &stubWebhookOAuth{token: "secret-token"},
	}
	s.deliverReportCreatedWebhooks(fstore.report.BudgetID, fstore.report.SessionID, fstore.report.ReportID, pk)
	if requests.Load() != 1 {
		t.Fatalf("handler invoked %d times, want 1", requests.Load())
	}
	mu.Lock()
	g := gotAuth
	mu.Unlock()
	if g != "" {
		t.Fatalf("Authorization %q want empty on http URL", g)
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
