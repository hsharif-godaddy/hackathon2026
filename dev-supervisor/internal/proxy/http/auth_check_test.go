//nolint:testpackage // Tests use unexported helpers.
package httpproxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHandleAuthCheck(t *testing.T) {
	t.Run("cookie auth - preview_auth cookie present", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/auth-check", nil)
		req.AddCookie(&http.Cookie{Name: "preview_auth", Value: "some-jwt-token"})
		w := httptest.NewRecorder()

		handleAuthCheck(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
		assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
		assert.Contains(t, w.Header().Get("Cache-Control"), "no-store")

		var resp authCheckResponse
		err := json.NewDecoder(w.Body).Decode(&resp)
		require.NoError(t, err)

		assert.True(t, resp.Authenticated)
		assert.True(t, resp.CookieAuth)
	})

	t.Run("header auth - no preview_auth cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/auth-check", nil)
		req.Header.Set("Authorization", "Bearer some-jwt-token")
		w := httptest.NewRecorder()

		handleAuthCheck(w, req)

		assert.Equal(t, http.StatusOK, w.Code)

		var resp authCheckResponse
		err := json.NewDecoder(w.Body).Decode(&resp)
		require.NoError(t, err)

		assert.True(t, resp.Authenticated)
		assert.False(t, resp.CookieAuth)
	})

	t.Run("share token auth - no preview_auth cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/airo/auth-check", nil)
		req.AddCookie(&http.Cookie{Name: "airo_share_token", Value: "share-token"})
		w := httptest.NewRecorder()

		handleAuthCheck(w, req)

		var resp authCheckResponse
		err := json.NewDecoder(w.Body).Decode(&resp)
		require.NoError(t, err)

		assert.True(t, resp.Authenticated)
		assert.False(t, resp.CookieAuth, "share token should not report cookieAuth=true")
	})

	t.Run("HEAD method allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodHead, "/airo/auth-check", nil)
		w := httptest.NewRecorder()

		handleAuthCheck(w, req)

		assert.Equal(t, http.StatusOK, w.Code)
	})

	t.Run("POST method not allowed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/airo/auth-check", nil)
		w := httptest.NewRecorder()

		handleAuthCheck(w, req)

		assert.Equal(t, http.StatusMethodNotAllowed, w.Code)
	})
}
