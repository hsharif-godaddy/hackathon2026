// Package credits: NUMERIC(20,6) parse/format and credits = costUSD / creditSpendRatio (6 dp half-away-from-zero).
package credits

import (
	"errors"
	"strings"

	"github.com/shopspring/decimal"
)

const (
	FractionalDigits  int32 = 6
	MaxIntegralDigits int   = 14
)

var (
	ErrOutOfRange = errors.New("value out of range for NUMERIC(20,6)")
	ErrInvalid    = errors.New("invalid amount")
)

var maxNumeric20_6 decimal.Decimal

func init() {
	maxNumeric20_6 = decimal.RequireFromString("99999999999999.999999")
}

func Parse(s string) (decimal.Decimal, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return decimal.Zero, ErrInvalid
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return decimal.Zero, ErrInvalid
	}
	return finalize(d)
}

func ParsePositiveRatio(s string) (decimal.Decimal, error) {
	d, err := Parse(s)
	if err != nil {
		return decimal.Zero, err
	}
	if !d.IsPositive() {
		return decimal.Zero, ErrInvalid
	}
	return d, nil
}

func ParseNonNegative(s string) (decimal.Decimal, error) {
	d, err := Parse(s)
	if err != nil {
		return decimal.Zero, err
	}
	if d.IsNegative() {
		return decimal.Zero, ErrInvalid
	}
	return d, nil
}

func finalize(d decimal.Decimal) (decimal.Decimal, error) {
	r := d.Round(FractionalDigits)
	if r.Abs().GreaterThan(maxNumeric20_6) {
		return decimal.Zero, ErrOutOfRange
	}
	return r, nil
}

func DollarsToCredits(costUSD, creditSpendRatio decimal.Decimal) (decimal.Decimal, error) {
	if costUSD.IsNegative() {
		return decimal.Zero, ErrInvalid
	}
	if !creditSpendRatio.IsPositive() {
		return decimal.Zero, ErrInvalid
	}
	prod := costUSD.Div(creditSpendRatio)
	return finalize(prod)
}

func Format(d decimal.Decimal) string {
	return d.StringFixed(FractionalDigits)
}
