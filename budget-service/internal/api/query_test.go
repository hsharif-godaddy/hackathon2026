package api

import (
	"net/url"
	"testing"
)

func TestQueryIncludeDeleted(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		q    url.Values
		want bool
	}{
		{name: "absent", q: url.Values{}, want: false},
		{name: "empty", q: url.Values{"includeDeleted": {""}}, want: false},
		{name: "spaces", q: url.Values{"includeDeleted": {"   "}}, want: false},
		{name: "true", q: url.Values{"includeDeleted": {"true"}}, want: true},
		{name: "True", q: url.Values{"includeDeleted": {"True"}}, want: true},
		{name: "TRUE", q: url.Values{"includeDeleted": {"TRUE"}}, want: true},
		{name: "one", q: url.Values{"includeDeleted": {"1"}}, want: true},
		{name: "false", q: url.Values{"includeDeleted": {"false"}}, want: false},
		{name: "zero", q: url.Values{"includeDeleted": {"0"}}, want: false},
		{name: "yes", q: url.Values{"includeDeleted": {"yes"}}, want: false},
	}
	for i := range cases {
		tc := cases[i]
		if got := queryIncludeDeleted(tc.q); got != tc.want {
			t.Fatalf("%s: queryIncludeDeleted got %v want %v (q=%v)", tc.name, got, tc.want, tc.q)
		}
	}
}
