// Package errors defines error codes and messages for the budget service API.
// Error codes enable frontend translation and programmatic error handling.
package errors

// Error codes for API responses.
const (
	// Validation errors (1xxx)
	CodeInvalidRequestBody      = "INVALID_REQUEST_BODY"
	CodeMissingSubscriptionID   = "MISSING_SUBSCRIPTION_ID"
	CodeInvalidSubscriptionID   = "INVALID_SUBSCRIPTION_ID"
	CodeMissingBudgetType       = "MISSING_BUDGET_TYPE"
	CodeInvalidBudgetType       = "INVALID_BUDGET_TYPE"
	CodeMissingLabel            = "MISSING_LABEL"
	CodeInvalidMaxCredits       = "INVALID_MAX_CREDITS"
	CodeInvalidConversionFactor = "INVALID_CONVERSION_FACTOR"
	CodeMissingExpirationDate   = "MISSING_EXPIRATION_DATE"
	CodeMissingResetInterval    = "MISSING_RESET_INTERVAL"
	CodeInvalidBudgetID         = "INVALID_BUDGET_ID"
	CodeInvalidCredits          = "INVALID_CREDITS"

	// Resource errors (2xxx)
	CodeBudgetNotFound = "BUDGET_NOT_FOUND"
	CodeNoBudgetsFound = "NO_BUDGETS_FOUND"

	// Operation errors (3xxx)
	CodeCreateFailed  = "CREATE_FAILED"
	CodeUpdateFailed  = "UPDATE_FAILED"
	CodeDeleteFailed  = "DELETE_FAILED"
	CodeSpendFailed   = "SPEND_FAILED"
	CodeReleaseFailed = "RELEASE_FAILED"

	// Auth errors (4xxx)
	CodeMissingAuthToken     = "MISSING_AUTH_TOKEN"
	CodeInvalidToken         = "INVALID_TOKEN"
	CodeTokenExpired         = "TOKEN_EXPIRED"
	CodeSubscriptionMismatch = "SUBSCRIPTION_MISMATCH"
	CodeAdminRequired        = "ADMIN_REQUIRED"
	CodeAdminNotAllowed      = "ADMIN_NOT_ALLOWED"
	CodeAuthContextMissing   = "AUTH_CONTEXT_MISSING"
)

// APIError represents a structured error response with code and message.
type APIError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details string `json:"details,omitempty"`
}

// Error implements the error interface.
func (e APIError) Error() string {
	return e.Message
}

// Common errors for reuse across handlers.
var (
	ErrInvalidRequestBody = APIError{
		Code:    CodeInvalidRequestBody,
		Message: "invalid request body",
	}
	ErrMissingSubscriptionID = APIError{
		Code:    CodeMissingSubscriptionID,
		Message: "subscriptionId is required",
	}
	ErrInvalidSubscriptionID = APIError{
		Code:    CodeInvalidSubscriptionID,
		Message: "subscriptionId exceeds maximum length",
		Details: "maximum 21 characters",
	}
	ErrInvalidBudgetType = APIError{
		Code:    CodeInvalidBudgetType,
		Message: "type must be 'interval' or 'burndown'",
	}
	ErrMissingLabel = APIError{
		Code:    CodeMissingLabel,
		Message: "label is required",
	}
	ErrInvalidMaxCredits = APIError{
		Code:    CodeInvalidMaxCredits,
		Message: "maxCredits must be positive",
	}
	ErrInvalidConversionFactor = APIError{
		Code:    CodeInvalidConversionFactor,
		Message: "conversionFactor must be positive",
	}
	ErrMissingExpirationDate = APIError{
		Code:    CodeMissingExpirationDate,
		Message: "expirationOrResetDate is required",
	}
	ErrMissingResetInterval = APIError{
		Code:    CodeMissingResetInterval,
		Message: "resetInterval is required for interval budgets",
	}
	ErrInvalidBudgetID = APIError{
		Code:    CodeInvalidBudgetID,
		Message: "invalid budget ID",
	}
	ErrInvalidCredits = APIError{
		Code:    CodeInvalidCredits,
		Message: "credits must be non-negative",
	}
	ErrBudgetNotFound = APIError{
		Code:    CodeBudgetNotFound,
		Message: "budget not found",
	}
	ErrMissingAuthToken = APIError{
		Code:    CodeMissingAuthToken,
		Message: "authorization header required",
	}
	ErrInvalidToken = APIError{
		Code:    CodeInvalidToken,
		Message: "invalid or malformed token",
	}
	ErrTokenExpired = APIError{
		Code:    CodeTokenExpired,
		Message: "token has expired",
	}
	ErrSubscriptionMismatch = APIError{
		Code:    CodeSubscriptionMismatch,
		Message: "token subscription does not match requested resource",
	}
	ErrAdminRequired = APIError{
		Code:    CodeAdminRequired,
		Message: "admin authentication required",
	}
	ErrAdminNotAllowed = APIError{
		Code:    CodeAdminNotAllowed,
		Message: "admin identity not in allowlist",
	}
	ErrAuthContextMissing = APIError{
		Code:    CodeAuthContextMissing,
		Message: "auth context not found - middleware ordering error",
	}
)

// NewAPIError creates a new APIError with the given code and message.
func NewAPIError(code, message string) APIError {
	return APIError{Code: code, Message: message}
}

// WithDetails returns a copy of the error with additional details.
func (e APIError) WithDetails(details string) APIError {
	e.Details = details
	return e
}
