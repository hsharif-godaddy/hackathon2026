package credits

import (
	"errors"
	"testing"

	"github.com/shopspring/decimal"
)

func TestDollarsToCreditsRepresentativeRatios(t *testing.T) {
	t.Parallel()
	cases := []struct {
		usd    string
		ratio  string
		expect string
	}{
		{"2", "0.66666", "3.000030"},
		{"10", "0.5", "20.000000"},
		{"100", "0.1", "1000.000000"},
		{"1", "0.66666", "1.500015"},
	}
	for _, tc := range cases {
		cost := decimal.RequireFromString(tc.usd)
		ratio := decimal.RequireFromString(tc.ratio)
		got, err := DollarsToCredits(cost, ratio)
		if err != nil {
			t.Fatalf("DollarsToCredits(%s,%s): %v", tc.usd, tc.ratio, err)
		}
		if got.StringFixed(6) != tc.expect {
			t.Fatalf("DollarsToCredits(%s,%s) = %s want %s", tc.usd, tc.ratio, got.StringFixed(6), tc.expect)
		}
	}
}

func TestDollarsToCreditsRoundingSeventhDigit(t *testing.T) {
	t.Parallel()
	cost := decimal.RequireFromString("0.1")
	ratio := decimal.RequireFromString("0.3333335")
	got, err := DollarsToCredits(cost, ratio)
	if err != nil {
		t.Fatal(err)
	}
	if got.StringFixed(6) != "0.300000" {
		t.Fatalf("got %s", got.StringFixed(6))
	}
}

func TestParseRejectsTooLarge(t *testing.T) {
	t.Parallel()
	_, err := Parse("100000000000000")
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrOutOfRange) {
		t.Fatalf("got %v", err)
	}
}

func TestParseAcceptsMaxBoundary(t *testing.T) {
	t.Parallel()
	d, err := Parse("99999999999999.999999")
	if err != nil {
		t.Fatal(err)
	}
	if d.StringFixed(6) != "99999999999999.999999" {
		t.Fatalf("got %s", d.StringFixed(6))
	}
}
