// Package budget provides data access operations for credit budgets.
package budget

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	sq "github.com/Masterminds/squirrel"
	"github.com/google/uuid"

	"github.com/airo-ai-builder/budget-service/pkg/models"
)

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

// psql is the PostgreSQL query builder with $1, $2, ... placeholders.
var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// PostgresRepository provides budget data operations using PostgreSQL.
// All methods are safe for concurrent use.
type PostgresRepository struct {
	db *sql.DB
}

// NewRepository creates a new PostgresRepository with the given database connection.
func NewRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

// Create inserts a new budget into the database.
// The budget's current_value is initialized to max_credits.
// Returns the complete budget record including generated ID and timestamps.
func (r *PostgresRepository) Create(ctx context.Context, req models.CreateBudgetRequest) (*models.Budget, error) {
	var resetInterval sql.NullString
	if req.ResetInterval != "" {
		resetInterval = sql.NullString{String: string(req.ResetInterval), Valid: true}
	}

	// Use raw SQL for proper NUMERIC casting
	// Note: $4 is used twice to initialize both max_credits and current_value to the same value
	query := `INSERT INTO budgets
		(subscription_id, type, label, max_credits, current_value, conversion_factor, expiration_or_reset_date, reset_interval)
		VALUES ($1, $2, $3, $4::NUMERIC, $4::NUMERIC, $5::NUMERIC, $6, $7)
		RETURNING ` + columnsString()

	budget, err := r.scanBudget(r.db.QueryRowContext(ctx, query,
		req.SubscriptionID, req.Type, req.Label, req.MaxCredits,
		req.ConversionFactor, req.ExpirationOrResetDate, resetInterval))
	if err != nil {
		return nil, fmt.Errorf("failed to create budget: %w", err)
	}
	return budget, nil
}

// GetByID retrieves a single budget by its UUID.
// Returns (nil, nil) if no budget exists with the given ID.
func (r *PostgresRepository) GetByID(ctx context.Context, id uuid.UUID) (*models.Budget, error) {
	query, args, err := psql.Select(budgetColumns...).
		From("budgets").
		Where(sq.Eq{"id": id}).
		ToSql()
	if err != nil {
		return nil, fmt.Errorf("failed to build select query: %w", err)
	}

	budget, err := r.scanBudget(r.db.QueryRowContext(ctx, query, args...))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get budget: %w", err)
	}
	return budget, nil
}

// GetBySubscription retrieves all budgets belonging to a subscription.
// Results are ordered by expiration_or_reset_date ASC to support soonest-expiring-first allocation.
// Returns an empty slice (not nil) if no budgets exist for the subscription.
func (r *PostgresRepository) GetBySubscription(ctx context.Context, subscriptionID string) ([]models.Budget, error) {
	query, args, err := psql.Select(budgetColumns...).
		From("budgets").
		Where(sq.Eq{"subscription_id": subscriptionID}).
		OrderBy("expiration_or_reset_date ASC").
		ToSql()
	if err != nil {
		return nil, fmt.Errorf("failed to build select query: %w", err)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query budgets: %w", err)
	}
	defer rows.Close()

	budgets := make([]models.Budget, 0)
	for rows.Next() {
		budget, err := r.scanBudgetFromRows(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan budget: %w", err)
		}
		budgets = append(budgets, *budget)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate budgets: %w", err)
	}

	return budgets, nil
}

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

// Delete removes a budget from the database.
// Returns an error if the budget does not exist (rows affected = 0).
func (r *PostgresRepository) Delete(ctx context.Context, id uuid.UUID) error {
	query, args, err := psql.Delete("budgets").
		Where(sq.Eq{"id": id}).
		ToSql()
	if err != nil {
		return fmt.Errorf("failed to build delete query: %w", err)
	}

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to delete budget: %w", err)
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to get affected rows: %w", err)
	}
	if rows == 0 {
		return fmt.Errorf("budget not found")
	}

	return nil
}

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

// ResetBudget restores an interval budget to full capacity and advances its reset date.
// Sets current_value = max_credits and adds the reset_interval to expiration_or_reset_date.
// This implements "lazy reset" - budgets are reset on-demand when accessed past their reset date.
// Only valid for interval budgets with a non-null reset_interval.
func (r *PostgresRepository) ResetBudget(ctx context.Context, id uuid.UUID) error {
	// Only reset budgets with a valid reset_interval and past their reset date.
	// The expiration_or_reset_date < NOW() condition makes this idempotent under
	// concurrent access: if two requests race to reset the same budget, the first
	// advances the date past NOW() so the second becomes a no-op.
	query, args, err := psql.Update("budgets").
		Set("current_value", sq.Expr("max_credits")).
		Set("expiration_or_reset_date", sq.Expr(`expiration_or_reset_date +
			CASE reset_interval
				WHEN 'daily' THEN INTERVAL '1 day'
				WHEN 'monthly' THEN INTERVAL '1 month'
			END`)).
		Set("updated_at", sq.Expr("NOW()")).
		Where(sq.Eq{"id": id}).
		Where("reset_interval IN ('daily', 'monthly')").
		Where("expiration_or_reset_date < NOW()").
		ToSql()
	if err != nil {
		return fmt.Errorf("failed to build reset query: %w", err)
	}

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to reset budget: %w", err)
	}

	// rows == 0 is expected when a concurrent request already reset this budget
	// (the expiration_or_reset_date < NOW() guard makes this idempotent)
	_ = result

	return nil
}

// columnsString returns budget columns as a comma-separated string for RETURNING clauses.
func columnsString() string {
	return strings.Join(budgetColumns, ", ")
}

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
