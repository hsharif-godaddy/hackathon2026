// internal/spend/engine.go
package spend

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

// Alert type constants for budget usage notifications.
const (
	AlertTypeExceeded = "exceeded"
	AlertTypeCritical = "critical_90pct_used"
	AlertTypeWarning  = "warning_80pct_used"
)

// budgetRepository defines the budget operations needed by the spend engine.
type budgetRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*models.Budget, error)
	GetBySubscription(ctx context.Context, subscriptionID string) ([]models.Budget, error)
	DecrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error)
	IncrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error)
	ResetBudget(ctx context.Context, id uuid.UUID) error
}

// Engine handles credit spending and release operations.
type Engine struct {
	repo                 budgetRepository
	warningThresholdPct  int
	criticalThresholdPct int
}

// NewEngine creates a new spend engine with the given repository and alert thresholds.
func NewEngine(repo budgetRepository, warningPct, criticalPct int) *Engine {
	return &Engine{
		repo:                 repo,
		warningThresholdPct:  warningPct,
		criticalThresholdPct: criticalPct,
	}
}

// Spend deducts credits from the subscription's budgets using soonest-expiring-first allocation.
// All arithmetic is performed in PostgreSQL using NUMERIC types.
func (e *Engine) Spend(ctx context.Context, subscriptionID string, amount string, opType, opID string) (*models.SpendResponse, error) {
	// 1. Get all active budgets ordered by expiration
	budgets, err := e.repo.GetBySubscription(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get budgets: %w", err)
	}

	if len(budgets) == 0 {
		return nil, fmt.Errorf("no budgets found for subscription %s", subscriptionID)
	}

	// 2. Lazy reset any interval budgets past their reset date
	for i := range budgets {
		if budgets[i].NeedsReset() {
			if err := e.repo.ResetBudget(ctx, budgets[i].ID); err != nil {
				return nil, fmt.Errorf("failed to reset budget: %w", err)
			}
			updated, err := e.repo.GetByID(ctx, budgets[i].ID)
			if err != nil {
				return nil, fmt.Errorf("failed to get updated budget: %w", err)
			}
			if updated != nil {
				budgets[i] = *updated
			}
		}
	}

	// 3. Spend from first budget (soonest expiring)
	targetBudget := budgets[0]
	newBalancePrecise, newBalanceRounded, err := e.repo.DecrementBalance(ctx, targetBudget.ID, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to spend credits: %w", err)
	}

	// Calculate amount spent (amount * conversion_factor) using decimal library
	amountDec, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, fmt.Errorf("invalid amount format: %w", err)
	}
	factorDec, err := decimal.NewFromString(targetBudget.ConversionFactor)
	if err != nil {
		return nil, fmt.Errorf("invalid conversion factor: %w", err)
	}
	amountSpent := amountDec.Mul(factorDec).StringFixed(6)

	allocation := models.Allocation{
		BudgetID:          targetBudget.ID.String(),
		Amount:            amountSpent,
		NewBalance:        newBalancePrecise,
		NewBalanceRounded: newBalanceRounded,
	}

	// 4. Calculate total balance (sum precise values using decimal)
	totalBalanceDec := decimal.Zero
	for _, b := range budgets {
		if b.ID == targetBudget.ID {
			val, _ := decimal.NewFromString(newBalancePrecise)
			totalBalanceDec = totalBalanceDec.Add(val)
		} else {
			val, _ := decimal.NewFromString(b.CurrentValue)
			totalBalanceDec = totalBalanceDec.Add(val)
		}
	}
	totalBalance := totalBalanceDec.StringFixed(6)
	totalBalanceRounded := totalBalanceDec.Round(0).IntPart()

	// 5. Check for alerts
	alerts := e.checkAlerts(targetBudget, newBalanceRounded)

	return &models.SpendResponse{
		Success:             true,
		AmountRequested:     amount,
		AmountSpent:         amountSpent,
		Allocations:         []models.Allocation{allocation},
		TotalBalance:        totalBalance,
		TotalBalanceRounded: totalBalanceRounded,
		OverBudget:          newBalanceRounded < 0,
		Alerts:              alerts,
	}, nil
}

// Release returns previously spent credits back to the subscription's first budget.
// All arithmetic is performed in PostgreSQL using NUMERIC types.
func (e *Engine) Release(ctx context.Context, subscriptionID string, amount string, opType, opID string) (*models.ReleaseResponse, error) {
	// Get budgets
	budgets, err := e.repo.GetBySubscription(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get budgets: %w", err)
	}

	if len(budgets) == 0 {
		return nil, fmt.Errorf("no budgets found for subscription %s", subscriptionID)
	}

	// Release to first budget
	targetBudget := budgets[0]
	newBalancePrecise, newBalanceRounded, err := e.repo.IncrementBalance(ctx, targetBudget.ID, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to release credits: %w", err)
	}

	// Calculate amount released (amount * conversion_factor) using decimal library
	amountDec, err := decimal.NewFromString(amount)
	if err != nil {
		return nil, fmt.Errorf("invalid amount format: %w", err)
	}
	factorDec, err := decimal.NewFromString(targetBudget.ConversionFactor)
	if err != nil {
		return nil, fmt.Errorf("invalid conversion factor: %w", err)
	}
	amountReleased := amountDec.Mul(factorDec).StringFixed(6)

	allocation := models.Allocation{
		BudgetID:          targetBudget.ID.String(),
		Amount:            amountReleased,
		NewBalance:        newBalancePrecise,
		NewBalanceRounded: newBalanceRounded,
	}

	// Calculate total balance (sum precise values using decimal)
	totalBalanceDec := decimal.Zero
	for _, b := range budgets {
		if b.ID == targetBudget.ID {
			val, _ := decimal.NewFromString(newBalancePrecise)
			totalBalanceDec = totalBalanceDec.Add(val)
		} else {
			val, _ := decimal.NewFromString(b.CurrentValue)
			totalBalanceDec = totalBalanceDec.Add(val)
		}
	}
	totalBalance := totalBalanceDec.StringFixed(6)
	totalBalanceRounded := totalBalanceDec.Round(0).IntPart()

	return &models.ReleaseResponse{
		Success:             true,
		Allocations:         []models.Allocation{allocation},
		TotalBalance:        totalBalance,
		TotalBalanceRounded: totalBalanceRounded,
	}, nil
}

func (e *Engine) checkAlerts(budget models.Budget, newBalanceRounded int64) []models.Alert {
	var alerts []models.Alert

	if newBalanceRounded < 0 {
		alerts = append(alerts, models.Alert{
			Type:     AlertTypeExceeded,
			BudgetID: budget.ID.String(),
			Current:  newBalanceRounded,
		})
		return alerts
	}

	// Parse MaxCredits string to decimal for threshold calculation
	maxCreditsDec, err := decimal.NewFromString(budget.MaxCredits)
	if err != nil || maxCreditsDec.LessThanOrEqual(decimal.Zero) {
		return alerts
	}
	maxCreditsRounded := maxCreditsDec.Round(0).IntPart()

	// Defensive guard: avoid division by zero if data is inconsistent
	if maxCreditsRounded <= 0 {
		return alerts
	}

	percentRemaining := float64(newBalanceRounded) / float64(maxCreditsRounded) * 100

	// Alert when remaining credits fall below thresholds
	// criticalThresholdPct=10 means alert when <=10% remaining (i.e., 90% used)
	// warningThresholdPct=20 means alert when <=20% remaining (i.e., 80% used)
	if percentRemaining <= float64(e.criticalThresholdPct) {
		alerts = append(alerts, models.Alert{
			Type:      AlertTypeCritical,
			BudgetID:  budget.ID.String(),
			Threshold: int64(e.criticalThresholdPct),
			Current:   newBalanceRounded,
		})
	} else if percentRemaining <= float64(e.warningThresholdPct) {
		alerts = append(alerts, models.Alert{
			Type:      AlertTypeWarning,
			BudgetID:  budget.ID.String(),
			Threshold: int64(e.warningThresholdPct),
			Current:   newBalanceRounded,
		})
	}

	return alerts
}
