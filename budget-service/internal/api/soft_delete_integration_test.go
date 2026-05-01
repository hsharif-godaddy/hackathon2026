package api

import (
	"context"
	"encoding/json"
	"fmt"
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
	d, err := st.GetBudget(ctx, bid, false)
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
	if recG.Code != http.StatusNotFound {
		t.Fatalf("get deleted budget item without includeDeleted: %d body %s", recG.Code, recG.Body.String())
	}
	recInc := httptest.NewRecorder()
	r.ServeHTTP(recInc, httptest.NewRequest(http.MethodGet, path+"?includeDeleted=true", nil))
	if recInc.Code != http.StatusOK {
		t.Fatalf("get budget item with includeDeleted: %d body %s", recInc.Code, recInc.Body.String())
	}
	m := decodeJSONMapUseNumber(t, recInc.Body.String())
	if m["deletedAt"] == nil {
		t.Fatalf("expected deletedAt: %s", recInc.Body.String())
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
	d, err := st.GetBudget(ctx, bid, false)
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

func TestGetBudgetIncludeDeletedNestedItems(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-bud-items-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	bid := uuid.NewString()
	if err := st.CreateBudget(ctx, bid, pk, []store.ItemInput{
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "2.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, err := st.GetBudget(ctx, bid, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Items) != 2 {
		t.Fatalf("want 2 items got %d", len(d.Items))
	}
	itemDel := d.Items[1].ID
	if err := st.SoftDeleteBudgetItem(ctx, bid, itemDel); err != nil {
		t.Fatalf("SoftDeleteBudgetItem: %v", err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/budgets/{budgetId}", s.getBudget).Methods(http.MethodGet)

	recDef := httptest.NewRecorder()
	r.ServeHTTP(recDef, httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+bid, nil))
	if recDef.Code != http.StatusOK {
		t.Fatalf("get budget: %d %s", recDef.Code, recDef.Body.String())
	}
	mDef := decodeJSONMapUseNumber(t, recDef.Body.String())
	itemsDef, _ := mDef["items"].([]any)
	if len(itemsDef) != 1 {
		t.Fatalf("default items len %d want 1 body=%s", len(itemsDef), recDef.Body.String())
	}

	recInc := httptest.NewRecorder()
	r.ServeHTTP(recInc, httptest.NewRequest(http.MethodGet, "/api/v1/budgets/"+bid+"?includeDeleted=true", nil))
	if recInc.Code != http.StatusOK {
		t.Fatalf("get budget includeDeleted: %d %s", recInc.Code, recInc.Body.String())
	}
	mInc := decodeJSONMapUseNumber(t, recInc.Body.String())
	itemsInc, _ := mInc["items"].([]any)
	if len(itemsInc) != 2 {
		t.Fatalf("includeDeleted items len %d want 2 body=%s", len(itemsInc), recInc.Body.String())
	}
	var sawDeletedAt bool
	for _, it := range itemsInc {
		im, ok := it.(map[string]any)
		if !ok {
			t.Fatalf("item not object: %T %v", it, it)
		}
		if fmt.Sprint(im["budgetItemId"]) != itemDel {
			continue
		}
		if im["deletedAt"] == nil {
			t.Fatalf("deleted item missing deletedAt: %v", im)
		}
		sawDeletedAt = true
	}
	if !sawDeletedAt {
		t.Fatalf("no item with budgetItemId=%s in %s", itemDel, recInc.Body.String())
	}
}

func TestGetWebhooksAndGetWebhookIncludeDeleted(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	pk := "sd-wh-inc-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	wid := uuid.NewString()
	if err := st.CreateWebhook(ctx, wid, "report.created", pk, "https://example.godaddy.com/hook"); err != nil {
		t.Fatal(err)
	}
	if err := st.DeleteWebhook(ctx, wid); err != nil {
		t.Fatal(err)
	}

	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/webhooks", s.getWebhooks).Methods(http.MethodGet)
	r.HandleFunc("/api/v1/webhooks/{webhookId}", s.getWebhook).Methods(http.MethodGet)

	rec404 := httptest.NewRecorder()
	r.ServeHTTP(rec404, httptest.NewRequest(http.MethodGet, "/api/v1/webhooks/"+wid, nil))
	if rec404.Code != http.StatusNotFound {
		t.Fatalf("get deleted webhook without includeDeleted: %d", rec404.Code)
	}

	recListDef := httptest.NewRecorder()
	r.ServeHTTP(recListDef, httptest.NewRequest(http.MethodGet, "/api/v1/webhooks?productKey="+pk, nil))
	if recListDef.Code != http.StatusOK {
		t.Fatalf("list webhooks default: %d %s", recListDef.Code, recListDef.Body.String())
	}
	var listDef []map[string]any
	if err := json.Unmarshal(recListDef.Body.Bytes(), &listDef); err != nil {
		t.Fatal(err)
	}
	for i := range listDef {
		if listDef[i]["webhookId"] == wid {
			t.Fatalf("soft-deleted webhook must not appear without includeDeleted: %s", recListDef.Body.String())
		}
	}

	recOne := httptest.NewRecorder()
	r.ServeHTTP(recOne, httptest.NewRequest(http.MethodGet, "/api/v1/webhooks/"+wid+"?includeDeleted=true", nil))
	if recOne.Code != http.StatusOK {
		t.Fatalf("get webhook includeDeleted: %d %s", recOne.Code, recOne.Body.String())
	}
	one := decodeJSONMapUseNumber(t, recOne.Body.String())
	if one["deletedAt"] == nil {
		t.Fatalf("expected deletedAt on webhook body=%s", recOne.Body.String())
	}

	recList := httptest.NewRecorder()
	r.ServeHTTP(recList, httptest.NewRequest(http.MethodGet, "/api/v1/webhooks?productKey="+pk+"&includeDeleted=true", nil))
	if recList.Code != http.StatusOK {
		t.Fatalf("list webhooks includeDeleted: %d %s", recList.Code, recList.Body.String())
	}
	var list []map[string]any
	if err := json.Unmarshal(recList.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	found := false
	for i := range list {
		if list[i]["webhookId"] == wid && list[i]["deletedAt"] != nil {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected soft-deleted webhook in list with deletedAt: %s", recList.Body.String())
	}
}
