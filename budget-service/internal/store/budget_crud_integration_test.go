package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCreateBudgetSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-create-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	})
	if err != nil {
		t.Fatalf("CreateBudget: %v", err)
	}
}

func TestCreateBudgetMultipleItems(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-multi-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "0.500000"},
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "200.000000", CostCreditRatio: "2.000000"},
	})
	if err != nil {
		t.Fatal(err)
	}

	d, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Items) != 3 {
		t.Fatalf("expected 3 items, got %d", len(d.Items))
	}
}

func TestCreateBudgetUnknownProduct(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, "nonexistent-"+uuid.NewString(), []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	})
	if err == nil {
		t.Fatal("expected error for unknown product")
	}
}

func TestGetBudgetSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-get-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	d, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatalf("GetBudget: %v", err)
	}
	if d.BudgetID != budgetID {
		t.Fatalf("BudgetID = %q want %q", d.BudgetID, budgetID)
	}
	if d.ProductKey != pk {
		t.Fatalf("ProductKey = %q want %q", d.ProductKey, pk)
	}
	if d.CreditsTotal != "100.000000" {
		t.Fatalf("CreditsTotal = %q want 100.000000", d.CreditsTotal)
	}
	if len(d.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(d.Items))
	}
}

func TestGetBudgetNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.GetBudget(ctx, uuid.NewString(), false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetBudgetItemSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-item-get-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "0.750000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if err != nil {
		t.Fatalf("GetBudgetItem: %v", err)
	}
	if row.ID != itemID {
		t.Fatalf("ID = %q want %q", row.ID, itemID)
	}
	if row.CreditsTotal != "50.000000" {
		t.Fatalf("CreditsTotal = %q", row.CreditsTotal)
	}
}

func TestInsertBudgetItemSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-insert-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	newItemID, err := st.InsertBudgetItem(ctx, budgetID, ItemInput{
		CreditsTotal: "200.000000", CostCreditRatio: "0.500000",
	})
	if err != nil {
		t.Fatalf("InsertBudgetItem: %v", err)
	}
	if _, err := uuid.Parse(newItemID); err != nil {
		t.Fatalf("returned ID is not a valid UUID: %q", newItemID)
	}

	d, _ := st.GetBudget(ctx, budgetID, false)
	if len(d.Items) != 2 {
		t.Fatalf("expected 2 items after insert, got %d", len(d.Items))
	}
}

func TestInsertBudgetItemBudgetNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.InsertBudgetItem(ctx, uuid.NewString(), ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestUpdateBudgetItemCreditsTotal(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-update-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	err := st.UpdateBudgetItem(ctx, budgetID, itemID, ItemInput{
		CreditsTotal: "200.000000", CostCreditRatio: "1.000000",
	}, nil)
	if err != nil {
		t.Fatalf("UpdateBudgetItem: %v", err)
	}

	row, _ := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if row.CreditsTotal != "200.000000" {
		t.Fatalf("CreditsTotal after update = %q want 200.000000", row.CreditsTotal)
	}
}

func TestUpdateBudgetItemWithCreditAdjustment(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-adj-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	err := st.UpdateBudgetItem(ctx, budgetID, itemID, ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	}, &CreditAdjustment{
		NewCreditsUsed: "25.000000",
		EntryKind:      "upgrade",
	})
	if err != nil {
		t.Fatalf("UpdateBudgetItem with adjustment: %v", err)
	}

	row, _ := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if row.CreditsUsed != "25.000000" {
		t.Fatalf("CreditsUsed = %q want 25.000000", row.CreditsUsed)
	}
}

func TestSoftDeleteBudgetSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-softdel-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	if err := st.SoftDeleteBudget(ctx, budgetID); err != nil {
		t.Fatalf("SoftDeleteBudget: %v", err)
	}

	d, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	if d.DeletedAt == nil {
		t.Fatal("expected non-nil DeletedAt after soft delete")
	}
}

func TestSoftDeleteBudgetNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.SoftDeleteBudget(ctx, uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestSoftDeleteBudgetWithUnreconciledSession(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-del-session-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	err := st.SoftDeleteBudget(ctx, budgetID)
	if !errors.Is(err, ErrBudgetHasUnreconciledSessions) {
		t.Fatalf("expected ErrBudgetHasUnreconciledSessions, got %v", err)
	}
}

func TestSoftDeleteBudgetItemSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-del-item-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	if err := st.SoftDeleteBudgetItem(ctx, budgetID, itemID); err != nil {
		t.Fatalf("SoftDeleteBudgetItem: %v", err)
	}

	d2, _ := st.GetBudget(ctx, budgetID, false)
	if len(d2.Items) != 1 {
		t.Fatalf("expected 1 active item after delete, got %d", len(d2.Items))
	}

	d3, _ := st.GetBudget(ctx, budgetID, true)
	if len(d3.Items) != 2 {
		t.Fatalf("expected 2 items with includeDeleted=true, got %d", len(d3.Items))
	}
}

func TestStorePing(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	if err := st.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}

func TestUpdateBudgetItemsBatch(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-batch-update-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "75.000000", CostCreditRatio: "0.500000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	item1ID := d.Items[0].ID
	item2ID := d.Items[1].ID

	items := []PutItemInput{
		{BudgetItemID: &item1ID, CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
		{BudgetItemID: &item2ID, CreditsTotal: "150.000000", CostCreditRatio: "0.500000"},
	}
	err := st.UpdateBudgetItems(ctx, budgetID, items, []*CreditAdjustment{nil, nil})
	if err != nil {
		t.Fatalf("UpdateBudgetItems: %v", err)
	}

	d2, _ := st.GetBudget(ctx, budgetID, false)
	if d2.Items[0].CreditsTotal != "100.000000" {
		t.Fatalf("item1 CreditsTotal = %q want 100.000000", d2.Items[0].CreditsTotal)
	}
	if d2.Items[1].CreditsTotal != "150.000000" {
		t.Fatalf("item2 CreditsTotal = %q want 150.000000", d2.Items[1].CreditsTotal)
	}
}

func TestBudgetConsumptionPreview(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-preview-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "50.000000", CostCreditRatio: "0.500000"},
	}); err != nil {
		t.Fatal(err)
	}

	rows, err := st.BudgetConsumptionPreview(ctx, budgetID)
	if err != nil {
		t.Fatalf("BudgetConsumptionPreview: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 preview rows, got %d", len(rows))
	}
}

func TestBudgetConsumptionPreviewInvalidUUID(t *testing.T) {
	st := testIntegrationStore(t)
	_, err := st.BudgetConsumptionPreview(context.Background(), "not-a-uuid")
	if err == nil {
		t.Fatal("expected error for invalid UUID")
	}
}

func TestDebugSessionCreditsReplay(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-replay-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "5.000000", CallRequestID: "replay-1"},
		{Cost: "3.000000", CallRequestID: "replay-2"},
	}); err != nil {
		t.Fatal(err)
	}

	replayed, err := st.DebugSessionCreditsReplay(ctx, sessionID)
	if err != nil {
		t.Fatalf("DebugSessionCreditsReplay: %v", err)
	}
	if len(replayed) != 2 {
		t.Fatalf("expected 2 replayed values, got %d", len(replayed))
	}
}

func TestSumReportItemCostsByLabelAndProduct(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-aggregate-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "1000.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "10.000000", CallRequestID: "agg-call"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "10.000000", ProductCost: "10.000000", Label: "compute"},
	}, false); err != nil {
		t.Fatal(err)
	}

	result, err := st.SumReportItemCostsByLabelAndProduct(ctx, ReportItemCostAggregateFilter{
		ProductKey: pk,
		Label:      "compute",
		From:       time.Now().Add(-1 * time.Hour),
		To:         time.Now().Add(1 * time.Hour),
	})
	if err != nil {
		t.Fatalf("SumReportItemCostsByLabelAndProduct: %v", err)
	}
	if result.LineCount < 1 {
		t.Fatalf("LineCount = %d want >= 1", result.LineCount)
	}
}

func TestCreateBudgetWithInitialCreditsUsed(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-initial-used-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000", CreditsUsed: "25.000000"},
	})
	if err != nil {
		t.Fatalf("CreateBudget with initial creditsUsed: %v", err)
	}

	d, _ := st.GetBudget(ctx, budgetID, false)
	if d.CreditsUsed != "25.000000" {
		t.Fatalf("CreditsUsed = %q want 25.000000", d.CreditsUsed)
	}
}

func TestCreateBudgetWithLabel(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-label-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	label := "my-budget-item"
	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000", Label: &label},
	})
	if err != nil {
		t.Fatalf("CreateBudget with label: %v", err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	if d.Items[0].Label == nil || *d.Items[0].Label != label {
		t.Fatalf("Label = %v want %q", d.Items[0].Label, label)
	}
}

func TestCreateBudgetWithDates(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-dates-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	expiresAt := "2027-01-01T00:00:00Z"
	startsAt := "2026-01-01T00:00:00Z"
	resetsAt := "2026-02-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{
			CreditsTotal:    "100.000000",
			CostCreditRatio: "1.000000",
			ExpiresAt:       &expiresAt,
			StartsAt:        &startsAt,
			ResetsAt:        &resetsAt,
			ResetInterval:   &resetInterval,
		},
	})
	if err != nil {
		t.Fatalf("CreateBudget with dates: %v", err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	if d.Items[0].ExpiresAt == nil {
		t.Fatal("ExpiresAt should not be nil")
	}
	if d.Items[0].ResetInterval == nil || *d.Items[0].ResetInterval != "1mo" {
		t.Fatalf("ResetInterval = %v", d.Items[0].ResetInterval)
	}
}

func TestInsertBudgetItemWithInitialCreditsUsed(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-insert-used-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	_, err := st.InsertBudgetItem(ctx, budgetID, ItemInput{
		CreditsTotal:    "200.000000",
		CostCreditRatio: "0.500000",
		CreditsUsed:     "50.000000",
	})
	if err != nil {
		t.Fatalf("InsertBudgetItem with creditsUsed: %v", err)
	}

	d, _ := st.GetBudget(ctx, budgetID, false)
	for _, item := range d.Items {
		if item.CreditsTotal == "200.000000" && item.CreditsUsed != "50.000000" {
			t.Fatalf("inserted item CreditsUsed = %q want 50.000000", item.CreditsUsed)
		}
	}
}

func TestSoftDeleteBudgetItemNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-del-item-nf-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	err := st.SoftDeleteBudgetItem(ctx, budgetID, uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent item, got %v", err)
	}
}

func TestSoftDeleteBudgetItemBudgetNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.SoftDeleteBudgetItem(ctx, uuid.NewString(), uuid.NewString())
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent budget, got %v", err)
	}
}

func TestSoftDeleteBudgetItemWithOpenSession(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-del-item-session-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	if err := st.CreateBudgetSession(ctx, budgetID, uuid.NewString(), nil, false); err != nil {
		t.Fatal(err)
	}

	err := st.SoftDeleteBudgetItem(ctx, budgetID, d.Items[0].ID)
	if !errors.Is(err, ErrBudgetHasUnreconciledSessions) {
		t.Fatalf("expected ErrBudgetHasUnreconciledSessions, got %v", err)
	}
}

func TestGetBudgetIncludeDeletedItems(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "budget-incl-del-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
		{CreditsTotal: "50.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	if err := st.SoftDeleteBudgetItem(ctx, budgetID, d.Items[0].ID); err != nil {
		t.Fatal(err)
	}

	withDeleted, _ := st.GetBudget(ctx, budgetID, true)
	withoutDeleted, _ := st.GetBudget(ctx, budgetID, false)

	if len(withDeleted.Items) != 2 {
		t.Fatalf("includeDeleted=true: expected 2 items, got %d", len(withDeleted.Items))
	}
	if len(withoutDeleted.Items) != 1 {
		t.Fatalf("includeDeleted=false: expected 1 item, got %d", len(withoutDeleted.Items))
	}
}
