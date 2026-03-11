package supervisor

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFactorySameAddrReturnsSameClient(t *testing.T) {
	f := NewClientFactory()
	c1, err := f.Get("unix:/var/run/supervisor.sock")
	require.NoError(t, err)
	c2, err := f.Get("unix:/var/run/supervisor.sock")
	require.NoError(t, err)
	assert.Same(t, c1, c2, "same addr should return same *Client pointer")
}

func TestFactoryDifferentAddrsReturnDifferentClients(t *testing.T) {
	f := NewClientFactory()
	c1, err := f.Get("unix:/var/run/supervisor.sock")
	require.NoError(t, err)
	c2, err := f.Get("http://localhost:8080")
	require.NoError(t, err)
	assert.NotSame(t, c1, c2, "different addrs should return different clients")
}

func TestFactoryUnixAddrParsing(t *testing.T) {
	f := NewClientFactory()
	c, err := f.Get("unix:/tmp/test.sock")
	require.NoError(t, err)
	assert.NotNil(t, c)
}

func TestFactoryHTTPAddrParsing(t *testing.T) {
	f := NewClientFactory()
	c, err := f.Get("http://localhost:9090")
	require.NoError(t, err)
	assert.NotNil(t, c)
}

func TestFactoryEmptyAddr(t *testing.T) {
	f := NewClientFactory()
	_, err := f.Get("")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty")
}

func TestFactoryUnsupportedScheme(t *testing.T) {
	f := NewClientFactory()
	_, err := f.Get("ws://localhost:8080")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported")
}
