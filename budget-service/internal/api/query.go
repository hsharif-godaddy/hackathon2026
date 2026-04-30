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

var allowedGetWebhooksQueryKeys = map[string]struct{}{
	"productKey": {},
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
