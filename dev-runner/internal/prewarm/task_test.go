package prewarm

import "testing"

func TestSelectionEmpty(t *testing.T) {
	cases := []struct {
		name string
		sel  Selection
		want bool
	}{
		{"both", Selection{API: true, Docker: true}, false},
		{"api only", Selection{API: true}, false},
		{"docker only", Selection{Docker: true}, false},
		{"none", Selection{}, true},
	}
	for _, c := range cases {
		if got := c.sel.Empty(); got != c.want {
			t.Errorf("%s: Empty() = %v, want %v", c.name, got, c.want)
		}
	}
}
