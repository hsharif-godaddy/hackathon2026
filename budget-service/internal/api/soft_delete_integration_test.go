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

	"github.com/gdcorp-partners/airo-app-builder/budget-service/internal/store"
)

func TestPostProductRevivesSoftDeletedProduct(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "revive-prod-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatalf("revive product: %v", err)
	}
	s := &Server{Store: st}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/products", nil)
	s.getProducts(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status %d", rec.Code)
	}
	var list []map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	found := false
	for i := range list {
		if list[i]["productKey"] == pk {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected revived product in list")
	}
}

func TestPostBudgetRejectsSoftDeletedProductKey(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-bud-prod-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	body := `{"productKey":"` + pk + `","items":[{"creditsTotal":"1.000000","costToCreditRatio":"1"}]}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/budgets", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.postBudget(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("post budget status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestPostWebhookRejectsSoftDeletedProductKey(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-wh-prod-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	body := `{"eventType":"report.created","productKey":"` + pk + `","url":"https://example.com/hook"}`
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/webhooks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.postWebhook(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("post webhook status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestSoftDeleteBudgetGetReturnsDeletedAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-get-bud-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	bid := uuid.NewString()
	if err := st.CreateBudget(ctx, bid, pk, []store.ItemInput{
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/budgets/{budgetId}", s.getBudget).Methods(http.MethodGet)
	r.HandleFunc("/api/v1/budgets/{budgetId}", s.deleteBudget).Methods(http.MethodDelete)
	recD := httptest.NewRecorder()
	r.ServeHTTP(recD, httptest.NewRequest(http.MethodDelete, "/api/v1/budgets/"+bid, nil))
	if recD.Code != http.StatusNoContent {
		t.Fatalf("delete budget %d body %s", recD.Code, recD.Body.String())
	}
	recG := httptest.NewRecorder()
	r.ServeHTTP(recG, httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+bid, nil))
	if recG.Code != http.StatusOK {
		t.Fatalf("get budget %d body %s", recG.Code, recG.Body.String())
	}
	m := decodeJSONMapUseNumber(t, recG.Body.String())
	if m["deletedAt"] == nil {
		t.Fatalf("expected deletedAt in GET budget body: %s", recG.Body.String())
	}
}

func TestSoftDeleteBudgetItemGetReturnsDeletedAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	bid := uuid.NewString()
	if err := st.CreateBudget(ctx, bid, pk, []store.ItemInput{
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, err := st.GetBudget(ctx, bid)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Items) != 1 {
		t.Fatalf("items len %d", len(d.Items))
	}
	itemID := d.Items[0].ID
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/budgets/{budgetId}/budget-items/{budgetItemId}", s.getBudgetItem).Methods(http.MethodGet)
	r.HandleFunc("/api/v1/budgets/{budgetId}/budget-items/{budgetItemId}", s.deleteBudgetItem).Methods(http.MethodDelete)
	path := "/api/v1/budgets/" + bid + "/budget-items/" + itemID
	recD := httptest.NewRecorder()
	r.ServeHTTP(recD, httptest.NewRequest(http.MethodDelete, path, nil))
	if recD.Code != http.StatusNoContent {
		t.Fatalf("delete budget item %d body %s", recD.Code, recD.Body.String())
	}
	recG := httptest.NewRecorder()
	r.ServeHTTP(recG, httptest.NewRequest(http.MethodGet, path, nil))
	if recG.Code != http.StatusOK {
		t.Fatalf("get budget item %d body %s", recG.Code, recG.Body.String())
	}
	m := decodeJSONMapUseNumber(t, recG.Body.String())
	if m["deletedAt"] == nil {
		t.Fatalf("expected deletedAt: %s", recG.Body.String())
	}
}

func TestDeleteBudgetItemWhenBudgetAlreadyDeletedReturns404(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-b2i-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	bid := uuid.NewString()
	if err := st.CreateBudget(ctx, bid, pk, []store.ItemInput{
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, err := st.GetBudget(ctx, bid)
	if err != nil {
		t.Fatal(err)
	}
	itemID := d.Items[0].ID
	if err := st.SoftDeleteBudget(ctx, bid); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/budgets/{budgetId}/budget-items/{budgetItemId}", s.deleteBudgetItem).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	path := "/api/v1/budgets/" + bid + "/budget-items/" + itemID
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodDelete, path, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("delete budget item when budget deleted: status %d body %s", rec.Code, rec.Body.String())
	}
}
