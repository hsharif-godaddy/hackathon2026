# Forwarding Details (Secondary Domains)

Only one domain can be **attached** as the app's primary. When a user owns
several domains (e.g. `mybusiness.com`, `.net`, `.org`) and wants them all to
reach the published site, the extras are **forwarded** to the primary — a
redirect, not a second attachment. Attach = DNS points at Airo's CDN; forward =
visitors are redirected to the primary domain.

Always call `{ action: 'forward' }` first (it finds the attached domain and
builds a personalized deep link), then paraphrase these specifics from the tool
result:

- **301 (Permanent)** — recommended; passes SEO link equity. **302 (Temporary)**
  only for short-term redirects.
- **Forward only** — recommended (visitor sees the destination URL).
  **Forward with masking** — not recommended (iframe; bad for SEO).
- **GoDaddy domains:** the user sets this in the Domain Control Center via the
  tool's deep link; changes take effect within minutes. Forwarding only works
  when the domain uses **GoDaddy nameservers** — if they point elsewhere the
  record won't take effect, so the user must switch nameservers back to GoDaddy
  or configure the redirect at their current DNS provider. Help article:
  https://www.godaddy.com/help/forward-my-godaddy-domain-12123
- **External (non-GoDaddy) domains:** the user configures forwarding at their
  registrar — look for URL Forwarding / URL Redirect / Web Redirect in the DNS
  panel and add a 301 to the primary domain.

Set expectations honestly on limitations:

- Forwarding **redirects** visitors — it does not serve the app on both domains
  at once.
- Path forwarding varies by registrar; most redirect every path to the root of
  the destination (`mybusiness.com/about` → `mybusiness.net/`). Don't promise
  path preservation unless the registrar explicitly supports it.
- No separate SSL certificate for the secondary domain — after the redirect the
  browser shows the primary domain.
