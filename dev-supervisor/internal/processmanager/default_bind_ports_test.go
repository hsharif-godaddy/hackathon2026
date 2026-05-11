//nolint:testpackage // Tests the unexported resolveDefaultBindPorts helper.
package processmanager

import (
	"reflect"
	"testing"

	"github.com/airo-ai-builder/dev-supervisor/internal/sandbox"
	"github.com/airo-ai-builder/dev-supervisor/internal/validation"
)

func TestEffectiveBindPorts_CallerExplicitWins(t *testing.T) {
	t.Setenv("PORT", "9999")
	req := validation.ProcessStartRequest{
		Ports: []int{3000, 3001},
		Env:   map[string]string{"PORT": "20000"},
	}
	got := effectiveBindPorts(req, sandbox.VariantPublish, 8080)
	want := []int{3000, 3001}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("caller-explicit ports should pass through untouched: got %v, want %v", got, want)
	}
}

func TestEffectiveBindPorts_DefaultResolvedEachCall(t *testing.T) {
	// Simulates restart-after-PORT-change: same request, env differs between calls.
	req := validation.ProcessStartRequest{Env: nil}

	t.Setenv("PORT", "20000")
	first := effectiveBindPorts(req, sandbox.VariantPreview, 8080)

	t.Setenv("PORT", "3333")
	second := effectiveBindPorts(req, sandbox.VariantPreview, 8080)

	if reflect.DeepEqual(first, second) {
		t.Errorf("effectiveBindPorts should re-resolve from env on each call; both returned %v", first)
	}
	if !reflect.DeepEqual(second, []int{3333, 8080}) {
		t.Errorf("second resolution should reflect updated PORT env: got %v, want [3333 8080]", second)
	}
}

func TestResolveDefaultBindPorts(t *testing.T) {
	tests := []struct {
		name     string
		env      map[string]string
		ambient  string
		variant  sandbox.ProcessVariant
		fallback int
		want     []int
	}{
		{
			name:     "request PORT wins over ambient and fallback",
			env:      map[string]string{"PORT": "20000"},
			ambient:  "9999",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{20000, 9999, 8080},
		},
		{
			name:     "ambient PORT used when request omits it",
			env:      nil,
			ambient:  "20000",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{20000, 8080},
		},
		{
			name:     "preview falls back to configured default only",
			env:      nil,
			ambient:  "",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{8080},
		},
		{
			name:     "publish adds 20000 runtime default even when fallback covers 8080",
			env:      nil,
			ambient:  "",
			variant:  sandbox.VariantPublish,
			fallback: 8080,
			want:     []int{8080, 20000},
		},
		{
			name:     "publish with PORT set does not duplicate 20000",
			env:      map[string]string{"PORT": "20000"},
			ambient:  "",
			variant:  sandbox.VariantPublish,
			fallback: 8080,
			want:     []int{20000, 8080},
		},
		{
			name:     "publish with no fallback still grants 20000",
			env:      nil,
			ambient:  "",
			variant:  sandbox.VariantPublish,
			fallback: 0,
			want:     []int{20000},
		},
		{
			name:     "dedupes when all sources agree",
			env:      map[string]string{"PORT": "8080"},
			ambient:  "8080",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{8080},
		},
		{
			name:     "preview returns nil when nothing usable",
			env:      nil,
			ambient:  "",
			variant:  sandbox.VariantPreview,
			fallback: 0,
			want:     nil,
		},
		{
			name:     "ignores invalid PORT values",
			env:      map[string]string{"PORT": "not-a-port"},
			ambient:  "",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{8080},
		},
		{
			name:     "ignores out-of-range ports",
			env:      map[string]string{"PORT": "99999"},
			ambient:  "-5",
			variant:  sandbox.VariantPreview,
			fallback: 8080,
			want:     []int{8080},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("PORT", tc.ambient)
			got := resolveDefaultBindPorts(tc.env, tc.variant, tc.fallback)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("resolveDefaultBindPorts(%v, %s, %d) = %v, want %v",
					tc.env, tc.variant, tc.fallback, got, tc.want)
			}
		})
	}
}
