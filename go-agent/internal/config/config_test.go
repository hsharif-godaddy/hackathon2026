package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoad_Defaults(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "4000", cfg.Port)
	assert.Equal(t, "test-key", cfg.AnthropicAPIKey)
	assert.Equal(t, "data/agents.db", cfg.DatabasePath)
	assert.Equal(t, "/tmp/airo-app-builder", cfg.AppRootPath)
	assert.Equal(t, "/tmp/ts-bridge.sock", cfg.BridgeSocketPath)
	assert.Equal(t, "info", cfg.LogLevel)
	assert.False(t, cfg.MultiTenant)
}

func TestLoad_EnvOverrides(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "my-key")
	t.Setenv("PORT", "8080")
	t.Setenv("DATABASE_PATH", "/data/test.db")
	t.Setenv("APP_ROOT_PATH", "/opt/apps")
	t.Setenv("TS_BRIDGE_SOCKET_PATH", "/run/bridge.sock")
	t.Setenv("LOG_LEVEL", "debug")
	t.Setenv("MULTI_TENANT", "true")

	cfg, err := Load()
	require.NoError(t, err)

	assert.Equal(t, "8080", cfg.Port)
	assert.Equal(t, "my-key", cfg.AnthropicAPIKey)
	assert.Equal(t, "/data/test.db", cfg.DatabasePath)
	assert.Equal(t, "/opt/apps", cfg.AppRootPath)
	assert.Equal(t, "/run/bridge.sock", cfg.BridgeSocketPath)
	assert.Equal(t, "debug", cfg.LogLevel)
	assert.True(t, cfg.MultiTenant)
}

func TestLoad_MissingAPIKey(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")

	_, err := Load()
	require.Error(t, err)
	require.ErrorIs(t, err, ErrMissingRequired)
	assert.Contains(t, err.Error(), "ANTHROPIC_API_KEY")
}

func TestLoad_MultiTenantFalseByDefault(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "key")
	t.Setenv("MULTI_TENANT", "")

	cfg, err := Load()
	require.NoError(t, err)
	assert.False(t, cfg.MultiTenant)
}
