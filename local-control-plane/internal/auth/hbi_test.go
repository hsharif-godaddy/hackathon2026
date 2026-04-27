package auth

import (
	"context"
	"testing"
	"time"

	"github.com/gdcorp-golang/auth/gdtoken"
)

func TestActiveHighWith12HrHbi(t *testing.T) {
	t.Parallel()
	req := activeHighWith12HrHbi()
	ctx := context.Background()
	now := time.Now().UTC()

	tests := []struct {
		name    string
		token   *gdtoken.Token
		wantErr bool
	}{
		{
			name: "shopper with fresh HBI within 12h is valid",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-30 * time.Minute).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "shopper with HBI just under 12h is valid",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-11*time.Hour - 55*time.Minute).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "shopper with HBI older than 12h is rejected",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-13 * time.Hour).Unix(),
				}),
			),
			wantErr: true,
		},
		{
			name: "shopper with HbiClaim=0 is rejected",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      0,
				}),
			),
			wantErr: true,
		},
		{
			name: "shopper with ExpiresAtTime=0 skips exp check and passes with fresh HBI",
			// ExpiresAtTime==0 means no exp claim in the token. The > 0 guard
			// skips the expiry check and falls through to the HBI check.
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: 0,
					HbiClaim:      now.Add(-30 * time.Minute).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "shopper with ExpiresAtTime=0 still fails on stale HBI",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: 0,
					HbiClaim:      now.Add(-13 * time.Hour).Unix(),
				}),
			),
			wantErr: true,
		},
		{
			name: "shopper with expired exp is rejected even with fresh HBI",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.ShopperKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-2 * time.Hour).Unix(),
					ExpiresAtTime: now.Add(-time.Minute).Unix(),
					HbiClaim:      now.Add(-30 * time.Minute).Unix(),
				}),
			),
			wantErr: true,
		},
		{
			name: "employee with fresh HBI is valid",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.EmployeeKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-time.Hour).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "employee with HBI older than 12h is rejected",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.EmployeeKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-13 * time.Hour).Unix(),
				}),
			),
			wantErr: true,
		},
		{
			name: "pass with fresh HBI is valid",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.PassKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-time.Hour).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "pass with HBI older than 12h is rejected",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.PassKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-time.Hour).Unix(),
					ExpiresAtTime: now.Add(time.Hour).Unix(),
					HbiClaim:      now.Add(-13 * time.Hour).Unix(),
				}),
			),
			wantErr: true,
		},
		{
			name: "e2s delegation with no HBI delegates to gdtoken.High and passes when fresh",
			// e2s tokens legitimately have no HBI claim (2h window per CLAUDE.md).
			// gdtoken.High for E2SDelegationKind checks IAT + 2h.
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.E2SDelegationKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-30 * time.Minute).Unix(),
					ExpiresAtTime: now.Add(90 * time.Minute).Unix(),
				}),
			),
			wantErr: false,
		},
		{
			name: "e2s delegation with expired exp is rejected via gdtoken.High",
			token: gdtoken.NewToken(
				gdtoken.WithKind(gdtoken.E2SDelegationKind),
				gdtoken.WithBaseToken(gdtoken.BaseToken{
					IssuedAtTime:  now.Add(-3 * time.Hour).Unix(),
					ExpiresAtTime: now.Add(-time.Minute).Unix(),
				}),
			),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := req.Satisfied(ctx, tt.token)
			if (err != nil) != tt.wantErr {
				t.Errorf("Satisfied() err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
