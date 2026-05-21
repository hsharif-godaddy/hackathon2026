package stripeapi

import (
	"context"
	"fmt"
	"net/http"
)

// FetchEvent calls GET /v2/core/events/{id} and returns the raw JSON body.
// Stripe v2 webhook deliveries are always thin (no data.object); calling
// FetchEvent expands them to the full payload so handlers can read sandbox IDs,
// owner accounts, and other fields.
func (c *Client) FetchEvent(ctx context.Context, eventID string) ([]byte, error) {
	if eventID == "" {
		return nil, fmt.Errorf("stripeapi: FetchEvent: eventID is required")
	}
	raw, err := c.do(ctx, http.MethodGet, "/v2/core/events/"+eventID, requestHeaders{}, nil)
	if err != nil {
		return nil, fmt.Errorf("stripeapi FetchEvent %s: %w", eventID, err)
	}
	return raw, nil
}
