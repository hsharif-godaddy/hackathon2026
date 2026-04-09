import type { DomainFilterConfig } from '../types.js';

/**
 * Check if a domain/event is enabled for logging.
 *
 * Priority (highest to lowest):
 * 1. Allowlist (enabledDomains) - if set, only matching events pass
 * 2. Blocklist (disabledDomains) - blocks matching events
 * 3. Opt-in (optInDomains) - requires explicit enablement
 * 4. Default: enabled
 */
export function isDomainEnabled(event: string, config: DomainFilterConfig): boolean {
  if (!event) return true;

  // Allowlist mode
  if (config.enabledDomains && config.enabledDomains.length > 0) {
    for (const domain of config.enabledDomains) {
      if (event === domain || event.startsWith(domain + '.')) {
        return true;
      }
    }
    return false;
  }

  // Blocklist mode
  if (config.disabledDomains) {
    for (const domain of config.disabledDomains) {
      if (event === domain || event.startsWith(domain + '.')) {
        return false;
      }
    }
  }

  // Opt-in mode
  if (config.optInDomains) {
    for (const domain of config.optInDomains) {
      if (event === domain || event.startsWith(domain + '.')) {
        return false;
      }
    }
  }

  return true;
}
