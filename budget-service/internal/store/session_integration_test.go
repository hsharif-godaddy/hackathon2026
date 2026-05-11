package store

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestCreateBudgetSessionSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-create-" + uuid.NewString()
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
	err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil)
	if err != nil {
		t.Fatalf("CreateBudgetSession: %v", err)
	}
}

func TestCreateBudgetSessionBudgetNotFound(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()

	err := st.CreateBudgetSession(ctx, uuid.NewString(), uuid.NewString(), nil)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

func TestGetBudgetSession(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-get-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	d, err := st.GetBudgetSession(ctx, sessionID)
	if err != nil {
		t.Fatalf("GetBudgetSession: %v", err)
	}
	if d.BudgetID != budgetID {
		t.Fatalf("BudgetID = %q want %q", d.BudgetID, budgetID)
	}
	if d.CostTotal != "0.000000" {
		t.Fatalf("CostTotal = %q want 0.000000", d.CostTotal)
	}
	if d.ReconciledAt != nil {
		t.Fatal("new session should not be reconciled")
	}
}

func TestAppendSessionItemsSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-append-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	lines := []SessionLine{
		{Cost: "5.000000", CallRequestID: "call-1"},
		{Cost: "3.000000", CallRequestID: "call-2"},
	}
	_, _, err := st.AppendSessionItems(ctx, sessionID, lines)
	if err != nil {
		t.Fatalf("AppendSessionItems: %v", err)
	}

	d, _ := st.GetBudgetSession(ctx, sessionID)
	if d.CostTotal != "8.000000" {
		t.Fatalf("CostTotal after append = %q want 8.000000", d.CostTotal)
	}
	if len(d.Lines) != 2 {
		t.Fatalf("Lines count = %d want 2", len(d.Lines))
	}
}

func TestAppendSessionItemsDuplicateCallRequestID(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-dup-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}

	lines := []SessionLine{{Cost: "1.000000", CallRequestID: "dup-call"}}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, lines); err != nil {
		t.Fatal(err)
	}
	_, _, err := st.AppendSessionItems(ctx, sessionID, lines)
	if !errors.Is(err, ErrDuplicateCallRequestID) {
		t.Fatalf("expected ErrDuplicateCallRequestID, got %v", err)
	}
}

func TestCreateSessionReportSuccess(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-report-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "10.000000", CallRequestID: "report-call-1"},
	}); err != nil {
		t.Fatal(err)
	}

	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "10.000000", ProductCost: "10.000000", Label: "test"},
	}, false)
	if err != nil {
		t.Fatalf("CreateSessionReport: %v", err)
	}
	if _, err := uuid.Parse(reportID); err != nil {
		t.Fatalf("reportID is not a valid UUID: %q", reportID)
	}
}

func TestCreateSessionReportAlreadyReconciled(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-double-report-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "5.000000", CallRequestID: "reconcile-call"},
	}); err != nil {
		t.Fatal(err)
	}

	_, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "5.000000", ProductCost: "5.000000", Label: "test"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	_, _, err = st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "5.000000", ProductCost: "5.000000", Label: "test"},
	}, false)
	if !errors.Is(err, ErrAlreadyReconciled) {
		t.Fatalf("expected ErrAlreadyReconciled, got %v", err)
	}
}

func TestGetSessionReport(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-get-report-" + uuid.NewString()
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
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "7.000000", CallRequestID: "get-report-call"},
	}); err != nil {
		t.Fatal(err)
	}
	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "7.000000", ProductCost: "7.000000", Label: "compute"},
	}, false)
	if err != nil {
		t.Fatal(err)
	}

	detail, err := st.GetSessionReport(ctx, sessionID, reportID)
	if err != nil {
		t.Fatalf("GetSessionReport: %v", err)
	}
	if detail.ReportID != reportID {
		t.Fatalf("ReportID = %q want %q", detail.ReportID, reportID)
	}
	if detail.BudgetID != budgetID {
		t.Fatalf("BudgetID = %q want %q", detail.BudgetID, budgetID)
	}
	if len(detail.Items) != 1 {
		t.Fatalf("Items count = %d want 1", len(detail.Items))
	}
	if detail.Items[0].Label != "compute" {
		t.Fatalf("Label = %q want compute", detail.Items[0].Label)
	}
}

func TestListSessionReports(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-list-reports-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}

	// Create 2 sessions, each with a report
	for i := 0; i < 2; i++ {
		sessionID := uuid.NewString()
		if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
			t.Fatal(err)
		}
		if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
			{Cost: "1.000000", CallRequestID: uuid.NewString()},
		}); err != nil {
			t.Fatal(err)
		}
		if _, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
			{BudgetCost: "1.000000", ProductCost: "1.000000", Label: "test"},
		}, false); err != nil {
			t.Fatal(err)
		}
	}

	rows, total, err := st.ListSessionReports(ctx, ListSessionReportsFilter{
		BudgetID: budgetID,
		Limit:    50,
	})
	if err != nil {
		t.Fatalf("ListSessionReports: %v", err)
	}
	if total < 2 {
		t.Fatalf("total = %d want >= 2", total)
	}
	if len(rows) < 2 {
		t.Fatalf("rows = %d want >= 2", len(rows))
	}
}

func TestCreateSessionReportAllowOverage(t *testing.T) {
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "session-overage-" + uuid.NewString()
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, []ItemInput{
		{CreditsTotal: "10.000000", CostCreditRatio: "1.000000"},
	}); err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if err := st.CreateBudgetSession(ctx, budgetID, sessionID, nil); err != nil {
		t.Fatal(err)
	}
	if _, _, err := st.AppendSessionItems(ctx, sessionID, []SessionLine{
		{Cost: "5.000000", CallRequestID: "overage-call"},
	}); err != nil {
		t.Fatal(err)
	}

	// Report cost exceeds budget: should fail without allowOverage
	_, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "15.000000", ProductCost: "15.000000", Label: "big"},
	}, false)
	if !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("expected ErrInsufficientCredits without allowOverage, got %v", err)
	}

	// With allowOverage=true, should succeed
	reportID, _, err := st.CreateSessionReport(ctx, sessionID, []ReportLineInput{
		{BudgetCost: "15.000000", ProductCost: "15.000000", Label: "big"},
	}, true)
	if err != nil {
		t.Fatalf("CreateSessionReport with allowOverage: %v", err)
	}
	if reportID == "" {
		t.Fatal("expected non-empty reportID")
	}
}
