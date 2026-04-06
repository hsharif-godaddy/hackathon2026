package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"

	goauth "github.com/gdcorp-partners/airo-app-builder/packages/go-auth"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

func testStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set (integration)")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return store.New(db)
}

func TestPostBudgetReturns201AndBudgetId(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-post-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	body := `{"productKey":"` + key + `","items":[{"creditsTotal":"100.000000","costToCreditRatio":"1"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"budgetId"`) {
		t.Fatalf("expected budgetId in body: %s", rec.Body.String())
	}
}

func TestPostBudgetRejectsEmptyItems(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(`{"productKey":"k","items":[]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostBudgetRejectsInvalidResetInterval(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"x","items":[{"creditsTotal":"1.000000","costToCreditRatio":"1","resetInterval":"INVALID"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestGetBudgetWithMuxVars(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-get-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CreditSpendRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.getBudget).Methods(http.MethodGet)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/budgets/"+budgetID, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"budgetId"`) {
		t.Fatalf("expected budgetId: %s", rec.Body.String())
	}
}

func TestBudgetSessionReportPathNotShadowedBySessionPatch(t *testing.T) {
	t.Parallel()
	var handlerName string
	r := mux.NewRouter()
	r.Methods(http.MethodPost).Path("/budgets/{budgetId}/sessions/{sessionId}/reports").HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerName = "report"
	})
	r.Methods(http.MethodPatch).Path("/budgets/{budgetId}/sessions/{sessionId}").HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerName = "patch"
	})
	bid := "11111111-1111-1111-1111-111111111111"
	sid := "22222222-2222-2222-2222-222222222222"
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/budgets/"+bid+"/sessions/"+sid+"/reports", strings.NewReader("{}"))
	r.ServeHTTP(rec, req)
	if handlerName != "report" {
		t.Fatalf("expected report route, got %q", handlerName)
	}
}

func TestPostSessionReturns402WhenBudgetExhausted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "session-402-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "1.000000", CreditSpendRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	auth := goauth.NewMiddleware("none", "")
	h := NewRouter(&Server{Store: st}, auth)

	reqS1 := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions", strings.NewReader(`{}`))
	reqS1.Header.Set("Content-Type", "application/json")
	recS1 := httptest.NewRecorder()
	h.ServeHTTP(recS1, reqS1)
	if recS1.Code != http.StatusCreated {
		t.Fatalf("first post session: %d %s", recS1.Code, recS1.Body.String())
	}
	var s1 struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(recS1.Body.Bytes(), &s1); err != nil {
		t.Fatal(err)
	}

	repBody := `{"reportItems":[{"budgetCost":"1","productCost":"0","label":"close"}]}`
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions/"+s1.SessionID+"/reports", strings.NewReader(repBody))
	reqRep.Header.Set("Content-Type", "application/json")
	recRep := httptest.NewRecorder()
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recRep.Code, recRep.Body.String())
	}

	reqS2 := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions", strings.NewReader(`{}`))
	reqS2.Header.Set("Content-Type", "application/json")
	recS2 := httptest.NewRecorder()
	h.ServeHTTP(recS2, reqS2)
	if recS2.Code != http.StatusPaymentRequired {
		t.Fatalf("second post session: status %d want 402, body %s", recS2.Code, recS2.Body.String())
	}
	var errBody struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recS2.Body.Bytes(), &errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Code != "NO_BUDGET_CAPACITY" {
		t.Fatalf("code %q want NO_BUDGET_CAPACITY", errBody.Code)
	}
}

func TestGoCodeSpendMathOverHTTP(t *testing.T) {
	st := testStore(t)
	auth := goauth.NewMiddleware("none", "")
	srv := &Server{Store: st}
	h := NewRouter(srv, auth)

	prodBody := `{"productKey":"integration-spend-` + uuid.NewString() + `"}`
	reqP := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(prodBody))
	reqP.Header.Set("Content-Type", "application/json")
	recP := httptest.NewRecorder()
	h.ServeHTTP(recP, reqP)
	if recP.Code != http.StatusCreated {
		t.Fatalf("post product: %d %s", recP.Code, recP.Body.String())
	}
	var prodResp struct {
		ProductKey string `json:"productKey"`
	}
	if err := json.Unmarshal(recP.Body.Bytes(), &prodResp); err != nil {
		t.Fatal(err)
	}
	budgetBody := `{"productKey":"` + prodResp.ProductKey + `","items":[{"creditsTotal":"1000.000000","costToCreditRatio":"0.666660"}]}`
	reqB := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(budgetBody))
	reqB.Header.Set("Content-Type", "application/json")
	recB := httptest.NewRecorder()
	h.ServeHTTP(recB, reqB)
	if recB.Code != http.StatusCreated {
		t.Fatalf("post budget: %d %s", recB.Code, recB.Body.String())
	}
	var budgetResp struct {
		BudgetID string `json:"budgetId"`
	}
	if err := json.Unmarshal(recB.Body.Bytes(), &budgetResp); err != nil {
		t.Fatal(err)
	}
	budgetID := budgetResp.BudgetID

	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions", strings.NewReader(`{"metadata":{"run":"integration"}}`))
	reqS.Header.Set("Content-Type", "application/json")
	recS := httptest.NewRecorder()
	h.ServeHTTP(recS, reqS)
	if recS.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recS.Code, recS.Body.String())
	}
	var sessResp struct {
		SessionID string          `json:"sessionId"`
		Metadata  json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal(recS.Body.Bytes(), &sessResp); err != nil {
		t.Fatal(err)
	}
	sessionID := sessResp.SessionID
	if len(sessResp.Metadata) == 0 || !strings.Contains(string(sessResp.Metadata), "integration") {
		t.Fatalf("expected metadata in create response: %s", recS.Body.String())
	}

	patchBody := `{"sessionItems":[{"cost":2,"callRequestId":"gocode-req-1"}]}`
	reqSp := httptest.NewRequest(http.MethodPatch, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID, strings.NewReader(patchBody))
	reqSp.Header.Set("Content-Type", "application/json")
	recSp := httptest.NewRecorder()
	h.ServeHTTP(recSp, reqSp)
	if recSp.Code != http.StatusOK {
		t.Fatalf("patch session: %d %s", recSp.Code, recSp.Body.String())
	}

	reqG := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID+"?debug=1", nil)
	recG := httptest.NewRecorder()
	h.ServeHTTP(recG, reqG)
	if recG.Code != http.StatusOK {
		t.Fatalf("get session: %d %s", recG.Code, recG.Body.String())
	}
	dec := json.NewDecoder(strings.NewReader(recG.Body.String()))
	dec.UseNumber()
	var got map[string]any
	if err := dec.Decode(&got); err != nil {
		t.Fatal(err)
	}
	if got["costTotal"].(json.Number).String() != "2.000000" {
		t.Fatalf("costTotal %v want 2.000000", got["costTotal"])
	}
	items, _ := got["sessionItems"].([]any)
	if len(items) != 1 {
		t.Fatalf("sessionItems len %d", len(items))
	}
	line0 := items[0].(map[string]any)
	if line0["callRequestId"] != "gocode-req-1" {
		t.Fatalf("callRequestId %v", line0["callRequestId"])
	}
	if line0["cost"].(json.Number).String() != "2.000000" {
		t.Fatalf("line cost %v", line0["cost"])
	}
	dbg := got["debug"].(map[string]any)
	order := dbg["consumptionOrder"].([]any)
	if len(order) != 1 {
		t.Fatalf("consumptionOrder len %d want 1", len(order))
	}
	dbgItems := dbg["sessionItems"].([]any)
	dbgLine0 := dbgItems[0].(map[string]any)
	if dbgLine0["creditsChargedReplayed"].(string) != "3.000030" {
		t.Fatalf("debug creditsChargedReplayed %v want 3.000030", dbgLine0["creditsChargedReplayed"])
	}
	if dbgLine0["creditsChargedStored"].(string) != "3.000030" {
		t.Fatalf("debug creditsChargedStored %v want 3.000030", dbgLine0["creditsChargedStored"])
	}

	repBody := `{"reportItems":[{"budgetCost":2,"productCost":1,"label":"usage"}]}`
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
	reqRep.Header.Set("Content-Type", "application/json")
	recRep := httptest.NewRecorder()
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recRep.Code, recRep.Body.String())
	}
	var reportResp struct {
		ReportID string `json:"reportId"`
	}
	if err := json.Unmarshal(recRep.Body.Bytes(), &reportResp); err != nil {
		t.Fatal(err)
	}
	if reportResp.ReportID == "" {
		t.Fatal("missing reportId")
	}

	reqGR := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID+"/reports/"+reportResp.ReportID, nil)
	recGR := httptest.NewRecorder()
	h.ServeHTTP(recGR, reqGR)
	if recGR.Code != http.StatusOK {
		t.Fatalf("get report: %d %s", recGR.Code, recGR.Body.String())
	}
	decR := json.NewDecoder(strings.NewReader(recGR.Body.String()))
	decR.UseNumber()
	var rep map[string]any
	if err := decR.Decode(&rep); err != nil {
		t.Fatal(err)
	}
	if rep["budgetId"].(string) != budgetID {
		t.Fatalf("report budgetId")
	}
	if rep["reportItems"].([]any)[0].(map[string]any)["category"].(string) != "usage" {
		t.Fatalf("report category")
	}

	reqGS404 := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID, nil)
	recGS404 := httptest.NewRecorder()
	h.ServeHTTP(recGS404, reqGS404)
	if recGS404.Code != http.StatusNotFound {
		t.Fatalf("get session after report: status %d want 404, body %s", recGS404.Code, recGS404.Body.String())
	}
}

func TestPatchBudgetItemInsertsHistoryRow(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "history-test-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "100.000000", CreditSpendRatio: "0.066666"},
	}); err != nil {
		t.Fatal(err)
	}
	var itemID string
	db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.QueryRowContext(ctx, `SELECT id FROM budget_items WHERE budget_id = $1`, budgetID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	patchBody := `{"creditsTotal":"100.000000","costToCreditRatio":"0.05"}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(patchBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch item: %d %s", rec.Code, rec.Body.String())
	}
	var revCount int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM budget_item_history WHERE budget_item_id = $1`, itemID).Scan(&revCount); err != nil {
		t.Fatal(err)
	}
	if revCount != 1 {
		t.Fatalf("budget_item_history count %d want 1", revCount)
	}
}

func TestGetBudgetItem(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "get-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "77.000000", CreditSpendRatio: "0.066666"},
	}); err != nil {
		t.Fatal(err)
	}
	var itemID string
	db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	if err := db.QueryRowContext(ctx, `SELECT id FROM budget_items WHERE budget_id = $1`, budgetID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.getBudgetItem).Methods(http.MethodGet)
	req := httptest.NewRequest(http.MethodGet, "/budgets/"+budgetID+"/budget-items/"+itemID, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get item: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["budgetId"].(string) != budgetID {
		t.Fatalf("budgetId")
	}
	if body["budgetItemId"].(string) != itemID {
		t.Fatalf("budgetItemId")
	}
	if body["creditsTotal"].(string) != "77.000000" {
		t.Fatalf("creditsTotal %v", body["creditsTotal"])
	}

	wrong := uuid.NewString()
	req404 := httptest.NewRequest(http.MethodGet, "/budgets/"+budgetID+"/budget-items/"+wrong, nil)
	rec404 := httptest.NewRecorder()
	r.ServeHTTP(rec404, req404)
	if rec404.Code != http.StatusNotFound {
		t.Fatalf("get missing item: status %d body %s", rec404.Code, rec404.Body.String())
	}
}

func TestReportAllocatesRenewalItemBeforePlainItem(t *testing.T) {
	st := testStore(t)
	auth := goauth.NewMiddleware("none", "")
	srv := &Server{Store: st}
	h := NewRouter(srv, auth)

	prodBody := `{"productKey":"priority-renew-` + uuid.NewString() + `"}`
	reqP := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(prodBody))
	reqP.Header.Set("Content-Type", "application/json")
	recP := httptest.NewRecorder()
	h.ServeHTTP(recP, reqP)
	if recP.Code != http.StatusCreated {
		t.Fatalf("post product: %d %s", recP.Code, recP.Body.String())
	}
	var prodResp struct {
		ProductKey string `json:"productKey"`
	}
	if err := json.Unmarshal(recP.Body.Bytes(), &prodResp); err != nil {
		t.Fatal(err)
	}

	budgetBody := `{"productKey":"` + prodResp.ProductKey + `","items":[` +
		`{"creditsTotal":"1000.000000","costToCreditRatio":"0.5","resetInterval":"MONTH","expiresAt":"2030-12-31T23:59:59Z"},` +
		`{"creditsTotal":"1000.000000","costToCreditRatio":"0.1","expiresAt":"2025-06-01T00:00:00Z"}` +
		`]}`
	reqB := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(budgetBody))
	reqB.Header.Set("Content-Type", "application/json")
	recB := httptest.NewRecorder()
	h.ServeHTTP(recB, reqB)
	if recB.Code != http.StatusCreated {
		t.Fatalf("post budget: %d %s", recB.Code, recB.Body.String())
	}
	var budgetResp struct {
		BudgetID string `json:"budgetId"`
	}
	if err := json.Unmarshal(recB.Body.Bytes(), &budgetResp); err != nil {
		t.Fatal(err)
	}
	budgetID := budgetResp.BudgetID

	reqGB := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID, nil)
	recGB := httptest.NewRecorder()
	h.ServeHTTP(recGB, reqGB)
	if recGB.Code != http.StatusOK {
		t.Fatalf("get budget: %d %s", recGB.Code, recGB.Body.String())
	}
	var budgetGet struct {
		Items []struct {
			BudgetItemID string `json:"budgetItemId"`
		} `json:"items"`
	}
	if err := json.Unmarshal(recGB.Body.Bytes(), &budgetGet); err != nil {
		t.Fatal(err)
	}
	if len(budgetGet.Items) != 2 {
		t.Fatalf("items len %d", len(budgetGet.Items))
	}
	renewalItemID := budgetGet.Items[0].BudgetItemID

	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions", strings.NewReader(`{}`))
	reqS.Header.Set("Content-Type", "application/json")
	recS := httptest.NewRecorder()
	h.ServeHTTP(recS, reqS)
	if recS.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recS.Code, recS.Body.String())
	}
	var sessResp struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(recS.Body.Bytes(), &sessResp); err != nil {
		t.Fatal(err)
	}
	sessionID := sessResp.SessionID

	repBody := `{"reportItems":[{"budgetCost":"0.10","productCost":"0","label":"p"}]}`
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
	reqRep.Header.Set("Content-Type", "application/json")
	recRep := httptest.NewRecorder()
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recRep.Code, recRep.Body.String())
	}
	var reportResp struct {
		ReportID string `json:"reportId"`
	}
	if err := json.Unmarshal(recRep.Body.Bytes(), &reportResp); err != nil {
		t.Fatal(err)
	}

	reqGR := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/sessions/"+sessionID+"/reports/"+reportResp.ReportID, nil)
	recGR := httptest.NewRecorder()
	h.ServeHTTP(recGR, reqGR)
	if recGR.Code != http.StatusOK {
		t.Fatalf("get report: %d %s", recGR.Code, recGR.Body.String())
	}
	dec := json.NewDecoder(strings.NewReader(recGR.Body.String()))
	dec.UseNumber()
	var rep map[string]any
	if err := dec.Decode(&rep); err != nil {
		t.Fatal(err)
	}
	ritems := rep["reportItems"].([]any)
	line0 := ritems[0].(map[string]any)
	budgetItems := line0["budgetItems"].([]any)
	if len(budgetItems) != 1 {
		t.Fatalf("report line budgetItems len %d want 1", len(budgetItems))
	}
	alloc := budgetItems[0].(map[string]any)
	gotID := alloc["budgetItemId"].(string)
	if gotID != renewalItemID {
		t.Fatalf("allocation budgetItemId %q want renewal item %q", gotID, renewalItemID)
	}
}
