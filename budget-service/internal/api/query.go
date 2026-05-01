package api

import (
	"net/http"
	"net/url"
	"slices"
	"strings"
)

var allowedGetReportsQueryKeys = map[string]struct{}{
	"budgetId":   {},
	"limit":      {},
	"offset":     {},
	"order":      {},
	"productKey": {},
	"sessionId":  {},
	"sort":       {},
}

var allowedGetReportsAggregateQueryKeys = map[string]struct{}{
	"budgetId":   {},
	"from":       {},
	"label":      {},
	"productKey": {},
	"sessionId":  {},
	"to":         {},
}

var allowedGetWebhookQueryKeys = map[string]struct{}{
	"includeDeleted": {},
}

var allowedGetWebhooksQueryKeys = map[string]struct{}{
	"includeDeleted": {},
	"productKey":     {},
}

var allowedGetBudgetItemQueryKeys = map[string]struct{}{
	"includeDeleted": {},
}

var allowedGetBudgetQueryKeys = map[string]struct{}{
	"includeDeleted": {},
}

var allowedGetProductsQueryKeys = map[string]struct{}{
	"includeDeleted": {},
}

// queryIncludeDeleted is true when includeDeleted is "1" or "true" (case-insensitive).
func queryIncludeDeleted(q url.Values) bool {
	v := strings.TrimSpace(q.Get("includeDeleted"))
	return v == "1" || strings.EqualFold(v, "true")
}

func rejectUnknownQueryKeys(w http.ResponseWriter, q url.Values, allowed map[string]struct{}) bool {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var unknown []string
	for _, k := range keys {
		if _, ok := allowed[k]; !ok {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		writeError(w, http.StatusBadRequest, "BAD_REQUEST", "unknown query parameters: "+strings.Join(unknown, ", "))
		return false
	}
	return true
}
