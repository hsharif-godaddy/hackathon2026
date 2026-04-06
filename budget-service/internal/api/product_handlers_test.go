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

func TestDeleteProductConflictWhenBudgetExists(t *testing.T) {
	ctx := context.Background()
	st := testStore(t)
	key := "del-prod-budget-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateBudget(ctx, uuid.NewString(), key, []store.ItemInput{
		{CreditsTotal: "1.000000", CreditSpendRatio: "1.000000"},
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
