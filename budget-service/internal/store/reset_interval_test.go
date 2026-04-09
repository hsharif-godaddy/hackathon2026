package store

import (
	"testing"
	"time"
)

func TestNormalizeResetInterval(t *testing.T) {
	t.Run("nil and empty map to nil", func(t *testing.T) {
		if got, err := NormalizeResetInterval(nil); err != nil || got != nil {
			t.Fatalf("nil input: got=%v err=%v", got, err)
		}
		empty := "  "
		if got, err := NormalizeResetInterval(&empty); err != nil || got != nil {
			t.Fatalf("empty input: got=%v err=%v", got, err)
		}
	})

	t.Run("canonicalizes case", func(t *testing.T) {
		in := "1MO"
		got, err := NormalizeResetInterval(&in)
		if err != nil {
			t.Fatal(err)
		}
		if got == nil || *got != "1mo" {
			t.Fatalf("got %v want 1mo", got)
		}
	})

	t.Run("accepts supported units", func(t *testing.T) {
		for _, raw := range []string{"1d", "2w", "3mo", "4y", "10d"} {
			raw := raw
			t.Run(raw, func(t *testing.T) {
				got, err := NormalizeResetInterval(&raw)
				if err != nil {
					t.Fatal(err)
				}
				if got == nil || *got != raw {
					t.Fatalf("got %v want %s", got, raw)
				}
			})
		}
	})

	t.Run("rejects invalid values", func(t *testing.T) {
		for _, raw := range []string{"0d", "-1d", "1m", "1yr", "mo", "1.5w", "999999999999999999999999d"} {
			raw := raw
			t.Run(raw, func(t *testing.T) {
				if _, err := NormalizeResetInterval(&raw); err == nil {
					t.Fatalf("expected error for %q", raw)
				}
			})
		}
	})
}

func TestNextResetAt(t *testing.T) {
	loc := time.FixedZone("UTC-5", -5*60*60)
	start := time.Date(2024, time.January, 31, 15, 4, 5, 0, loc)

	tests := []struct {
		name     string
		interval string
		want     time.Time
	}{
		{
			name:     "days",
			interval: "3d",
			want:     time.Date(2024, time.February, 3, 15, 4, 5, 0, loc),
		},
		{
			name:     "weeks",
			interval: "2w",
			want:     time.Date(2024, time.February, 14, 15, 4, 5, 0, loc),
		},
		{
			name:     "months use calendar math",
			interval: "1mo",
			want:     time.Date(2024, time.March, 2, 15, 4, 5, 0, loc),
		},
		{
			name:     "years",
			interval: "1y",
			want:     time.Date(2025, time.January, 31, 15, 4, 5, 0, loc),
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			got, err := NextResetAt(start, tt.interval)
			if err != nil {
				t.Fatal(err)
			}
			if !got.Equal(tt.want) {
				t.Fatalf("got %s want %s", got.Format(time.RFC3339), tt.want.Format(time.RFC3339))
			}
		})
	}

	t.Run("rejects invalid interval", func(t *testing.T) {
		if _, err := NextResetAt(start, "bad"); err == nil {
			t.Fatal("expected error")
		}
	})
}
