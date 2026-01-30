//go:build linux

package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseSELinuxContext(t *testing.T) {
	tests := []struct {
		name        string
		raw         string
		wantUser    string
		wantRole    string
		wantType    string
		wantLevel   string
		expectError bool
	}{
		{
			name:      "full context with MCS",
			raw:       "system_u:system_r:container_t:s0:c1,c2",
			wantUser:  "system_u",
			wantRole:  "system_r",
			wantType:  "container_t",
			wantLevel: "s0:c1,c2",
		},
		{
			name:      "context without MCS categories",
			raw:       "system_u:system_r:airo_agent_container.process:s0",
			wantUser:  "system_u",
			wantRole:  "system_r",
			wantType:  "airo_agent_container.process",
			wantLevel: "s0",
		},
		{
			name:      "minimal context",
			raw:       "user_u:role_r:type_t",
			wantUser:  "user_u",
			wantRole:  "role_r",
			wantType:  "type_t",
			wantLevel: "",
		},
		{
			name:        "empty context",
			raw:         "",
			expectError: true,
		},
		{
			name:        "invalid format - too few parts",
			raw:         "user:role",
			expectError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, err := parseSELinuxContext(tt.raw)

			if tt.expectError {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if ctx.User != tt.wantUser {
				t.Errorf("User = %q, want %q", ctx.User, tt.wantUser)
			}
			if ctx.Role != tt.wantRole {
				t.Errorf("Role = %q, want %q", ctx.Role, tt.wantRole)
			}
			if ctx.Type != tt.wantType {
				t.Errorf("Type = %q, want %q", ctx.Type, tt.wantType)
			}
			if ctx.Level != tt.wantLevel {
				t.Errorf("Level = %q, want %q", ctx.Level, tt.wantLevel)
			}
			if ctx.Raw != tt.raw {
				t.Errorf("Raw = %q, want %q", ctx.Raw, tt.raw)
			}
		})
	}
}

func TestPeerSecFromContext(t *testing.T) {
	t.Run("returns nil for empty context", func(t *testing.T) {
		ctx := context.Background()
		sec := peerSecFromContext(ctx)
		if sec != nil {
			t.Errorf("expected nil, got %+v", sec)
		}
	})

	t.Run("returns context when present", func(t *testing.T) {
		ctx := context.Background()
		expected := &SELinuxContext{
			User:  "system_u",
			Role:  "system_r",
			Type:  "airo_agent_container.process",
			Level: "s0",
			Raw:   "system_u:system_r:airo_agent_container.process:s0",
		}
		ctx = context.WithValue(ctx, peerSecContextKey{}, expected)

		sec := peerSecFromContext(ctx)
		if sec == nil {
			t.Fatal("expected context, got nil")
		}
		if sec.Type != expected.Type {
			t.Errorf("Type = %q, want %q", sec.Type, expected.Type)
		}
	})
}

func TestPeerSecMiddleware(t *testing.T) {
	nextHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("OK"))
	})

	allowedTypes := []string{"airo_agent_container.process", "airo_supervisor_t"}
	middleware := peerSecMiddleware(allowedTypes)(nextHandler)

	t.Run("rejects request without security context", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rec.Code)
		}
	})

	t.Run("rejects request with unauthorized SELinux type", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), peerSecContextKey{}, &SELinuxContext{
			User:  "system_u",
			Role:  "system_r",
			Type:  "malicious_container_t",
			Level: "s0",
			Raw:   "system_u:system_r:malicious_container_t:s0",
		})
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rec.Code)
		}
	})

	t.Run("allows request with authorized SELinux type", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "/alloc")
		req := httptest.NewRequest("GET", "/test", nil)
		ctx := context.WithValue(req.Context(), peerSecContextKey{}, &SELinuxContext{
			User:  "system_u",
			Role:  "system_r",
			Type:  "airo_agent_container.process",
			Level: "s0",
			Raw:   "system_u:system_r:airo_agent_container.process:s0",
		})
		req = req.WithContext(ctx)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
	})

	t.Run("bypasses restriction when nomad env missing", func(t *testing.T) {
		t.Setenv("NOMAD_ALLOC_DIR", "")
		req := httptest.NewRequest("GET", "/test", nil)
		rec := httptest.NewRecorder()

		middleware.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rec.Code)
		}
	})
}
