//go:build integration

// Package budget provides integration tests for the budget repository.
// These tests require a running PostgreSQL instance.
// Run with: INTEGRATION_TEST=1 go test -tags=integration -v ./internal/budget/...
package budget

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/lib/pq"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

// testDB holds the shared database connection for repository tests.
var testDB *sql.DB

// TestMain sets up the database connection for all tests in this package.
func TestMain(m *testing.M) {
	if os.Getenv("INTEGRATION_TEST") != "1" {
		fmt.Println("Skipping integration tests (set INTEGRATION_TEST=1 to run)")
		os.Exit(0)
	}

	// Connect to test database
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://budget:budget@localhost:5432/budget_test?sslmode=disable"
	}

	var err error
	testDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		fmt.Printf("Failed to connect to database: %v\n", err)
		os.Exit(1)
	}

	// Verify connection
	if err := testDB.Ping(); err != nil {
		fmt.Printf("Failed to ping database: %v\n", err)
		os.Exit(1)
	}

	// Run tests
	code := m.Run()

	// Cleanup
	testDB.Close()
	os.Exit(code)
}

// cleanupBudget removes a budget by ID, ignoring errors (for test cleanup).
func cleanupBudget(ctx context.Context, repo *PostgresRepository, id string) {
	testDB.ExecContext(ctx, "DELETE FROM budgets WHERE id = $1", id)
}

// generateSubscriptionID creates a unique subscription ID for testing.
func generateSubscriptionID() string {
	return fmt.Sprintf("t%d", time.Now().UnixMilli())
}

func TestRepository_Create(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	t.Run("creates burndown budget", func(t *testing.T) {
		req := models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Test Burndown",
			MaxCredits:            "10000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour),
		}

		budget, err := repo.Create(ctx, req)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		defer cleanupBudget(ctx, repo, budget.ID.String())

		if budget.ID.String() == "" {
			t.Error("Expected budget ID to be set")
		}
		if budget.SubscriptionID != subID {
			t.Errorf("SubscriptionID = %q, want %q", budget.SubscriptionID, subID)
		}
		if budget.Type != models.BudgetTypeBurndown {
			t.Errorf("Type = %q, want %q", budget.Type, models.BudgetTypeBurndown)
		}
		if budget.Label != "Test Burndown" {
			t.Errorf("Label = %q, want %q", budget.Label, "Test Burndown")
		}
		if budget.MaxCreditsRounded != 10000 {
			t.Errorf("MaxCreditsRounded = %d, want %d", budget.MaxCreditsRounded, 10000)
		}
		if budget.CurrentValueRounded != 10000 {
			t.Errorf("CurrentValueRounded = %d, want %d (should equal MaxCreditsRounded)", budget.CurrentValueRounded, 10000)
		}
		if budget.ConversionFactor != "1.0000" {
			t.Errorf("ConversionFactor = %s, want %s", budget.ConversionFactor, "1.0000")
		}
		if budget.ResetInterval != nil {
			t.Errorf("ResetInterval = %v, want nil for burndown", budget.ResetInterval)
		}
	})

	t.Run("creates interval budget with reset interval", func(t *testing.T) {
		req := models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeInterval,
			Label:                 "Test Interval",
			MaxCredits:            "5000.000000",
			ConversionFactor:      "0.9000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
			ResetInterval:         models.ResetIntervalDaily,
		}

		budget, err := repo.Create(ctx, req)
		if err != nil {
			t.Fatalf("Create failed: %v", err)
		}
		defer cleanupBudget(ctx, repo, budget.ID.String())

		if budget.Type != models.BudgetTypeInterval {
			t.Errorf("Type = %q, want %q", budget.Type, models.BudgetTypeInterval)
		}
		if budget.ConversionFactor != "0.9000" {
			t.Errorf("ConversionFactor = %s, want %s", budget.ConversionFactor, "0.9000")
		}
		if budget.ResetInterval == nil {
			t.Fatal("ResetInterval should not be nil for interval budget")
		}
		if *budget.ResetInterval != models.ResetIntervalDaily {
			t.Errorf("ResetInterval = %q, want %q", *budget.ResetInterval, models.ResetIntervalDaily)
		}
	})
}

func TestRepository_GetByID(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	// Create a budget to retrieve
	budget, err := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Get Test",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("Setup: Create failed: %v", err)
	}
	defer cleanupBudget(ctx, repo, budget.ID.String())

	t.Run("retrieves existing budget", func(t *testing.T) {
		found, err := repo.GetByID(ctx, budget.ID)
		if err != nil {
			t.Fatalf("GetByID failed: %v", err)
		}
		if found == nil {
			t.Fatal("Expected budget, got nil")
		}
		if found.ID != budget.ID {
			t.Errorf("ID = %v, want %v", found.ID, budget.ID)
		}
		if found.Label != "Get Test" {
			t.Errorf("Label = %q, want %q", found.Label, "Get Test")
		}
	})

	t.Run("returns nil for non-existent budget", func(t *testing.T) {
		found, err := repo.GetByID(ctx, uuid.Nil)
		if err != nil {
			t.Fatalf("GetByID failed: %v", err)
		}
		if found != nil {
			t.Errorf("Expected nil for non-existent budget, got %v", found)
		}
	})
}

func TestRepository_GetBySubscription(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	// Create multiple budgets with different expiration dates
	budget1, _ := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Expires Last",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(90 * 24 * time.Hour), // 90 days
	})
	defer cleanupBudget(ctx, repo, budget1.ID.String())

	budget2, _ := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Expires First",
		MaxCredits:            "2000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(30 * 24 * time.Hour), // 30 days
	})
	defer cleanupBudget(ctx, repo, budget2.ID.String())

	budget3, _ := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Expires Middle",
		MaxCredits:            "3000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(60 * 24 * time.Hour), // 60 days
	})
	defer cleanupBudget(ctx, repo, budget3.ID.String())

	t.Run("returns budgets ordered by expiration date", func(t *testing.T) {
		budgets, err := repo.GetBySubscription(ctx, subID)
		if err != nil {
			t.Fatalf("GetBySubscription failed: %v", err)
		}
		if len(budgets) != 3 {
			t.Fatalf("Expected 3 budgets, got %d", len(budgets))
		}

		// Should be ordered: Expires First (30d), Expires Middle (60d), Expires Last (90d)
		if budgets[0].Label != "Expires First" {
			t.Errorf("First budget Label = %q, want %q", budgets[0].Label, "Expires First")
		}
		if budgets[1].Label != "Expires Middle" {
			t.Errorf("Second budget Label = %q, want %q", budgets[1].Label, "Expires Middle")
		}
		if budgets[2].Label != "Expires Last" {
			t.Errorf("Third budget Label = %q, want %q", budgets[2].Label, "Expires Last")
		}
	})

	t.Run("returns empty slice for non-existent subscription", func(t *testing.T) {
		budgets, err := repo.GetBySubscription(ctx, "nonexistent-sub")
		if err != nil {
			t.Fatalf("GetBySubscription failed: %v", err)
		}
		if budgets == nil {
			t.Error("Expected empty slice, got nil")
		}
		if len(budgets) != 0 {
			t.Errorf("Expected 0 budgets, got %d", len(budgets))
		}
	})
}

func TestRepository_Update(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	// Create a budget to update
	budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Original Label",
		MaxCredits:            "1000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
	})
	defer cleanupBudget(ctx, repo, budget.ID.String())

	t.Run("updates single field", func(t *testing.T) {
		newLabel := "Updated Label"
		updated, err := repo.Update(ctx, budget.ID, models.UpdateBudgetRequest{
			Label: &newLabel,
		})
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if updated.Label != "Updated Label" {
			t.Errorf("Label = %q, want %q", updated.Label, "Updated Label")
		}
		// Other fields should remain unchanged
		if updated.MaxCreditsRounded != 1000 {
			t.Errorf("MaxCreditsRounded = %d, want %d (unchanged)", updated.MaxCreditsRounded, 1000)
		}
	})

	t.Run("updates multiple fields", func(t *testing.T) {
		newLabel := "Multi Update"
		newMaxCredits := "5000.000000"
		newFactor := "0.8000"

		updated, err := repo.Update(ctx, budget.ID, models.UpdateBudgetRequest{
			Label:            &newLabel,
			MaxCredits:       &newMaxCredits,
			ConversionFactor: &newFactor,
		})
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if updated.Label != "Multi Update" {
			t.Errorf("Label = %q, want %q", updated.Label, "Multi Update")
		}
		if updated.MaxCreditsRounded != 5000 {
			t.Errorf("MaxCreditsRounded = %d, want %d", updated.MaxCreditsRounded, 5000)
		}
		if updated.ConversionFactor != "0.8000" {
			t.Errorf("ConversionFactor = %s, want %s", updated.ConversionFactor, "0.8000")
		}
	})

	t.Run("returns nil for non-existent budget", func(t *testing.T) {
		newLabel := "Does Not Exist"
		updated, err := repo.Update(ctx, uuid.Nil, models.UpdateBudgetRequest{
			Label: &newLabel,
		})
		if err != nil {
			t.Fatalf("Update failed: %v", err)
		}
		if updated != nil {
			t.Errorf("Expected nil for non-existent budget, got %v", updated)
		}
	})
}

func TestRepository_Delete(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	t.Run("deletes existing budget", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "To Delete",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})

		err := repo.Delete(ctx, budget.ID)
		if err != nil {
			t.Fatalf("Delete failed: %v", err)
		}

		// Verify it's gone
		found, _ := repo.GetByID(ctx, budget.ID)
		if found != nil {
			t.Error("Budget should not exist after deletion")
		}
	})

	t.Run("returns error for non-existent budget", func(t *testing.T) {
		err := repo.Delete(ctx, uuid.Nil)
		if err == nil {
			t.Error("Expected error for deleting non-existent budget")
		}
	})
}

func TestRepository_DecrementBalance(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	t.Run("decrements balance with conversion factor 1.0", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Decrement Test",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		_, rounded, err := repo.DecrementBalance(ctx, budget.ID, "100")
		if err != nil {
			t.Fatalf("DecrementBalance failed: %v", err)
		}
		if rounded != 900 {
			t.Errorf("rounded = %d, want %d", rounded, 900)
		}

		// Verify in database
		found, _ := repo.GetByID(ctx, budget.ID)
		if found.CurrentValueRounded != 900 {
			t.Errorf("CurrentValueRounded = %d, want %d", found.CurrentValueRounded, 900)
		}
	})

	t.Run("decrements balance with conversion factor", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Conversion Test",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "0.5000", // 50% conversion
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		// Spend 100, should deduct 50 (100 * 0.5)
		_, rounded, err := repo.DecrementBalance(ctx, budget.ID, "100")
		if err != nil {
			t.Fatalf("DecrementBalance failed: %v", err)
		}
		if rounded != 950 {
			t.Errorf("rounded = %d, want %d (100 * 0.5 = 50 deducted)", rounded, 950)
		}
	})

	t.Run("allows negative balance (soft limit)", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Negative Test",
			MaxCredits:            "100.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		// Spend more than available
		_, rounded, err := repo.DecrementBalance(ctx, budget.ID, "150")
		if err != nil {
			t.Fatalf("DecrementBalance failed: %v", err)
		}
		if rounded != -50 {
			t.Errorf("rounded = %d, want %d (negative balance allowed)", rounded, -50)
		}
	})
}

func TestRepository_IncrementBalance(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	t.Run("increments balance", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Increment Test",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		// First decrement to have room to increment
		repo.DecrementBalance(ctx, budget.ID, "500")

		_, rounded, err := repo.IncrementBalance(ctx, budget.ID, "200")
		if err != nil {
			t.Fatalf("IncrementBalance failed: %v", err)
		}
		if rounded != 700 {
			t.Errorf("rounded = %d, want %d", rounded, 700)
		}
	})

	t.Run("increments with conversion factor", func(t *testing.T) {
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeBurndown,
			Label:                 "Increment Conversion",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "0.5000",
			ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		// Decrement first
		repo.DecrementBalance(ctx, budget.ID, "200") // -100 (200 * 0.5)

		// Increment 100, should add 50 (100 * 0.5)
		_, rounded, err := repo.IncrementBalance(ctx, budget.ID, "100")
		if err != nil {
			t.Fatalf("IncrementBalance failed: %v", err)
		}
		if rounded != 950 {
			t.Errorf("rounded = %d, want %d", rounded, 950)
		}
	})
}

func TestRepository_ResetBudget(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	t.Run("resets daily interval budget", func(t *testing.T) {
		originalResetDate := time.Now().Add(-1 * time.Hour) // Past due for reset
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeInterval,
			Label:                 "Daily Reset",
			MaxCredits:            "1000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: originalResetDate,
			ResetInterval:         models.ResetIntervalDaily,
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		// Spend some credits
		repo.DecrementBalance(ctx, budget.ID, "500")

		// Reset the budget
		err := repo.ResetBudget(ctx, budget.ID)
		if err != nil {
			t.Fatalf("ResetBudget failed: %v", err)
		}

		// Verify reset
		found, _ := repo.GetByID(ctx, budget.ID)
		if found.CurrentValue != found.MaxCredits {
			t.Errorf("CurrentValue = %s, want %s (should be reset to MaxCredits)", found.CurrentValue, found.MaxCredits)
		}

		// Verify date advanced by 1 day
		expectedDate := originalResetDate.Add(24 * time.Hour)
		if found.ExpirationOrResetDate.Sub(expectedDate) > time.Minute {
			t.Errorf("ExpirationOrResetDate not advanced by 1 day")
		}
	})

	t.Run("resets monthly interval budget", func(t *testing.T) {
		originalResetDate := time.Now().Add(-1 * time.Hour)
		budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
			SubscriptionID:        subID,
			Type:                  models.BudgetTypeInterval,
			Label:                 "Monthly Reset",
			MaxCredits:            "5000.000000",
			ConversionFactor:      "1.0000",
			ExpirationOrResetDate: originalResetDate,
			ResetInterval:         models.ResetIntervalMonthly,
		})
		defer cleanupBudget(ctx, repo, budget.ID.String())

		repo.DecrementBalance(ctx, budget.ID, "3000")

		err := repo.ResetBudget(ctx, budget.ID)
		if err != nil {
			t.Fatalf("ResetBudget failed: %v", err)
		}

		found, _ := repo.GetByID(ctx, budget.ID)
		if found.CurrentValueRounded != 5000 {
			t.Errorf("CurrentValueRounded = %d, want %d", found.CurrentValueRounded, 5000)
		}
	})
}

func TestRepository_ConcurrentDecrements(t *testing.T) {
	repo := NewRepository(testDB)
	ctx := context.Background()
	subID := generateSubscriptionID()

	budget, _ := repo.Create(ctx, models.CreateBudgetRequest{
		SubscriptionID:        subID,
		Type:                  models.BudgetTypeBurndown,
		Label:                 "Concurrent Test",
		MaxCredits:            "10000.000000",
		ConversionFactor:      "1.0000",
		ExpirationOrResetDate: time.Now().Add(24 * time.Hour),
	})
	defer cleanupBudget(ctx, repo, budget.ID.String())

	// Run concurrent decrements
	numGoroutines := 100
	decrementAmount := "10"
	done := make(chan bool, numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			_, _, err := repo.DecrementBalance(ctx, budget.ID, decrementAmount)
			if err != nil {
				t.Errorf("DecrementBalance failed: %v", err)
			}
			done <- true
		}()
	}

	// Wait for all goroutines
	for i := 0; i < numGoroutines; i++ {
		<-done
	}

	// Verify final balance
	found, _ := repo.GetByID(ctx, budget.ID)
	expectedBalance := int64(10000 - (numGoroutines * 10))
	if found.CurrentValueRounded != expectedBalance {
		t.Errorf("CurrentValueRounded = %d, want %d (concurrent operations should be atomic)", found.CurrentValueRounded, expectedBalance)
	}
}
