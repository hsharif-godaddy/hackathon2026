//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

func TestSpend_Basic(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget with 10000 credits
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Test Budget",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	// Spend 100 credits
	result, err := client.Spend(subID, models.SpendRequest{
		Amount:        "100",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	if !result.Success {
		t.Error("expected success true")
	}
	if result.AmountRequested != "100.000000" {
		t.Errorf("expected amount requested 100.000000, got %s", result.AmountRequested)
	}
	if result.AmountSpent != "100.000000" {
		t.Errorf("expected amount spent 100.000000, got %s", result.AmountSpent)
	}
	if result.TotalBalanceRounded != 9900 {
		t.Errorf("expected total balance 9900, got %d", result.TotalBalanceRounded)
	}
	if result.OverBudget {
		t.Error("expected over budget false")
	}
}

func TestSpend_ConversionFactor(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget with 0.9 conversion factor
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Discounted Budget",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "0.9000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	// Spend 100 credits (should cost 90 from budget)
	result, err := client.Spend(subID, models.SpendRequest{
		Amount:        "100",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	if result.AmountSpent != "90.000000" {
		t.Errorf("expected amount spent 90.000000 (100 * 0.9), got %s", result.AmountSpent)
	}
	if result.TotalBalanceRounded != 9910 {
		t.Errorf("expected total balance 9910, got %d", result.TotalBalanceRounded)
	}
}

func TestSpend_MultibudgetOrdering(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget expiring sooner (should be spent first)
	budget1, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Expiring Soon",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(10 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget 1 failed: %v", err)
	}
	defer client.DeleteBudget(budget1.ID.String())

	// Create budget expiring later
	budget2, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Expiring Later",
		MaxCredits:            "5000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(60 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget 2 failed: %v", err)
	}
	defer client.DeleteBudget(budget2.ID.String())

	// Spend 100 credits - should come from budget1 (expiring sooner)
	result, err := client.Spend(subID, models.SpendRequest{
		Amount:        "100",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	if len(result.Allocations) != 1 {
		t.Fatalf("expected 1 allocation, got %d", len(result.Allocations))
	}
	if result.Allocations[0].BudgetID != budget1.ID.String() {
		t.Errorf("expected allocation from budget1 (%s), got %s", budget1.ID, result.Allocations[0].BudgetID)
	}
	if result.Allocations[0].NewBalanceRounded != 900 {
		t.Errorf("expected new balance 900, got %d", result.Allocations[0].NewBalanceRounded)
	}
}

func TestSpend_SoftLimit(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget with only 100 credits
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Small Budget",
		MaxCredits:            "100.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	// Spend 150 credits (more than available - should allow overspend)
	result, err := client.Spend(subID, models.SpendRequest{
		Amount:        "150",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	if !result.Success {
		t.Error("expected success true (soft limit)")
	}
	if !result.OverBudget {
		t.Error("expected over budget true")
	}
	if result.TotalBalanceRounded != -50 {
		t.Errorf("expected total balance -50, got %d", result.TotalBalanceRounded)
	}
}

func TestSpend_Alerts(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget with 1000 credits
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Alert Test",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	// Spend 850 credits (leaves 15% - should trigger 80% warning)
	result, err := client.Spend(subID, models.SpendRequest{
		Amount:        "850",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	if len(result.Alerts) == 0 {
		t.Error("expected alert for 80% threshold")
	} else if result.Alerts[0].Type != "warning_80pct" {
		t.Errorf("expected warning_80pct alert, got %s", result.Alerts[0].Type)
	}
}

func TestRelease_Basic(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create budget
	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Release Test",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}
	defer client.DeleteBudget(budget.ID.String())

	// Spend 500 credits
	_, err = client.Spend(subID, models.SpendRequest{
		Amount:        "500",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Spend failed: %v", err)
	}

	// Release 200 credits
	result, err := client.Release(subID, models.ReleaseRequest{
		Amount:        "200",
		OperationType: "test",
		OperationID:   "op-1",
	})
	if err != nil {
		t.Fatalf("Release failed: %v", err)
	}

	if !result.Success {
		t.Error("expected success true")
	}
	// After: 10000 - 500 + 200 = 9700
	if result.TotalBalanceRounded != 9700 {
		t.Errorf("expected total balance 9700, got %d", result.TotalBalanceRounded)
	}
}
