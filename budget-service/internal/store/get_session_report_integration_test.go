package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// TestGetSessionReportAllocationsSingleQueryParity checks one query returns the same
// allocation rows as before: per-line budget_item_id set and credits (GET orders
// budgetItems by budget_item_id, not consumption walk order).
func TestGetSessionReportAllocationsSingleQueryParity(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "get-report-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "5.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
		{CreditsTotal: "5.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	budget, err := st.GetBudget(ctx, budgetID, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(budget.Items) != 2 {
		t.Fatalf("items = %d want 2", len(budget.Items))
	}
	itemA := budget.Items[0].ID
	itemB := budget.Items[1].ID

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "8.000000", ProductCost: "8.000000", Label: "line1"},
		{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "line2"},
	}, false)
	if err != nil {
		t.Fatalf("CreateSessionReport: %v", err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}
	if len(detail.Items) != 2 {
		t.Fatalf("report items = %d want 2", len(detail.Items))
	}

	byLabel := make(map[string]SessionReportItemOut, len(detail.Items))
	for i := range detail.Items {
		byLabel[detail.Items[i].Label] = detail.Items[i]
	}
	line1 := byLabel["line1"]
	line2 := byLabel["line2"]
	if line1.ReportItemID == "" || line2.ReportItemID == "" {
		t.Fatalf("missing report lines by label: %#v", byLabel)
	}

	if len(line1.BudgetItems) != 2 {
		t.Fatalf("line1 allocations = %d want 2", len(line1.BudgetItems))
	}
	if len(line2.BudgetItems) != 1 {
		t.Fatalf("line2 allocations = %d want 1", len(line2.BudgetItems))
	}

	ids := []string{line1.BudgetItems[0].BudgetItemID, line1.BudgetItems[1].BudgetItemID}
	if ids[0] > ids[1] {
		ids[0], ids[1] = ids[1], ids[0]
	}
	want := []string{itemA, itemB}
	if want[0] > want[1] {
		want[0], want[1] = want[1], want[0]
	}
	if ids[0] != want[0] || ids[1] != want[1] {
		t.Fatalf("line1 budget item ids got %v want %v", ids, want)
	}

	sum1 := decimal.Zero
	for _, a := range line1.BudgetItems {
		d, err := decimal.NewFromString(a.CreditsUsed)
		if err != nil {
			t.Fatalf("parse credits %q: %v", a.CreditsUsed, err)
		}
		sum1 = sum1.Add(d)
	}
	if !sum1.Equal(decimal.NewFromInt(8)) {
		t.Fatalf("line1 credits sum = %s want 8", sum1.String())
	}
	line2c, err := decimal.NewFromString(line2.BudgetItems[0].CreditsUsed)
	if err != nil || !line2c.Equal(decimal.NewFromInt(1)) {
		t.Fatalf("line2 credits = %s want 1", line2.BudgetItems[0].CreditsUsed)
	}
}
