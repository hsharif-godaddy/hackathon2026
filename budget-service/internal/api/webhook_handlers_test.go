package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
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

func TestGetWebhooksRejectsOversizedProductKeyQuery(t *testing.T) {
	t.Parallel()
	s := &Server{}
	longPK := strings.Repeat("a", maxFieldLen+1)
	req := httptest.NewRequest(http.MethodGet, "/webhooks?productKey="+longPK, nil)
	rec := httptest.NewRecorder()
	s.getWebhooks(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestGetWebhooksRejectsInvalidProductKeyCharacters(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/webhooks?productKey=%3Cscript%3E", nil)
	rec := httptest.NewRecorder()
	s.getWebhooks(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid characters") {
		t.Fatalf("expected 'invalid characters' error, got %s", rec.Body.String())
	}
}

func TestGetWebhooksRejectsUnknownQueryParameter(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/webhooks?productKey=x&foo=1", nil)
	rec := httptest.NewRecorder()
	s.getWebhooks(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "unknown query parameters") {
		t.Fatalf("expected unknown query parameters, got %s", rec.Body.String())
	}
}

func TestGetWebhooksAllowsDocumentedProductKeyQuery(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/webhooks?productKey=x", nil)
	rec := httptest.NewRecorder()
	s.getWebhooks(rec, req)
	if rec.Code == http.StatusBadRequest && strings.Contains(rec.Body.String(), "unknown query parameters") {
		t.Fatalf("allowlist rejected valid keys: %s", rec.Body.String())
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 without store (allowlist passed), got %d %s", rec.Code, rec.Body.String())
	}
}

func TestGetWebhooksAllowsIncludeDeletedQuery(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/webhooks?includeDeleted=true", nil)
	rec := httptest.NewRecorder()
	s.getWebhooks(rec, req)
	if rec.Code == http.StatusBadRequest && strings.Contains(rec.Body.String(), "unknown query parameters") {
		t.Fatalf("allowlist rejected includeDeleted: %s", rec.Body.String())
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 without store (allowlist passed), got %d %s", rec.Code, rec.Body.String())
	}
}

func TestGetWebhookRejectsUnknownQueryParameter(t *testing.T) {
	t.Parallel()
	s := &Server{}
	wid := "00000000-0000-4000-8000-000000000001"
	req := httptest.NewRequest(http.MethodGet, "/webhooks/"+wid+"?foo=1", nil)
	req = mux.SetURLVars(req, map[string]string{"webhookId": wid})
	rec := httptest.NewRecorder()
	s.getWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400 body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "unknown query parameters") {
		t.Fatalf("expected unknown query parameters, got %s", rec.Body.String())
	}
}

func TestGetWebhookAllowsIncludeDeletedQuery(t *testing.T) {
	t.Parallel()
	s := &Server{}
	wid := "00000000-0000-4000-8000-000000000001"
	req := httptest.NewRequest(http.MethodGet, "/webhooks/"+wid+"?includeDeleted=true", nil)
	req = mux.SetURLVars(req, map[string]string{"webhookId": wid})
	rec := httptest.NewRecorder()
	s.getWebhook(rec, req)
	if rec.Code == http.StatusBadRequest && strings.Contains(rec.Body.String(), "unknown query parameters") {
		t.Fatalf("allowlist rejected includeDeleted: %s", rec.Body.String())
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 without store (allowlist passed), got %d %s", rec.Code, rec.Body.String())
	}
}

func TestPostWebhookRejectsInvalidProductKeyCharacters(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"eventType":"report.created","productKey":"<script>","url":"https://example.com/hook"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid characters") {
		t.Fatalf("expected 'invalid characters' error, got %s", rec.Body.String())
	}
}

func TestPostWebhookRejectsOversizedProductKey(t *testing.T) {
	t.Parallel()
	s := &Server{}
	longPK := strings.Repeat("a", maxFieldLen+1)
	body := `{"eventType":"report.created","productKey":"` + longPK + `","url":"https://example.godaddy.com/hook"}`
	req := httptest.NewRequest(http.MethodPost, "/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "exceeds maximum length") {
		t.Fatalf("expected 'exceeds maximum length' error, got %s", rec.Body.String())
	}
}

func TestGetWebhooksFiltersByProductKey(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pkA := "wh-list-a-" + uuid.NewString()
	pkB := "wh-list-b-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pkA); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateProduct(ctx, pkB); err != nil {
		t.Fatal(err)
	}
	idA := uuid.NewString()
	idB := uuid.NewString()
	if err := st.CreateWebhook(ctx, idA, "report.created", pkA, "https://example.godaddy.com/a"); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateWebhook(ctx, idB, "report.created", pkB, "https://example.godaddy.com/b"); err != nil {
		t.Fatal(err)
	}

	authMW := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, authMW)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/webhooks?productKey="+pkA, nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list filtered status %d body %s", rec.Code, rec.Body.String())
	}
	var filtered []struct {
		WebhookID string `json:"webhookId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &filtered); err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 1 {
		t.Fatalf("filtered len %d want 1", len(filtered))
	}
	if filtered[0].WebhookID != idA {
		t.Fatalf("webhookId = %q want %s", filtered[0].WebhookID, idA)
	}

	recAll := httptest.NewRecorder()
	reqAll := httptest.NewRequest(http.MethodGet, "/api/v1/webhooks", nil)
	h.ServeHTTP(recAll, reqAll)
	if recAll.Code != http.StatusOK {
		t.Fatalf("list all status %d", recAll.Code)
	}
	var all []struct {
		WebhookID string `json:"webhookId"`
	}
	if err := json.Unmarshal(recAll.Body.Bytes(), &all); err != nil {
		t.Fatal(err)
	}
	if len(all) < 2 {
		t.Fatalf("list all len %d want >= 2", len(all))
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

func TestDeleteWebhookSoftDeletesRow(t *testing.T) {
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
	var delCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM webhooks WHERE id = $1 AND deleted_at IS NOT NULL`, wid).Scan(&delCount); err != nil {
		t.Fatal(err)
	}
	if delCount != 1 {
		t.Fatalf("soft-deleted webhooks rows %d want 1", delCount)
	}
}

func TestIsAllowedWebhookDomain(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		host    string
		allowed bool
	}{
		// Attack vectors - subdomain spoofing (must be BLOCKED)
		{"blocks spoofed godaddy.com", "evilgodaddy.com", false},
		{"blocks spoofed gdcorp.tools", "attacker-gdcorp.tools", false},
		{"blocks fake gdcorp.tools", "fakegdcorp.tools", false},
		{"blocks similar domain", "notgodaddy.com", false},
		{"blocks subdomain of spoofed domain", "sub.evilgodaddy.com", false},

		// Base domains (must be ALLOWED)
		{"allows godaddy.com", "godaddy.com", true},
		{"allows gdcorp.tools", "gdcorp.tools", true},

		// Subdomains (must be ALLOWED)
		{"allows subdomain of godaddy.com", "api.godaddy.com", true},
		{"allows subdomain of gdcorp.tools", "webhook.gdcorp.tools", true},
		{"allows deep subdomain", "deep.sub.godaddy.com", true},

		// Environment variants - exact match (must be ALLOWED)
		{"allows dev-godaddy.com", "dev-godaddy.com", true},
		{"allows test-godaddy.com", "test-godaddy.com", true},
		{"allows stg-godaddy.com", "stg-godaddy.com", true},
		{"allows ote-godaddy.com", "ote-godaddy.com", true},
		{"allows dev-gdcorp.tools", "dev-gdcorp.tools", true},
		{"allows test-gdcorp.tools", "test-gdcorp.tools", true},
		{"allows stg-gdcorp.tools", "stg-gdcorp.tools", true},
		{"allows ote-gdcorp.tools", "ote-gdcorp.tools", true},

		// Environment variants - subdomains (must be ALLOWED)
		{"allows subdomain of dev-godaddy.com", "api.dev-godaddy.com", true},
		{"allows subdomain of test-gdcorp.tools", "webhook.test-gdcorp.tools", true},
		{"allows deep subdomain of env variant", "a.b.stg-godaddy.com", true},

		// Invalid environment prefixes (must be BLOCKED)
		{"blocks unknown env prefix", "prod-godaddy.com", false},
		{"blocks unknown env prefix for gdcorp", "staging-gdcorp.tools", false},

		// Domains without environment prefixes (nstk.net)
		{"allows nstk.net", "nstk.net", true},
		{"allows subdomain of nstk.net", "api.nstk.net", true},
		{"allows deep subdomain of nstk.net", "deep.sub.nstk.net", true},
		{"blocks spoofed nstk.net", "evilnstk.net", false},
		{"blocks subdomain of spoofed nstk.net", "sub.evilnstk.net", false},
		{"blocks env-prefixed nstk.net", "dev-nstk.net", false},
		{"blocks subdomain of env-prefixed nstk.net", "api.dev-nstk.net", false},

		// Edge cases
		{"blocks empty string", "", false},
		{"blocks unrelated domain", "example.com", false},
		{"blocks partial match at start", "godaddy.com.evil.com", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := isAllowedWebhookDomain(tc.host)
			if result != tc.allowed {
				t.Errorf("isAllowedWebhookDomain(%q) = %v, want %v", tc.host, result, tc.allowed)
			}
		})
	}
}

func TestValidateWebhookTargetURL_DomainValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		url       string
		localAuth bool
		wantErr   string
	}{
		// Production mode (localAuth=false) - domain restrictions apply
		{"prod rejects spoofed domain", "https://evilgodaddy.com/hook", false, "url must be a *.gdcorp.tools, *.godaddy.com, or *.nstk.net domain"},
		{"prod rejects attacker domain", "https://attacker-gdcorp.tools/hook", false, "url must be a *.gdcorp.tools, *.godaddy.com, or *.nstk.net domain"},
		{"prod allows godaddy.com", "https://godaddy.com/hook", false, ""},
		{"prod allows subdomain", "https://api.godaddy.com/hook", false, ""},
		{"prod allows env variant", "https://api.dev-godaddy.com/hook", false, ""},
		{"prod allows gdcorp.tools", "https://webhook.gdcorp.tools/hook", false, ""},
		{"prod allows nstk.net", "https://nstk.net/hook", false, ""},
		{"prod allows nstk.net subdomain", "https://api.nstk.net/hook", false, ""},
		{"prod rejects url with userinfo", "https://user:pass@api.godaddy.com/hook", false, "url must not contain credentials"},

		// Local dev mode (localAuth=true) - no domain restrictions
		{"local allows any https domain", "https://example.com/hook", true, ""},
		{"local allows loopback http", "http://localhost:8080/hook", true, ""},
		{"local rejects non-loopback http", "http://example.com/hook", true, "http is only allowed for loopback addresses (127.0.0.1, localhost, ::1)"},
		{"local rejects url with userinfo", "https://user:pass@example.com/hook", true, "url must not contain credentials"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := validateWebhookTargetURL(tc.url, tc.localAuth)
			if tc.wantErr == "" {
				if result != "" {
					t.Errorf("validateWebhookTargetURL(%q, %v) = %q, want empty", tc.url, tc.localAuth, result)
				}
			} else {
				if result != tc.wantErr {
					t.Errorf("validateWebhookTargetURL(%q, %v) = %q, want %q", tc.url, tc.localAuth, result, tc.wantErr)
				}
			}
		})
	}
}

func TestPostWebhookReturnsSamePayloadAsGetWebhook(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "wh-parity-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	authMW := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, authMW)

	body := `{"eventType":"report.created","productKey":"` + pk + `","url":"https://example.godaddy.com/hook"}`
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

// stubTokenGenerator implements TokenProvider for testing.
type stubTokenGenerator struct {
	token   string
	err     error
	healthy bool
	lastErr error
}

func (s *stubTokenGenerator) GetToken() (string, error) {
	return s.token, s.err
}

func (s *stubTokenGenerator) Healthy() bool {
	return s.healthy
}

func (s *stubTokenGenerator) LastError() error {
	return s.lastErr
}

func TestDoWebhookRequest_AuthorizationHeader(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		token          string
		wantAuthHeader string
	}{
		{"includes auth header when token provided", "test-jwt-token", "sso-jwt test-jwt-token"},
		{"omits auth header when token empty", "", ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var receivedAuth string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				receivedAuth = r.Header.Get("Authorization")
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			s := &Server{WebhookClient: srv.Client()}
			resp, err := s.doWebhookRequest(context.Background(), srv.URL, []byte(`{}`), tc.token)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			_ = resp.Body.Close()

			if receivedAuth != tc.wantAuthHeader {
				t.Errorf("Authorization header = %q, want %q", receivedAuth, tc.wantAuthHeader)
			}
		})
	}
}

func TestDoWebhookRequest_SetsContentTypeAndUserAgent(t *testing.T) {
	t.Parallel()

	var receivedContentType, receivedUserAgent string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedContentType = r.Header.Get("Content-Type")
		receivedUserAgent = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := &Server{WebhookClient: srv.Client()}
	resp, err := s.doWebhookRequest(context.Background(), srv.URL, []byte(`{"test":true}`), "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_ = resp.Body.Close()

	if receivedContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", receivedContentType)
	}
	if receivedUserAgent != "budget-service/1.0" {
		t.Errorf("User-Agent = %q, want budget-service/1.0", receivedUserAgent)
	}
}

func TestDeliverWebhook_HTTPSRequiredWithTokenGenerator(t *testing.T) {
	t.Parallel()

	s := &Server{
		TokenGenerator: &stubTokenGenerator{token: "test-token", healthy: true},
	}

	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: "http://example.com/hook",
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err == nil {
		t.Fatal("expected error for HTTP URL with TokenGenerator")
	}
	if !strings.Contains(err.Error(), "must use HTTPS") {
		t.Errorf("error = %q, want 'must use HTTPS'", err)
	}
}

func TestDeliverWebhook_RejectsUserinfoInURL(t *testing.T) {
	t.Parallel()
	s := &Server{
		TokenGenerator: &stubTokenGenerator{token: "test-token", healthy: true},
	}
	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: "https://user:secret@api.godaddy.com/hook",
	}
	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err == nil {
		t.Fatal("expected error for URL with userinfo")
	}
	if !strings.Contains(err.Error(), "must not contain credentials") {
		t.Fatalf("error = %q, want credentials rejection", err)
	}
}

func TestWebhookURLForLog_OmitsUserinfoAndPath(t *testing.T) {
	t.Parallel()
	got := webhookURLForLog("https://user:pass@api.godaddy.com:8443/hook?x=1#frag")
	want := "https://api.godaddy.com:8443"
	if got != want {
		t.Fatalf("webhookURLForLog = %q, want %q", got, want)
	}
}

func TestDeliverWebhook_DomainAllowlistWithTokenGenerator(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		url     string
		wantErr bool
		errMsg  string
	}{
		{"rejects untrusted domain", "https://evil.com/hook", true, "domain not in allowlist"},
		{"rejects spoofed domain", "https://evilgodaddy.com/hook", true, "domain not in allowlist"},
		{"allows godaddy.com subdomain", "https://api.godaddy.com/hook", false, ""},
		{"allows gdcorp.tools subdomain", "https://webhook.gdcorp.tools/hook", false, ""},
		{"allows env variant", "https://api.dev-godaddy.com/hook", false, ""},
		{"allows nstk.net subdomain", "https://api.nstk.net/hook", false, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			defer srv.Close()

			s := &Server{
				TokenGenerator: &stubTokenGenerator{token: "test-token", healthy: true},
				WebhookClient:  srv.Client(),
			}

			wh := store.WebhookRow{
				ID:  uuid.NewString(),
				URL: tc.url,
			}

			err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for URL %s", tc.url)
				}
				if !strings.Contains(err.Error(), tc.errMsg) {
					t.Errorf("error = %q, want %q", err, tc.errMsg)
				}
			} else {
				// For allowed domains, we expect a connection error since the URL
				// doesn't match the test server, but NOT a domain validation error
				if err != nil && strings.Contains(err.Error(), "domain not in allowlist") {
					t.Errorf("unexpected domain error for allowed URL %s: %v", tc.url, err)
				}
			}
		})
	}
}

func TestDeliverWebhook_HTTPLoopbackAllowedWithoutTokenGenerator(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := &Server{
		TokenGenerator: nil, // local dev mode
		WebhookClient:  srv.Client(),
	}

	// httptest.NewServer uses 127.0.0.1 which is loopback
	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: srv.URL + "/hook",
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err != nil {
		t.Errorf("unexpected error for HTTP loopback without TokenGenerator: %v", err)
	}
}

func TestDeliverWebhook_HTTPNonLoopbackRejectedWithoutTokenGenerator(t *testing.T) {
	t.Parallel()

	s := &Server{
		TokenGenerator: nil, // local dev mode
	}

	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: "http://example.com/hook",
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err == nil {
		t.Fatal("expected error for HTTP non-loopback URL without TokenGenerator")
	}
	if !strings.Contains(err.Error(), "loopback addresses") {
		t.Errorf("error = %q, want 'loopback addresses'", err)
	}
}

func TestDeliverWebhook_Non2xxReturnsError(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		statusCode int
		wantErr    bool
	}{
		{"200 OK succeeds", http.StatusOK, false},
		{"201 Created succeeds", http.StatusCreated, false},
		{"204 No Content succeeds", http.StatusNoContent, false},
		{"400 Bad Request fails", http.StatusBadRequest, true},
		{"401 Unauthorized fails", http.StatusUnauthorized, true},
		{"500 Internal Server Error fails", http.StatusInternalServerError, true},
		{"503 Service Unavailable fails", http.StatusServiceUnavailable, true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.statusCode)
			}))
			defer srv.Close()

			s := &Server{
				TokenGenerator: nil,
				WebhookClient:  srv.Client(),
			}

			wh := store.WebhookRow{
				ID:  uuid.NewString(),
				URL: srv.URL + "/hook",
			}

			err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected error for status %d", tc.statusCode)
				}
				if !strings.Contains(err.Error(), "returned status") {
					t.Errorf("error = %q, want 'returned status'", err)
				}
			} else {
				if err != nil {
					t.Errorf("unexpected error for status %d: %v", tc.statusCode, err)
				}
			}
		})
	}
}

func TestDeliverWebhook_TokenGenerationError(t *testing.T) {
	t.Parallel()

	s := &Server{
		TokenGenerator: &stubTokenGenerator{
			err:     errors.New("token refresh failed"),
			healthy: false,
		},
	}

	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: "https://example.gdcorp.tools/hook",
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err == nil {
		t.Fatal("expected error when token generation fails")
	}
	if !strings.Contains(err.Error(), "token generation failed") {
		t.Errorf("error = %q, want 'token generation failed'", err)
	}
}

// captureTransport is an http.RoundTripper that captures request headers and returns a mock response.
type captureTransport struct {
	capturedAuth string
	statusCode   int
}

func (t *captureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.capturedAuth = req.Header.Get("Authorization")
	return &http.Response{
		StatusCode: t.statusCode,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     make(http.Header),
	}, nil
}

func TestDeliverWebhook_SendsAuthHeaderWhenTokenGeneratorPresent(t *testing.T) {
	t.Parallel()

	transport := &captureTransport{statusCode: http.StatusOK}
	s := &Server{
		TokenGenerator: &stubTokenGenerator{token: "my-jwt-token", healthy: true},
		WebhookClient:  &http.Client{Transport: transport},
	}

	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: "https://webhook.gdcorp.tools/hook", // allowed domain
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if transport.capturedAuth != "sso-jwt my-jwt-token" {
		t.Errorf("Authorization header = %q, want 'sso-jwt my-jwt-token'", transport.capturedAuth)
	}
}

func TestDeliverWebhook_OmitsAuthHeaderWithoutTokenGenerator(t *testing.T) {
	t.Parallel()

	var receivedAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedAuth = r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	s := &Server{
		TokenGenerator: nil,
		WebhookClient:  srv.Client(),
	}

	wh := store.WebhookRow{
		ID:  uuid.NewString(),
		URL: srv.URL + "/hook",
	}

	err := s.deliverWebhook(context.Background(), wh, []byte(`{}`))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if receivedAuth != "" {
		t.Errorf("Authorization header = %q, want empty", receivedAuth)
	}
}
