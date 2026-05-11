package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestCreateProductSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-test-" + uuid.NewString()

	row, err := st.CreateProduct(ctx, pk)
	if err != nil {
		t.Fatalf("CreateProduct: %v", err)
	}
	if row.ProductKey != pk {
		t.Fatalf("ProductKey = %q want %q", row.ProductKey, pk)
	}
	if row.CreatedAt.IsZero() {
		t.Fatal("CreatedAt is zero")
	}
	if row.DeletedAt != nil {
		t.Fatal("DeletedAt should be nil")
	}
}

func TestCreateProductConflict(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-conflict-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	_, err := st.CreateProduct(ctx, pk)
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected ErrConflict, got %v", err)
	}
}

func TestCreateProductReactivate(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-reactivate-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	row, err := st.CreateProduct(ctx, pk)
	if err != nil {
		t.Fatalf("CreateProduct (reactivate): %v", err)
	}
	if row.DeletedAt != nil {
		t.Fatal("reactivated product should have nil DeletedAt")
	}
}

func TestListProductsMultiple(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk1 := "prod-list-a-" + uuid.NewString()
	pk2 := "prod-list-b-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk1); err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateProduct(ctx, pk2); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListProducts(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) < 2 {
		t.Fatalf("expected at least 2 products, got %d", len(rows))
	}
}

func TestListProductsExcludeDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-del-filter-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	rows, err := st.ListProducts(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if r.ProductKey == pk {
			t.Fatal("deleted product should not appear with includeDeleted=false")
		}
	}

	rowsAll, err := st.ListProducts(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, r := range rowsAll {
		if r.ProductKey == pk {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("deleted product should appear with includeDeleted=true")
	}
}

func TestSoftDeleteProductSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-softdel-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatalf("SoftDeleteProduct: %v", err)
	}
}

func TestSoftDeleteProductNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.SoftDeleteProduct(ctx, "nonexistent-"+uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestSoftDeleteProductAlreadyDeleted(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-double-del-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	if err := st.SoftDeleteProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	err := st.SoftDeleteProduct(ctx, pk)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound on second delete, got %v", err)
	}
}

func TestSoftDeleteProductHasActiveBudgets(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prod-has-budgets-" + uuid.NewString()

	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	err := st.SoftDeleteProduct(ctx, pk)
	if !errors.Is(err, ErrProductHasActiveBudgets) {
		t.Fatalf("expected ErrProductHasActiveBudgets, got %v", err)
	}
}
