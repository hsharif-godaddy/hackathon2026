package main

import (
	"os"
	"strings"
	"testing"
)

func TestEnvironmentManager_NewEnvironmentManager(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	if em == nil {
		t.Fatal("Expected non-nil EnvironmentManager")
		return
	}

	if em.variables == nil {
		t.Error("Expected variables map to be initialized")
	}

	if em.defaults == nil {
		t.Error("Expected defaults map to be initialized")
	}

	// Should have loaded current environment
	response := em.GetVariables()
	if len(response.Variables) == 0 {
		t.Error("Expected some environment variables to be loaded")
	}
}

func TestEnvironmentManager_SetVariables(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	tests := []struct {
		name        string
		request     EnvironmentSetRequest
		expectError bool
		errorMsg    string
	}{
		{
			name: "valid variables",
			request: EnvironmentSetRequest{
				Variables: map[string]string{
					"TEST_VAR1": "value1",
					"TEST_VAR2": "value2",
				},
			},
			expectError: false,
		},
		{
			name: "empty variables",
			request: EnvironmentSetRequest{
				Variables: map[string]string{},
			},
			expectError: true,
			errorMsg:    "no variables provided",
		},
		{
			name: "invalid variable name",
			request: EnvironmentSetRequest{
				Variables: map[string]string{
					"123INVALID": "value",
				},
			},
			expectError: true,
			errorMsg:    "invalid environment variable name",
		},
		{
			name: "variable name with spaces",
			request: EnvironmentSetRequest{
				Variables: map[string]string{
					"INVALID NAME": "value",
				},
			},
			expectError: true,
			errorMsg:    "invalid environment variable name",
		},
		{
			name: "empty variable name",
			request: EnvironmentSetRequest{
				Variables: map[string]string{
					"": "value",
				},
			},
			expectError: true,
			errorMsg:    "invalid environment variable name",
		},
		{
			name: "protected variable",
			request: EnvironmentSetRequest{
				Variables: map[string]string{
					"PATH": "/custom/path",
				},
			},
			expectError: true,
			errorMsg:    "cannot modify protected environment variable",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := em.SetVariables(tt.request)

			if tt.expectError && err == nil {
				t.Error("Expected error but got none")
			}

			if !tt.expectError && err != nil {
				t.Errorf("Expected no error but got: %v", err)
			}

			if tt.expectError && err != nil && tt.errorMsg != "" {
				if err.Error() != tt.errorMsg && !containsString(err.Error(), tt.errorMsg) {
					t.Errorf("Expected error message to contain '%s', got: %s", tt.errorMsg, err.Error())
				}
			}

			// If successful, verify variables were set
			if !tt.expectError {
				response := em.GetVariables()
				for key, expectedValue := range tt.request.Variables {
					if actualValue, exists := response.Variables[key]; !exists {
						t.Errorf("Expected variable %s to be set", key)
					} else if actualValue != expectedValue {
						t.Errorf("Expected %s=%s, got %s=%s", key, expectedValue, key, actualValue)
					}

					// Also check in actual OS environment
					if osValue := os.Getenv(key); osValue != expectedValue {
						t.Errorf("Expected OS env %s=%s, got %s=%s", key, expectedValue, key, osValue)
					}
				}
			}
		})
	}
}

func TestEnvironmentManager_GetVariables(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Set some test variables
	testVars := map[string]string{
		"TEST_GET_VAR1": "value1",
		"TEST_GET_VAR2": "value2",
	}

	req := EnvironmentSetRequest{Variables: testVars}
	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set test variables: %v", err)
	}

	// Get variables
	response := em.GetVariables()

	if response.Variables == nil {
		t.Fatal("Expected non-nil variables map")
		return
	}

	// Check our test variables are present
	for key, expectedValue := range testVars {
		if actualValue, exists := response.Variables[key]; !exists {
			t.Errorf("Expected variable %s to exist", key)
		} else if actualValue != expectedValue {
			t.Errorf("Expected %s=%s, got %s=%s", key, expectedValue, key, actualValue)
		}
	}
}

func TestEnvironmentManager_GetVariable(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Set a test variable
	testKey := "TEST_SINGLE_VAR"
	testValue := "single_value"

	req := EnvironmentSetRequest{
		Variables: map[string]string{testKey: testValue},
	}

	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set test variable: %v", err)
	}

	// Test getting existing variable
	value, exists := em.GetVariable(testKey)
	if !exists {
		t.Errorf("Expected variable %s to exist", testKey)
	}
	if value != testValue {
		t.Errorf("Expected value %s, got %s", testValue, value)
	}

	// Test getting non-existent variable
	_, exists = em.GetVariable("NON_EXISTENT_VAR")
	if exists {
		t.Error("Expected non-existent variable to not exist")
	}
}

func TestEnvironmentManager_UnsetVariable(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Set a test variable
	testKey := "TEST_UNSET_VAR"
	testValue := "unset_value"

	req := EnvironmentSetRequest{
		Variables: map[string]string{testKey: testValue},
	}

	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set test variable: %v", err)
	}

	// Verify it exists
	if _, exists := em.GetVariable(testKey); !exists {
		t.Fatal("Test variable should exist before unsetting")
	}

	// Unset the variable
	if err := em.UnsetVariable(testKey); err != nil {
		t.Errorf("Failed to unset variable: %v", err)
	}

	// Verify it's gone
	if _, exists := em.GetVariable(testKey); exists {
		t.Error("Variable should not exist after unsetting")
	}

	// Verify it's gone from OS environment too
	if osValue := os.Getenv(testKey); osValue != "" {
		t.Error("Variable should not exist in OS environment after unsetting")
	}
}

func TestEnvironmentManager_ResetToDefaults(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Get initial variable count
	initialResponse := em.GetVariables()
	initialCount := len(initialResponse.Variables)

	// Add some custom variables
	customVars := map[string]string{
		"TEST_CUSTOM1": "custom1",
		"TEST_CUSTOM2": "custom2",
	}

	req := EnvironmentSetRequest{Variables: customVars}
	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set custom variables: %v", err)
	}

	// Verify custom variables were added
	afterAddResponse := em.GetVariables()
	if len(afterAddResponse.Variables) <= initialCount {
		t.Error("Expected variable count to increase after adding custom variables")
	}

	// Reset to defaults
	if err := em.ResetToDefaults(); err != nil {
		t.Errorf("Failed to reset to defaults: %v", err)
	}

	// Verify custom variables are gone
	afterResetResponse := em.GetVariables()

	for key := range customVars {
		if _, exists := afterResetResponse.Variables[key]; exists {
			t.Errorf("Custom variable %s should not exist after reset", key)
		}

		// Check OS environment too
		if osValue := os.Getenv(key); osValue != "" {
			t.Errorf("Custom variable %s should not exist in OS environment after reset", key)
		}
	}
}

func TestEnvironmentManager_GetEnvironmentArray(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Set some test variables
	testVars := map[string]string{
		"TEST_ARRAY_VAR1": "array_value1",
		"TEST_ARRAY_VAR2": "array_value2",
	}

	req := EnvironmentSetRequest{Variables: testVars}
	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set test variables: %v", err)
	}

	// Get environment array
	envArray := em.GetEnvironmentArray()

	if len(envArray) == 0 {
		t.Error("Expected non-empty environment array")
	}

	// Check format and content
	foundVars := make(map[string]bool)
	for _, envStr := range envArray {
		if !containsString(envStr, "=") {
			t.Errorf("Environment string should contain '=': %s", envStr)
		}

		// Check if our test variables are present
		for key := range testVars {
			if startsWithString(envStr, key+"=") {
				foundVars[key] = true
			}
		}
	}

	// Verify all test variables were found
	for key := range testVars {
		if !foundVars[key] {
			t.Errorf("Test variable %s not found in environment array", key)
		}
	}
}

func TestEnvironmentManager_GetFilteredVariables(t *testing.T) {
	t.Parallel()
	em := NewEnvironmentManager()

	// Set some test variables with specific prefixes
	testVars := map[string]string{
		"FILTER_TEST_VAR1": "filter_value1",
		"FILTER_TEST_VAR2": "filter_value2",
		"OTHER_VAR":        "other_value",
	}

	req := EnvironmentSetRequest{Variables: testVars}
	if err := em.SetVariables(req); err != nil {
		t.Fatalf("Failed to set test variables: %v", err)
	}

	// Test filtering
	filtered := em.GetFilteredVariables("FILTER_TEST")

	// Should find the two FILTER_TEST variables
	expectedCount := 2
	if len(filtered) != expectedCount {
		t.Errorf("Expected %d filtered variables, got %d", expectedCount, len(filtered))
	}

	// Should not find the OTHER_VAR
	if _, exists := filtered["OTHER_VAR"]; exists {
		t.Error("OTHER_VAR should not be in filtered results")
	}

	// Test empty filter (should return all)
	allFiltered := em.GetFilteredVariables("")
	allVariables := em.GetVariables()

	if len(allFiltered) != len(allVariables.Variables) {
		t.Error("Empty filter should return all variables")
	}
}

// Helper functions
func containsString(s, substr string) bool {
	return len(s) >= len(substr) &&
		(s == substr ||
			(len(s) > len(substr) &&
				(s[:len(substr)] == substr ||
					s[len(s)-len(substr):] == substr ||
					strings.Contains(s, substr))))
}

func startsWithString(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

func TestIsValidEnvVarName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name     string
		varName  string
		expected bool
	}{
		{"valid uppercase", "VALID_VAR", true},
		{"valid lowercase", "valid_var", true},
		{"valid mixed case", "Valid_Var", true},
		{"valid with numbers", "VAR_123", true},
		{"valid single char", "A", true},
		{"valid underscore start", "_VAR", true},
		{"empty name", "", false},
		{"starts with number", "123_VAR", false},
		{"contains space", "INVALID VAR", false},
		{"contains dash", "INVALID-VAR", false},
		{"contains dot", "INVALID.VAR", false},
		{"contains special chars", "VAR@#$", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			result := isValidEnvVarName(tt.varName)
			if result != tt.expected {
				t.Errorf("isValidEnvVarName(%s) = %v, expected %v", tt.varName, result, tt.expected)
			}
		})
	}
}
