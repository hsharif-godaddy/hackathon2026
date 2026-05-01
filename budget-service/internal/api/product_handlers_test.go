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

func TestPostProductRejectsEmptyProductKey(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"   "}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
}

func TestPostProductRejectsInvalidCharacters(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"<script>alert(1)</script>"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid characters") {
		t.Fatalf("expected 'invalid characters' error, got %s", rec.Body.String())
	}
}

func TestPostProductRejectsUnknownField(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"abc","extra":true}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	var env map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env["code"] != "BAD_REQUEST" || env["error"] != "invalid JSON body" {
		t.Fatalf("expected generic invalid JSON body, got %s", rec.Body.String())
	}
}

func TestPostProductRejectsLargeBody(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"` + strings.Repeat("a", budgetMaxBodyBytes) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postProduct(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"PAYLOAD_TOO_LARGE"`) {
		t.Fatalf("expected PAYLOAD_TOO_LARGE code, got %s", rec.Body.String())
	}
}

func TestPostProductRejectsOversizedProductKey(t *testing.T) {
	t.Parallel()
	s := &Server{}
	body := `{"productKey":"` + strings.Repeat("a", maxFieldLen+1) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.postProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "exceeds maximum length") {
		t.Fatalf("expected 'exceeds maximum length' error, got %s", rec.Body.String())
	}
}

func TestPostProductAndGetProducts(t *testing.T) {
	st := testStore(t)
	s := &Server{Store: st}
	key := "test-product-" + uuid.NewString()
	body := `{"productKey":"` + key + `"}`

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	s.postProduct(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post status %d, body %s", rec.Code, rec.Body.String())
	}

	recG := httptest.NewRecorder()
	reqG := httptest.NewRequest(http.MethodGet, "/api/v1/products", nil)
	s.getProducts(recG, reqG)
	if recG.Code != http.StatusOK {
		t.Fatalf("get status %d, body %s", recG.Code, recG.Body.String())
	}
	var list []map[string]string
	if err := json.Unmarshal(recG.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	found := false
	for i := range list {
		if list[i]["productKey"] == key {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected productKey in list: %s", recG.Body.String())
	}
}

func TestGetProductsRejectsUnknownQueryKey(t *testing.T) {
	t.Parallel()
	s := &Server{}
	rec := httptest.NewRecorder()
	s.getProducts(rec, httptest.NewRequest(http.MethodGet, "/api/v1/products?includedeleted=true", nil))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400 body %s", rec.Code, rec.Body.String())
	}
}

func TestGetProductsIncludeDeletedListsSoftDeletedWithDeletedAt(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	s := &Server{Store: st}
	key := "test-prod-del-" + uuid.NewString()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(`{"productKey":"`+key+`"}`))
	req.Header.Set("Content-Type", "application/json")
	s.postProduct(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("post status %d, body %s", rec.Code, rec.Body.String())
	}
	if err := st.SoftDeleteProduct(ctx, key); err != nil {
		t.Fatalf("SoftDeleteProduct: %v", err)
	}

	recA := httptest.NewRecorder()
	s.getProducts(recA, httptest.NewRequest(http.MethodGet, "/api/v1/products", nil))
	if recA.Code != http.StatusOK {
		t.Fatalf("list active: %d", recA.Code)
	}
	var active []map[string]any
	if err := json.Unmarshal(recA.Body.Bytes(), &active); err != nil {
		t.Fatal(err)
	}
	for i := range active {
		if active[i]["productKey"] == key {
			t.Fatalf("soft-deleted product should not appear without includeDeleted")
		}
	}

	recB := httptest.NewRecorder()
	s.getProducts(recB, httptest.NewRequest(http.MethodGet, "/api/v1/products?includeDeleted=true", nil))
	if recB.Code != http.StatusOK {
		t.Fatalf("list includeDeleted: %d %s", recB.Code, recB.Body.String())
	}
	var all []map[string]any
	if err := json.Unmarshal(recB.Body.Bytes(), &all); err != nil {
		t.Fatal(err)
	}
	found := false
	for i := range all {
		if all[i]["productKey"] == key {
			if all[i]["deletedAt"] == nil {
				t.Fatalf("expected deletedAt for soft-deleted row: %v", all[i])
			}
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("soft-deleted product missing from includeDeleted list: %s", recB.Body.String())
	}
}

func TestPostProductDuplicateConflict(t *testing.T) {
	st := testStore(t)
	s := &Server{Store: st}
	key := "test-dup-" + uuid.NewString()
	body := `{"productKey":"` + key + `"}`

	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	s.postProduct(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first post status %d, body %s", rec1.Code, rec1.Body.String())
	}

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/products", strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	s.postProduct(rec2, req2)
	if rec2.Code != http.StatusConflict {
		t.Fatalf("second post status %d, body %s", rec2.Code, rec2.Body.String())
	}
}

func TestDeleteProductRejectsInvalidCharacters(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/products/{productKey}", s.deleteProduct).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/products/%3Cscript%3E", nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid characters") {
		t.Fatalf("expected 'invalid characters' error, got %s", rec.Body.String())
	}
}

func TestDeleteProductRejectsOversizedProductKey(t *testing.T) {
	t.Parallel()
	s := &Server{}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/products/{productKey}", s.deleteProduct).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/products/"+strings.Repeat("a", maxFieldLen+1), nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "exceeds maximum length") {
		t.Fatalf("expected 'exceeds maximum length' error, got %s", rec.Body.String())
	}
}

func TestDeleteProductRejectsInvalidPercentEncoding(t *testing.T) {
	t.Parallel()
	s := &Server{}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/products/test", nil)
	req = mux.SetURLVars(req, map[string]string{"productKey": "bad%2"})
	rec := httptest.NewRecorder()
	s.deleteProduct(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d, body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "invalid percent-encoding") {
		t.Fatalf("expected 'invalid percent-encoding' error, got %s", rec.Body.String())
	}
}

func TestDeleteProductConflictWhenBudgetExists(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "del-prod-budget-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateBudget(ctx, uuid.NewString(), key, []store.ItemInput{
		{CreditsTotal: "1.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/products/{productKey}", s.deleteProduct).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/products/"+key, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("delete product status %d want 409, body %s", rec.Code, rec.Body.String())
	}
}

func TestDeleteProductNoContent(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "del-prod-ok-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	s := &Server{Store: st}
	r := mux.NewRouter()
	r.HandleFunc("/api/v1/products/{productKey}", s.deleteProduct).Methods(http.MethodDelete)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/products/"+key, nil)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete product status %d want 204, body %s", rec.Code, rec.Body.String())
	}
}
