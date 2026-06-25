package store

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"
)

// Parses the report.created webhook payload that DeductCredits enqueues so the
// control plane can advance grant spend for credit-only deductions.
type whReportCreatedAlloc struct {
	BudgetItemID string `json:"budgetItemId"`
	CreditsUsed  string `json:"creditsUsed"`
}

type whReportCreatedItem struct {
	BudgetItems []whReportCreatedAlloc `json:"budgetItems"`
}

type whReportCreatedPayload struct {
	BudgetID    string                `json:"budgetId"`
	SessionID   string                `json:"sessionId"`
	ReportID    string                `json:"reportId"`
	ReportItems []whReportCreatedItem `json:"reportItems"`
}

func deductWebhookSetup(t *testing.T, items []ItemInput) (*Store, context.Context, string, string) {
	t.Helper()
	st := testIntegrationStore(t)
	ctx := context.Background()
	pk := "deduct-wh-" + uuid.NewString()[:8]
	if _, err := st.CreateProduct(ctx, pk); err != nil {
		t.Fatal(err)
	}
	budgetID := uuid.NewString()
	if err := st.CreateBudget(ctx, budgetID, pk, items); err != nil {
		t.Fatal(err)
	}
	return st, ctx, pk, budgetID
}

func reportCreatedRows(t *testing.T, st *Store, ctx context.Context, pk string) []whReportCreatedPayload {
	t.Helper()
	rows, err := st.db.QueryContext(ctx,
		`SELECT payload FROM webhook_outbox WHERE event_type = 'report.created' AND product_key = $1`, pk)
	if err != nil {
		t.Fatalf("query outbox: %v", err)
	}
	defer func() { _ = rows.Close() }()
	var out []whReportCreatedPayload
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			t.Fatalf("scan payload: %v", err)
		}
		var p whReportCreatedPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("unmarshal payload %s: %v", raw, err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows err: %v", err)
	}
	return out
}

// TestDeductCredits_EmitsReportCreatedWebhook verifies a successful deduct enqueues exactly one
// report.created outbox event carrying the budget id, a synthetic "deduct" session, a non-empty
// report id, and the per-budget-item creditsUsed deltas.
func TestDeductCredits_EmitsReportCreatedWebhook(t *testing.T) {
	st, ctx, pk, budgetID := deductWebhookSetup(t, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "0.100000"},
	})

	if _, err := st.DeductCredits(ctx, DeductInput{
		BudgetID:       budgetID,
		Credits:        decimal.RequireFromString("30"),
		IdempotencyKey: uuid.NewString(),
		Reason:         "deploy",
	}); err != nil {
		t.Fatalf("DeductCredits: %v", err)
	}

	events := reportCreatedRows(t, st, ctx, pk)
	if len(events) != 1 {
		t.Fatalf("expected 1 report.created event, got %d", len(events))
	}
	ev := events[0]
	if ev.BudgetID != budgetID {
		t.Errorf("budgetId: want %s, got %s", budgetID, ev.BudgetID)
	}
	if ev.SessionID != "deduct" {
		t.Errorf("sessionId: want \"deduct\", got %q", ev.SessionID)
	}
	if ev.ReportID == "" {
		t.Error("reportId should be non-empty")
	}
	if len(ev.ReportItems) != 1 || len(ev.ReportItems[0].BudgetItems) != 1 {
		t.Fatalf("expected 1 report item with 1 budget item, got %+v", ev.ReportItems)
	}
	if got := ev.ReportItems[0].BudgetItems[0].CreditsUsed; got != "30.000000" {
		t.Errorf("creditsUsed: want 30.000000, got %s", got)
	}
}

// TestDeductCredits_ReplayEmitsNoSecondWebhook verifies an idempotent replay does not enqueue a
// second report.created event (which would double-count spend at the control plane).
func TestDeductCredits_ReplayEmitsNoSecondWebhook(t *testing.T) {
	st, ctx, pk, budgetID := deductWebhookSetup(t, []ItemInput{
		{CreditsTotal: "100.000000", CostCreditRatio: "0.100000"},
	})
	key := uuid.NewString()
	in := DeductInput{
		BudgetID:       budgetID,
		Credits:        decimal.RequireFromString("25"),
		IdempotencyKey: key,
		Reason:         "image-gen",
	}
	if _, err := st.DeductCredits(ctx, in); err != nil {
		t.Fatalf("first deduct: %v", err)
	}
	res, err := st.DeductCredits(ctx, in)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !res.Replayed {
		t.Fatal("expected replay to report Replayed=true")
	}
	if events := reportCreatedRows(t, st, ctx, pk); len(events) != 1 {
		t.Fatalf("expected exactly 1 report.created event after replay, got %d", len(events))
	}
}

// TestDeductCredits_MultiItemSplitWebhook verifies a deduct spanning two budget items reports a
// per-item creditsUsed breakdown whose sum equals the deducted amount.
func TestDeductCredits_MultiItemSplitWebhook(t *testing.T) {
	st, ctx, pk, budgetID := deductWebhookSetup(t, []ItemInput{
		{CreditsTotal: "20.000000", CostCreditRatio: "0.100000"},
		{CreditsTotal: "100.000000", CostCreditRatio: "0.100000"},
	})

	if _, err := st.DeductCredits(ctx, DeductInput{
		BudgetID:       budgetID,
		Credits:        decimal.RequireFromString("50"),
		IdempotencyKey: uuid.NewString(),
	}); err != nil {
		t.Fatalf("DeductCredits: %v", err)
	}

	events := reportCreatedRows(t, st, ctx, pk)
	if len(events) != 1 {
		t.Fatalf("expected 1 report.created event, got %d", len(events))
	}
	allocs := events[0].ReportItems[0].BudgetItems
	if len(allocs) != 2 {
		t.Fatalf("expected 2 budget-item allocations, got %d (%+v)", len(allocs), allocs)
	}
	sum := decimal.Zero
	for _, a := range allocs {
		sum = sum.Add(decimal.RequireFromString(a.CreditsUsed))
	}
	if !sum.Equal(decimal.RequireFromString("50")) {
		t.Errorf("sum of creditsUsed: want 50, got %s", sum.String())
	}
}
