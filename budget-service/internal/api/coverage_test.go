package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/credits"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// ---------------------------------------------------------------------------
// writeInternalError
// ---------------------------------------------------------------------------

func TestWriteInternalError_Returns500WithInternalCode(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeInternalError(rec, "test.op", errors.New("something went wrong"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["code"] != "INTERNAL" {
		t.Fatalf("code = %q, want INTERNAL", body["code"])
	}
	if body["error"] != "internal error" {
		t.Fatalf("error = %q, want 'internal error'", body["error"])
	}
}

// ---------------------------------------------------------------------------
// responseWriter.Flush
// ---------------------------------------------------------------------------

// flushableRecorder embeds httptest.ResponseRecorder and implements http.Flusher
// so we can verify Flush() is delegated.
type flushableRecorder struct {
	*httptest.ResponseRecorder
	flushed bool
}

func (f *flushableRecorder) Flush() {
	f.flushed = true
	f.ResponseRecorder.Flush()
}

func TestResponseWriterFlush_DelegatesToFlusherUnderlying(t *testing.T) {
	t.Parallel()
	fr := &flushableRecorder{ResponseRecorder: httptest.NewRecorder()}
	rw := newResponseWriter(fr)
	rw.Flush()
	if !fr.flushed {
		t.Fatal("expected underlying Flusher.Flush() to be called")
	}
}

func TestResponseWriterFlush_NonFlusherIsNoOp(t *testing.T) {
	t.Parallel()
	// httptest.ResponseRecorder implements Flusher in newer Go versions; wrap it
	// in a plain ResponseWriter that does not implement Flusher.
	type plainWriter struct {
		http.ResponseWriter
	}
	rec := httptest.NewRecorder()
	rw := newResponseWriter(plainWriter{rec})
	// Must not panic.
	rw.Flush()
}

// ---------------------------------------------------------------------------
// writeWebhookStoreError
// ---------------------------------------------------------------------------

func TestWriteWebhookStoreError_ErrNotFoundReturns400(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeWebhookStoreError(rec, "webhook.create", store.ErrNotFound)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "productKey is not registered" {
		t.Fatalf("error = %q, want 'productKey is not registered'", body["error"])
	}
}

func TestWriteWebhookStoreError_GenericErrReturns500(t *testing.T) {
	t.Parallel()
	rec := httptest.NewRecorder()
	writeWebhookStoreError(rec, "webhook.create", errors.New("db error"))
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["code"] != "INTERNAL" {
		t.Fatalf("code = %q, want INTERNAL", body["code"])
	}
}

// ---------------------------------------------------------------------------
// parseRFC3339Time
// ---------------------------------------------------------------------------

func TestParseRFC3339Time_EmptyStringReturnsError(t *testing.T) {
	t.Parallel()
	_, err := parseRFC3339Time("")
	if err == nil {
		t.Fatal("expected error for empty string")
	}
}

func TestParseRFC3339Time_TooLongStringReturnsError(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("a", maxDateStringLen+1)
	_, err := parseRFC3339Time(long)
	if err == nil {
		t.Fatal("expected error for string exceeding maxDateStringLen")
	}
}

func TestParseRFC3339Time_RFC3339NanoFormat(t *testing.T) {
	t.Parallel()
	input := "2024-01-15T10:30:00.123456789Z"
	got, err := parseRFC3339Time(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want, _ := time.Parse(time.RFC3339Nano, input)
	if !got.Equal(want.UTC()) {
		t.Fatalf("got %v, want %v", got, want.UTC())
	}
}

func TestParseRFC3339Time_RFC3339Format(t *testing.T) {
	t.Parallel()
	input := "2024-01-15T10:30:00Z"
	got, err := parseRFC3339Time(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want, _ := time.Parse(time.RFC3339, input)
	if !got.Equal(want.UTC()) {
		t.Fatalf("got %v, want %v", got, want.UTC())
	}
}

func TestParseRFC3339Time_InvalidStringReturnsError(t *testing.T) {
	t.Parallel()
	_, err := parseRFC3339Time("not-a-date")
	if err == nil {
		t.Fatal("expected error for invalid date string")
	}
}

func TestParseRFC3339Time_ReturnsUTC(t *testing.T) {
	t.Parallel()
	// Timezone offset +05:00 — result must be in UTC.
	input := "2024-06-01T12:00:00+05:00"
	got, err := parseRFC3339Time(input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Location() != time.UTC {
		t.Fatalf("expected UTC location, got %v", got.Location())
	}
	// 12:00 +05:00 == 07:00 UTC
	if got.Hour() != 7 {
		t.Fatalf("hour = %d, want 7", got.Hour())
	}
}

// ---------------------------------------------------------------------------
// deleteWebhook handler
// ---------------------------------------------------------------------------

func TestDeleteWebhook_InvalidUUIDReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/webhooks/{webhookId}", s.deleteWebhook).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/webhooks/not-a-uuid", nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteWebhook_NilStoreReturns503(t *testing.T) {
	t.Parallel()
	s := &Server{} // Store is nil
	r := mux.NewRouter()
	r.HandleFunc("/webhooks/{webhookId}", s.deleteWebhook).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	validID := uuid.NewString()
	req := httptest.NewRequest(http.MethodDelete, "/webhooks/"+validID, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// webhookHTTPClient
// ---------------------------------------------------------------------------

func TestWebhookHTTPClient_ReturnsDefaultClientWhenNil(t *testing.T) {
	t.Parallel()
	s := &Server{WebhookClient: nil}
	client := s.webhookHTTPClient()
	if client == nil {
		t.Fatal("expected a non-nil default HTTP client")
	}
	if client.Timeout != 15*time.Second {
		t.Fatalf("default client timeout = %v, want 15s", client.Timeout)
	}
}

func TestWebhookHTTPClient_ReturnsSetClientWhenNotNil(t *testing.T) {
	t.Parallel()
	custom := &http.Client{Timeout: 30 * time.Second}
	s := &Server{WebhookClient: custom}
	got := s.webhookHTTPClient()
	if got != custom {
		t.Fatal("expected the custom WebhookClient to be returned")
	}
}

// ---------------------------------------------------------------------------
// getBudgetSessionReport handler
// ---------------------------------------------------------------------------

func TestGetBudgetSessionReport_InvalidSessionIDReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports/{reportId}", s.getBudgetSessionReport)
	rec := httptest.NewRecorder()
	validReportID := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/sessions/not-a-uuid/reports/"+validReportID, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGetBudgetSessionReport_InvalidReportIDReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports/{reportId}", s.getBudgetSessionReport)
	rec := httptest.NewRecorder()
	validSessionID := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/sessions/"+validSessionID+"/reports/not-a-uuid", nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGetBudgetSessionReport_NilStoreReturns503(t *testing.T) {
	t.Parallel()
	s := &Server{} // Store is nil
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports/{reportId}", s.getBudgetSessionReport)
	rec := httptest.NewRecorder()
	validSessionID := uuid.NewString()
	validReportID := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/sessions/"+validSessionID+"/reports/"+validReportID, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503; body: %s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// postBudgetSessionReport validation
// ---------------------------------------------------------------------------

func TestPostBudgetSessionReport_EmptyReportItemsReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	body := `{"reportItems":[]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+uuid.NewString()+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "reportItems must contain at least one entry") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestPostBudgetSessionReport_MissingLabelReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	body := `{"reportItems":[{"budgetCost":"1.000000","productCost":"1.000000","label":""}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+uuid.NewString()+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "each reportItem requires label") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestPostBudgetSessionReport_ReservedAllowedOverageLabelReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	body := `{"reportItems":[{"budgetCost":"1.000000","productCost":"1.000000","label":"allowed-overage"}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+uuid.NewString()+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "allowed-overage") || !strings.Contains(rec.Body.String(), "reserved") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestPostBudgetSessionReport_NegativeBudgetCostReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	body := `{"reportItems":[{"budgetCost":"-1.000000","productCost":"1.000000","label":"my-label"}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+uuid.NewString()+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "budgetCost must be a valid non-negative amount") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestPostBudgetSessionReport_MissingBudgetAndProductCostReturns400(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/sessions/{sessionId}/reports", s.postBudgetSessionReport).Methods(http.MethodPost)
	// Neither budgetCost nor productCost is present (omitted fields default to empty flexAmount).
	body := `{"reportItems":[{"label":"my-label"}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+uuid.NewString()+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "each reportItem requires budgetCost and productCost") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// writeBudgetStoreError — full branch coverage
// ---------------------------------------------------------------------------

func TestWriteBudgetStoreErrorBranches(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"ErrNotFound", store.ErrNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"ErrUnknownProductKey", store.ErrUnknownProductKey, http.StatusBadRequest, "productKey is not registered"},
		{"ErrAlreadyReconciled", store.ErrAlreadyReconciled, http.StatusConflict, "session already reconciled"},
		{"ErrBudgetHasUnreconciledSessions", store.ErrBudgetHasUnreconciledSessions, http.StatusConflict, "budget has unreconciled sessions"},
		{"ErrNoBudgetItems", store.ErrNoBudgetItems, http.StatusPaymentRequired, "budget has no budget items"},
		{"ErrNoSessionCapacity", store.ErrNoSessionCapacity, http.StatusPaymentRequired, "no credits available to open a session"},
		{"ErrInsufficientCredits", store.ErrInsufficientCredits, http.StatusBadRequest, "insufficient credits"},
		{"ErrDuplicateCallRequestID", store.ErrDuplicateCallRequestID, http.StatusBadRequest, "callRequestId already used for this session"},
		{"ErrReportAggregateNoFilter", store.ErrReportAggregateNoFilter, http.StatusBadRequest, "at least one of productKey and label is required"},
		{"credits.ErrInvalid", credits.ErrInvalid, http.StatusBadRequest, "invalid amount"},
		{"credits.ErrOutOfRange", credits.ErrOutOfRange, http.StatusBadRequest, "invalid amount"},
		{"ErrCreditsUsedExceedsTotal", store.ErrCreditsUsedExceedsTotal, http.StatusBadRequest, "creditsUsed cannot exceed creditsTotal"},
		{"ErrCreditsUsedNegative", store.ErrCreditsUsedNegative, http.StatusBadRequest, "creditsUsed cannot be negative"},
		{"ErrReimbursementRequiresReduction", store.ErrReimbursementRequiresReduction, http.StatusBadRequest, "reimbursement requires a reduction in creditsUsed"},
		{"unknown error", errors.New("some unexpected db error"), http.StatusInternalServerError, "INTERNAL"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			writeBudgetStoreError(rec, "test.op", tc.err)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status %d want %d body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantCode) {
				t.Fatalf("body %s should contain %q", rec.Body.String(), tc.wantCode)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// deleteWebhook handler — not-found path
// ---------------------------------------------------------------------------

func TestDeleteWebhookNotFound(t *testing.T) {
	t.Parallel()
	st := testStore(t)
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/webhooks/{webhookId}", s.deleteWebhook).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/webhooks/"+uuid.NewString(), nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404, body=%s", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// getReportsAggregate — validation paths
// ---------------------------------------------------------------------------

func TestGetReportsAggregate_MissingBothProductKeyAndLabel(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "at least one of productKey and label is required") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_InvalidBudgetID(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&budgetId=not-a-uuid", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "budgetId must be a valid UUID") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_InvalidSessionID(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&sessionId=not-a-uuid", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "sessionId must be a valid UUID") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_FromWithoutTo(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&from=2024-01-01T00:00:00Z", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "from and to must both be set, or both omitted") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_ToWithoutFrom(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&to=2024-01-01T00:00:00Z", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "from and to must both be set, or both omitted") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_FromAfterTo(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&from=2024-06-01T00:00:00Z&to=2024-01-01T00:00:00Z", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "from must be before to") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_InvalidFromFormat(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&from=not-a-date&to=2024-01-01T00:00:00Z", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "from must be RFC3339") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestGetReportsAggregate_InvalidToFormat(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodGet, "/reports/aggregate?productKey=x&from=2024-01-01T00:00:00Z&to=not-a-date", nil)
	rec := httptest.NewRecorder()
	s.getReportsAggregate(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400, body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "to must be RFC3339") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// writeProductStoreError — full branch coverage
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// webhookURLForLog
// ---------------------------------------------------------------------------

func TestWebhookURLForLog(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		want string
	}{
		{"valid https", "https://api.godaddy.com/hook?x=1", "https://api.godaddy.com"},
		{"valid http with path", "http://localhost:8080/webhook/callback", "http://localhost:8080"},
		{"no scheme", "/relative/path", ""},
		{"empty", "", ""},
		{"invalid url", "://bad", ""},
		{"with spaces", "  https://api.gdcorp.tools/x  ", "https://api.gdcorp.tools"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := webhookURLForLog(tc.in)
			if got != tc.want {
				t.Fatalf("webhookURLForLog(%q) = %q want %q", tc.in, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// sessionCostJSONNumber
// ---------------------------------------------------------------------------

func TestSessionCostJSONNumber(t *testing.T) {
	t.Parallel()
	t.Run("valid", func(t *testing.T) {
		t.Parallel()
		n, err := sessionCostJSONNumber("12.345000")
		if err != nil {
			t.Fatal(err)
		}
		if string(n) != "12.345000" {
			t.Fatalf("got %q", n)
		}
	})
	t.Run("zero", func(t *testing.T) {
		t.Parallel()
		n, err := sessionCostJSONNumber("0")
		if err != nil {
			t.Fatal(err)
		}
		if string(n) != "0.000000" {
			t.Fatalf("got %q", n)
		}
	})
	t.Run("invalid", func(t *testing.T) {
		t.Parallel()
		_, err := sessionCostJSONNumber("not-a-number")
		if err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("negative", func(t *testing.T) {
		t.Parallel()
		_, err := sessionCostJSONNumber("-5")
		if err == nil {
			t.Fatal("expected error for negative")
		}
	})
}

// ---------------------------------------------------------------------------
// normalizeWebhookEventType
// ---------------------------------------------------------------------------

func TestNormalizeWebhookEventType(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		wantOK  bool
		wantVal string
	}{
		{"report.created", true, "report.created"},
		{"  budget-item.reset  ", true, "budget-item.reset"},
		{"budget-item.expired", true, "budget-item.expired"},
		{"budget-item.exhausted", true, "budget-item.exhausted"},
		{"unknown.event", false, ""},
		{"", false, ""},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			t.Parallel()
			val, ok := normalizeWebhookEventType(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v want %v", ok, tc.wantOK)
			}
			if val != tc.wantVal {
				t.Fatalf("val = %q want %q", val, tc.wantVal)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// validateWebhookTargetURL
// ---------------------------------------------------------------------------

func TestValidateWebhookTargetURL(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		url      string
		localDev bool
		wantMsg  string
	}{
		{"valid prod", "https://api.gdcorp.tools/hook", false, ""},
		{"valid prod godaddy.com", "https://api.godaddy.com/hook", false, ""},
		{"valid prod nstk.net", "https://api.nstk.net/hook", false, ""},
		{"valid prod env variant", "https://api.dev-gdcorp.tools/hook", false, ""},
		{"http rejected prod", "http://api.gdcorp.tools/hook", false, "url must use https"},
		{"bad domain prod", "https://evil.example.com/hook", false, "must be a *.gdcorp.tools"},
		{"empty url", "", false, "url is required"},
		{"relative url", "/hook", false, "url must be an absolute URL"},
		{"credentials in url", "https://user:pass@api.gdcorp.tools/hook", false, "url must not contain credentials"},
		{"local http loopback", "http://127.0.0.1:9090/hook", true, ""},
		{"local http localhost", "http://localhost:9090/hook", true, ""},
		{"local http non-loopback", "http://remote.example.com/hook", true, "http is only allowed for loopback"},
		{"local https any", "https://any.example.com/hook", true, ""},
		{"ftp rejected local", "ftp://localhost/hook", true, "url must use http or https"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := validateWebhookTargetURL(tc.url, tc.localDev)
			if tc.wantMsg == "" {
				if got != "" {
					t.Fatalf("expected no error, got %q", got)
				}
			} else {
				if !strings.Contains(got, tc.wantMsg) {
					t.Fatalf("msg %q should contain %q", got, tc.wantMsg)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// isAllowedWebhookDomain (extended cases)
// ---------------------------------------------------------------------------

func TestIsAllowedWebhookDomainExtended(t *testing.T) {
	t.Parallel()
	tests := []struct {
		host string
		want bool
	}{
		{"nstk.net", true},
		{"api.nstk.net", true},
		{"api.dev-gdcorp.tools", true},
		{"api.stg-godaddy.com", true},
		{"api.ote-godaddy.com", true},
		{"notgdcorp.tools", false},
		{"notgodaddy.com", false},
	}
	for _, tc := range tests {
		t.Run(tc.host, func(t *testing.T) {
			t.Parallel()
			if got := isAllowedWebhookDomain(tc.host); got != tc.want {
				t.Fatalf("isAllowedWebhookDomain(%q) = %v want %v", tc.host, got, tc.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// writeProductStoreError
// ---------------------------------------------------------------------------

func TestWriteProductStoreErrorBranches(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"conflict", store.ErrConflict, http.StatusConflict, "CONFLICT"},
		{"not found", store.ErrNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"has active budgets", store.ErrProductHasActiveBudgets, http.StatusConflict, "CONFLICT"},
		{"unknown", errors.New("boom"), http.StatusInternalServerError, "INTERNAL"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			rec := httptest.NewRecorder()
			writeProductStoreError(rec, "test.op", tc.err)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status %d want %d body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), tc.wantCode) {
				t.Fatalf("body %s should contain %q", rec.Body.String(), tc.wantCode)
			}
		})
	}
}
