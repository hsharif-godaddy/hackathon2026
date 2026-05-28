// Package credits: NUMERIC(20,6) parse/format and credits = costUSD / creditSpendRatio (6 dp half-away-from-zero).
package credits

import (
	"errors"
	"math"
	"strconv"
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

// LogFloat wraps float64 for emission to structured logs that flow into
// Elasticsearch. It always JSON-encodes with at least one fractional
// digit (e.g. 0 -> 0.0, 5 -> 5.0), so Elastic's dynamic mapping infers
// `double` rather than `long` when the first document for a field
// happens to carry a whole-number value. NaN and infinities encode as
// JSON null, matching encoding/json's behavior for those float states.
type LogFloat float64

// LogFloatFromDecimal converts a decimal money value to a LogFloat for
// log emission. Float imprecision is acceptable here because the value
// is for monitoring; precise amounts are logged as strings alongside
// (e.g. budgetCostTotal next to budgetCostTotalUsd).
func LogFloatFromDecimal(d decimal.Decimal) LogFloat {
	return LogFloat(d.InexactFloat64())
}

func (f LogFloat) MarshalJSON() ([]byte, error) {
	v := float64(f)
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return []byte("null"), nil
	}
	s := strconv.FormatFloat(v, 'f', -1, 64)
	if !strings.ContainsRune(s, '.') {
		s += ".0"
	}
	return []byte(s), nil
}
