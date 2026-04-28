package api

import "regexp"

// maxFieldLen bounds identifier and label fields at the API boundary. Because
// both identifierRe and labelRe only permit ASCII, len(s) (byte count) and
// char_length(s) (Unicode codepoint count) agree for all fields that also have
// DB-level char_length CHECK constraints (today: products.product_key and
// budget_session_items.call_request_id; budget_session_report_items.label is
// length-checked only at the API). Widening either regex to non-ASCII (e.g. for
// i18n label support) would break that equivalence - update both the API and
// DB checks together, and add a DB check for any newly-constrained field.
const maxFieldLen = 256

var identifierRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._:\-]*$`)
var labelRe = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9 ._:\-/]*$`)

func validateIdentifier(s string) string {
	if len(s) > maxFieldLen {
		return "exceeds maximum length"
	}
	if !identifierRe.MatchString(s) {
		return "contains invalid characters"
	}
	return ""
}

func validateLabel(s string) string {
	if len(s) > maxFieldLen {
		return "exceeds maximum length"
	}
	if !labelRe.MatchString(s) {
		return "contains invalid characters"
	}
	return ""
}
