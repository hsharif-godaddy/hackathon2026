package httpproxy

import (
	"net/http"

	"github.com/airo-ai-builder/dev-supervisor/internal/allocconfig"
)

const (
	// defaultProductID is the fallback value when PRODUCT_ID is not configured
	// in /alloc/config.json. Corresponds to AIRO_PRODUCT_IDS.AAB_V1.
	defaultProductID = "aab-v1"

	productIDHeader = "ss-product-id"
)

// responseHeadersMiddleware injects custom response headers on every response.
// Headers that depend on /alloc/config.json are read dynamically via allocconfig
// with a 5-second TTL cache, so config changes are picked up without restart.
func responseHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		addProductID(w)
		next.ServeHTTP(w, r)
	})
}

func addProductID(rspWriter http.ResponseWriter) {
	productID := allocconfig.GetProductIDOrDefault(defaultProductID)
	rspWriter.Header().Set(productIDHeader, productID) //nolint:canonicalheader,nolintlint // intentional GD casing
}
