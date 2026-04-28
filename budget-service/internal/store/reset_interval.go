package store

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const resetIntervalPattern = "^[1-9][0-9]*(d|w|mo|y)$"

var resetIntervalRegexp = regexp.MustCompile(resetIntervalPattern)

// NormalizeResetInterval canonicalizes reset intervals (e.g. "1D" -> "1d").
// Empty input returns nil, nil.
func NormalizeResetInterval(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	s := strings.ToLower(strings.TrimSpace(*raw))
	if s == "" {
		return nil, nil
	}
	if !resetIntervalRegexp.MatchString(s) {
		return nil, fmt.Errorf("%w", ErrResetIntervalInvalidFormat)
	}
	// Validate range parse to reject extremely large values that overflow strconv.
	unitStart := strings.IndexAny(s, "dwmy")
	if strings.HasSuffix(s, "mo") {
		unitStart = len(s) - 2
	}
	if _, err := strconv.ParseInt(s[:unitStart], 10, 64); err != nil {
		return nil, fmt.Errorf("%w", ErrResetIntervalOutOfRange)
	}
	return &s, nil
}

func parseResetInterval(raw string) (int64, string, error) {
	norm, err := NormalizeResetInterval(&raw)
	if err != nil {
		return 0, "", err
	}
	if norm == nil {
		return 0, "", fmt.Errorf("%w", ErrResetIntervalInvalidFormat)
	}
	valuePart := (*norm)[:len(*norm)-1]
	unit := (*norm)[len(*norm)-1:]
	if strings.HasSuffix(*norm, "mo") {
		valuePart = (*norm)[:len(*norm)-2]
		unit = "mo"
	}
	value, err := strconv.ParseInt(valuePart, 10, 64)
	if err != nil {
		return 0, "", fmt.Errorf("%w", ErrResetIntervalOutOfRange)
	}
	return value, unit, nil
}

// NextResetAt returns the next reset time after start using calendar math for month/year intervals.
func NextResetAt(start time.Time, interval string) (time.Time, error) {
	value, unit, err := parseResetInterval(interval)
	if err != nil {
		return time.Time{}, err
	}
	if value > math.MaxInt {
		return time.Time{}, fmt.Errorf("%w", ErrResetIntervalOutOfRange)
	}
	count := int(value)
	switch unit {
	case "d":
		return start.AddDate(0, 0, count), nil
	case "w":
		if value > math.MaxInt/7 {
			return time.Time{}, fmt.Errorf("%w", ErrResetIntervalOutOfRange)
		}
		return start.AddDate(0, 0, count*7), nil
	case "mo":
		return start.AddDate(0, count, 0), nil
	case "y":
		return start.AddDate(count, 0, 0), nil
	default:
		return time.Time{}, fmt.Errorf("%w", ErrResetIntervalInvalidFormat)
	}
}
