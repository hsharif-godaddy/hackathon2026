package main

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
)

type EnvironmentSetRequest struct {
	Variables      map[string]string `json:"variables"`
	RestartProcess bool              `json:"restart_process,omitempty"`
}

type EnvironmentGetResponse struct {
	Variables map[string]string `json:"variables"`
}

type EnvironmentManager struct {
	mu        sync.RWMutex
	variables map[string]string
	defaults  map[string]string
}

func NewEnvironmentManager() *EnvironmentManager {
	em := &EnvironmentManager{
		variables: make(map[string]string),
		defaults:  make(map[string]string),
	}

	// Store current environment as defaults
	em.loadCurrentEnvironment()

	return em
}

func (em *EnvironmentManager) loadCurrentEnvironment() {
	for _, env := range os.Environ() {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			key, value := parts[0], parts[1]
			em.variables[key] = value
			em.defaults[key] = value
		}
	}
}

func (em *EnvironmentManager) SetVariables(req EnvironmentSetRequest) error {
	em.mu.Lock()
	defer em.mu.Unlock()

	if len(req.Variables) == 0 {
		return fmt.Errorf("no variables provided")
	}

	// Validate variable names and check for protected variables
	protectedVars := map[string]bool{
		"PATH": true,
		"HOME": true,
		"USER": true,
		"PWD":  true,
	}

	for key := range req.Variables {
		if !isValidEnvVarName(key) {
			return fmt.Errorf("invalid environment variable name: %s", key)
		}
		if protectedVars[key] {
			return fmt.Errorf("cannot modify protected environment variable: %s", key)
		}
	}

	// Update variables
	for key, value := range req.Variables {
		em.variables[key] = value
		// Also set in current process environment
		os.Setenv(key, value)
	}

	return nil
}

func (em *EnvironmentManager) GetVariables() EnvironmentGetResponse {
	em.mu.RLock()
	defer em.mu.RUnlock()

	// Create a copy of variables
	variables := make(map[string]string)
	for key, value := range em.variables {
		variables[key] = value
	}

	return EnvironmentGetResponse{
		Variables: variables,
	}
}

func (em *EnvironmentManager) GetVariable(key string) (string, bool) {
	em.mu.RLock()
	defer em.mu.RUnlock()

	value, exists := em.variables[key]
	return value, exists
}

func (em *EnvironmentManager) UnsetVariable(key string) error {
	em.mu.Lock()
	defer em.mu.Unlock()

	delete(em.variables, key)
	return os.Unsetenv(key)
}

func (em *EnvironmentManager) ResetToDefaults() error {
	em.mu.Lock()
	defer em.mu.Unlock()

	// Clear current variables
	em.variables = make(map[string]string)

	// Restore defaults
	for key, value := range em.defaults {
		em.variables[key] = value
		os.Setenv(key, value)
	}

	// Clear any variables that weren't in defaults
	currentEnv := os.Environ()
	for _, env := range currentEnv {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) == 2 {
			key := parts[0]
			if _, exists := em.defaults[key]; !exists {
				os.Unsetenv(key)
			}
		}
	}

	return nil
}

func (em *EnvironmentManager) GetEnvironmentArray() []string {
	em.mu.RLock()
	defer em.mu.RUnlock()

	var env []string
	for key, value := range em.variables {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

	// Sort for consistent ordering
	sort.Strings(env)

	return env
}

func (em *EnvironmentManager) GetFilteredVariables(filter string) map[string]string {
	em.mu.RLock()
	defer em.mu.RUnlock()

	filtered := make(map[string]string)

	for key, value := range em.variables {
		if filter == "" || strings.Contains(strings.ToLower(key), strings.ToLower(filter)) {
			filtered[key] = value
		}
	}

	return filtered
}

// isValidEnvVarName checks if the environment variable name is valid
func isValidEnvVarName(name string) bool {
	if name == "" {
		return false
	}

	// First character must be letter or underscore
	first := name[0]
	if !((first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z') || first == '_') {
		return false
	}

	// Remaining characters can be letters, digits, or underscore
	for i := 1; i < len(name); i++ {
		char := name[i]
		if !((char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '_') {
			return false
		}
	}

	return true
}
