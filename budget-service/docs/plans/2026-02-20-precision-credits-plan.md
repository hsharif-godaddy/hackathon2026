# Precision Credits Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update budget service to store credits with 6 decimal places, perform all math in PostgreSQL, and return rounded whole numbers in API responses.

**Architecture:** Migrate schema to NUMERIC(20,6), change Go models to use strings for precision values, update repository queries to cast types and round results, remove all Go-side credit arithmetic.

**Tech Stack:** Go, PostgreSQL NUMERIC, database/sql string scanning

---

## Task 1: Create Migration File

**Files:**

- Create: `migrations/002_precision_credits.sql`

**Step 1: Create migration**

```sql
-- migrations/002_precision_credits.sql
-- Up migration: Convert credit columns from BIGINT to NUMERIC(20,6)

-- Change column types to support 6 decimal places
ALTER TABLE budgets
  ALTER COLUMN max_credits TYPE NUMERIC(20,6),
  ALTER COLUMN current_value TYPE NUMERIC(20,6);

-- Recreate constraint for decimal values
ALTER TABLE budgets DROP CONSTRAINT IF EXISTS positive_max_credits;
ALTER TABLE budgets ADD CONSTRAINT positive_max_credits CHECK (max_credits > 0);

-- Down migration (comment block for reference)
-- ALTER TABLE budgets ALTER COLUMN max_credits TYPE BIGINT;
-- ALTER TABLE budgets ALTER COLUMN current_value TYPE BIGINT;
-- ALTER TABLE budgets DROP CONSTRAINT positive_max_credits;
-- ALTER TABLE budgets ADD CONSTRAINT positive_max_credits CHECK (max_credits > 0);
```

**Step 2: Commit**

```bash
git add migrations/002_precision_credits.sql
git commit -m "feat(budget-service): add migration for precision credits"
```

---

## Task 2: Update Budget Model

**Files:**

- Modify: `pkg/models/budget.go`

**Step 1: Update Budget struct**

Replace the current Budget struct with precision fields:

```go
// pkg/models/budget.go
package models

import (
	"time"

	"github.com/google/uuid"
)

type BudgetType string

const (
	BudgetTypeInterval BudgetType = "interval"
	BudgetTypeBurndown BudgetType = "burndown"
)

type ResetInterval string

const (
	ResetIntervalDaily   ResetInterval = "daily"
	ResetIntervalMonthly ResetInterval = "monthly"
)

// Budget represents a credit budget with precise decimal values.
// Credit values are stored as strings to preserve NUMERIC(20,6) precision.
// Rounded values are provided for display purposes.
type Budget struct {
	ID                    uuid.UUID      `json:"budgetId"`
	SubscriptionID        string         `json:"subscriptionId"`
	Type                  BudgetType     `json:"type"`
	Label                 string         `json:"label"`
	MaxCredits            string         `json:"maxCredits"`            // Precise NUMERIC value
	CurrentValue          string         `json:"currentValue"`          // Precise NUMERIC value
	MaxCreditsRounded     int64          `json:"maxCreditsRounded"`     // ROUND(max_credits)
	CurrentValueRounded   int64          `json:"currentValueRounded"`   // ROUND(current_value)
	ConversionFactor      string         `json:"conversionFactor"`      // Precise DECIMAL value
	ExpirationOrResetDate time.Time      `json:"expirationOrResetDate"`
	ResetInterval         *ResetInterval `json:"resetInterval,omitempty"`
	CreatedAt             time.Time      `json:"createdAt"`
	UpdatedAt             time.Time      `json:"updatedAt"`
}

// NeedsReset returns true if this interval budget is past its reset date.
func (b *Budget) NeedsReset() bool {
	if b.Type != BudgetTypeInterval || b.ResetInterval == nil {
		return false
	}
	return time.Now().After(b.ExpirationOrResetDate)
}
```

**Step 2: Verify build**

Run: `go build ./...`
Expected: Build fails (type mismatches in other files) - this is expected

**Step 3: Commit**

```bash
git add pkg/models/budget.go
git commit -m "feat(budget-service): update Budget model for precision credits"
```

---

## Task 3: Update API Models

**Files:**

- Modify: `pkg/models/api.go`

**Step 1: Update request and response types**

```go
// pkg/models/api.go
package models

import "time"

// Request types

type CreateBudgetRequest struct {
	SubscriptionID        string        `json:"subscriptionId"`
	Type                  BudgetType    `json:"type"`
	Label                 string        `json:"label"`
	MaxCredits            string        `json:"maxCredits"`       // Decimal string, e.g., "1000.50"
	ConversionFactor      string        `json:"conversionFactor"` // Decimal string, e.g., "1.5"
	ExpirationOrResetDate time.Time     `json:"expirationOrResetDate"`
	ResetInterval         ResetInterval `json:"resetInterval,omitempty"`
}

type UpdateBudgetRequest struct {
	Label                 *string        `json:"label,omitempty"`
	MaxCredits            *string        `json:"maxCredits,omitempty"`       // Decimal string
	ConversionFactor      *string        `json:"conversionFactor,omitempty"` // Decimal string
	ExpirationOrResetDate *time.Time     `json:"expirationOrResetDate,omitempty"`
	ResetInterval         *ResetInterval `json:"resetInterval,omitempty"`
}

type SpendRequest struct {
	Amount        string `json:"amount"` // Decimal string, e.g., "50.123456"
	OperationType string `json:"operationType,omitempty"`
	OperationID   string `json:"operationId,omitempty"`
}

type ReleaseRequest struct {
	Amount        string `json:"amount"` // Decimal string
	OperationType string `json:"operationType,omitempty"`
	OperationID   string `json:"operationId,omitempty"`
}

// Response types

type BudgetsResponse struct {
	SubscriptionID           string   `json:"subscriptionId"`
	TotalMaxCredits          string   `json:"totalMaxCredits"`          // Precise sum
	TotalCurrentValue        string   `json:"totalCurrentValue"`        // Precise sum
	TotalMaxCreditsRounded   int64    `json:"totalMaxCreditsRounded"`   // Rounded sum
	TotalCurrentValueRounded int64    `json:"totalCurrentValueRounded"` // Rounded sum
	Budgets                  []Budget `json:"budgets"`
}

type Allocation struct {
	BudgetID          string `json:"budgetId"`
	Amount            string `json:"amount"`            // Precise amount spent/released
	NewBalance        string `json:"newBalance"`        // Precise new balance
	NewBalanceRounded int64  `json:"newBalanceRounded"` // Rounded new balance
}

type Alert struct {
	Type      string `json:"type"`
	BudgetID  string `json:"budgetId"`
	Threshold int64  `json:"threshold,omitempty"`
	Current   int64  `json:"current"` // Rounded current value
}

type SpendResponse struct {
	Success             bool         `json:"success"`
	AmountRequested     string       `json:"amountRequested"`     // Precise
	AmountSpent         string       `json:"amountSpent"`         // Precise (after conversion)
	Allocations         []Allocation `json:"allocations"`
	TotalBalance        string       `json:"totalBalance"`        // Precise
	TotalBalanceRounded int64        `json:"totalBalanceRounded"` // Rounded
	OverBudget          bool         `json:"overBudget"`
	Alerts              []Alert      `json:"alerts"`
}

type ReleaseResponse struct {
	Success             bool         `json:"success"`
	Allocations         []Allocation `json:"allocations"`
	TotalBalance        string       `json:"totalBalance"`        // Precise
	TotalBalanceRounded int64        `json:"totalBalanceRounded"` // Rounded
}

type HealthResponse struct {
	Status   string `json:"status"`
	Version  string `json:"version"`
	Database string `json:"database"`
	Uptime   string `json:"uptime"`
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Code    string `json:"code,omitempty"`
	Details string `json:"details,omitempty"`
}
```

**Step 2: Commit**

```bash
git add pkg/models/api.go
git commit -m "feat(budget-service): update API models for precision credits"
```

---

## Task 4: Update Repository Query Columns

**Files:**

- Modify: `internal/budget/repository.go`

**Step 1: Update budgetColumns and add scan helpers**

Update the column definitions and scan functions:

```go
// budgetColumns defines the standard column list for budget queries.
// Uses ::TEXT casts for NUMERIC columns to preserve precision in Go strings.
var budgetColumns = []string{
	"id", "subscription_id", "type", "label",
	"max_credits::TEXT", "current_value::TEXT",
	"ROUND(max_credits)::BIGINT AS max_credits_rounded",
	"ROUND(current_value)::BIGINT AS current_value_rounded",
	"conversion_factor::TEXT",
	"expiration_or_reset_date", "reset_interval", "created_at", "updated_at",
}
```

**Step 2: Update scanBudget function**

```go
// scanBudget scans a single row into a Budget model.
func (r *PostgresRepository) scanBudget(row *sql.Row) (*models.Budget, error) {
	var budget models.Budget
	var resetInterval sql.NullString

	err := row.Scan(
		&budget.ID, &budget.SubscriptionID, &budget.Type, &budget.Label,
		&budget.MaxCredits, &budget.CurrentValue,
		&budget.MaxCreditsRounded, &budget.CurrentValueRounded,
		&budget.ConversionFactor,
		&budget.ExpirationOrResetDate, &resetInterval, &budget.CreatedAt, &budget.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if resetInterval.Valid {
		ri := models.ResetInterval(resetInterval.String)
		budget.ResetInterval = &ri
	}

	return &budget, nil
}

// scanBudgetFromRows scans a row from sql.Rows into a Budget model.
func (r *PostgresRepository) scanBudgetFromRows(rows *sql.Rows) (*models.Budget, error) {
	var budget models.Budget
	var resetInterval sql.NullString

	err := rows.Scan(
		&budget.ID, &budget.SubscriptionID, &budget.Type, &budget.Label,
		&budget.MaxCredits, &budget.CurrentValue,
		&budget.MaxCreditsRounded, &budget.CurrentValueRounded,
		&budget.ConversionFactor,
		&budget.ExpirationOrResetDate, &resetInterval, &budget.CreatedAt, &budget.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if resetInterval.Valid {
		ri := models.ResetInterval(resetInterval.String)
		budget.ResetInterval = &ri
	}

	return &budget, nil
}
```

**Step 3: Commit**

```bash
git add internal/budget/repository.go
git commit -m "feat(budget-service): update repository column definitions for precision"
```

---

## Task 5: Update Repository Create Method

**Files:**

- Modify: `internal/budget/repository.go`

**Step 1: Update Create method for NUMERIC casting**

```go
// Create inserts a new budget into the database.
// The budget's current_value is initialized to max_credits.
// Returns the complete budget record including generated ID and timestamps.
func (r *PostgresRepository) Create(ctx context.Context, req models.CreateBudgetRequest) (*models.Budget, error) {
	var resetInterval sql.NullString
	if req.ResetInterval != "" {
		resetInterval = sql.NullString{String: string(req.ResetInterval), Valid: true}
	}

	// Use raw SQL for proper NUMERIC casting
	query := `INSERT INTO budgets
		(subscription_id, type, label, max_credits, current_value, conversion_factor, expiration_or_reset_date, reset_interval)
		VALUES ($1, $2, $3, $4::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)
		RETURNING ` + columnsString()

	return r.scanBudget(r.db.QueryRowContext(ctx, query,
		req.SubscriptionID, req.Type, req.Label, req.MaxCredits,
		req.ConversionFactor, req.ExpirationOrResetDate, resetInterval))
}
```

**Step 2: Update columnsString helper**

```go
// columnsString returns budget columns as a comma-separated string for RETURNING clauses.
func columnsString() string {
	return strings.Join(budgetColumns, ", ")
}
```

**Step 3: Commit**

```bash
git add internal/budget/repository.go
git commit -m "feat(budget-service): update repository Create for precision credits"
```

---

## Task 6: Update Repository Update Method

**Files:**

- Modify: `internal/budget/repository.go`

**Step 1: Update Update method**

```go
// Update modifies an existing budget with the provided fields.
// Uses raw SQL for dynamic updates with NUMERIC casting.
// Returns (nil, nil) if no budget exists with the given ID.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, req models.UpdateBudgetRequest) (*models.Budget, error) {
	// Build SET clause dynamically
	setClauses := []string{"updated_at = NOW()"}
	args := []any{}
	argNum := 1

	if req.Label != nil {
		setClauses = append(setClauses, fmt.Sprintf("label = $%d", argNum))
		args = append(args, *req.Label)
		argNum++
	}
	if req.MaxCredits != nil {
		setClauses = append(setClauses, fmt.Sprintf("max_credits = $%d::NUMERIC", argNum))
		args = append(args, *req.MaxCredits)
		argNum++
	}
	if req.ConversionFactor != nil {
		setClauses = append(setClauses, fmt.Sprintf("conversion_factor = $%d::NUMERIC", argNum))
		args = append(args, *req.ConversionFactor)
		argNum++
	}
	if req.ExpirationOrResetDate != nil {
		setClauses = append(setClauses, fmt.Sprintf("expiration_or_reset_date = $%d", argNum))
		args = append(args, *req.ExpirationOrResetDate)
		argNum++
	}
	if req.ResetInterval != nil {
		setClauses = append(setClauses, fmt.Sprintf("reset_interval = $%d", argNum))
		args = append(args, *req.ResetInterval)
		argNum++
	}

	args = append(args, id)
	query := fmt.Sprintf("UPDATE budgets SET %s WHERE id = $%d RETURNING %s",
		strings.Join(setClauses, ", "), argNum, columnsString())

	budget, err := r.scanBudget(r.db.QueryRowContext(ctx, query, args...))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to update budget: %w", err)
	}
	return budget, nil
}
```

**Step 2: Commit**

```bash
git add internal/budget/repository.go
git commit -m "feat(budget-service): update repository Update for precision credits"
```

---

## Task 7: Update Repository Balance Methods

**Files:**

- Modify: `internal/budget/repository.go`

**Step 1: Update DecrementBalance signature and implementation**

```go
// DecrementBalance atomically reduces the budget's current_value.
// The actual deduction is: amount * conversion_factor (computed in PostgreSQL).
// Returns both precise string value and rounded int64 for convenience.
func (r *PostgresRepository) DecrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error) {
	query := `UPDATE budgets
		SET current_value = current_value - ($1::NUMERIC * conversion_factor),
			updated_at = NOW()
		WHERE id = $2
		RETURNING current_value::TEXT, ROUND(current_value)::BIGINT`

	err = r.db.QueryRowContext(ctx, query, amount, id).Scan(&precise, &rounded)
	if err == sql.ErrNoRows {
		return "", 0, fmt.Errorf("budget not found")
	}
	if err != nil {
		return "", 0, fmt.Errorf("failed to decrement balance: %w", err)
	}
	return precise, rounded, nil
}
```

**Step 2: Update IncrementBalance signature and implementation**

```go
// IncrementBalance atomically increases the budget's current_value.
// The actual addition is: amount * conversion_factor (computed in PostgreSQL).
// Returns both precise string value and rounded int64 for convenience.
func (r *PostgresRepository) IncrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error) {
	query := `UPDATE budgets
		SET current_value = current_value + ($1::NUMERIC * conversion_factor),
			updated_at = NOW()
		WHERE id = $2
		RETURNING current_value::TEXT, ROUND(current_value)::BIGINT`

	err = r.db.QueryRowContext(ctx, query, amount, id).Scan(&precise, &rounded)
	if err == sql.ErrNoRows {
		return "", 0, fmt.Errorf("budget not found")
	}
	if err != nil {
		return "", 0, fmt.Errorf("failed to increment balance: %w", err)
	}
	return precise, rounded, nil
}
```

**Step 3: Commit**

```bash
git add internal/budget/repository.go
git commit -m "feat(budget-service): update repository balance methods for precision"
```

---

## Task 8: Update Spend Engine Interface

**Files:**

- Modify: `internal/spend/engine.go`

**Step 1: Update budgetRepository interface**

```go
// budgetRepository defines the budget operations needed by the spend engine.
type budgetRepository interface {
	GetByID(ctx context.Context, id uuid.UUID) (*models.Budget, error)
	GetBySubscription(ctx context.Context, subscriptionID string) ([]models.Budget, error)
	DecrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error)
	IncrementBalance(ctx context.Context, id uuid.UUID, amount string) (precise string, rounded int64, err error)
	ResetBudget(ctx context.Context, id uuid.UUID) error
}
```

**Step 2: Commit**

```bash
git add internal/spend/engine.go
git commit -m "feat(budget-service): update spend engine interface for precision"
```

---

## Task 9: Update Spend Engine Spend Method

**Files:**

- Modify: `internal/spend/engine.go`

**Step 1: Update imports (remove math package)**

```go
import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)
```

**Step 2: Add decimal dependency**

Run: `go get github.com/shopspring/decimal`

**Step 3: Update Spend method**

```go
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
	amountDec, _ := decimal.NewFromString(amount)
	factorDec, _ := decimal.NewFromString(targetBudget.ConversionFactor)
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
```

**Step 4: Commit**

```bash
git add internal/spend/engine.go go.mod go.sum
git commit -m "feat(budget-service): update Spend method for precision credits"
```

---

## Task 10: Update Spend Engine Release Method

**Files:**

- Modify: `internal/spend/engine.go`

**Step 1: Update Release method**

```go
// Release returns previously spent credits back to the subscription's first budget.
// All arithmetic is performed in PostgreSQL using NUMERIC types.
func (e *Engine) Release(ctx context.Context, subscriptionID string, amount string, opType, opID string) (*models.ReleaseResponse, error) {
	budgets, err := e.repo.GetBySubscription(ctx, subscriptionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get budgets: %w", err)
	}

	if len(budgets) == 0 {
		return nil, fmt.Errorf("no budgets found for subscription %s", subscriptionID)
	}

	targetBudget := budgets[0]
	newBalancePrecise, newBalanceRounded, err := e.repo.IncrementBalance(ctx, targetBudget.ID, amount)
	if err != nil {
		return nil, fmt.Errorf("failed to release credits: %w", err)
	}

	// Calculate amount released (amount * conversion_factor)
	amountDec, _ := decimal.NewFromString(amount)
	factorDec, _ := decimal.NewFromString(targetBudget.ConversionFactor)
	amountReleased := amountDec.Mul(factorDec).StringFixed(6)

	allocation := models.Allocation{
		BudgetID:          targetBudget.ID.String(),
		Amount:            amountReleased,
		NewBalance:        newBalancePrecise,
		NewBalanceRounded: newBalanceRounded,
	}

	// Calculate total balance
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
```

**Step 2: Commit**

```bash
git add internal/spend/engine.go
git commit -m "feat(budget-service): update Release method for precision credits"
```

---

## Task 11: Update Spend Engine Alerts

**Files:**

- Modify: `internal/spend/engine.go`

**Step 1: Update checkAlerts to use rounded values**

```go
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

	// Use rounded values for threshold comparison
	if budget.MaxCreditsRounded <= 0 {
		return alerts
	}

	percentRemaining := float64(newBalanceRounded) / float64(budget.MaxCreditsRounded) * 100

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
```

**Step 2: Remove applyConversionFactor function (no longer needed)**

Delete the `applyConversionFactor` function as all conversion is now done in PostgreSQL.

**Step 3: Commit**

```bash
git add internal/spend/engine.go
git commit -m "feat(budget-service): update alerts for precision credits"
```

---

## Task 12: Update API Handlers

**Files:**

- Modify: `internal/api/handlers.go`

**Step 1: Update handleCreateBudget validation**

```go
func (s *Server) handleCreateBudget(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var req models.CreateBudgetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate required fields
	if req.SubscriptionID == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingSubscriptionID)
		return
	}
	if len(req.SubscriptionID) > 21 {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidSubscriptionID)
		return
	}
	if req.Type != models.BudgetTypeInterval && req.Type != models.BudgetTypeBurndown {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidBudgetType)
		return
	}
	if req.Label == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingLabel)
		return
	}
	// Validate MaxCredits is a positive decimal string
	if req.MaxCredits == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidMaxCredits)
		return
	}
	maxCredits, err := decimal.NewFromString(req.MaxCredits)
	if err != nil || maxCredits.LessThanOrEqual(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidMaxCredits)
		return
	}
	// Validate ConversionFactor is a positive decimal string
	if req.ConversionFactor == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidConversionFactor)
		return
	}
	convFactor, err := decimal.NewFromString(req.ConversionFactor)
	if err != nil || convFactor.LessThanOrEqual(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidConversionFactor)
		return
	}
	if req.ExpirationOrResetDate.IsZero() {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingExpirationDate)
		return
	}
	if req.Type == models.BudgetTypeInterval && req.ResetInterval == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrMissingResetInterval)
		return
	}

	budget, err := s.budgetRepo.Create(r.Context(), req)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeCreateFailed, "failed to create budget").WithDetails(err.Error()))
		return
	}

	if err := s.auditLog.Log(logging.AuditEntry{
		Event:          "budget.created",
		SubscriptionID: req.SubscriptionID,
		BudgetID:       budget.ID.String(),
		Metadata:       req,
	}); err != nil {
		slog.Error("audit.log.failed", "event", "budget.created", "error", err)
	}

	writeJSON(w, http.StatusCreated, budget)
}
```

**Step 2: Add decimal import**

```go
import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
	"github.com/shopspring/decimal"

	"github.com/airo-ai-builder/budget-service/internal/logging"
	apierrors "github.com/airo-ai-builder/budget-service/pkg/errors"
	"github.com/airo-ai-builder/budget-service/pkg/models"
)
```

**Step 3: Commit**

```bash
git add internal/api/handlers.go
git commit -m "feat(budget-service): update handleCreateBudget for precision"
```

---

## Task 13: Update Spend and Release Handlers

**Files:**

- Modify: `internal/api/handlers.go`

**Step 1: Update handleGetBudgets**

```go
func (s *Server) handleGetBudgets(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	budgets, err := s.budgetRepo.GetBySubscription(r.Context(), subscriptionID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeNoBudgetsFound, "failed to get budgets").WithDetails(err.Error()))
		return
	}

	// Calculate totals using decimal library
	totalMaxDec := decimal.Zero
	totalCurrentDec := decimal.Zero
	for _, b := range budgets {
		max, _ := decimal.NewFromString(b.MaxCredits)
		current, _ := decimal.NewFromString(b.CurrentValue)
		totalMaxDec = totalMaxDec.Add(max)
		totalCurrentDec = totalCurrentDec.Add(current)
	}

	response := models.BudgetsResponse{
		SubscriptionID:           subscriptionID,
		TotalMaxCredits:          totalMaxDec.StringFixed(6),
		TotalCurrentValue:        totalCurrentDec.StringFixed(6),
		TotalMaxCreditsRounded:   totalMaxDec.Round(0).IntPart(),
		TotalCurrentValueRounded: totalCurrentDec.Round(0).IntPart(),
		Budgets:                  budgets,
	}

	writeJSON(w, http.StatusOK, response)
}
```

**Step 2: Update handleSpend**

```go
func (s *Server) handleSpend(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	var req models.SpendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate amount is a non-negative decimal string
	if req.Amount == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThan(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}

	response, err := s.spendEngine.Spend(r.Context(), subscriptionID, req.Amount, req.OperationType, req.OperationID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeSpendFailed, "failed to spend credits").WithDetails(err.Error()))
		return
	}

	for _, alloc := range response.Allocations {
		if err := s.auditLog.Log(logging.AuditEntry{
			Event:          "credits.spent",
			SubscriptionID: subscriptionID,
			BudgetID:       alloc.BudgetID,
			Amount:         alloc.Amount,
			BalanceAfter:   alloc.NewBalanceRounded,
			OperationType:  req.OperationType,
			OperationID:    req.OperationID,
		}); err != nil {
			slog.Error("audit.log.failed", "event", "credits.spent", "error", err)
		}
	}

	writeJSON(w, http.StatusOK, response)
}
```

**Step 3: Update handleRelease**

```go
func (s *Server) handleRelease(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	vars := mux.Vars(r)
	subscriptionID := vars["subscriptionId"]

	var req models.ReleaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidRequestBody.WithDetails(err.Error()))
		return
	}

	// Validate amount is a non-negative decimal string
	if req.Amount == "" {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}
	amount, err := decimal.NewFromString(req.Amount)
	if err != nil || amount.LessThan(decimal.Zero) {
		writeAPIError(w, http.StatusBadRequest, apierrors.ErrInvalidCredits)
		return
	}

	response, err := s.spendEngine.Release(r.Context(), subscriptionID, req.Amount, req.OperationType, req.OperationID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, apierrors.NewAPIError(apierrors.CodeReleaseFailed, "failed to release credits").WithDetails(err.Error()))
		return
	}

	for _, alloc := range response.Allocations {
		if err := s.auditLog.Log(logging.AuditEntry{
			Event:          "credits.released",
			SubscriptionID: subscriptionID,
			BudgetID:       alloc.BudgetID,
			Amount:         alloc.Amount,
			BalanceAfter:   alloc.NewBalanceRounded,
			OperationType:  req.OperationType,
			OperationID:    req.OperationID,
		}); err != nil {
			slog.Error("audit.log.failed", "event", "credits.released", "error", err)
		}
	}

	writeJSON(w, http.StatusOK, response)
}
```

**Step 4: Commit**

```bash
git add internal/api/handlers.go
git commit -m "feat(budget-service): update spend/release handlers for precision"
```

---

## Task 14: Update Audit Logger

**Files:**

- Modify: `internal/logging/audit.go`

**Step 1: Update AuditEntry struct**

Change the Credits and BalanceAfter fields to support string amounts:

```go
type AuditEntry struct {
	Timestamp      time.Time `json:"timestamp"`
	Event          string    `json:"event"`
	SubscriptionID string    `json:"subscriptionId,omitempty"`
	BudgetID       string    `json:"budgetId,omitempty"`
	Amount         string    `json:"amount,omitempty"`         // Changed from Credits int64
	BalanceAfter   int64     `json:"balanceAfter,omitempty"`   // Rounded value
	OperationType  string    `json:"operationType,omitempty"`
	OperationID    string    `json:"operationId,omitempty"`
	Metadata       any       `json:"metadata,omitempty"`
}
```

**Step 2: Commit**

```bash
git add internal/logging/audit.go
git commit -m "feat(budget-service): update audit logger for precision credits"
```

---

## Task 15: Build and Test

**Step 1: Build**

Run: `go build ./...`
Expected: Build succeeds

**Step 2: Run tests**

Run: `go test ./... -v`
Expected: Tests pass (some may need updates for new types)

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix(budget-service): fix any remaining type issues"
```

---

## Summary

After completing all tasks, you will have:

1. Migration for NUMERIC(20,6) column types
2. Budget model with string precision fields + rounded int64 fields
3. API models with string types for decimal values
4. Repository using ::TEXT and ::NUMERIC casts with PostgreSQL math
5. Spend engine using decimal library for totals (no float64 arithmetic)
6. Handlers validating decimal string inputs
7. Updated audit logging

**Key invariants:**

- All credit arithmetic happens in PostgreSQL
- Go uses strings to preserve precision
- Rounded values computed by PostgreSQL ROUND()
- No float64 arithmetic on credit values in Go
