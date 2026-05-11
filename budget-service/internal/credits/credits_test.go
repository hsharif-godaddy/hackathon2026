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

func TestParseEdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		want    string
		wantErr error
	}{
		{"empty string", "", "", ErrInvalid},
		{"whitespace only", "   ", "", ErrInvalid},
		{"non-numeric", "abc", "", ErrInvalid},
		{"negative accepted", "-5.5", "-5.500000", nil},
		{"negative boundary", "-99999999999999.999999", "-99999999999999.999999", nil},
		{"rounds 7th digit up", "1.1234565", "1.123457", nil},
		{"rounds 7th digit down", "1.1234564", "1.123456", nil},
		{"leading whitespace trimmed", "  42.5", "42.500000", nil},
		{"trailing whitespace trimmed", "42.5  ", "42.500000", nil},
		{"zero", "0", "0.000000", nil},
		{"very small positive", "0.000001", "0.000001", nil},
		{"just over max", "100000000000000.000000", "", ErrOutOfRange},
		{"negative over max", "-100000000000000.000000", "", ErrOutOfRange},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := Parse(tc.input)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("Parse(%q) err = %v, want %v", tc.input, err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse(%q) unexpected error: %v", tc.input, err)
			}
			if d.StringFixed(6) != tc.want {
				t.Fatalf("Parse(%q) = %s, want %s", tc.input, d.StringFixed(6), tc.want)
			}
		})
	}
}

func TestParsePositiveRatioEdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"zero rejected", "0", "", true},
		{"negative rejected", "-1", "", true},
		{"positive accepted", "0.5", "0.500000", false},
		{"large positive", "99999999999999.999999", "99999999999999.999999", false},
		{"empty rejected", "", "", true},
		{"invalid string", "xyz", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := ParsePositiveRatio(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParsePositiveRatio(%q) expected error, got %s", tc.input, d.StringFixed(6))
				}
				return
			}
			if err != nil {
				t.Fatalf("ParsePositiveRatio(%q) unexpected error: %v", tc.input, err)
			}
			if d.StringFixed(6) != tc.want {
				t.Fatalf("ParsePositiveRatio(%q) = %s, want %s", tc.input, d.StringFixed(6), tc.want)
			}
		})
	}
}

func TestParseNonNegativeEdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"zero accepted", "0", "0.000000", false},
		{"positive accepted", "10.5", "10.500000", false},
		{"negative rejected", "-0.000001", "", true},
		{"empty rejected", "", "", true},
		{"invalid string", "not-a-number", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d, err := ParseNonNegative(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseNonNegative(%q) expected error, got %s", tc.input, d.StringFixed(6))
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseNonNegative(%q) unexpected error: %v", tc.input, err)
			}
			if d.StringFixed(6) != tc.want {
				t.Fatalf("ParseNonNegative(%q) = %s, want %s", tc.input, d.StringFixed(6), tc.want)
			}
		})
	}
}

func TestFormatEdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"whole number", "42", "42.000000"},
		{"already 6dp", "1.234567", "1.234567"},
		{"fewer dp padded", "1.5", "1.500000"},
		{"zero", "0", "0.000000"},
		{"negative", "-3.14", "-3.140000"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			d := decimal.RequireFromString(tc.input)
			got := Format(d)
			if got != tc.want {
				t.Fatalf("Format(%s) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestDollarsToCreditsEdgeCases(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		cost    string
		ratio   string
		want    string
		wantErr error
	}{
		{"negative cost rejected", "-1", "0.5", "", ErrInvalid},
		{"zero ratio rejected", "10", "0", "", ErrInvalid},
		{"negative ratio rejected", "10", "-0.5", "", ErrInvalid},
		{"zero cost returns zero", "0", "0.5", "0.000000", nil},
		{"overflow returns ErrOutOfRange", "99999999999999", "0.000001", "", ErrOutOfRange},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			cost := decimal.RequireFromString(tc.cost)
			ratio := decimal.RequireFromString(tc.ratio)
			got, err := DollarsToCredits(cost, ratio)
			if tc.wantErr != nil {
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("DollarsToCredits(%s,%s) err = %v, want %v", tc.cost, tc.ratio, err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("DollarsToCredits(%s,%s) unexpected error: %v", tc.cost, tc.ratio, err)
			}
			if got.StringFixed(6) != tc.want {
				t.Fatalf("DollarsToCredits(%s,%s) = %s, want %s", tc.cost, tc.ratio, got.StringFixed(6), tc.want)
			}
		})
	}
}
