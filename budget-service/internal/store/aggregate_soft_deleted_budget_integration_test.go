package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestSumReportAggregateIncludesSoftDeletedBudget(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "agg-del-bud-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)
	label := "agg-soft-del-" + uuid.NewString()

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	from := now.Add(-2 * time.Hour)
	to := now.Add(2 * time.Hour)

	_, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "2.500000", ProductCost: "1.250000", Label: label},
	})
	if err != nil {
		t.Fatalf("CreateSessionReport: %v", err)
	}

	before, err := st.SumReportItemCostsByLabelAndProduct(ctx, ReportItemCostAggregateFilter{
		ProductKey: productKey,
		Label:      label,
		From:       from,
		To:         to,
	})
	if err != nil {
		t.Fatalf("aggregate before delete: %v", err)
	}
	if before.LineCount != 1 {
		t.Fatalf("line count before delete = %d want 1", before.LineCount)
	}
	if before.BudgetCostTotal == "" || before.ProductCostTotal == "" {
		t.Fatalf("empty totals before delete: b=%s p=%s", before.BudgetCostTotal, before.ProductCostTotal)
	}

	if err := st.SoftDeleteBudget(ctx, budgetID); err != nil {
		t.Fatalf("SoftDeleteBudget: %v", err)
	}

	after, err := st.SumReportItemCostsByLabelAndProduct(ctx, ReportItemCostAggregateFilter{
		ProductKey: productKey,
		Label:      label,
		From:       from,
		To:         to,
	})
	if err != nil {
		t.Fatalf("aggregate after delete: %v", err)
	}
	if after.LineCount != before.LineCount {
		t.Fatalf("line count after delete = %d want %d", after.LineCount, before.LineCount)
	}
	if after.BudgetCostTotal != before.BudgetCostTotal || after.ProductCostTotal != before.ProductCostTotal {
		t.Fatalf("aggregate after delete changed totals: before b=%s p=%s after b=%s p=%s",
			before.BudgetCostTotal, before.ProductCostTotal, after.BudgetCostTotal, after.ProductCostTotal)
	}
}
