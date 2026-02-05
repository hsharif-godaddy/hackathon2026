//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadAllocConfig(t *testing.T) {
	tests := []struct {
		name        string
		configJSON  string
		wantErr     bool
		errContains string
		validate    func(t *testing.T, config *AllocConfig)
	}{
		{
			name: "valid config with database",
			configJSON: `{
				"DATABASE": {
					"SYSTEM_MANAGED": true,
					"VALUE": {
						"NAME": "test_db",
						"HOST": "10.0.0.1",
						"IP": "10.0.0.1",
						"PORT": 3306,
						"USERNAME": "test_user",
						"PASSWORD": "test_pass",
						"VARIANT": ""
					}
				}
			}`,
			wantErr: false,
			validate: func(t *testing.T, config *AllocConfig) {
				require.NotNil(t, config.Database)
				assert.True(t, config.Database.SystemManaged)
				assert.Equal(t, "test_db", config.Database.Value.Name)
				assert.Equal(t, "10.0.0.1", config.Database.Value.Host)
				assert.Equal(t, 3306, config.Database.Value.Port)
				assert.Equal(t, "test_user", config.Database.Value.Username)
				assert.Equal(t, "test_pass", config.Database.Value.Password)
			},
		},
		{
			name: "config without database",
			configJSON: `{
				"_PLACEHOLDER": {
					"SYSTEM_MANAGED": false,
					"VALUE": {}
				}
			}`,
			wantErr: false,
			validate: func(t *testing.T, config *AllocConfig) {
				assert.Nil(t, config.Database)
			},
		},
		{
			name:        "invalid json",
			configJSON:  `{invalid json}`,
			wantErr:     true,
			errContains: "invalid character",
		},
		{
			name:       "empty config",
			configJSON: `{}`,
			wantErr:    false,
			validate: func(t *testing.T, config *AllocConfig) {
				assert.Nil(t, config.Database)
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create temp config file
			tmpDir := t.TempDir()
			configPath := filepath.Join(tmpDir, "config.json")
			err := os.WriteFile(configPath, []byte(tt.configJSON), 0600)
			require.NoError(t, err, "failed to write test config")

			// Parse JSON directly for testing (since loadAllocConfig uses hardcoded path)
			var config AllocConfig
			err = json.Unmarshal([]byte(tt.configJSON), &config)

			if tt.wantErr {
				assert.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}

			require.NoError(t, err)
			if tt.validate != nil {
				tt.validate(t, &config)
			}
		})
	}
}

func TestCheckCephFilesystem(t *testing.T) {
	t.Run("missing CUSTOMER_APP_DIR", func(t *testing.T) {
		// Ensure env var is not set
		t.Setenv("CUSTOMER_APP_DIR", "")
		os.Unsetenv("CUSTOMER_APP_DIR")

		result := checkCephFilesystem()

		assert.Equal(t, "unhealthy", result.Status)
		assert.Contains(t, result.Error, "CUSTOMER_APP_DIR not set")
		assert.NotEmpty(t, result.Latency)
	})

	t.Run("successful read/write/delete", func(t *testing.T) {
		tmpDir := t.TempDir()
		t.Setenv("CUSTOMER_APP_DIR", tmpDir)

		result := checkCephFilesystem()

		assert.Equal(t, "healthy", result.Status)
		assert.Empty(t, result.Error)
		assert.NotEmpty(t, result.Latency)

		// Verify cleanup - no health check files should exist
		matches, err := filepath.Glob(filepath.Join(tmpDir, ".health-check-*"))
		require.NoError(t, err)
		assert.Empty(t, matches, "health check files should be deleted")
	})

	t.Run("non-existent directory", func(t *testing.T) {
		t.Setenv("CUSTOMER_APP_DIR", "/non/existent/path")

		result := checkCephFilesystem()

		assert.Equal(t, "unhealthy", result.Status)
		assert.Equal(t, "write failed", result.Error)
		assert.NotEmpty(t, result.Latency)
	})

	t.Run("read-only directory", func(t *testing.T) {
		tmpDir := t.TempDir()
		readOnlyDir := filepath.Join(tmpDir, "readonly")
		err := os.Mkdir(readOnlyDir, 0500) // read+execute only
		require.NoError(t, err)
		t.Cleanup(func() {
			// Restore permissions for cleanup
			os.Chmod(readOnlyDir, 0700)
		})

		t.Setenv("CUSTOMER_APP_DIR", readOnlyDir)

		result := checkCephFilesystem()

		assert.Equal(t, "unhealthy", result.Status)
		assert.Equal(t, "write failed", result.Error)
		assert.NotEmpty(t, result.Latency)
	})
}

func TestCheckMySQL(t *testing.T) {
	t.Run("missing config file", func(t *testing.T) {
		// loadAllocConfig uses hardcoded path /alloc/config.json
		// which won't exist in test environment
		result := checkMySQL()

		assert.Equal(t, "unhealthy", result.Status)
		assert.Equal(t, "config load failed", result.Error)
		assert.NotEmpty(t, result.Latency)
	})
}

func TestRunCanaryChecks(t *testing.T) {
	t.Run("returns both checks", func(t *testing.T) {
		// Clear CUSTOMER_APP_DIR to ensure consistent behavior
		t.Setenv("CUSTOMER_APP_DIR", "")
		os.Unsetenv("CUSTOMER_APP_DIR")

		checks := runCanaryChecks()

		// Both checks should be present
		assert.Contains(t, checks, "ceph")
		assert.Contains(t, checks, "mysql")

		// Both should have valid status values
		assert.NotNil(t, checks["ceph"])
		assert.NotNil(t, checks["mysql"])
		assert.Contains(t, []string{"healthy", "unhealthy"}, checks["ceph"].Status)
		assert.Contains(t, []string{"healthy", "unhealthy"}, checks["mysql"].Status)
	})
}

func TestCheckResultStructure(t *testing.T) {
	t.Run("healthy result serialization", func(t *testing.T) {
		result := &CheckResult{
			Status:  "healthy",
			Latency: "15ms",
		}

		data, err := json.Marshal(result)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "healthy", parsed["status"])
		assert.Equal(t, "15ms", parsed["latency"])
		_, hasError := parsed["error"]
		assert.False(t, hasError, "error field should be omitted when empty")
	})

	t.Run("unhealthy result serialization", func(t *testing.T) {
		result := &CheckResult{
			Status:  "unhealthy",
			Latency: "5001ms",
			Error:   "connection timeout",
		}

		data, err := json.Marshal(result)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "unhealthy", parsed["status"])
		assert.Equal(t, "5001ms", parsed["latency"])
		assert.Equal(t, "connection timeout", parsed["error"])
	})
}

func TestCanaryCheckResponse(t *testing.T) {
	t.Run("response with canary checks", func(t *testing.T) {
		resp := CanaryCheckResponse{
			Status: "healthy",
			Checks: map[string]*CheckResult{
				"ceph": {
					Status:  "healthy",
					Latency: "12ms",
				},
				"mysql": {
					Status:  "healthy",
					Latency: "8ms",
				},
			},
		}

		data, err := json.Marshal(resp)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "healthy", parsed["status"])

		checks, ok := parsed["checks"].(map[string]any)
		require.True(t, ok, "checks should be a map")
		assert.Len(t, checks, 2)

		ceph, ok := checks["ceph"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "healthy", ceph["status"])
		assert.Equal(t, "12ms", ceph["latency"])
	})

	t.Run("response without checks omits field", func(t *testing.T) {
		resp := CanaryCheckResponse{
			Status: "healthy",
		}

		data, err := json.Marshal(resp)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "healthy", parsed["status"])
		_, hasChecks := parsed["checks"]
		assert.False(t, hasChecks, "checks should be omitted when nil")
	})

	t.Run("unhealthy response with failed check", func(t *testing.T) {
		resp := CanaryCheckResponse{
			Status: "unhealthy",
			Checks: map[string]*CheckResult{
				"ceph": {
					Status:  "healthy",
					Latency: "12ms",
				},
				"mysql": {
					Status:  "unhealthy",
					Latency: "5001ms",
					Error:   "connection timeout",
				},
			},
		}

		data, err := json.Marshal(resp)
		require.NoError(t, err)

		var parsed map[string]any
		err = json.Unmarshal(data, &parsed)
		require.NoError(t, err)

		assert.Equal(t, "unhealthy", parsed["status"])

		checks, ok := parsed["checks"].(map[string]any)
		require.True(t, ok)

		mysql, ok := checks["mysql"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "unhealthy", mysql["status"])
		assert.Equal(t, "connection timeout", mysql["error"])
	})
}
