//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

func TestCreateBudget_Interval(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeInterval,
		Label:                 "Monthly Credits",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
		ResetInterval:         models.ResetIntervalMonthly,
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}

	if budget.ID.String() == "" {
		t.Error("expected budget ID to be set")
	}
	if budget.SubscriptionID != subID {
		t.Errorf("expected subscription ID %s, got %s", subID, budget.SubscriptionID)
	}
	if budget.Type != models.BudgetTypeInterval {
		t.Errorf("expected type interval, got %s", budget.Type)
	}
	if budget.MaxCreditsRounded != 10000 {
		t.Errorf("expected max credits 10000, got %d", budget.MaxCreditsRounded)
	}
	if budget.CurrentValueRounded != 10000 {
		t.Errorf("expected current value 10000, got %d", budget.CurrentValueRounded)
	}

	// Cleanup
	if err := client.DeleteBudget(budget.ID.String()); err != nil {
		t.Logf("cleanup failed: %v", err)
	}
}

func TestCreateBudget_Burndown(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Bonus Credits",
		MaxCredits:            "5000.000000",
		ConversionFactor:      "0.9000",
		ExpirationOrResetDate: time.Now().Add(90 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}

	if budget.Type != models.BudgetTypeBurndown {
		t.Errorf("expected type burndown, got %s", budget.Type)
	}
	if budget.ConversionFactor != "0.9000" {
		t.Errorf("expected conversion factor 0.9000, got %s", budget.ConversionFactor)
	}

	// Cleanup
	if err := client.DeleteBudget(budget.ID.String()); err != nil {
		t.Logf("cleanup failed: %v", err)
	}
}

func TestGetBudgets(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	// Create two budgets
	budget1, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeInterval,
		Label:                 "Monthly",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
		ResetInterval:         models.ResetIntervalMonthly,
	})
	if err != nil {
		t.Fatalf("CreateBudget 1 failed: %v", err)
	}

	budget2, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Bonus",
		MaxCredits:            "5000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(60 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget 2 failed: %v", err)
	}

	// Get budgets
	result, err := client.GetBudgets(subID)
	if err != nil {
		t.Fatalf("GetBudgets failed: %v", err)
	}

	if len(result.Budgets) != 2 {
		t.Errorf("expected 2 budgets, got %d", len(result.Budgets))
	}
	if result.TotalMaxCreditsRounded != 15000 {
		t.Errorf("expected total max 15000, got %d", result.TotalMaxCreditsRounded)
	}
	if result.TotalCurrentValueRounded != 15000 {
		t.Errorf("expected total current 15000, got %d", result.TotalCurrentValueRounded)
	}

	// Cleanup
	client.DeleteBudget(budget1.ID.String())
	client.DeleteBudget(budget2.ID.String())
}

func TestDeleteBudget(t *testing.T) {
	skipIfNoIntegration(t)
	client := NewClient()

	subID := generateSubscriptionID()

	budget, err := client.CreateBudget(models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "To Delete",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("CreateBudget failed: %v", err)
	}

	// Delete
	if err := client.DeleteBudget(budget.ID.String()); err != nil {
		t.Fatalf("DeleteBudget failed: %v", err)
	}

	// Verify deleted
	result, err := client.GetBudgets(subID)
	if err != nil {
		t.Fatalf("GetBudgets failed: %v", err)
	}
	if len(result.Budgets) != 0 {
		t.Errorf("expected 0 budgets after delete, got %d", len(result.Budgets))
	}
}
