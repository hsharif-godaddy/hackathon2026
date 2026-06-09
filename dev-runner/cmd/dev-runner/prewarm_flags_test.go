package main

import (
	"testing"

	"github.com/airo-ai-builder/dev-runner/internal/prewarm"
)

func TestParsePrewarmFlags(t *testing.T) {
	cases := []struct {
		name    string
		args    []string
		want    prewarm.Selection
		wantErr bool
	}{
		{"no flags => both", nil, prewarm.Selection{API: true, Docker: true}, false},
		{"api only", []string{"--api"}, prewarm.Selection{API: true}, false},
		{"docker only", []string{"--docker"}, prewarm.Selection{Docker: true}, false},
		{"both explicit", []string{"--api", "--docker"}, prewarm.Selection{API: true, Docker: true}, false},
		{"unknown", []string{"--nope"}, prewarm.Selection{}, true},
	}
	for _, c := range cases {
		got, err := parsePrewarmFlags(c.args)
		if (err != nil) != c.wantErr {
			t.Errorf("%s: err = %v, wantErr %v", c.name, err, c.wantErr)
			continue
		}
		if !c.wantErr && got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}
