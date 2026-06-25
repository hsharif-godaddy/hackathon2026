package store

import (
	"errors"

	"github.com/shopspring/decimal"
)

var (
	// ErrNotFound is returned when a budget, item, or session row is missing.
	ErrNotFound = errors.New("not found")
	// ErrAlreadyReconciled is returned when a second session report is posted (session already reconciled).
	ErrAlreadyReconciled = errors.New("already reconciled")
	// ErrConflict is returned when a product_key already exists (unique violation).
	ErrConflict = errors.New("conflict")
	// ErrUnknownProductKey is returned when creating a budget with an unregistered productKey.
	ErrUnknownProductKey = errors.New("unknown product key")
	// ErrInsufficientCredits is returned when a session report needs more credits than budget items have available.
	ErrInsufficientCredits = errors.New("insufficient credits")
	// ErrNoSessionCapacity is returned when POST session cannot proceed because the budget has active
	// budget_items but none are consumable (same walk as consumeBudgetCostUSD). Empty budgets use ErrNoBudgetItems instead.
	ErrNoSessionCapacity = errors.New("no session capacity")
	// ErrNoBudgetItems is returned when a budget has no active (non-deleted) budget_items rows.
	ErrNoBudgetItems = errors.New("budget has no budget items")
	// ErrProductHasActiveBudgets is returned when deleting a product that still has active (non-deleted) budgets.
	ErrProductHasActiveBudgets = errors.New("product has active budgets")
	// ErrBudgetHasUnreconciledSessions is returned when deleting a budget that still has open sessions.
	ErrBudgetHasUnreconciledSessions = errors.New("budget has unreconciled sessions")
	// ErrDuplicateCallRequestID is returned when a session item reuses an existing callRequestId for that session.
	ErrDuplicateCallRequestID = errors.New("duplicate callRequestId")
	// ErrReportAggregateNoFilter is returned when neither product key nor label is set for report cost aggregation.
	ErrReportAggregateNoFilter = errors.New("report aggregate requires product key and/or label")
	// ErrResetIntervalInvalidFormat is returned when resetInterval does not match the allowed pattern.
	ErrResetIntervalInvalidFormat = errors.New("reset interval invalid format")
	// ErrResetIntervalOutOfRange is returned when the numeric portion is invalid or overflows supported range.
	ErrResetIntervalOutOfRange = errors.New("reset interval numeric out of range")
	// ErrCreditsUsedExceedsTotal is returned when creditsUsed would exceed creditsTotal.
	ErrCreditsUsedExceedsTotal = errors.New("creditsUsed cannot exceed creditsTotal")
	// ErrCreditsUsedNegative is returned when creditsUsed would become negative.
	ErrCreditsUsedNegative = errors.New("creditsUsed cannot be negative")
	// ErrReimbursementRequiresReduction is returned when a reimbursement entry does not reduce creditsUsed.
	ErrReimbursementRequiresReduction = errors.New("reimbursement requires a reduction in creditsUsed")
	// ErrIdempotencyKeyConflict is returned when a deduct request reuses an idempotency key against a different budget.
	ErrIdempotencyKeyConflict = errors.New("idempotency key used for a different budget")
)

// InsufficientCreditsError carries the credits actually available at the point a strict
// credit consumption was rejected, so callers can report the figure without recomputing it
// (the consumption walk already knows it). Unwraps to ErrInsufficientCredits, so existing
// errors.Is(err, ErrInsufficientCredits) checks keep working.
type InsufficientCreditsError struct {
	Available decimal.Decimal
}

func (e *InsufficientCreditsError) Error() string { return ErrInsufficientCredits.Error() }
func (e *InsufficientCreditsError) Unwrap() error { return ErrInsufficientCredits }
