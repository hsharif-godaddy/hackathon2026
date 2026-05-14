package store

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

func TestCreateSessionReportAllowOverageAppends(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "overage-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "5.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "8.000000", ProductCost: "2.000000", Label: "main-work"},
	}, true)
	if err != nil {
		t.Fatalf("CreateSessionReport with allowOverage: %v", err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}

	if len(detail.Items) != 2 {
		t.Fatalf("report items = %d want 2 (original + overage)", len(detail.Items))
	}

	byLabel := make(map[string]SessionReportItemOut, len(detail.Items))
	for i := range detail.Items {
		if _, dup := byLabel[detail.Items[i].Label]; dup {
			t.Fatalf("duplicate label %q in report items", detail.Items[i].Label)
		}
		byLabel[detail.Items[i].Label] = detail.Items[i]
	}

	overage, ok := byLabel["allowed-overage"]
	if !ok {
		t.Fatal("missing allowed-overage report item")
	}

	bc, _ := decimal.NewFromString(overage.BudgetCost)
	if !bc.IsZero() {
		t.Fatalf("overage budgetCost = %s want 0", overage.BudgetCost)
	}

	pc, _ := decimal.NewFromString(overage.ProductCost)
	wantRemainder := decimal.NewFromInt(3) // 8 requested - 5 available = 3 remainder
	if !pc.Equal(wantRemainder) {
		t.Fatalf("overage productCost = %s want %s", pc.String(), wantRemainder.String())
	}

	if len(overage.BudgetItems) != 0 {
		t.Fatalf("overage allocations = %d want 0", len(overage.BudgetItems))
	}

	mainItem := byLabel["main-work"]
	mainBC, _ := decimal.NewFromString(mainItem.BudgetCost)
	if !mainBC.Equal(decimal.NewFromInt(5)) {
		t.Fatalf("main-work budgetCost = %s want 5 (allocated only)", mainBC.String())
	}
	mainPC, _ := decimal.NewFromString(mainItem.ProductCost)
	if !mainPC.Equal(decimal.NewFromInt(2)) {
		t.Fatalf("main-work productCost = %s want 2 (unchanged)", mainPC.String())
	}
	if len(mainItem.BudgetItems) != 1 {
		t.Fatalf("main-work allocations = %d want 1", len(mainItem.BudgetItems))
	}
	creds, _ := decimal.NewFromString(mainItem.BudgetItems[0].CreditsUsed)
	if !creds.Equal(decimal.NewFromInt(5)) {
		t.Fatalf("main-work credits = %s want 5", creds.String())
	}

	// Verify top-level totals reflect actual allocation, not raw request
	bcTotal, _ := decimal.NewFromString(detail.BudgetCostTotal)
	wantBCTotal := decimal.NewFromInt(5)
	if !bcTotal.Equal(wantBCTotal) {
		t.Fatalf("BudgetCostTotal = %s want %s", bcTotal.String(), wantBCTotal.String())
	}
	pcTotal, _ := decimal.NewFromString(detail.ProductCostTotal)
	wantPCTotal := decimal.NewFromInt(5) // original productCost(2) + overage remainder(3)
	if !pcTotal.Equal(wantPCTotal) {
		t.Fatalf("ProductCostTotal = %s want %s", pcTotal.String(), wantPCTotal.String())
	}
}

func TestCreateSessionReportAllowOverageMultiItem(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "overage-multi-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	// Item A requests 6 (fits fully), item B requests 8 (only 4 remaining after A)
	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "6.000000", ProductCost: "1.000000", Label: "item-a"},
		{BudgetCost: "8.000000", ProductCost: "1.000000", Label: "item-b"},
	}, true)
	if err != nil {
		t.Fatalf("CreateSessionReport multi-item allowOverage: %v", err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}

	// Expect 3 items: item-a, item-b, allowed-overage
	if len(detail.Items) != 3 {
		t.Fatalf("report items = %d want 3", len(detail.Items))
	}

	byLabel := make(map[string]SessionReportItemOut, len(detail.Items))
	for i := range detail.Items {
		if _, dup := byLabel[detail.Items[i].Label]; dup {
			t.Fatalf("duplicate label %q in report items", detail.Items[i].Label)
		}
		byLabel[detail.Items[i].Label] = detail.Items[i]
	}

	// item-a fully allocated (6), productCost unchanged
	itemA := byLabel["item-a"]
	itemABC, _ := decimal.NewFromString(itemA.BudgetCost)
	if !itemABC.Equal(decimal.NewFromInt(6)) {
		t.Fatalf("item-a budgetCost = %s want 6", itemABC.String())
	}
	itemAPC, _ := decimal.NewFromString(itemA.ProductCost)
	if !itemAPC.Equal(decimal.NewFromInt(1)) {
		t.Fatalf("item-a productCost = %s want 1 (unchanged)", itemAPC.String())
	}

	// item-b partially allocated (4 of 8), productCost unchanged
	itemB := byLabel["item-b"]
	itemBBC, _ := decimal.NewFromString(itemB.BudgetCost)
	if !itemBBC.Equal(decimal.NewFromInt(4)) {
		t.Fatalf("item-b budgetCost = %s want 4", itemBBC.String())
	}
	itemBPC, _ := decimal.NewFromString(itemB.ProductCost)
	if !itemBPC.Equal(decimal.NewFromInt(1)) {
		t.Fatalf("item-b productCost = %s want 1 (unchanged)", itemBPC.String())
	}

	// Overage = 8 - 4 = 4
	overage := byLabel["allowed-overage"]
	overagePC, _ := decimal.NewFromString(overage.ProductCost)
	if !overagePC.Equal(decimal.NewFromInt(4)) {
		t.Fatalf("overage productCost = %s want 4", overagePC.String())
	}

	// Top-level totals: budgetCost = 6 + 4 = 10, productCost = 1 + 1 + 4 = 6
	bcTotal, _ := decimal.NewFromString(detail.BudgetCostTotal)
	if !bcTotal.Equal(decimal.NewFromInt(10)) {
		t.Fatalf("BudgetCostTotal = %s want 10", bcTotal.String())
	}
	pcTotal, _ := decimal.NewFromString(detail.ProductCostTotal)
	if !pcTotal.Equal(decimal.NewFromInt(6)) {
		t.Fatalf("ProductCostTotal = %s want 6", pcTotal.String())
	}
}

func TestCreateSessionReportAllowOverageZeroBudget(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "overage-zero-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "5.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	// Create both sessions while budget has capacity
	sessionID1 := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID1, nil, false); err != nil {
		t.Fatal(err)
	}
	sessionID2 := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID2, nil, false); err != nil {
		t.Fatal(err)
	}

	// Exhaust all credits via the first session
	_, _, err := st.CreateSessionReport(ctx, sessionID1, []ReportLineInput{
		{BudgetCost: "5.000000", ProductCost: "0.000000", Label: "exhaust"},
	}, false)
	if err != nil {
		t.Fatalf("exhaust report: %v", err)
	}

	reportID, _, err := st.CreateSessionReport(ctx, sessionID2, []ReportLineInput{
		{BudgetCost: "3.000000", ProductCost: "1.000000", Label: "post-exhaust"},
	}, true)
	if err != nil {
		t.Fatalf("CreateSessionReport zero-budget allowOverage: %v", err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID2, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}

	if len(detail.Items) != 2 {
		t.Fatalf("report items = %d want 2", len(detail.Items))
	}

	byLabel := make(map[string]SessionReportItemOut, len(detail.Items))
	for i := range detail.Items {
		if _, dup := byLabel[detail.Items[i].Label]; dup {
			t.Fatalf("duplicate label %q in report items", detail.Items[i].Label)
		}
		byLabel[detail.Items[i].Label] = detail.Items[i]
	}

	// Original item should have 0 budget_cost (nothing allocated)
	mainItem := byLabel["post-exhaust"]
	mainBC, _ := decimal.NewFromString(mainItem.BudgetCost)
	if !mainBC.IsZero() {
		t.Fatalf("post-exhaust budgetCost = %s want 0", mainBC.String())
	}
	if len(mainItem.BudgetItems) != 0 {
		t.Fatalf("post-exhaust allocations = %d want 0", len(mainItem.BudgetItems))
	}

	// Entire request becomes overage
	overage := byLabel["allowed-overage"]
	overagePC, _ := decimal.NewFromString(overage.ProductCost)
	if !overagePC.Equal(decimal.NewFromInt(3)) {
		t.Fatalf("overage productCost = %s want 3", overagePC.String())
	}

	// Top-level totals: budgetCost = 0, productCost = 1 + 3 = 4
	bcTotal, _ := decimal.NewFromString(detail.BudgetCostTotal)
	if !bcTotal.IsZero() {
		t.Fatalf("BudgetCostTotal = %s want 0", bcTotal.String())
	}
	pcTotal, _ := decimal.NewFromString(detail.ProductCostTotal)
	if !pcTotal.Equal(decimal.NewFromInt(4)) {
		t.Fatalf("ProductCostTotal = %s want 4", pcTotal.String())
	}
}

func TestCreateSessionReportAllowOverageNoOverageWhenSufficient(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "overage-suff-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "5.000000", ProductCost: "5.000000", Label: "fits"},
	}, true)
	if err != nil {
		t.Fatalf("CreateSessionReport with allowOverage (sufficient): %v", err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}

	if len(detail.Items) != 1 {
		t.Fatalf("report items = %d want 1 (no overage appended)", len(detail.Items))
	}
	if detail.Items[0].Label != "fits" {
		t.Fatalf("item label = %q want fits", detail.Items[0].Label)
	}
}

func TestCreateSessionReportDefaultStrictRejectsOverage(t *testing.T) {
	ctx := context.Background()
	st := testIntegrationStore(t)

	productKey := "overage-strict-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, productKey); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	startsAt := now.Add(-24 * time.Hour).Format(time.RFC3339)

	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, productKey, []ItemInput{
		{CreditsTotal: "5.000000", CostCreditRatio: "1.000000", StartsAt: &startsAt},
	}); err != nil {
		t.Fatal(err)
	}

	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil, false); err != nil {
		t.Fatal(err)
	}

	_, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "8.000000", ProductCost: "2.000000", Label: "exceeds"},
	}, false)
	if err == nil {
		t.Fatal("expected INSUFFICIENT_CREDITS error, got nil")
	}
	if err != ErrInsufficientCredits {
		t.Fatalf("expected ErrInsufficientCredits, got: %v", err)
	}
}
