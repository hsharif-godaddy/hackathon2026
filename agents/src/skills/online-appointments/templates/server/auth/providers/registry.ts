// ---------------------------------------------------------------------------
// Provider Registry
//
// Register all auth providers here. The active provider is selected via the
// AUTH_PROVIDER env var (defaults to "local"). Endpoints never import a
// concrete provider — they call through the registry.
//
// To add a new provider:
//   1. Implement AuthProvider in providers/<name>.ts
//   2. Call registry.register(yourProvider) below.
//   3. Set AUTH_PROVIDER=<name> in the environment.
// ---------------------------------------------------------------------------

import type { AuthProvider } from "./types";
import { localProvider } from "./local";

class ProviderRegistry {
  private readonly providers = new Map<string, AuthProvider>();
  private activeName: string;

  constructor(defaultProvider: string) {
    this.activeName = defaultProvider;
  }

  register(provider: AuthProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  getActive(): AuthProvider {
    const p = this.providers.get(this.activeName);
    if (!p) {
      throw new Error(
        `Auth provider "${this.activeName}" is not registered. ` +
          `Available: ${[...this.providers.keys()].join(", ")}`,
      );
    }
    return p;
  }

  get(name: string): AuthProvider | undefined {
    return this.providers.get(name);
  }

  list(): AuthProvider[] {
    return [...this.providers.values()];
  }

  setActive(name: string): void {
    if (!this.providers.has(name)) throw new Error(`Unknown provider: "${name}"`);
    this.activeName = name;
  }
}

export const providerRegistry = new ProviderRegistry(process.env.AUTH_PROVIDER ?? "local").register(
  localProvider,
);
// .register(googleProvider)
// .register(magicLinkProvider)

export type { AuthProvider, AuthUser, Role, IdentityType } from "./types";
