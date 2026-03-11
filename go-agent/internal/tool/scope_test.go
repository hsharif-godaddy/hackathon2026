package tool

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScopeRoundTrip(t *testing.T) {
	scope := RequestScope{
		AppID:          "app-123",
		AppRoot:        "/tmp/app",
		SupervisorAddr: "unix:/var/run/supervisor.sock",
	}

	ctx := WithScope(context.Background(), scope)
	got, err := ScopeFrom(ctx)
	require.NoError(t, err)
	assert.Equal(t, scope, got)
}

func TestScopeFromMissing(t *testing.T) {
	_, err := ScopeFrom(context.Background())
	require.Error(t, err)
	assert.ErrorIs(t, err, ErrNoScope)
}
