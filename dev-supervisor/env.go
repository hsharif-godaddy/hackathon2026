package main

import (
	"os"
	"strconv"
	"time"
)

// getEnvStringWithDefault returns the environment variable value if set,
// otherwise returns the provided default value
func getEnvStringWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvBoolWithDefault returns true if the environment variable is set to "true",
// false if set to any other value, or defaultValue if not set
func getEnvBoolWithDefault(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true"
	}
	return defaultValue
}

// getEnvIntWithDefault returns the parsed integer value of the environment variable,
// or defaultValue if not set or parsing fails
func getEnvIntWithDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if parsedValue, err := strconv.Atoi(value); err == nil {
			return parsedValue
		}
	}
	return defaultValue
}

// getEnvDurationWithDefault returns the parsed duration value of the environment variable,
// or defaultValue if not set or parsing fails
func getEnvDurationWithDefault(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsedValue, err := time.ParseDuration(value); err == nil {
			return parsedValue
		}
	}
	return defaultValue
}
