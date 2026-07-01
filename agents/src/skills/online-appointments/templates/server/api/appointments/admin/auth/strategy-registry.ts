// ---------------------------------------------------------------------------
// Admin Auth Strategy Registry
//
// Strategies self-register here. The active strategy is selected via the
// ADMIN_AUTH_STRATEGY env var. Add new strategies by:
//   1. Implementing AdminAuthStrategy in strategies/<name>.ts
//   2. Calling registry.register(yourStrategy) below.
// ---------------------------------------------------------------------------

import type { AdminAuthStrategy } from "./strategies/types";
import { firstUserStrategy } from "./strategies/first-user";

class AdminAuthRegistry {
  private readonly strategies = new Map<string, AdminAuthStrategy>();
  private activeName: string;

  constructor(defaultStrategy: string) {
    this.activeName = defaultStrategy;
  }

  register(strategy: AdminAuthStrategy): this {
    this.strategies.set(strategy.name, strategy);
    return this;
  }

  /** Returns the active strategy. Throws if it hasn't been registered. */
  getActive(): AdminAuthStrategy {
    const strategy = this.strategies.get(this.activeName);
    if (!strategy) {
      throw new Error(
        `Admin auth strategy "${this.activeName}" is not registered. ` +
          `Available: ${[...this.strategies.keys()].join(", ")}`,
      );
    }
    return strategy;
  }

  /** All registered strategies — useful for listing available options. */
  list(): AdminAuthStrategy[] {
    return [...this.strategies.values()];
  }

  /** Override the active strategy at runtime (e.g. for testing). */
  setActive(name: string): void {
    if (!this.strategies.has(name)) {
      throw new Error(`Unknown strategy: "${name}"`);
    }
    this.activeName = name;
  }
}

// Singleton registry — register all built-in strategies here.
export const adminAuthRegistry = new AdminAuthRegistry(
  process.env.ADMIN_AUTH_STRATEGY ?? "first-user",
).register(firstUserStrategy);
// To add more strategies:
// .register(envPasswordStrategy)
// .register(oauthStrategy)

export type { AdminAuthStrategy } from "./strategies/types";
