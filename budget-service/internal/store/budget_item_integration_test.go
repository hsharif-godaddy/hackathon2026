package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// GetBudgetItem – nullable field paths
// ---------------------------------------------------------------------------

func TestGetBudgetItemAllNullableFieldsPopulated(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "item-nullable-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	expiresAt := "2027-06-01T00:00:00Z"
	startsAt := "2026-06-01T00:00:00Z"
	resetsAt := "2026-07-01T00:00:00Z"
	resetInterval := "1mo"
	label := "test-label"

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{
			CreditsTotal:    "100.000000",
			CostCreditRatio: "1.000000",
			ExpiresAt:       &expiresAt,
			StartsAt:        &startsAt,
			ResetsAt:        &resetsAt,
			ResetInterval:   &resetInterval,
			Label:           &label,
		},
	}); err != nil {
		t.Fatalf("CreateBudget: %v", err)
	}

	d, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	itemID := d.Items[0].ID

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if err != nil {
		t.Fatalf("GetBudgetItem: %v", err)
	}
	if row.ExpiresAt == nil {
		t.Fatal("ExpiresAt should not be nil")
	}
	if row.StartsAt == nil {
		t.Fatal("StartsAt should not be nil")
	}
	if row.ResetsAt == nil {
		t.Fatal("ResetsAt should not be nil")
	}
	if row.ResetInterval == nil || *row.ResetInterval != "1mo" {
		t.Fatalf("ResetInterval = %v want \"1mo\"", row.ResetInterval)
	}
	if row.Label == nil || *row.Label != "test-label" {
		t.Fatalf("Label = %v want \"test-label\"", row.Label)
	}
	if row.DeletedAt != nil {
		t.Fatal("DeletedAt should be nil for live item")
	}
}

func TestGetBudgetItemDeletedExcludedByDefault(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "item-del-excl-" + uuid.NewString()
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

	_, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for deleted item with includeDeleted=false, got %v", err)
	}
}

func TestGetBudgetItemDeletedIncludedWhenRequested(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "item-del-incl-" + uuid.NewString()
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

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, true)
	if err != nil {
		t.Fatalf("GetBudgetItem with includeDeleted=true: %v", err)
	}
	if row.DeletedAt == nil {
		t.Fatal("DeletedAt should be set on a soft-deleted item")
	}
}

func TestGetBudgetItemInvalidBudgetUUID(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.GetBudgetItem(ctx, "not-a-uuid", uuid.NewString(), false)
	if err == nil {
		t.Fatal("expected error for invalid budgetID UUID")
	}
}

func TestGetBudgetItemInvalidItemUUID(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.GetBudgetItem(ctx, uuid.NewString(), "not-a-uuid", false)
	if err == nil {
		t.Fatal("expected error for invalid itemID UUID")
	}
}

func TestGetBudgetItemValidUUIDNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	_, err := st.GetBudgetItem(ctx, uuid.NewString(), uuid.NewString(), false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent item, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// UpdateBudgetItem – update paths
// ---------------------------------------------------------------------------

func TestUpdateBudgetItemUpdatesAllFields(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "upd-item-full-" + uuid.NewString()
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

	newLabel := "updated-label"
	err := st.UpdateBudgetItem(ctx, budgetID, itemID, ItemInput{
		CreditsTotal:    "250.000000",
		CostCreditRatio: "0.500000",
		Label:           &newLabel,
	}, nil)
	if err != nil {
		t.Fatalf("UpdateBudgetItem: %v", err)
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if err != nil {
		t.Fatalf("GetBudgetItem after update: %v", err)
	}
	if row.CreditsTotal != "250.000000" {
		t.Fatalf("CreditsTotal = %q want 250.000000", row.CreditsTotal)
	}
	if row.CostCreditRatio != "0.500000" {
		t.Fatalf("CostCreditRatio = %q want 0.500000", row.CostCreditRatio)
	}
	if row.Label == nil || *row.Label != "updated-label" {
		t.Fatalf("Label = %v want \"updated-label\"", row.Label)
	}
}

func TestUpdateBudgetItemNonExistentItem(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "upd-item-nf-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	err := st.UpdateBudgetItem(ctx, budgetID, uuid.NewString(), ItemInput{
		CreditsTotal: "200.000000", CostCreditRatio: "1.000000",
	}, nil)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent item, got %v", err)
	}
}

func TestUpdateBudgetItemInvalidBudgetUUID(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.UpdateBudgetItem(ctx, "not-a-uuid", uuid.NewString(), ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	}, nil)
	if err == nil {
		t.Fatal("expected error for invalid budget UUID")
	}
}

func TestUpdateBudgetItemInvalidItemUUID(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.UpdateBudgetItem(ctx, uuid.NewString(), "not-a-uuid", ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	}, nil)
	if err == nil {
		t.Fatal("expected error for invalid item UUID")
	}
}

// ---------------------------------------------------------------------------
// UpdateBudgetItems – batch update
// ---------------------------------------------------------------------------

func TestUpdateBudgetItemsNonExistentBudget(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	nonExistentBudgetID := uuid.NewString()
	fakeItemID := uuid.NewString()
	items := []PutItemInput{
		{BudgetItemID: &fakeItemID, CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}
	err := st.UpdateBudgetItems(ctx, nonExistentBudgetID, items, []*CreditAdjustment{nil})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound for non-existent budget, got %v", err)
	}
}

func TestUpdateBudgetItemsVerifiesAllItems(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "upd-batch-verify-" + uuid.NewString()
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

	label1 := "item-one"
	label2 := "item-two"
	items := []PutItemInput{
		{BudgetItemID: &item1ID, CreditsTotal: "120.000000", CostCreditRatio: "1.000000", Label: &label1},
		{BudgetItemID: &item2ID, CreditsTotal: "180.000000", CostCreditRatio: "0.500000", Label: &label2},
	}
	if err := st.UpdateBudgetItems(ctx, budgetID, items, []*CreditAdjustment{nil, nil}); err != nil {
		t.Fatalf("UpdateBudgetItems: %v", err)
	}

	row1, err := st.GetBudgetItem(ctx, budgetID, item1ID, false)
	if err != nil {
		t.Fatalf("GetBudgetItem item1: %v", err)
	}
	if row1.CreditsTotal != "120.000000" {
		t.Fatalf("item1 CreditsTotal = %q want 120.000000", row1.CreditsTotal)
	}
	if row1.Label == nil || *row1.Label != "item-one" {
		t.Fatalf("item1 Label = %v want \"item-one\"", row1.Label)
	}

	row2, err := st.GetBudgetItem(ctx, budgetID, item2ID, false)
	if err != nil {
		t.Fatalf("GetBudgetItem item2: %v", err)
	}
	if row2.CreditsTotal != "180.000000" {
		t.Fatalf("item2 CreditsTotal = %q want 180.000000", row2.CreditsTotal)
	}
	if row2.Label == nil || *row2.Label != "item-two" {
		t.Fatalf("item2 Label = %v want \"item-two\"", row2.Label)
	}
}

// ---------------------------------------------------------------------------
// applyCreditAdjustment via UpdateBudgetItem
// ---------------------------------------------------------------------------

func TestCreditAdjustmentUpgrade(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "adj-upgrade-" + uuid.NewString()
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
		t.Fatalf("UpdateBudgetItem upgrade adjustment: %v", err)
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if err != nil {
		t.Fatal(err)
	}
	if row.CreditsUsed != "25.000000" {
		t.Fatalf("CreditsUsed = %q want 25.000000", row.CreditsUsed)
	}
}

func TestCreditAdjustmentReimbursement(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "adj-reimb-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000", CreditsUsed: "50.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	err := st.UpdateBudgetItem(ctx, budgetID, itemID, ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	}, &CreditAdjustment{
		NewCreditsUsed: "20.000000",
		EntryKind:      "reimbursement",
	})
	if err != nil {
		t.Fatalf("UpdateBudgetItem reimbursement adjustment: %v", err)
	}

	row, err := st.GetBudgetItem(ctx, budgetID, itemID, false)
	if err != nil {
		t.Fatal(err)
	}
	if row.CreditsUsed != "20.000000" {
		t.Fatalf("CreditsUsed = %q want 20.000000 after reimbursement", row.CreditsUsed)
	}
}

func TestCreditAdjustmentNegativeCreditsUsedError(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "adj-neg-" + uuid.NewString()
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
		NewCreditsUsed: "-5.000000",
		EntryKind:      "upgrade",
	})
	if !errors.Is(err, ErrCreditsUsedNegative) {
		t.Fatalf("expected ErrCreditsUsedNegative, got %v", err)
	}
}

func TestCreditAdjustmentExceedsTotalError(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "adj-exceed-" + uuid.NewString()
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
		NewCreditsUsed: "150.000000",
		EntryKind:      "upgrade",
	})
	if !errors.Is(err, ErrCreditsUsedExceedsTotal) {
		t.Fatalf("expected ErrCreditsUsedExceedsTotal, got %v", err)
	}
}

func TestCreditAdjustmentReimbursementRequiresReductionError(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "adj-reimb-req-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000", CreditsUsed: "30.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	d, _ := st.GetBudget(ctx, budgetID, false)
	itemID := d.Items[0].ID

	// reimbursement that would increase credits_used (not reduce)
	err := st.UpdateBudgetItem(ctx, budgetID, itemID, ItemInput{
		CreditsTotal: "100.000000", CostCreditRatio: "1.000000",
	}, &CreditAdjustment{
		NewCreditsUsed: "50.000000",
		EntryKind:      "reimbursement",
	})
	if !errors.Is(err, ErrReimbursementRequiresReduction) {
		t.Fatalf("expected ErrReimbursementRequiresReduction, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// InsertBudgetItem – item count increases
// ---------------------------------------------------------------------------

func TestInsertBudgetItemIncreasesCount(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "insert-count-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	d1, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	initialCount := len(d1.Items)

	_, err = st.InsertBudgetItem(ctx, budgetID, ItemInput{
		CreditsTotal: "200.000000", CostCreditRatio: "0.500000",
	})
	if err != nil {
		t.Fatalf("InsertBudgetItem: %v", err)
	}

	d2, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(d2.Items) != initialCount+1 {
		t.Fatalf("item count = %d want %d", len(d2.Items), initialCount+1)
	}
}

// ---------------------------------------------------------------------------
// prepareBudgetItemInsert – resetsAt auto-calculated from resetInterval
// ---------------------------------------------------------------------------

func TestPrepareBudgetItemInsertResetsAtAutoCalculated(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "prepare-reset-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}

	// Set resetInterval but not resetsAt; prepareBudgetItemInsert should
	// derive resetsAt automatically as NextResetAt(startsAt, resetInterval).
	startsAt := "2026-06-01T00:00:00Z"
	resetInterval := "1mo"
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{
			CreditsTotal:    "100.000000",
			CostCreditRatio: "1.000000",
			StartsAt:        &startsAt,
			ResetInterval:   &resetInterval,
			// ResetsAt intentionally omitted
		},
	}); err != nil {
		t.Fatalf("CreateBudget: %v", err)
	}

	d, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	item := d.Items[0]
	if item.ResetsAt == nil {
		t.Fatal("ResetsAt should have been auto-calculated from resetInterval")
	}

	// The auto-calculated resetsAt must be after startsAt.
	parsed, err := time.Parse(time.RFC3339, startsAt)
	if err != nil {
		t.Fatal(err)
	}
	if !item.ResetsAt.After(parsed) {
		t.Fatalf("ResetsAt (%v) should be after StartsAt (%v)", item.ResetsAt, parsed)
	}
}

// ---------------------------------------------------------------------------
// CreateBudgetSession – metadata and invalid UUID paths
// ---------------------------------------------------------------------------

func TestCreateBudgetSessionWithMetadata(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-meta-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	meta := []byte(`{"key":"value"}`)
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, meta); err != nil {
		t.Fatal(err)
	}
	d, err := st.GetBudgetSession(ctx, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if d.Metadata == nil {
		t.Fatal("expected metadata to be set")
	}
}

func TestCreateBudgetSessionInvalidBudgetUUID(t *testing.T) {
	st := testIntegrationStore(t)
	err := st.CreateBudgetSession(context.Background(), "not-a-uuid", uuid.NewString(), nil)
	if err == nil {
		t.Fatal("expected error for invalid UUID")
	}
}

func TestCreateBudgetSessionInvalidSessionUUID(t *testing.T) {
	st := testIntegrationStore(t)
	err := st.CreateBudgetSession(context.Background(), uuid.NewString(), "not-a-uuid", nil)
	if err == nil {
		t.Fatal("expected error for invalid UUID")
	}
}

// ---------------------------------------------------------------------------
// AppendSessionItems – invalid UUID, not-found, and duplicate callRequestId
// ---------------------------------------------------------------------------

func TestAppendSessionItemsInvalidUUID(t *testing.T) {
	st := testIntegrationStore(t)
	_, _, err := st.AppendSessionItems(context.Background(), "not-a-uuid", []SessionLine{
		{Cost: "1.000000", CallRequestID: "cr-1"},
	})
	if err == nil {
		t.Fatal("expected error for invalid UUID")
	}
}

func TestAppendSessionItemsSessionNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	_, _, err := st.AppendSessionItems(context.Background(), uuid.NewString(), []SessionLine{
		{Cost: "1.000000", CallRequestID: "cr-1"},
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// SoftDeleteBudgetItem – invalid UUID paths
// ---------------------------------------------------------------------------

func TestSoftDeleteBudgetItemInvalidBudgetUUID(t *testing.T) {
	st := testIntegrationStore(t)
	err := st.SoftDeleteBudgetItem(context.Background(), "not-a-uuid", uuid.NewString())
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestSoftDeleteBudgetItemInvalidItemUUID(t *testing.T) {
	st := testIntegrationStore(t)
	err := st.SoftDeleteBudgetItem(context.Background(), uuid.NewString(), "not-a-uuid")
	if err == nil {
		t.Fatal("expected error")
	}
}

// ---------------------------------------------------------------------------
// DebugSessionCreditsReplay – invalid UUID path
// ---------------------------------------------------------------------------

func TestDebugSessionCreditsReplayInvalidUUID(t *testing.T) {
	st := testIntegrationStore(t)
	_, err := st.DebugSessionCreditsReplay(context.Background(), "not-a-uuid")
	if err == nil {
		t.Fatal("expected error")
	}
}
