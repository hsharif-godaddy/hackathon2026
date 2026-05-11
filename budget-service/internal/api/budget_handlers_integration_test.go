package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/mux"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

// newTestRouter builds a full router backed by the given store with auth disabled.
func newTestRouter(st *store.Store) http.Handler {
	authMW := auth.NewMiddleware("none", nil, nil)
	return NewRouter(&Server{Store: st}, authMW)
}

// TestDeleteBudgetHappyPath creates a product+budget then deletes it via the router.
func TestDeleteBudgetHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "del-budget-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budgets/"+budgetID, nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete budget: status %d, body %s", rec.Code, rec.Body.String())
	}

	// Verify soft-delete: GetBudget with includeDeleted=true should show DeletedAt set.
	budget, err := st.GetBudget(ctx, budgetID, true)
	if err != nil {
		t.Fatalf("GetBudget after soft-delete: unexpected error %v", err)
	}
	if budget.DeletedAt == nil {
		t.Fatal("expected budget.DeletedAt to be set after soft-delete")
	}
}

// TestDeleteBudgetNotFound expects 404 for a non-existent budget UUID.
func TestDeleteBudgetNotFound(t *testing.T) {
	st := testStore(t)

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/budgets/"+uuid.NewString(), nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("delete non-existent budget: status %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestPostBudgetItemHappyPath creates a product+budget then adds a budget item via the router.
func TestPostBudgetItemHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "post-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	body := `{"creditsTotal":"5.000000","costToCreditRatio":"1.000000"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/budget-items", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("post budget item: status %d, body %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v, body %s", err, rec.Body.String())
	}
	if resp["budgetId"] != budgetID {
		t.Fatalf("budgetId = %v, want %s", resp["budgetId"], budgetID)
	}
	if _, ok := resp["budgetItemId"]; !ok {
		t.Fatalf("expected budgetItemId in response: %s", rec.Body.String())
	}
	if _, ok := resp["creditsTotal"]; !ok {
		t.Fatalf("expected creditsTotal in response: %s", rec.Body.String())
	}
}

// TestPostBudgetItemNotFound expects 404 when posting to a non-existent budget.
func TestPostBudgetItemNotFound(t *testing.T) {
	st := testStore(t)

	router := newTestRouter(st)
	body := `{"creditsTotal":"5.000000","costToCreditRatio":"1.000000"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+uuid.NewString()+"/budget-items", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("post item to non-existent budget: status %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestPatchBudgetSessionHappyPath creates a product+budget+session then appends items.
func TestPatchBudgetSessionHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "patch-session-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	callID := uuid.NewString()
	body := `{"sessionItems":[{"callRequestId":"` + callID + `","cost":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("patch session: status %d, body %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v, body %s", err, rec.Body.String())
	}
	if resp["sessionId"] != sessionID {
		t.Fatalf("sessionId = %v, want %s", resp["sessionId"], sessionID)
	}
	if _, ok := resp["costTotal"]; !ok {
		t.Fatalf("expected costTotal in response: %s", rec.Body.String())
	}
}

// TestPatchBudgetSessionDuplicateCallRequestId expects 400 when duplicate callRequestId is sent.
func TestPatchBudgetSessionDuplicateCallRequestId(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "patch-dup-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	callID := uuid.NewString()
	body := `{"sessionItems":[{"callRequestId":"` + callID + `","cost":"1.000000"},{"callRequestId":"` + callID + `","cost":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("patch session with duplicate callRequestId: status %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestGetBudgetSessionHappyPath creates and patches a session then retrieves it.
func TestGetBudgetSessionHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "get-session-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	callID := uuid.NewString()
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "2.000000", CallRequestID: callID},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID, nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("get session: status %d, body %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v, body %s", err, rec.Body.String())
	}
	if resp["sessionId"] != sessionID {
		t.Fatalf("sessionId = %v, want %s", resp["sessionId"], sessionID)
	}
	if resp["budgetId"] != budgetID {
		t.Fatalf("budgetId = %v, want %s", resp["budgetId"], budgetID)
	}
	if _, ok := resp["costTotal"]; !ok {
		t.Fatalf("expected costTotal in response: %s", rec.Body.String())
	}
}

// TestGetBudgetSessionNotFound expects 404 for a non-existent session UUID.
func TestGetBudgetSessionNotFound(t *testing.T) {
	st := testStore(t)

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+uuid.NewString(), nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("get non-existent session: status %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestPostBudgetSessionReportHappyPath creates a full session flow and then reconciles it.
func TestPostBudgetSessionReportHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "report-happy-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	callID := uuid.NewString()
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "1.000000", CallRequestID: callID},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	body := `{"reportItems":[{"label":"inference","budgetCost":"1.000000","productCost":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("post session report: status %d, body %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v, body %s", err, rec.Body.String())
	}
	if resp["sessionId"] != sessionID {
		t.Fatalf("sessionId = %v, want %s", resp["sessionId"], sessionID)
	}
	if _, ok := resp["reportId"]; !ok {
		t.Fatalf("expected reportId in response: %s", rec.Body.String())
	}
}

// TestPostBudgetSessionReportAlreadyReconciled expects 409 when submitting a report twice.
func TestPostBudgetSessionReportAlreadyReconciled(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "report-dup-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	callID := uuid.NewString()
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "1.000000", CallRequestID: callID},
	}); err != nil {
		t.Fatal(err)
	}
	// Reconcile via the store directly.
	if _, _, err := st.CreateSessionReport(ctx, sessionID, []store.ReportLineInput{
		{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "inference"},
	}, false); err != nil {
		t.Fatal(err)
	}

	// Second reconcile attempt should return 409.
	router := newTestRouter(st)
	body := `{"reportItems":[{"label":"inference","budgetCost":"1.000000","productCost":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("second report on reconciled session: status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "reconciled") {
		t.Fatalf("expected reconciled error, got %s", rec.Body.String())
	}
}

// TestGetBudgetSessionReportHappyPath creates a report and retrieves it by ID.
func TestGetBudgetSessionReportHappyPath(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "get-report-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	callID := uuid.NewString()
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "1.000000", CallRequestID: callID},
	}); err != nil {
		t.Fatal(err)
	}
	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []store.ReportLineInput{
		{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "inference"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/reports/"+reportID, nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("get session report: status %d, body %s", rec.Code, rec.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v, body %s", err, rec.Body.String())
	}
	if resp["reportId"] != reportID {
		t.Fatalf("reportId = %v, want %s", resp["reportId"], reportID)
	}
	items, ok := resp["reportItems"].([]any)
	if !ok || len(items) == 0 {
		t.Fatalf("expected non-empty reportItems in response: %s", rec.Body.String())
	}
}

// TestGetBudgetSessionReportNotFound expects 404 for a non-existent report UUID.
func TestGetBudgetSessionReportNotFound(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	key := "get-report-404-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	// Reconcile the session so it exists.
	callID := uuid.NewString()
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "1.000000", CallRequestID: callID},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.CreateSessionReport(ctx, sessionID, []store.ReportLineInput{
		{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "inference"},
	}, false); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/reports/"+uuid.NewString(), nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("get non-existent report: status %d, body %s", rec.Code, rec.Body.String())
	}
}

// TestPatchBudgetSessionWithDebug verifies that ?debug=1 on PATCH /sessions/:id
// returns a "debug" field in the response.
func TestPatchBudgetSessionWithDebug(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	pk := "patch-debug-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	body := `{"sessionItems":[{"callRequestId":"` + uuid.NewString() + `","cost":"5.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID+"?debug=1", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("patch session with debug: status %d body %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v body %s", err, rec.Body.String())
	}
	if out["debug"] == nil {
		t.Fatalf("expected debug field in response, got: %s", rec.Body.String())
	}
}

// TestGetBudgetSessionWithDebug verifies that ?debug=1 on GET /sessions/:id
// returns a "debug" field in the response.
func TestGetBudgetSessionWithDebug(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	pk := "get-debug-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []store.SessionLine{
		{Cost: "3.000000", CallRequestID: uuid.NewString()},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"?debug=1", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("get session with debug: status %d body %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v body %s", err, rec.Body.String())
	}
	if out["debug"] == nil {
		t.Fatalf("expected debug field in response, got: %s", rec.Body.String())
	}
}

// TestPatchBudgetSessionEmptyItems expects 400 when sessionItems is an empty array.
func TestPatchBudgetSessionEmptyItems(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/sessions/{sessionId}", s.patchBudgetSession).Methods(http.MethodPatch)
	body := `{"sessionItems":[]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+uuid.NewString(), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "sessionItems must contain") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

// TestPatchBudgetSessionMissingCallRequestId expects 400 when callRequestId is absent.
func TestPatchBudgetSessionMissingCallRequestId(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/sessions/{sessionId}", s.patchBudgetSession).Methods(http.MethodPatch)
	body := `{"sessionItems":[{"cost":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+uuid.NewString(), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "callRequestId") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

// TestPatchBudgetSessionMissingCost expects 400 when cost is absent.
func TestPatchBudgetSessionMissingCost(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/sessions/{sessionId}", s.patchBudgetSession).Methods(http.MethodPatch)
	body := `{"sessionItems":[{"callRequestId":"` + uuid.NewString() + `"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+uuid.NewString(), strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cost") {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

// TestPostBudgetSessionWithMetadata creates a session with metadata and verifies
// it appears in the response.
func TestPostBudgetSessionWithMetadata(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)

	pk := "session-meta-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []store.ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	router := newTestRouter(st)
	body := `{"budgetId":"` + budgetID + `","metadata":{"key":"value"}}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("post session with metadata: status %d body %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v body %s", err, rec.Body.String())
	}
	if out["sessionId"] == nil {
		t.Fatalf("missing sessionId in response: %s", rec.Body.String())
	}
	if out["metadata"] == nil {
		t.Fatalf("missing metadata in response: %s", rec.Body.String())
	}
}
