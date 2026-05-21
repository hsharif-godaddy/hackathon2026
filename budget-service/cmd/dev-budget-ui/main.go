// Local E2E only: static dev UI + reverse proxy to budget-service (avoids browser CORS).
package main

import (
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	devui "github.com/gdcorp-partners/airo-app-builder/budget-service/e2e/dev-ui"
)

func main() {
	upstream, err := url.Parse(strings.TrimSpace(getenv("BUDGET_SERVICE_URL", "http://127.0.0.1:8080")))
	if err != nil || upstream.Scheme == "" || upstream.Host == "" {
		log.Fatal("BUDGET_SERVICE_URL must be a valid URL")
	}
	listenAddr := getenv("DEV_BUDGET_UI_ADDR", ":9980")
	fatalIfSelfProxy(upstream, listenAddr)

	proxy := httputil.NewSingleHostReverseProxy(upstream)
	orig := proxy.Director
	proxy.Director = func(req *http.Request) {
		orig(req)
		// NewSingleHostReverseProxy keeps the browser Host; nginx/virtual hosts then see 127.0.0.1:9980 and return 403.
		req.Host = upstream.Host
		if t := strings.TrimSpace(req.Header.Get("X-E2E-Authorization")); t != "" {
			req.Header.Set("Authorization", t)
			req.Header.Del("X-E2E-Authorization")
		}
	}

	h := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if p == "" {
			p = "/"
		}
		if !strings.HasPrefix(p, "/") {
			p = "/" + p
		}
		if p == "/health" || strings.HasPrefix(p, "/api/") {
			proxy.ServeHTTP(w, r)
			return
		}
		switch p {
		case "/", "/index.html":
			serveEmbed(w, r, "index.html", "text/html; charset=utf-8")
		case "/app.js":
			serveEmbed(w, r, "app.js", "text/javascript; charset=utf-8")
		default:
			http.NotFound(w, r)
		}
	})
	log.Printf("dev-budget-ui listening %s proxy-> %s", listenAddr, upstream.Redacted())
	log.Printf("Budget Service Dev UI: %s", browserURL(listenAddr))
	log.Fatal((&http.Server{Addr: listenAddr, Handler: h}).ListenAndServe())
}

// browserURL turns a listen address (":9980", "0.0.0.0:9980", "127.0.0.1:9980") into a clickable localhost URL.
func browserURL(listen string) string {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		if strings.HasPrefix(listen, ":") {
			return "http://localhost:" + strings.TrimPrefix(listen, ":") + "/"
		}
		return "http://" + listen + "/"
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "localhost"
	}
	return "http://" + host + ":" + port + "/"
}

func serveEmbed(w http.ResponseWriter, r *http.Request, name, contentType string) {
	b, err := devui.FS.ReadFile(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", contentType)
	_, _ = w.Write(b)
}

// Same host:port as this process causes /api/* to proxy to itself → ERR_TOO_MANY_REDIRECTS.
func fatalIfSelfProxy(up *url.URL, listen string) {
	lport, ok := listenPort(listen)
	if !ok {
		return
	}
	uhost := strings.ToLower(up.Hostname())
	uport := up.Port()
	if uport == "" {
		switch up.Scheme {
		case "http":
			uport = "80"
		case "https":
			uport = "443"
		default:
			return
		}
	}
	loopback := uhost == "localhost" || uhost == "127.0.0.1" || uhost == "::1" || uhost == ""
	if !loopback {
		return
	}
	if uport == lport {
		log.Fatalf("dev-budget-ui: BUDGET_SERVICE_URL=%s uses port %s, same as DEV_BUDGET_UI_ADDR=%s — "+
			"point BUDGET_SERVICE_URL at the budget API (e.g. http://127.0.0.1:8080), not this UI", up.Redacted(), uport, listen)
	}
}

func listenPort(listen string) (port string, ok bool) {
	_, p, err := net.SplitHostPort(listen)
	if err == nil {
		return p, true
	}
	if strings.HasPrefix(listen, ":") {
		return strings.TrimPrefix(listen, ":"), true
	}
	return "", false
}

func getenv(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}
