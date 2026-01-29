package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// GetEnvStringWithDefault returns the environment variable value if set,
// otherwise returns the provided default value
func GetEnvStringWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// GetEnvBoolWithDefault returns true if the environment variable is set to "true",
// false if set to any other value, or defaultValue if not set
func GetEnvBoolWithDefault(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		return value == "true"
	}
	return defaultValue
}

// GetEnvIntWithDefault returns the parsed integer value of the environment variable,
// or defaultValue if not set or parsing fails
func GetEnvIntWithDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if parsedValue, err := strconv.Atoi(value); err == nil {
			return parsedValue
		}
	}
	return defaultValue
}

// GetEnvDurationWithDefault returns the parsed duration value of the environment variable,
// or defaultValue if not set or parsing fails
func GetEnvDurationWithDefault(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if parsedValue, err := time.ParseDuration(value); err == nil {
			return parsedValue
		}
	}
	return defaultValue
}

// GetAllowedSELinuxTypes returns the list of SELinux types allowed to access the API
// Configured via DEV_SUPERVISOR_ALLOWED_SELINUX_TYPES (comma-separated)
// Defaults to "airo_agent_container.process" if not set or if value contains only whitespace
func GetAllowedSELinuxTypes() []string {
	const defaultType = "airo_agent_container.process"

	value := strings.TrimSpace(os.Getenv("DEV_SUPERVISOR_ALLOWED_SELINUX_TYPES"))
	if value == "" {
		return []string{defaultType}
	}

	var result []string
	for _, t := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(t); trimmed != "" {
			result = append(result, trimmed)
		}
	}

	if len(result) == 0 {
		return []string{defaultType}
	}
	return result
}
