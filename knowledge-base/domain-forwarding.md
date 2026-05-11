# Domain Forwarding for Secondary Domains

## When to Forward vs. Attach

Only one domain can be attached as the primary domain for an Airo app. If a user owns multiple domains (e.g. `mybusiness.com`, `mybusiness.net`, `mybusiness.org`) and wants them all to reach their published site, the extra domains should be **forwarded** to the primary attached domain.

**Attach** = connect one primary domain directly to the app (DNS points at Airo CDN).
**Forward** = redirect visitors from a secondary domain to the primary domain via a 301/302 redirect.

## How to Set Up Forwarding

**Always call the `domainPurchase` tool with `{ action: 'forward' }` for forwarding requests.** The tool looks up the user's actual attached domain and generates a personalized deep link. Do not answer forwarding questions from this KB article alone.

### GoDaddy Domains

Users set up forwarding in the Domain Control Center. The tool provides the correct deep link. Key choices:

- **301 (Permanent)** redirect — recommended for SEO (passes link equity)
- **302 (Temporary)** — only for short-term redirects
- **Forward only** — recommended (visitor sees destination URL)
- **Forward with masking** — not recommended (iframe, bad for SEO)

Changes take effect within minutes. **Important:** GoDaddy forwarding only works when the domain uses GoDaddy nameservers. If nameservers point elsewhere, the forwarding record won't take effect — the user must either switch nameservers back to GoDaddy or configure the redirect at their current DNS provider instead.

**Help article:** https://www.godaddy.com/help/forward-my-godaddy-domain-12123

### External (Non-GoDaddy) Domains

User must configure forwarding at their registrar. General approach: look for URL Forwarding / URL Redirect / Web Redirect in the registrar's DNS panel and add a 301 redirect to the primary domain.

## Limitations

- Forwarding **redirects** visitors — does not serve the app on both domains simultaneously.
- Path forwarding behavior varies by registrar — most redirect all paths to the root of the destination domain (e.g. `mybusiness.com/about` → `mybusiness.net/`, not `mybusiness.net/about`). Do not promise path preservation unless the registrar explicitly supports it.
- No separate SSL certificate for the secondary domain — the browser shows the primary domain after redirect.
