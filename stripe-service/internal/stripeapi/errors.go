package stripeapi

import "fmt"

// StripeError wraps Stripe's standard JSON error envelope:
//
//	{
//	  "error": {
//	    "type": "invalid_request_error",
//	    "code": "missing_param",
//	    "message": "Missing required param: type."
//	  }
//	}
//
// Callers branch on errors.As to make retry decisions (see IsRetryable)
// or surface specific error codes upward (e.g. "rate_limit",
// "resource_missing"). Use a *StripeError target — Error() is on the
// pointer receiver, so a value target panics with
// "*target must be interface or implement error":
//
//	var se *stripeapi.StripeError
//	if errors.As(err, &se) {
//	    if se.IsRetryable() { /* schedule retry */ }
//	}
type StripeError struct {
	HTTPStatus int
	Type       string
	Code       string
	Message    string
	// Raw is a truncated prefix of the response body, kept for log-grepping
	// when the standard envelope can't be parsed.
	Raw string
}

func (e *StripeError) Error() string {
	// Prefer the structured envelope. Fall back to Raw when Message is
	// empty (e.g. Stripe envelope with no message), then to "<empty body>"
	// when nothing useful is left — log lines without these fallbacks
	// look truncated ("stripe 502: ", "stripe 400 invalid_request_error/: ").
	switch {
	case e.Type != "" && e.Message != "":
		return fmt.Sprintf("stripe %d %s/%s: %s", e.HTTPStatus, e.Type, e.Code, e.Message)
	case e.Type != "" && e.Raw != "":
		return fmt.Sprintf("stripe %d %s/%s: %s", e.HTTPStatus, e.Type, e.Code, e.Raw)
	case e.Type != "":
		return fmt.Sprintf("stripe %d %s/%s", e.HTTPStatus, e.Type, e.Code)
	case e.Raw != "":
		return fmt.Sprintf("stripe %d: %s", e.HTTPStatus, e.Raw)
	default:
		return fmt.Sprintf("stripe %d: <empty body>", e.HTTPStatus)
	}
}

// IsRetryable reports whether the error is a transient class that
// callers should retry. 5xx and 429 are retryable; everything else
// (including all other 4xx) is not.
func (e *StripeError) IsRetryable() bool {
	if e.HTTPStatus == 429 {
		return true
	}
	return e.HTTPStatus >= 500 && e.HTTPStatus < 600
}
