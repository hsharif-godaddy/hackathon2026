// Package openapi serves the embedded OpenAPI spec and Swagger UI (no auth).
// Swagger UI assets are from npm package swagger-ui-dist v5.18.3 (swagger-ui.css, swagger-ui-bundle.js, swagger-ui-standalone-preset.js, index.html).
package openapi

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/gorilla/mux"
)

//go:embed openapi.yaml
var spec []byte

//go:embed swagger-ui
var swaggerUI embed.FS

// Mount registers public GET /openapi.yaml and /swagger/ on r (no auth middleware).
func Mount(r *mux.Router) {
	r.HandleFunc("/openapi.yaml", serveSpec).Methods(http.MethodGet, http.MethodHead)
	r.HandleFunc("/swagger", redirectSwagger).Methods(http.MethodGet)
	sub, err := fs.Sub(swaggerUI, "swagger-ui")
	if err != nil {
		panic("openapi: swagger-ui embed: " + err.Error())
	}
	r.PathPrefix("/swagger/").Methods(http.MethodGet, http.MethodHead).Handler(
		http.StripPrefix("/swagger/", http.FileServer(http.FS(sub))))
}

func serveSpec(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter -- embedded OpenAPI YAML (not HTML); no user input
	_, _ = w.Write(spec)
}

func redirectSwagger(w http.ResponseWriter, r *http.Request) {
	http.Redirect(w, r, "/swagger/", http.StatusMovedPermanently)
}
