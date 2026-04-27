package api

import "regexp"

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
