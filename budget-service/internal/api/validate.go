package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
)

// maxFieldLen bounds identifier and label fields at the API boundary. Because
// both identifierRe and labelRe only permit ASCII, len(s) (byte count) and
// char_length(s) (Unicode codepoint count) agree for all fields that also have
// DB-level char_length CHECK constraints (today: products.product_key and
// budget_session_items.call_request_id; budget_session_report_items.label is
// length-checked only at the API). Widening either regex to non-ASCII (e.g. for
// i18n label support) would break that equivalence - update both the API and
// DB checks together, and add a DB check for any newly-constrained field.
const maxFieldLen = 256

const (
	maxSessionMetadataBytes = 256 << 10 // raw JSON bytes for budget_sessions.metadata (jsonb)
	maxMetadataDepth        = 5         // maximum nesting depth in metadata JSON
	maxDateStringLen        = 64        // RFC3339 is ~25 chars; generous ceiling
	maxDecimalLen           = 64        // NUMERIC(20,6) values are never longer than ~28 chars
)

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

func jsonDepth(data []byte) (int, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	max, depth := 0, 0
	for {
		t, err := dec.Token()
		if err != nil {
			if err == io.EOF {
				break
			}
			return 0, fmt.Errorf("jsonDepth: %w", err)
		}
		switch t {
		case json.Delim('{'), json.Delim('['):
			depth++
			if depth > max {
				max = depth
			}
		case json.Delim('}'), json.Delim(']'):
			depth--
		}
	}
	return max, nil
}
