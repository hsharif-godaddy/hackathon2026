package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	_ "github.com/lib/pq"

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/auth"
	schemamigrate "github.com/gdcorp-partners/airo-app-builder/budget-service/internal/migrate"
	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

var testDBMigrateOnce sync.Once

func decodeJSONMapUseNumber(t *testing.T, body string) map[string]any {
	t.Helper()
	dec := json.NewDecoder(strings.NewReader(body))
	dec.UseNumber()
	var out map[string]any
	if err := dec.Decode(&out); err != nil {
		t.Fatalf("decode json: %v body=%s", err, body)
	}
	return out
}

func assertJSONMapEqual(t *testing.T, label string, got, want map[string]any) {
	t.Helper()
	if reflect.DeepEqual(got, want) {
		return
	}
	gotJSON, _ := json.MarshalIndent(got, "", "  ")
	wantJSON, _ := json.MarshalIndent(want, "", "  ")
	t.Fatalf("%s mismatch\n--- got ---\n%s\n--- want ---\n%s", label, string(gotJSON), string(wantJSON))
}

func testStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set (integration)")
	}
	var migrateErr error
	testDBMigrateOnce.Do(func() {
		migrateErr = schemamigrate.Up(dsn)
	})
	if migrateErr != nil {
		t.Fatalf("migrate: %v", migrateErr)
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

func TestPostBudgetAllowsEmptyItems(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-empty-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}

	cases := []struct {
		name       string
		postBudget string
	}{
		{"itemsEmptyArray", `{"productKey":"` + key + `","items":[]}`},
		{"itemsOmitted", `{"productKey":"` + key + `"}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(tc.postBudget))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			s.postBudget(rec, req)
			if rec.Code != http.StatusCreated {
				t.Fatalf("post budget: status %d, body %s", rec.Code, rec.Body.String())
			}
			var got map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			budgetID, _ := got["budgetId"].(string)
			if budgetID == "" {
				t.Fatalf("expected budgetId in body: %s", rec.Body.String())
			}
			items, _ := got["items"].([]any)
			if items == nil || len(items) != 0 {
				t.Fatalf("expected empty items, got %#v", got["items"])
			}

			reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
			reqS.Header.Set("Content-Type", "application/json")
			recS := httptest.NewRecorder()
			s.postBudgetSession(recS, reqS)
			if recS.Code != http.StatusPaymentRequired {
				t.Fatalf("post session want 402, got %d body %s", recS.Code, recS.Body.String())
			}
			var errBody struct {
				Code  string `json:"code"`
				Error string `json:"error"`
			}
			if err := json.Unmarshal(recS.Body.Bytes(), &errBody); err != nil {
				t.Fatal(err)
			}
			if errBody.Code != "NO_BUDGET_CAPACITY" {
				t.Fatalf("code %q want NO_BUDGET_CAPACITY", errBody.Code)
			}
			if errBody.Error != "budget has no budget items" {
				t.Fatalf("error %q want budget has no budget items", errBody.Error)
			}
		})
	}
}

func TestPostBudgetSessionRejectsMissingBudgetId(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudgetSession(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostBudgetSessionRejectsInvalidBudgetId(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"not-a-uuid"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudgetSession(rec, req)
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

func TestPostBudgetAcceptsCompactResetInterval(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"x","items":[{"creditsTotal":"1.000000","costToCreditRatio":"1","resetInterval":"1mo"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostBudgetDefaultsStartsAtToCreatedAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-default-start-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	body := `{"productKey":"` + key + `","items":[{"creditsTotal":"100.000000","costToCreditRatio":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Items []struct {
			CreatedAt     string  `json:"createdAt"`
			StartsAt      *string `json:"startsAt"`
			ResetsAt      *string `json:"resetsAt"`
			ResetInterval *string `json:"resetInterval"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("items len %d want 1", len(resp.Items))
	}
	if resp.Items[0].StartsAt == nil {
		t.Fatal("startsAt should be defaulted")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, resp.Items[0].CreatedAt)
	if err != nil {
		t.Fatal(err)
	}
	startsAt, err := time.Parse(time.RFC3339Nano, *resp.Items[0].StartsAt)
	if err != nil {
		t.Fatal(err)
	}
	if !createdAt.Equal(startsAt) {
		t.Fatalf("startsAt %s want createdAt %s", startsAt.Format(time.RFC3339Nano), createdAt.Format(time.RFC3339Nano))
	}
	if resp.Items[0].ResetsAt != nil {
		t.Fatalf("resetsAt = %v want nil", *resp.Items[0].ResetsAt)
	}
	if resp.Items[0].ResetInterval != nil {
		t.Fatalf("resetInterval = %v want nil", *resp.Items[0].ResetInterval)
	}
}

func TestCreateBudgetItemWithCompactResetInterval(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "renew-compact-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	renewVal := "3d"
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{
			CreditsTotal:    "100.000000",
			CostCreditRatio: "1.000000",
			ResetInterval:   &renewVal,
		},
	}); err != nil {
		t.Fatal(err)
	}

	// Fetch the budget and verify the reset interval was stored
	budget, err := st.GetBudget(ctx, budgetID)
	if err != nil {
		t.Fatal(err)
	}
	if len(budget.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(budget.Items))
	}
	if budget.Items[0].ResetInterval == nil {
		t.Fatalf("ResetInterval is nil, expected %q", renewVal)
	}
	if *budget.Items[0].ResetInterval != renewVal {
		t.Fatalf("ResetInterval = %q, want %q", *budget.Items[0].ResetInterval, renewVal)
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
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
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

func TestPostBudgetItemDefaultsStartsAtAndDerivesResetsAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-item-defaults-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
	}}); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items", s.postBudgetItem).Methods(http.MethodPost)

	cases := []struct {
		name         string
		body         string
		wantResetAdd func(time.Time) time.Time
	}{
		{
			name: "2w",
			body: `{"creditsTotal":"5.000000","costToCreditRatio":"1.250000","resetInterval":"2w"}`,
			wantResetAdd: func(startsAt time.Time) time.Time {
				return startsAt.AddDate(0, 0, 14)
			},
		},
		{
			name: "3d",
			body: `{"creditsTotal":"4.000000","costToCreditRatio":"2.000000","resetInterval":"3d"}`,
			wantResetAdd: func(startsAt time.Time) time.Time {
				return startsAt.AddDate(0, 0, 3)
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/budgets/"+budgetID+"/budget-items", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			if rec.Code != http.StatusCreated {
				t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
			}
			var resp struct {
				CreatedAt string  `json:"createdAt"`
				StartsAt  *string `json:"startsAt"`
				ResetsAt  *string `json:"resetsAt"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
				t.Fatal(err)
			}
			if resp.StartsAt == nil || resp.ResetsAt == nil {
				t.Fatalf("expected startsAt and resetsAt in response: %s", rec.Body.String())
			}
			createdAt, err := time.Parse(time.RFC3339Nano, resp.CreatedAt)
			if err != nil {
				t.Fatal(err)
			}
			startsAt, err := time.Parse(time.RFC3339Nano, *resp.StartsAt)
			if err != nil {
				t.Fatal(err)
			}
			resetsAt, err := time.Parse(time.RFC3339Nano, *resp.ResetsAt)
			if err != nil {
				t.Fatal(err)
			}
			if !createdAt.Equal(startsAt) {
				t.Fatalf("startsAt %s want createdAt %s", startsAt.Format(time.RFC3339Nano), createdAt.Format(time.RFC3339Nano))
			}
			wantReset := tc.wantResetAdd(startsAt)
			if !resetsAt.Equal(wantReset) {
				t.Fatalf("resetsAt %s want %s", resetsAt.Format(time.RFC3339Nano), wantReset.Format(time.RFC3339Nano))
			}
		})
	}
}

func TestBudgetSessionReportPathNotShadowedBySessionPatch(t *testing.T) {
	t.Parallel()
	var handlerName string
	r := mux.NewRouter()
	r.Methods(http.MethodPost).Path("/sessions/{sessionId}/reports").HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerName = "report"
	})
	r.Methods(http.MethodPatch).Path("/sessions/{sessionId}").HandlerFunc(func(http.ResponseWriter, *http.Request) {
		handlerName = "patch"
	})
	sid := "22222222-2222-2222-2222-222222222222"
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/sessions/"+sid+"/reports", strings.NewReader("{}"))
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
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	auth := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, auth)

	reqS1 := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
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
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+s1.SessionID+"/reports", strings.NewReader(repBody))
	reqRep.Header.Set("Content-Type", "application/json")
	recRep := httptest.NewRecorder()
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recRep.Code, recRep.Body.String())
	}

	reqS2 := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
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

func TestPatchReconciledSessionReturns409(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-rec-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	auth := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, auth)

	recS := httptest.NewRecorder()
	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
	reqS.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recS, reqS)
	if recS.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recS.Code, recS.Body.String())
	}
	var sess struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(recS.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}
	repBody := `{"reportItems":[{"budgetCost":"1","productCost":"0","label":"x"}]}`
	recRep := httptest.NewRecorder()
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sess.SessionID+"/reports", strings.NewReader(repBody))
	reqRep.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recRep.Code, recRep.Body.String())
	}

	recPatch := httptest.NewRecorder()
	reqPatch := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sess.SessionID, strings.NewReader(`{"sessionItems":[{"cost":"1","callRequestId":"late-req"}]}`))
	reqPatch.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPatch, reqPatch)
	if recPatch.Code != http.StatusConflict {
		t.Fatalf("patch after reconcile: %d %s", recPatch.Code, recPatch.Body.String())
	}
	var errBody struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recPatch.Body.Bytes(), &errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Code != "CONFLICT" || errBody.Error != "session already reconciled" {
		t.Fatalf("got %#v want CONFLICT / session already reconciled", errBody)
	}
}

func TestPatchConcurrentSessionsEventuallySucceed(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-concurrent-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "1000.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	a := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, a)

	// Create multiple sessions.
	const n = 5
	sessionIDs := make([]string, n)
	for i := range sessionIDs {
		recS := httptest.NewRecorder()
		reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
		reqS.Header.Set("Content-Type", "application/json")
		h.ServeHTTP(recS, reqS)
		if recS.Code != http.StatusCreated {
			t.Fatalf("post session %d: %d %s", i, recS.Code, recS.Body.String())
		}
		var sess struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(recS.Body.Bytes(), &sess); err != nil {
			t.Fatal(err)
		}
		sessionIDs[i] = sess.SessionID
	}

	// Race concurrent PATCHes against different sessions (same budget).
	var wg sync.WaitGroup
	codes := make([]int, n)
	wg.Add(n)
	for i := range sessionIDs {
		go func(idx int) {
			defer wg.Done()
			body := fmt.Sprintf(`{"sessionItems":[{"cost":"1","callRequestId":"race-%d"}]}`, idx)
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionIDs[idx], strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req = req.WithContext(ctx)
			h.ServeHTTP(rec, req)
			codes[idx] = rec.Code
		}(i)
	}
	wg.Wait()

	var ok, conflict int
	for _, code := range codes {
		switch code {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
			conflict++
		default:
			t.Fatalf("unexpected status %d", code)
		}
	}
	t.Logf("concurrent PATCH results: %d OK, %d 409 Conflict", ok, conflict)
	if ok == 0 {
		t.Fatal("expected at least one successful PATCH")
	}
}

func TestPatchNonexistentSessionReturns404(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-missing-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	auth := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, auth)

	fakeSessionID := uuid.NewString()
	recPatch := httptest.NewRecorder()
	reqPatch := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+fakeSessionID, strings.NewReader(`{"sessionItems":[{"cost":"1","callRequestId":"req"}]}`))
	reqPatch.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPatch, reqPatch)
	if recPatch.Code != http.StatusNotFound {
		t.Fatalf("patch missing session: %d %s", recPatch.Code, recPatch.Body.String())
	}
	var errBody struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recPatch.Body.Bytes(), &errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Code != "NOT_FOUND" || errBody.Error != "resource not found" {
		t.Fatalf("got %#v want NOT_FOUND / resource not found", errBody)
	}
}

func TestPatchSessionDuplicateCallRequestID(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "dup-call-req-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	auth := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, auth)

	recS := httptest.NewRecorder()
	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
	reqS.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recS, reqS)
	if recS.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recS.Code, recS.Body.String())
	}
	var sess struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(recS.Body.Bytes(), &sess); err != nil {
		t.Fatal(err)
	}

	recDupInBody := httptest.NewRecorder()
	reqDupInBody := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sess.SessionID, strings.NewReader(
		`{"sessionItems":[{"cost":"1","callRequestId":"same"},{"cost":"1","callRequestId":"same"}]}`,
	))
	reqDupInBody.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recDupInBody, reqDupInBody)
	if recDupInBody.Code != http.StatusBadRequest {
		t.Fatalf("duplicate in body: %d %s", recDupInBody.Code, recDupInBody.Body.String())
	}
	var dupInBodyErr struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recDupInBody.Body.Bytes(), &dupInBodyErr); err != nil {
		t.Fatal(err)
	}
	if dupInBodyErr.Code != "DUPLICATE_CALL_REQUEST_ID" || dupInBodyErr.Error != "duplicate callRequestId in sessionItems" {
		t.Fatalf("duplicate in body: got %#v body=%s", dupInBodyErr, recDupInBody.Body.String())
	}

	recFirst := httptest.NewRecorder()
	reqFirst := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sess.SessionID, strings.NewReader(
		`{"sessionItems":[{"cost":"1","callRequestId":"idempotent-req"}]}`,
	))
	reqFirst.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recFirst, reqFirst)
	if recFirst.Code != http.StatusOK {
		t.Fatalf("first patch: %d %s", recFirst.Code, recFirst.Body.String())
	}

	recSecond := httptest.NewRecorder()
	reqSecond := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sess.SessionID, strings.NewReader(
		`{"sessionItems":[{"cost":"1","callRequestId":"idempotent-req"}]}`,
	))
	reqSecond.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recSecond, reqSecond)
	if recSecond.Code != http.StatusBadRequest {
		t.Fatalf("reuse callRequestId: %d %s", recSecond.Code, recSecond.Body.String())
	}
	var errBody struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recSecond.Body.Bytes(), &errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Code != "DUPLICATE_CALL_REQUEST_ID" || errBody.Error != "callRequestId already used for this session" {
		t.Fatalf("got %#v want DUPLICATE_CALL_REQUEST_ID", errBody)
	}
}

func TestGoCodeSpendMathOverHTTP(t *testing.T) {
	st := testStore(t)
	auth := auth.NewMiddleware("none", nil, nil)
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

	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`","metadata":{"run":"integration"}}`))
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
	reqSp := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID, strings.NewReader(patchBody))
	reqSp.Header.Set("Content-Type", "application/json")
	recSp := httptest.NewRecorder()
	h.ServeHTTP(recSp, reqSp)
	if recSp.Code != http.StatusOK {
		t.Fatalf("patch session: %d %s", recSp.Code, recSp.Body.String())
	}

	reqG := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"?debug=1", nil)
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
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
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

	reqGR := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/reports/"+reportResp.ReportID, nil)
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
	if rep["reportItems"].([]any)[0].(map[string]any)["label"].(string) != "usage" {
		t.Fatalf("report label")
	}

	reqGS404 := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID, nil)
	recGS404 := httptest.NewRecorder()
	h.ServeHTTP(recGS404, reqGS404)
	if recGS404.Code != http.StatusNotFound {
		t.Fatalf("get session after report: status %d want 404, body %s", recGS404.Code, recGS404.Body.String())
	}
}

func TestPatchSessionPartialCreditsReportRejectsExcessBudgetCost(t *testing.T) {
	st := testStore(t)
	auth := auth.NewMiddleware("none", nil, nil)
	srv := &Server{Store: st}
	h := NewRouter(srv, auth)

	prodBody := `{"productKey":"patch-partial-` + uuid.NewString() + `"}`
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
	budgetBody := `{"productKey":"` + prodResp.ProductKey + `","items":[{"creditsTotal":"5.000000","costToCreditRatio":"1"}]}`
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

	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetResp.BudgetID+`"}`))
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

	patchBody := `{"sessionItems":[{"cost":"10","callRequestId":"partial-req-1"}]}`
	reqPatch := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID, strings.NewReader(patchBody))
	reqPatch.Header.Set("Content-Type", "application/json")
	recPatch := httptest.NewRecorder()
	h.ServeHTTP(recPatch, reqPatch)
	if recPatch.Code != http.StatusOK {
		t.Fatalf("patch session want 200, got %d %s", recPatch.Code, recPatch.Body.String())
	}

	reqGet := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"?debug=1", nil)
	recGet := httptest.NewRecorder()
	h.ServeHTTP(recGet, reqGet)
	if recGet.Code != http.StatusOK {
		t.Fatalf("get session: %d %s", recGet.Code, recGet.Body.String())
	}
	dec := json.NewDecoder(strings.NewReader(recGet.Body.String()))
	dec.UseNumber()
	var sess map[string]any
	if err := dec.Decode(&sess); err != nil {
		t.Fatal(err)
	}
	ct, ok := sess["costTotal"].(json.Number)
	if !ok || ct.String() != "10.000000" {
		t.Fatalf("costTotal want 10.000000, got %v (%T)", sess["costTotal"], sess["costTotal"])
	}
	itemsRaw, ok := sess["sessionItems"].([]any)
	if !ok || len(itemsRaw) == 0 {
		t.Fatalf("sessionItems: want non-empty array, got %#v", sess["sessionItems"])
	}
	line0, ok := itemsRaw[0].(map[string]any)
	if !ok {
		t.Fatalf("sessionItems[0]: want object")
	}
	costN, ok := line0["cost"].(json.Number)
	if !ok || costN.String() != "10.000000" {
		t.Fatalf("cost want 10.000000, got %v (%T)", line0["cost"], line0["cost"])
	}
	dbgRaw, ok := sess["debug"]
	if !ok || dbgRaw == nil {
		t.Fatal("expected debug with ?debug=1")
	}
	dbg, ok := dbgRaw.(map[string]any)
	if !ok {
		t.Fatalf("debug: want object, got %T", dbgRaw)
	}
	dbgItemsRaw, ok := dbg["sessionItems"].([]any)
	if !ok || len(dbgItemsRaw) == 0 {
		t.Fatalf("debug.sessionItems: want non-empty array")
	}
	dbgLine0, ok := dbgItemsRaw[0].(map[string]any)
	if !ok {
		t.Fatalf("debug.sessionItems[0]: want object")
	}
	stored, ok := dbgLine0["creditsChargedStored"].(string)
	if !ok {
		t.Fatalf("creditsChargedStored: want string, got %T", dbgLine0["creditsChargedStored"])
	}
	replayed, ok := dbgLine0["creditsChargedReplayed"].(string)
	if !ok {
		t.Fatalf("creditsChargedReplayed: want string, got %T", dbgLine0["creditsChargedReplayed"])
	}
	if stored != "5.000000" || replayed != "5.000000" {
		t.Fatalf("creditsChargedStored %q creditsChargedReplayed %q want 5.000000", stored, replayed)
	}

	repFail := `{"reportItems":[{"budgetCost":"10","productCost":"0","label":"usage"}]}`
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repFail))
	reqRep.Header.Set("Content-Type", "application/json")
	recRep := httptest.NewRecorder()
	h.ServeHTTP(recRep, reqRep)
	if recRep.Code != http.StatusBadRequest {
		t.Fatalf("post report excess budgetCost: %d %s", recRep.Code, recRep.Body.String())
	}
	var errBody struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recRep.Body.Bytes(), &errBody); err != nil {
		t.Fatal(err)
	}
	if errBody.Code != "INSUFFICIENT_CREDITS" {
		t.Fatalf("code %q want INSUFFICIENT_CREDITS", errBody.Code)
	}
	if !strings.Contains(errBody.Error, "overages") {
		t.Fatalf("error should mention overages: %q", errBody.Error)
	}

	repOK := `{"reportItems":[{"budgetCost":"5","productCost":"5","label":"overages"}]}`
	reqOK := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repOK))
	reqOK.Header.Set("Content-Type", "application/json")
	recOK := httptest.NewRecorder()
	h.ServeHTTP(recOK, reqOK)
	if recOK.Code != http.StatusCreated {
		t.Fatalf("post report ok: %d %s", recOK.Code, recOK.Body.String())
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
		{CreditsTotal: "100.000000", CostCreditRatio: "0.066666"},
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
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM budget_items_history WHERE budget_item_id = $1`, itemID).Scan(&revCount); err != nil {
		t.Fatal(err)
	}
	if revCount != 1 {
		t.Fatalf("budget_items_history count %d want 1", revCount)
	}
}

func TestBudgetItemLabelCreatePatchOmitPreservesClear(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "label-roundtrip-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{}); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items", s.postBudgetItem).Methods(http.MethodPost)
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.getBudgetItem).Methods(http.MethodGet)
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)

	postReq := httptest.NewRequest(http.MethodPost, "/budgets/"+budgetID+"/budget-items", strings.NewReader(
		`{"creditsTotal":"100.000000","costToCreditRatio":"1","label":"line-a"}`,
	))
	postReq.Header.Set("Content-Type", "application/json")
	postRec := httptest.NewRecorder()
	r.ServeHTTP(postRec, postReq)
	if postRec.Code != http.StatusCreated {
		t.Fatalf("post item: %d %s", postRec.Code, postRec.Body.String())
	}
	var postOut map[string]any
	if err := json.Unmarshal(postRec.Body.Bytes(), &postOut); err != nil {
		t.Fatal(err)
	}
	itemID, _ := postOut["budgetItemId"].(string)
	if itemID == "" {
		t.Fatal("missing budgetItemId")
	}
	if got, ok := postOut["label"].(string); !ok || got != "line-a" {
		t.Fatalf("post label %v want line-a", postOut["label"])
	}

	getReq := httptest.NewRequest(http.MethodGet, "/budgets/"+budgetID+"/budget-items/"+itemID, nil)
	getRec := httptest.NewRecorder()
	r.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get item: %d %s", getRec.Code, getRec.Body.String())
	}
	var getOut map[string]any
	if err := json.Unmarshal(getRec.Body.Bytes(), &getOut); err != nil {
		t.Fatal(err)
	}
	if getOut["label"].(string) != "line-a" {
		t.Fatalf("get label %v want line-a", getOut["label"])
	}

	patchKeep := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(
		`{"creditsTotal":"90.000000"}`,
	))
	patchKeep.Header.Set("Content-Type", "application/json")
	patchRec := httptest.NewRecorder()
	r.ServeHTTP(patchRec, patchKeep)
	if patchRec.Code != http.StatusOK {
		t.Fatalf("patch omit label: %d %s", patchRec.Code, patchRec.Body.String())
	}
	var patchKeepOut map[string]any
	if err := json.Unmarshal(patchRec.Body.Bytes(), &patchKeepOut); err != nil {
		t.Fatal(err)
	}
	if patchKeepOut["label"].(string) != "line-a" {
		t.Fatalf("patch omit label preserved: got %v", patchKeepOut["label"])
	}

	patchNull := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(
		`{"label":null}`,
	))
	patchNull.Header.Set("Content-Type", "application/json")
	patchNullRec := httptest.NewRecorder()
	r.ServeHTTP(patchNullRec, patchNull)
	if patchNullRec.Code != http.StatusOK {
		t.Fatalf("patch null label: %d %s", patchNullRec.Code, patchNullRec.Body.String())
	}
	var patchNullOut map[string]any
	if err := json.Unmarshal(patchNullRec.Body.Bytes(), &patchNullOut); err != nil {
		t.Fatal(err)
	}
	if patchNullOut["label"] != nil {
		t.Fatalf("patch null label: got %v want nil", patchNullOut["label"])
	}
	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Label != nil {
		t.Fatalf("stored label after clear: %v want nil", row.Label)
	}
}

func TestBudgetItemBodyToItemInputAllowsMissingCostToCreditRatioOnUpdate(t *testing.T) {
	body := budgetItemBody{CreditsTotal: "10.000000"}
	row, msg := body.toItemInput(false)
	if msg != "" {
		t.Fatalf("unexpected validation message: %s", msg)
	}
	if row.CreditsTotal != "10.000000" {
		t.Fatalf("creditsTotal %q want %q", row.CreditsTotal, "10.000000")
	}
	if row.CostCreditRatio != "" {
		t.Fatalf("costCreditRatio %q want empty", row.CostCreditRatio)
	}
}

func TestPatchBudgetItemToPutItemInputAllowsMissingCostToCreditRatioOnUpdate(t *testing.T) {
	body := patchBudgetItem{CreditsTotal: "10.000000"}
	row, msg := body.toPutItemInput(false)
	if msg != "" {
		t.Fatalf("unexpected validation message: %s", msg)
	}
	if row.CreditsTotal != "10.000000" {
		t.Fatalf("creditsTotal %q want %q", row.CreditsTotal, "10.000000")
	}
	if row.CostCreditRatio != "" {
		t.Fatalf("costCreditRatio %q want empty", row.CostCreditRatio)
	}
}

func TestPatchBudgetItemKeepsExistingCostToCreditRatioWhenOmitted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-item-keep-ratio-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.066666",
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(`{"creditsTotal":"120.000000"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch item: %d %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if got := body["creditsTotal"].(string); got != "120.000000" {
		t.Fatalf("creditsTotal %q want %q", got, "120.000000")
	}
	if got := body["costToCreditRatio"].(string); got != "0.066666" {
		t.Fatalf("costToCreditRatio %q want %q", got, "0.066666")
	}
	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.CostCreditRatio != "0.066666" {
		t.Fatalf("stored costCreditRatio %q want %q", row.CostCreditRatio, "0.066666")
	}
}

func TestPatchBudgetExistingItemKeepsExistingCostToCreditRatioWhenOmitted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-budget-keep-ratio-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.066666",
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"111.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch budget: %d %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Items []struct {
			BudgetItemID      string `json:"budgetItemId"`
			CreditsTotal      string `json:"creditsTotal"`
			CostToCreditRatio string `json:"costToCreditRatio"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("items len %d want 1", len(resp.Items))
	}
	if resp.Items[0].BudgetItemID != itemID {
		t.Fatalf("budgetItemId %q want %q", resp.Items[0].BudgetItemID, itemID)
	}
	if resp.Items[0].CreditsTotal != "111.000000" {
		t.Fatalf("creditsTotal %q want %q", resp.Items[0].CreditsTotal, "111.000000")
	}
	if resp.Items[0].CostToCreditRatio != "0.066666" {
		t.Fatalf("costToCreditRatio %q want %q", resp.Items[0].CostToCreditRatio, "0.066666")
	}
	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.CostCreditRatio != "0.066666" {
		t.Fatalf("stored costCreditRatio %q want %q", row.CostCreditRatio, "0.066666")
	}
}

func TestPatchBudgetItemKeepsExistingDateFieldsWhenOmitted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-item-keep-dates-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	expiresAt := "2031-01-01T00:00:00Z"
	startsAt := "2030-01-01T00:00:00Z"
	resetsAt := "2030-02-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ExpiresAt:       &expiresAt,
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &resetInterval,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(`{"creditsTotal":"120.000000"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch item: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ExpiresAt == nil || row.ExpiresAt.UTC().Format(time.RFC3339) != expiresAt {
		t.Fatalf("expiresAt got %v want %s", row.ExpiresAt, expiresAt)
	}
	if row.StartsAt == nil || row.StartsAt.UTC().Format(time.RFC3339) != startsAt {
		t.Fatalf("startsAt got %v want %s", row.StartsAt, startsAt)
	}
	if row.ResetsAt == nil || row.ResetsAt.UTC().Format(time.RFC3339) != resetsAt {
		t.Fatalf("resetsAt got %v want %s", row.ResetsAt, resetsAt)
	}
	if row.ResetInterval == nil || *row.ResetInterval != resetInterval {
		t.Fatalf("resetInterval got %v want %s", row.ResetInterval, resetInterval)
	}
}

func TestPatchBudgetExistingItemKeepsExistingDateFieldsWhenOmitted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-budget-keep-dates-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	expiresAt := "2031-01-01T00:00:00Z"
	startsAt := "2030-01-01T00:00:00Z"
	resetsAt := "2030-02-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ExpiresAt:       &expiresAt,
		StartsAt:        &startsAt,
		ResetsAt:        &resetsAt,
		ResetInterval:   &resetInterval,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"111.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch budget: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ExpiresAt == nil || row.ExpiresAt.UTC().Format(time.RFC3339) != expiresAt {
		t.Fatalf("expiresAt got %v want %s", row.ExpiresAt, expiresAt)
	}
	if row.StartsAt == nil || row.StartsAt.UTC().Format(time.RFC3339) != startsAt {
		t.Fatalf("startsAt got %v want %s", row.StartsAt, startsAt)
	}
	if row.ResetsAt == nil || row.ResetsAt.UTC().Format(time.RFC3339) != resetsAt {
		t.Fatalf("resetsAt got %v want %s", row.ResetsAt, resetsAt)
	}
	if row.ResetInterval == nil || *row.ResetInterval != resetInterval {
		t.Fatalf("resetInterval got %v want %s", row.ResetInterval, resetInterval)
	}
}

func TestPatchBudgetItemExplicitNullClearsField(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-item-clear-null-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	expiresAt := "2031-01-01T00:00:00Z"
	startsAt := "2030-01-01T00:00:00Z"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ExpiresAt:       &expiresAt,
		StartsAt:        &startsAt,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(`{"creditsTotal":"120.000000","expiresAt":null}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch item: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ExpiresAt != nil {
		t.Fatalf("expiresAt got %v want nil", row.ExpiresAt)
	}
	if row.StartsAt == nil || row.StartsAt.UTC().Format(time.RFC3339) != startsAt {
		t.Fatalf("startsAt got %v want %s", row.StartsAt, startsAt)
	}
}

func TestPatchBudgetExistingItemExplicitNullClearsField(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-budget-clear-null-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	expiresAt := "2031-01-01T00:00:00Z"
	startsAt := "2030-01-01T00:00:00Z"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ExpiresAt:       &expiresAt,
		StartsAt:        &startsAt,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"111.000000","expiresAt":null}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch budget: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ExpiresAt != nil {
		t.Fatalf("expiresAt got %v want nil", row.ExpiresAt)
	}
	if row.StartsAt == nil || row.StartsAt.UTC().Format(time.RFC3339) != startsAt {
		t.Fatalf("startsAt got %v want %s", row.StartsAt, startsAt)
	}
}

func TestPatchBudgetRejectsItemWithoutBudgetItemId(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	body := `{"items":[{"creditsTotal":"4.000000","costToCreditRatio":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	b := rec.Body.String()
	if !strings.Contains(b, "budgetItemId") || !strings.Contains(b, "budget-items") {
		t.Fatalf("expected budgetItemId and budget-items in error, got %s", b)
	}
}

func TestPatchBudgetRejectsInvalidBudgetItemIdUUID(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	body := `{"items":[{"budgetItemId":"not-a-uuid","creditsTotal":"4.000000","costToCreditRatio":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "budgetItemId must be a valid UUID") {
		t.Fatalf("expected UUID validation error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetUnknownBudgetItemIdReturns404(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-budget-unknown-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
	}}); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	unknownItemID := uuid.NewString()
	body := `{"items":[{"budgetItemId":"` + unknownItemID + `","creditsTotal":"10.000000","costToCreditRatio":"1.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostBudgetItemRejectsResetsAtWithoutResetInterval(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items", s.postBudgetItem).Methods(http.MethodPost)
	budgetID := uuid.NewString()
	body := `{"creditsTotal":"4.000000","costToCreditRatio":"1.000000","resetsAt":"2030-01-01T00:00:00Z"}`
	req := httptest.NewRequest(http.MethodPost, "/budgets/"+budgetID+"/budget-items", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "resetsAt requires resetInterval") {
		t.Fatalf("expected clear error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetItemRejectsResetIntervalWithoutResetsAt(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	body := `{"creditsTotal":"4.000000","costToCreditRatio":"1.000000","resetInterval":"1mo"}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "resetInterval requires resetsAt when updating") {
		t.Fatalf("expected clear error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetUpdateExistingItemRejectsResetIntervalWithoutResetsAt(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"4.000000","costToCreditRatio":"1.000000","resetInterval":"1mo"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "resetInterval requires resetsAt when updating") {
		t.Fatalf("expected clear error, got %s", rec.Body.String())
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
		{CreditsTotal: "77.000000", CostCreditRatio: "0.066666"},
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
		t.Fatalf("get item: %d, body: %s", rec.Code, rec.Body.String())
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
	auth := auth.NewMiddleware("none", nil, nil)
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
		`{"creditsTotal":"1000.000000","costToCreditRatio":"0.5","resetInterval":"1mo","expiresAt":"2030-12-31T23:59:59Z"},` +
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

	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
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
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
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

	reqGR := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/reports/"+reportResp.ReportID, nil)
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

func TestWriteEndpointsReturnCanonicalGetPayloads(t *testing.T) {
	st := testStore(t)
	auth := auth.NewMiddleware("none", nil, nil)
	h := NewRouter(&Server{Store: st}, auth)

	productKey := "parity-" + uuid.NewString()
	if _, err := st.CreateProduct(context.Background(), productKey); err != nil {
		t.Fatal(err)
	}

	postBudgetBody := fmt.Sprintf(`{"productKey":%q,"items":[{"creditsTotal":"10.000000","costToCreditRatio":"1.000000"}]}`, productKey)
	recPostBudget := httptest.NewRecorder()
	reqPostBudget := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(postBudgetBody))
	reqPostBudget.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPostBudget, reqPostBudget)
	if recPostBudget.Code != http.StatusCreated {
		t.Fatalf("post budget: %d %s", recPostBudget.Code, recPostBudget.Body.String())
	}
	postBudgetResp := decodeJSONMapUseNumber(t, recPostBudget.Body.String())
	budgetID, _ := postBudgetResp["budgetId"].(string)

	recGetBudget := httptest.NewRecorder()
	reqGetBudget := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID, nil)
	h.ServeHTTP(recGetBudget, reqGetBudget)
	if recGetBudget.Code != http.StatusOK {
		t.Fatalf("get budget: %d %s", recGetBudget.Code, recGetBudget.Body.String())
	}
	getBudgetResp := decodeJSONMapUseNumber(t, recGetBudget.Body.String())
	assertJSONMapEqual(t, "post budget vs get budget", postBudgetResp, getBudgetResp)

	itemID := getBudgetResp["items"].([]any)[0].(map[string]any)["budgetItemId"].(string)
	patchBudgetBody := fmt.Sprintf(`{"items":[{"budgetItemId":%q,"creditsTotal":"11.000000","costToCreditRatio":"1.000000"}]}`, itemID)
	recPatchBudget := httptest.NewRecorder()
	reqPatchBudget := httptest.NewRequest(http.MethodPatch, "/api/v1/budgets/"+budgetID, strings.NewReader(patchBudgetBody))
	reqPatchBudget.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPatchBudget, reqPatchBudget)
	if recPatchBudget.Code != http.StatusOK {
		t.Fatalf("patch budget: %d %s", recPatchBudget.Code, recPatchBudget.Body.String())
	}
	patchBudgetResp := decodeJSONMapUseNumber(t, recPatchBudget.Body.String())

	recGetBudget2 := httptest.NewRecorder()
	reqGetBudget2 := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID, nil)
	h.ServeHTTP(recGetBudget2, reqGetBudget2)
	if recGetBudget2.Code != http.StatusOK {
		t.Fatalf("get budget after patch: %d %s", recGetBudget2.Code, recGetBudget2.Body.String())
	}
	getBudgetResp2 := decodeJSONMapUseNumber(t, recGetBudget2.Body.String())
	assertJSONMapEqual(t, "patch budget vs get budget", patchBudgetResp, getBudgetResp2)

	recPostItem := httptest.NewRecorder()
	reqPostItem := httptest.NewRequest(http.MethodPost, "/api/v1/budgets/"+budgetID+"/budget-items", strings.NewReader(`{"creditsTotal":"5.000000","costToCreditRatio":"1.500000"}`))
	reqPostItem.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPostItem, reqPostItem)
	if recPostItem.Code != http.StatusCreated {
		t.Fatalf("post budget item: %d %s", recPostItem.Code, recPostItem.Body.String())
	}
	postItemResp := decodeJSONMapUseNumber(t, recPostItem.Body.String())
	itemID2 := postItemResp["budgetItemId"].(string)

	recGetItem := httptest.NewRecorder()
	reqGetItem := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/budget-items/"+itemID2, nil)
	h.ServeHTTP(recGetItem, reqGetItem)
	if recGetItem.Code != http.StatusOK {
		t.Fatalf("get budget item: %d %s", recGetItem.Code, recGetItem.Body.String())
	}
	getItemResp := decodeJSONMapUseNumber(t, recGetItem.Body.String())
	assertJSONMapEqual(t, "post budget item vs get budget item", postItemResp, getItemResp)

	recPatchItem := httptest.NewRecorder()
	reqPatchItem := httptest.NewRequest(http.MethodPatch, "/api/v1/budgets/"+budgetID+"/budget-items/"+itemID2, strings.NewReader(`{"creditsTotal":"6.000000","costToCreditRatio":"1.250000"}`))
	reqPatchItem.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPatchItem, reqPatchItem)
	if recPatchItem.Code != http.StatusOK {
		t.Fatalf("patch budget item: %d %s", recPatchItem.Code, recPatchItem.Body.String())
	}
	patchItemResp := decodeJSONMapUseNumber(t, recPatchItem.Body.String())

	recGetItem2 := httptest.NewRecorder()
	reqGetItem2 := httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+budgetID+"/budget-items/"+itemID2, nil)
	h.ServeHTTP(recGetItem2, reqGetItem2)
	if recGetItem2.Code != http.StatusOK {
		t.Fatalf("get budget item after patch: %d %s", recGetItem2.Code, recGetItem2.Body.String())
	}
	getItemResp2 := decodeJSONMapUseNumber(t, recGetItem2.Body.String())
	assertJSONMapEqual(t, "patch budget item vs get budget item", patchItemResp, getItemResp2)

	recPostSession := httptest.NewRecorder()
	reqPostSession := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`","metadata":{"source":"parity"}}`))
	reqPostSession.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPostSession, reqPostSession)
	if recPostSession.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recPostSession.Code, recPostSession.Body.String())
	}
	postSessionResp := decodeJSONMapUseNumber(t, recPostSession.Body.String())
	sessionID := postSessionResp["sessionId"].(string)

	recGetSession := httptest.NewRecorder()
	reqGetSession := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID, nil)
	h.ServeHTTP(recGetSession, reqGetSession)
	if recGetSession.Code != http.StatusOK {
		t.Fatalf("get session: %d %s", recGetSession.Code, recGetSession.Body.String())
	}
	getSessionResp := decodeJSONMapUseNumber(t, recGetSession.Body.String())
	assertJSONMapEqual(t, "post session vs get session", postSessionResp, getSessionResp)

	recPatchSession := httptest.NewRecorder()
	reqPatchSession := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID, strings.NewReader(`{"sessionItems":[{"cost":2,"callRequestId":"parity-req-1"}]}`))
	reqPatchSession.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPatchSession, reqPatchSession)
	if recPatchSession.Code != http.StatusOK {
		t.Fatalf("patch session: %d %s", recPatchSession.Code, recPatchSession.Body.String())
	}
	patchSessionResp := decodeJSONMapUseNumber(t, recPatchSession.Body.String())

	recGetSession2 := httptest.NewRecorder()
	reqGetSession2 := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID, nil)
	h.ServeHTTP(recGetSession2, reqGetSession2)
	if recGetSession2.Code != http.StatusOK {
		t.Fatalf("get session after patch: %d %s", recGetSession2.Code, recGetSession2.Body.String())
	}
	getSessionResp2 := decodeJSONMapUseNumber(t, recGetSession2.Body.String())
	assertJSONMapEqual(t, "patch session vs get session", patchSessionResp, getSessionResp2)

	recPostReport := httptest.NewRecorder()
	reqPostReport := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(`{"reportItems":[{"budgetCost":"1.500000","productCost":"1.000000","label":"parity"}]}`))
	reqPostReport.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(recPostReport, reqPostReport)
	if recPostReport.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recPostReport.Code, recPostReport.Body.String())
	}
	postReportResp := decodeJSONMapUseNumber(t, recPostReport.Body.String())
	reportID := postReportResp["reportId"].(string)

	recGetReport := httptest.NewRecorder()
	reqGetReport := httptest.NewRequest(http.MethodGet, "/api/v1/sessions/"+sessionID+"/reports/"+reportID, nil)
	h.ServeHTTP(recGetReport, reqGetReport)
	if recGetReport.Code != http.StatusOK {
		t.Fatalf("get report: %d %s", recGetReport.Code, recGetReport.Body.String())
	}
	getReportResp := decodeJSONMapUseNumber(t, recGetReport.Body.String())
	assertJSONMapEqual(t, "post report vs get report", postReportResp, getReportResp)
}

func TestPatchBudgetItemRejectsUnknownField(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	body := `{"creditsTotal":"10","unknownField":"x"}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `unknown field`) {
		t.Fatalf("expected unknown field error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetRejectsUnknownFieldInItem(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"10","unknownField":"x"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `unknown field`) {
		t.Fatalf("expected unknown field error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetItemClearResetIntervalAlsoClearsResetsAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-clear-interval-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	resetsAt := "2030-02-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ResetsAt:        &resetsAt,
		ResetInterval:   &resetInterval,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	// Explicitly set resetInterval to null — should also clear resetsAt
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(`{"resetInterval":null}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch item: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ResetInterval != nil {
		t.Fatalf("resetInterval got %v want nil", row.ResetInterval)
	}
	if row.ResetsAt != nil {
		t.Fatalf("resetsAt got %v want nil (should be cleared when resetInterval is cleared)", row.ResetsAt)
	}
}

func TestPatchBudgetExistingItemClearResetIntervalAlsoClearsResetsAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "patch-budget-clear-interval-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	resetsAt := "2030-02-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "100.000000",
		CostCreditRatio: "0.500000",
		ResetsAt:        &resetsAt,
		ResetInterval:   &resetInterval,
	}}); err != nil {
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
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	// Explicitly set resetInterval to null via PATCH /budgets — should also clear resetsAt
	body := `{"items":[{"budgetItemId":"` + itemID + `","resetInterval":null}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("patch budget: %d %s", rec.Code, rec.Body.String())
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ResetInterval != nil {
		t.Fatalf("resetInterval got %v want nil", row.ResetInterval)
	}
	if row.ResetsAt != nil {
		t.Fatalf("resetsAt got %v want nil (should be cleared when resetInterval is cleared)", row.ResetsAt)
	}
}

func TestPostBudgetWithCreditsUsed(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-credits-used-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	body := `{"productKey":"` + key + `","items":[{"creditsTotal":"100.000000","creditsUsed":"50.000000","costToCreditRatio":"1"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		BudgetID string `json:"budgetId"`
		Items    []struct {
			BudgetItemID string `json:"budgetItemId"`
			CreditsTotal string `json:"creditsTotal"`
			CreditsUsed  string `json:"creditsUsed"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("items len %d want 1", len(resp.Items))
	}
	if resp.Items[0].CreditsUsed != "50.000000" {
		t.Fatalf("creditsUsed %q want %q", resp.Items[0].CreditsUsed, "50.000000")
	}

	// Verify the ledger entry was created
	db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	var entryKind string
	var creditsDelta string
	if err := db.QueryRowContext(ctx, `
		SELECT entry_kind, credits_delta::text FROM budget_item_credit_ledger
		WHERE budget_item_id = $1
	`, resp.Items[0].BudgetItemID).Scan(&entryKind, &creditsDelta); err != nil {
		t.Fatal(err)
	}
	if entryKind != "initial_spend" {
		t.Fatalf("entry_kind %q want %q", entryKind, "initial_spend")
	}
	if creditsDelta != "50.000000" {
		t.Fatalf("credits_delta %q want %q", creditsDelta, "50.000000")
	}
}

func TestPostBudgetItemWithCreditsUsed(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "item-credits-used-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, key, []store.ItemInput{{
		CreditsTotal:    "10.000000",
		CostCreditRatio: "1.000000",
	}}); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items", s.postBudgetItem).Methods(http.MethodPost)
	req := httptest.NewRequest(http.MethodPost, "/budgets/"+budgetID+"/budget-items", strings.NewReader(`{"creditsTotal":"200.000000","creditsUsed":"75.500000","costToCreditRatio":"0.5"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		BudgetItemID string `json:"budgetItemId"`
		CreditsUsed  string `json:"creditsUsed"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp.CreditsUsed != "75.500000" {
		t.Fatalf("creditsUsed %q want %q", resp.CreditsUsed, "75.500000")
	}
}

func TestPostBudgetCreditsUsedCannotExceedCreditsTotal(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"x","items":[{"creditsTotal":"100.000000","creditsUsed":"150.000000","costToCreditRatio":"1"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "creditsUsed cannot exceed creditsTotal") {
		t.Fatalf("expected clear error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetItemRejectsCreditsUsed(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}/budget-items/{budgetItemId}", s.patchBudgetItem).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	body := `{"creditsTotal":"100.000000","creditsUsed":"50.000000"}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID+"/budget-items/"+itemID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	// creditsUsed is only valid when creating a budget item, not when updating
	if !strings.Contains(rec.Body.String(), "creditsUsed can only be set when creating") {
		t.Fatalf("expected creditsUsed create-only error, got %s", rec.Body.String())
	}
}

func TestPatchBudgetExistingItemRejectsCreditsUsed(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/budgets/{budgetId}", s.patchBudget).Methods(http.MethodPatch)
	budgetID := uuid.NewString()
	itemID := uuid.NewString()
	// Update an existing item (budgetItemId set) with creditsUsed — should be rejected
	body := `{"items":[{"budgetItemId":"` + itemID + `","creditsTotal":"100.000000","creditsUsed":"50.000000"}]}`
	req := httptest.NewRequest(http.MethodPatch, "/budgets/"+budgetID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "creditsUsed can only be set when creating") {
		t.Fatalf("expected creditsUsed create-only error, got %s", rec.Body.String())
	}
}

func TestPostBudgetCreditsUsedEqualsCreditsTotal(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-credits-used-equal-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	// creditsUsed == creditsTotal should be allowed (boundary case)
	body := `{"productKey":"` + key + `","items":[{"creditsTotal":"100.000000","creditsUsed":"100.000000","costToCreditRatio":"1"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Items []struct {
			CreditsTotal string `json:"creditsTotal"`
			CreditsUsed  string `json:"creditsUsed"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("items len %d want 1", len(resp.Items))
	}
	if resp.Items[0].CreditsUsed != "100.000000" {
		t.Fatalf("creditsUsed %q want %q", resp.Items[0].CreditsUsed, "100.000000")
	}
}

func TestPostBudgetCreditsUsedZeroSkipsLedger(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "budget-credits-used-zero-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	// creditsUsed = 0 should be accepted but no ledger entry created
	body := `{"productKey":"` + key + `","items":[{"creditsTotal":"100.000000","creditsUsed":"0.000000","costToCreditRatio":"1"}]}`
	req := httptest.NewRequest(http.MethodPost, "/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postBudget(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Items []struct {
			BudgetItemID string `json:"budgetItemId"`
			CreditsUsed  string `json:"creditsUsed"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if len(resp.Items) != 1 {
		t.Fatalf("items len %d want 1", len(resp.Items))
	}
	if resp.Items[0].CreditsUsed != "0.000000" {
		t.Fatalf("creditsUsed %q want %q", resp.Items[0].CreditsUsed, "0.000000")
	}

	// Verify no ledger entry was created (zero is a no-op)
	db, err := sql.Open("postgres", os.Getenv("TEST_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	var count int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM budget_item_credit_ledger
		WHERE budget_item_id = $1
	`, resp.Items[0].BudgetItemID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("ledger entry count %d want 0 (zero creditsUsed should skip ledger)", count)
	}
}

func TestListReportsBySessionIdProductKeyBudgetId(t *testing.T) {
	st := testStore(t)
	h := NewRouter(&Server{Store: st}, auth.NewMiddleware("none", nil, nil))
	prodBody := `{"productKey":"list-rep-` + uuid.NewString() + `"}`
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
	pk := prodResp.ProductKey
	budgetBody := `{"productKey":"` + pk + `","items":[{"creditsTotal":"10.000000","costToCreditRatio":"1"}]}`
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
	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
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
	repBody := `{"reportItems":[{"budgetCost":"1","productCost":"0","label":"a"}]}`
	reqRep := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
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
	for _, u := range []string{
		"/api/v1/reports?sessionId=" + sessionID,
		"/api/v1/reports?productKey=" + pk,
		"/api/v1/reports?budgetId=" + budgetID,
	} {
		name := u[strings.Index(u, "?")+1:]
		t.Run("filter "+name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, u, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("list reports: %d %s", rec.Code, rec.Body.String())
			}
			var list struct {
				Reports []map[string]any `json:"reports"`
				Total   int              `json:"total"`
				Limit   int              `json:"limit"`
				Offset  int              `json:"offset"`
				HasMore bool             `json:"hasMore"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
				t.Fatal(err)
			}
			if list.Total != 1 || len(list.Reports) != 1 {
				t.Fatalf("total=%d len=%d", list.Total, len(list.Reports))
			}
			if list.Limit != 50 || list.Offset != 0 || list.HasMore {
				t.Fatalf("pagination: limit=%d offset=%d hasMore=%v", list.Limit, list.Offset, list.HasMore)
			}
			if list.Reports[0]["reportId"].(string) != reportResp.ReportID {
				t.Fatalf("reportId")
			}
			if list.Reports[0]["sessionId"].(string) != sessionID {
				t.Fatalf("sessionId")
			}
			if list.Reports[0]["budgetId"].(string) != budgetID {
				t.Fatalf("budgetId")
			}
			if list.Reports[0]["productKey"].(string) != pk {
				t.Fatalf("productKey")
			}
			if _, err := time.Parse(time.RFC3339Nano, list.Reports[0]["createdAt"].(string)); err != nil {
				t.Fatalf("createdAt: %v", err)
			}
			if list.Reports[0]["reportItems"] != nil {
				t.Fatalf("list row must not include reportItems")
			}
		})
	}
}

func TestListReportsQueryValidation(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{Store: nil}, auth.NewMiddleware("none", nil, nil))
	cases := []struct {
		path string
		want int
	}{
		{"/api/v1/reports?budgetId=not-a-uuid", http.StatusBadRequest},
		{"/api/v1/reports?sessionId=not-a-uuid", http.StatusBadRequest},
		{"/api/v1/reports?sort=other", http.StatusBadRequest},
		{"/api/v1/reports?order=both", http.StatusBadRequest},
		{"/api/v1/reports?limit=0", http.StatusBadRequest},
		{"/api/v1/reports?limit=501", http.StatusBadRequest},
		{"/api/v1/reports?offset=-1", http.StatusBadRequest},
		{"/api/v1/reports?limit=abc", http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.path, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestListReportsUnfiltered(t *testing.T) {
	h := NewRouter(&Server{Store: testStore(t)}, auth.NewMiddleware("none", nil, nil))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/reports", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Reports []any `json:"reports"`
		Total   int   `json:"total"`
		Limit   int   `json:"limit"`
		Offset  int   `json:"offset"`
		HasMore bool  `json:"hasMore"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Limit != 50 || out.Offset != 0 {
		t.Fatalf("defaults: limit=%d offset=%d", out.Limit, out.Offset)
	}
	if out.Total < 0 || len(out.Reports) > 50 {
		t.Fatalf("total=%d len(reports)=%d", out.Total, len(out.Reports))
	}
	if out.Total < len(out.Reports) {
		t.Fatalf("total must be >= len(reports) on first page, total=%d len=%d", out.Total, len(out.Reports))
	}
	wantHasMore := out.Offset+len(out.Reports) < out.Total
	if out.HasMore != wantHasMore {
		t.Fatalf("hasMore: got %v want %v (offset=%d len=%d total=%d)", out.HasMore, wantHasMore, out.Offset, len(out.Reports), out.Total)
	}
}

func TestListReportsOversizedProductKey(t *testing.T) {
	t.Parallel()
	h := NewRouter(&Server{Store: nil}, auth.NewMiddleware("none", nil, nil))
	longPK := strings.Repeat("a", productKeyMaxLen+1)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/reports?productKey="+longPK, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestListReportsEmptyUnknownSession(t *testing.T) {
	h := NewRouter(&Server{Store: testStore(t)}, auth.NewMiddleware("none", nil, nil))
	id := uuid.NewString()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/reports?sessionId="+id, nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Reports []any `json:"reports"`
		Total   int   `json:"total"`
		Limit   int   `json:"limit"`
		Offset  int   `json:"offset"`
		HasMore bool  `json:"hasMore"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Total != 0 || len(list.Reports) != 0 || list.HasMore {
		t.Fatalf("want empty total=0 got total=%d len=%d hasMore=%v", list.Total, len(list.Reports), list.HasMore)
	}
	if list.Limit != 50 || list.Offset != 0 {
		t.Fatalf("default limit/offset: %d %d", list.Limit, list.Offset)
	}
}

func TestListReportsPaginationAndOrder(t *testing.T) {
	st := testStore(t)
	h := NewRouter(&Server{Store: st}, auth.NewMiddleware("none", nil, nil))
	pk := "list-page-" + uuid.NewString()
	prodBody := `{"productKey":"` + pk + `"}`
	reqP := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(prodBody))
	reqP.Header.Set("Content-Type", "application/json")
	recP := httptest.NewRecorder()
	h.ServeHTTP(recP, reqP)
	if recP.Code != http.StatusCreated {
		t.Fatalf("post product: %d", recP.Code)
	}
	var rids [2]string
	for i := 0; i < 2; i++ {
		budgetBody := `{"productKey":"` + pk + `","items":[{"creditsTotal":"10.000000","costToCreditRatio":"1"}]}`
		reqB := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(budgetBody))
		reqB.Header.Set("Content-Type", "application/json")
		recB := httptest.NewRecorder()
		h.ServeHTTP(recB, reqB)
		if recB.Code != http.StatusCreated {
			t.Fatalf("post budget: %d %s", recB.Code, recB.Body.String())
		}
		var bResp struct {
			BudgetID string `json:"budgetId"`
		}
		if err := json.Unmarshal(recB.Body.Bytes(), &bResp); err != nil {
			t.Fatal(err)
		}
		reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+bResp.BudgetID+`"}`))
		reqS.Header.Set("Content-Type", "application/json")
		recS := httptest.NewRecorder()
		h.ServeHTTP(recS, reqS)
		if recS.Code != http.StatusCreated {
			t.Fatalf("post session: %d", recS.Code)
		}
		var sResp struct {
			SessionID string `json:"sessionId"`
		}
		if err := json.Unmarshal(recS.Body.Bytes(), &sResp); err != nil {
			t.Fatal(err)
		}
		if i == 1 {
			time.Sleep(5 * time.Millisecond)
		}
		reqR := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sResp.SessionID+"/reports",
			strings.NewReader(`{"reportItems":[{"budgetCost":"1","productCost":"0","label":"x"}]}`))
		reqR.Header.Set("Content-Type", "application/json")
		recR := httptest.NewRecorder()
		h.ServeHTTP(recR, reqR)
		if recR.Code != http.StatusCreated {
			t.Fatalf("post report: %d %s", recR.Code, recR.Body.String())
		}
		var rep struct {
			ReportID string `json:"reportId"`
		}
		if err := json.Unmarshal(recR.Body.Bytes(), &rep); err != nil {
			t.Fatal(err)
		}
		rids[i] = rep.ReportID
	}
	var listDesc struct {
		Reports []map[string]any `json:"reports"`
		Total   int              `json:"total"`
		HasMore bool             `json:"hasMore"`
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/reports?productKey="+pk+"&order=desc&limit=10&offset=0", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listDesc); err != nil {
		t.Fatal(err)
	}
	if listDesc.Total != 2 {
		t.Fatalf("total %d", listDesc.Total)
	}
	if listDesc.HasMore {
		t.Fatalf("desc with limit=10: hasMore should be false, got true")
	}
	older, newer := rids[0], rids[1]
	reqAsc := httptest.NewRequest(http.MethodGet, "/api/v1/reports?productKey="+pk+"&order=asc&limit=1&offset=0", nil)
	recA := httptest.NewRecorder()
	h.ServeHTTP(recA, reqAsc)
	if recA.Code != http.StatusOK {
		t.Fatalf("list asc: %d", recA.Code)
	}
	var page0 struct {
		Reports []map[string]any `json:"reports"`
		HasMore bool             `json:"hasMore"`
		Limit   int              `json:"limit"`
		Offset  int              `json:"offset"`
	}
	if err := json.Unmarshal(recA.Body.Bytes(), &page0); err != nil {
		t.Fatal(err)
	}
	if !page0.HasMore || page0.Limit != 1 || page0.Offset != 0 {
		t.Fatalf("asc page0: hasMore=%v limit=%d offset=%d", page0.HasMore, page0.Limit, page0.Offset)
	}
	if len(page0.Reports) != 1 || page0.Reports[0]["reportId"].(string) != older {
		t.Fatalf("asc first: got %v want %q", page0.Reports, older)
	}
	reqL := httptest.NewRequest(http.MethodGet, "/api/v1/reports?productKey="+pk+"&order=asc&limit=1&offset=1", nil)
	recL := httptest.NewRecorder()
	h.ServeHTTP(recL, reqL)
	if recL.Code != http.StatusOK {
		t.Fatalf("list page2: %d", recL.Code)
	}
	if err := json.Unmarshal(recL.Body.Bytes(), &page0); err != nil {
		t.Fatal(err)
	}
	if page0.HasMore {
		t.Fatalf("asc last page: hasMore should be false")
	}
	if len(page0.Reports) != 1 || page0.Reports[0]["reportId"].(string) != newer {
		t.Fatalf("asc second: got %v want %q", page0.Reports, newer)
	}
	if listDesc.Reports[0]["reportId"].(string) != newer {
		t.Fatalf("desc first should be newer report %s got %s", newer, listDesc.Reports[0]["reportId"])
	}
}

func TestPostBudgetSessionReportEmitsSuccessLog(t *testing.T) {
	var logBuf bytes.Buffer
	logH := slog.NewJSONHandler(&logBuf, &slog.HandlerOptions{Level: slog.LevelInfo})
	previous := slog.Default()
	slog.SetDefault(slog.New(logH))
	t.Cleanup(func() { slog.SetDefault(previous) })

	st := testStore(t)
	auth := auth.NewMiddleware("none")
	srv := &Server{Store: st}
	h := NewRouter(srv, auth)
	pk := "success-log-" + uuid.NewString()
	reqP := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"`+pk+`"}`))
	reqP.Header.Set("Content-Type", "application/json")
	recP := httptest.NewRecorder()
	h.ServeHTTP(recP, reqP)
	if recP.Code != http.StatusCreated {
		t.Fatalf("post product: %d %s", recP.Code, recP.Body.String())
	}
	reqB := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(
		`{"productKey":"`+pk+`","items":[{"creditsTotal":"10.000000","costToCreditRatio":"1"}]}`,
	))
	reqB.Header.Set("Content-Type", "application/json")
	recB := httptest.NewRecorder()
	h.ServeHTTP(recB, reqB)
	if recB.Code != http.StatusCreated {
		t.Fatalf("post budget: %d %s", recB.Code, recB.Body.String())
	}
	budgetID := decodeJSONMapUseNumber(t, recB.Body.String())["budgetId"].(string)
	reqS := httptest.NewRequest(http.MethodPost, "/api/v1/sessions", strings.NewReader(`{"budgetId":"`+budgetID+`"}`))
	reqS.Header.Set("Content-Type", "application/json")
	recS := httptest.NewRecorder()
	h.ServeHTTP(recS, reqS)
	if recS.Code != http.StatusCreated {
		t.Fatalf("post session: %d %s", recS.Code, recS.Body.String())
	}
	sessionID := decodeJSONMapUseNumber(t, recS.Body.String())["sessionId"].(string)

	repBody := `{"reportItems":[{"budgetCost":"1.000000","productCost":"2.500000","label":"slog"}]}`
	reqR := httptest.NewRequest(http.MethodPost, "/api/v1/sessions/"+sessionID+"/reports", strings.NewReader(repBody))
	reqR.Header.Set("Content-Type", "application/json")
	recR := httptest.NewRecorder()
	h.ServeHTTP(recR, reqR)
	if recR.Code != http.StatusCreated {
		t.Fatalf("post report: %d %s", recR.Code, recR.Body.String())
	}

	var success map[string]any
	for _, line := range strings.Split(logBuf.String(), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			continue
		}
		if m["msg"] == "budget.session.report.success" {
			success = m
			break
		}
	}
	if success == nil {
		t.Fatalf("missing budget.session.report.success in log output: %s", logBuf.String())
	}
	if success["productKey"].(string) != pk {
		t.Fatalf("productKey: got %v", success["productKey"])
	}
	if success["sessionId"].(string) != sessionID {
		t.Fatalf("sessionId")
	}
	if success["budgetId"].(string) != budgetID {
		t.Fatalf("budgetId")
	}
	if success["productCostTotal"].(string) != "2.500000" {
		t.Fatalf("productCostTotal: got %v", success["productCostTotal"])
	}
	if success["budgetCostTotal"].(string) != "1.000000" {
		t.Fatalf("budgetCostTotal: got %v", success["budgetCostTotal"])
	}
	rid, ok := success["reportId"].(string)
	if !ok || rid == "" {
		t.Fatalf("reportId: %v", success["reportId"])
	}
	pcu, ok := success["productCostTotalUsd"].(float64)
	if !ok {
		t.Fatalf("productCostTotalUsd type: %T %v", success["productCostTotalUsd"], success["productCostTotalUsd"])
	}
	if pcu < 2.499999 || pcu > 2.500001 {
		t.Fatalf("productCostTotalUsd: got %g", pcu)
	}
	bcu, ok := success["budgetCostTotalUsd"].(float64)
	if !ok {
		t.Fatalf("budgetCostTotalUsd type: %T", success["budgetCostTotalUsd"])
	}
	if bcu < 0.999999 || bcu > 1.000001 {
		t.Fatalf("budgetCostTotalUsd: got %g", bcu)
	}
}
