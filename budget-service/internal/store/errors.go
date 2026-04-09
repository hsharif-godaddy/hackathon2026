package store

import "errors"

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
	// ErrNoSessionCapacity is returned when POST session cannot proceed: no budget_items or no consumable pool (same walk as consumeBudgetCostUSD).
	ErrNoSessionCapacity = errors.New("no session capacity")
	// ErrProductHasActiveBudgets is returned when deleting a product that still has active (non-deleted) budgets.
	ErrProductHasActiveBudgets = errors.New("product has active budgets")
	// ErrBudgetHasUnreconciledSessions is returned when deleting a budget that still has open sessions.
	ErrBudgetHasUnreconciledSessions = errors.New("budget has unreconciled sessions")
	// ErrDuplicateCallRequestID is returned when a session item reuses an existing callRequestId for that session.
	ErrDuplicateCallRequestID = errors.New("duplicate callRequestId")
)
