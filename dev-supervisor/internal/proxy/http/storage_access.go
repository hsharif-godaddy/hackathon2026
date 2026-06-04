package httpproxy

import (
	"log/slog"
	"net/http"
)

// storageAccessPage is a fully self-contained HTML bootstrap served at
// /airo/storage-access. It is the WebKit-sanctioned escape hatch for the
// embedded cross-site preview: when Safari ITP blocks the third-party
// preview_auth/airo_share_token cookie, the app's sub-resources 307 and the
// preview never renders. This page (loaded inside the preview iframe) calls
// document.requestStorageAccess() from a user gesture; once Safari grants it,
// the iframe can store/send its cookie, so we redirect into the real app and
// every sub-resource then authenticates.
//
// Why this must be a dedicated, dependency-free route:
//   - It is in JWT_EXCLUDED_PATHS, so it loads even when no cookie/token is
//     present (the broken state is precisely "no usable credential").
//   - It references ZERO external scripts/styles — any sub-resource would
//     itself 307 in the blocked state, so everything is inlined.
//   - It serves a CONSTANT body; the redirect target is read client-side from
//     location.search and validated to be a same-origin relative path, so the
//     server never reflects untrusted input (no open-redirect / XSS surface).
//
// The page is harmless when loaded first-party or when access already exists:
// it detects has-access / no-API and redirects immediately with no prompt.
const storageAccessPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Loading preview…</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    color:#1d1d1f;background:#f5f5f7}
  .card{max-width:340px;padding:24px;text-align:center}
  h1{font-size:17px;margin:0 0 8px}
  p{margin:0 0 16px;color:#555}
  button{font:inherit;font-weight:600;color:#fff;background:#0b5fff;border:0;
    border-radius:8px;padding:10px 18px;cursor:pointer}
  button:hover{background:#0a4fd6}
  a{display:inline-block;margin-top:12px;color:#0b5fff;font-size:13px}
  .hidden{display:none}
</style>
</head>
<body>
<div class="card">
  <h1 id="title">Loading preview…</h1>
  <p id="msg"></p>
  <button id="enable" class="hidden">Enable preview</button>
  <br>
  <a id="newtab" class="hidden" target="_blank" rel="noopener noreferrer">Open preview in a new tab</a>
</div>
<script>
(function () {
  "use strict";

  // Resolve the redirect target to a SAME-ORIGIN relative path only.
  // Reject protocol-relative ("//host") and backslash tricks so this can
  // never be turned into an open redirect.
  function target() {
    var raw = new URLSearchParams(location.search).get("redirect") || "/";
    if (raw.charAt(0) !== "/" || raw.charAt(1) === "/" || raw.charAt(1) === "\\") {
      raw = "/";
    }
    return new URL(raw, location.origin).href;
  }
  var dest = target();

  function go() { location.replace(dest); }

  var titleEl = document.getElementById("title");
  var msgEl = document.getElementById("msg");
  var enableBtn = document.getElementById("enable");
  var newTab = document.getElementById("newtab");
  newTab.href = dest; // set via property — never string-concatenated into HTML

  function showManual(message) {
    titleEl.textContent = "Preview blocked";
    msgEl.textContent = message;
    newTab.classList.remove("hidden");
  }

  // No Storage Access API (non-Safari / very old) → nothing to do here;
  // just continue to the app and let the normal cookie/token flow handle it.
  if (!document.requestStorageAccess || !document.hasStorageAccess) {
    go();
    return;
  }

  document.hasStorageAccess().then(function (has) {
    if (has) { go(); return; } // already have cookie access → straight through

    // Blocked: require a user gesture to request access.
    titleEl.textContent = "Enable preview";
    msgEl.textContent = "Your browser is blocking the preview. Tap to enable it.";
    enableBtn.classList.remove("hidden");
    enableBtn.addEventListener("click", function () {
      document.requestStorageAccess().then(function () {
        go(); // granted → reload into the app; the cookie now sticks
      }).catch(function () {
        showManual("Couldn’t enable it here. Open the preview in a new tab instead.");
      });
    });
  }).catch(function () {
    showManual("Open the preview in a new tab to continue.");
  });
})();
</script>
</body>
</html>
`

// handleStorageAccess serves the Storage Access bootstrap page. It is
// registered in JWT_EXCLUDED_PATHS so it is reachable in the exact state it
// exists to fix — no usable preview credential. The page itself exposes no
// app content; on success it redirects to a same-origin app path that IS
// authenticated (token in the redirect query), which re-sets the cookie that
// now persists post-grant.
func handleStorageAccess(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	// Defense in depth: this page intentionally embeds an inline script and is
	// meant to run framed by the builder, so we don't send frame-ancestors here.
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if r.Method == http.MethodHead {
		return
	}

	if _, err := w.Write([]byte(storageAccessPage)); err != nil {
		slog.Error("storage_access.write_error", "error", err)
	}
}
