# OAuth Architecture

This document explains how OAuth works in the AI App Builder, why we use **per‑App client registration**, and how the current code implements the flows.

---

## 1. Goals and Constraints

Our platform has two distinct authorization needs:

1. **C1 → Provider (Agent admin actions)**
   - Who: C1 (business owner) authorizing our **Agent** to manage their store/products.
   - What: Long‑lived, revocable consent for commerce APIs.
   - How: **Authorization Code Grant with PKCE**.

2. **App → Provider (Preview/Published checkout)**
   - Who: Our **App instance** acting server‑to‑server when C2 (end user) checks out.
   - What: Ability to create checkout sessions etc. on behalf of C1.
   - How: **Client Credentials Grant** (no C2 OAuth; pure backend‑to‑backend).

Key constraints:

- Each **App instance** (Preview + Published) has its own unique base URL and **redirect URI**.
- OAuth providers require redirect URIs to be pre‑registered per **OAuth client**.
- We cannot feasibly maintain a single "master client" that knows **all** dynamic redirect URIs.

Hence: **Per‑App client registration**.

---

## 2. Domain Model and Actors

- **C1** – Our customer (business owner).
- **C2** – Their customer (end user).
- **App** – Isolated instance owned by C1:
  - One C1 → many Apps.
  - Each App has **Preview** and **Published** variants.
    - **Preview**: Runs the **Agent** service and the Application task.
    - **Published**: Runs only the Application task.
- **OAuth Client** – Registered by the **Control Plane** (Airo App Builder team):
  - Created at **Pre-Provisioning Time** (when the app instance is warmed up).
  - Owned by a single **App** (not shared across Apps).
  - Configured with that App’s specific redirect URIs.
  - The Control Plane pre-provisions infrastructure and manages the lifecycle.

Relationship:

> C1 → owns App → owns OAuth Client → talks to Provider

---

## 3. Grant Types and Flows

### 3.1 Agent (C1 Admin) – Authorization Code + PKCE

- Used when the **Agent** needs permission to:
  - Read/store store metadata.
  - Read/write products.
  - Perform onboarding actions, etc.
- Flow characteristics:
  - C1 is the **resource owner**.
  - Agent is the **OAuth client**.
  - We use **Authorization Code Grant with PKCE** for security.
  - One **access token per App + provider**.

Implemented in:

- `services/auth-service.ts` – `AuthService.getAccessToken`, `AuthService.exchangeCode`.
- `tools/oauth-tool.ts` – `oauthConnect` tool (AI‑lib).
- `tools/commerce-tools.ts` – commerce tools that require OAuth.

### 3.2 App Variants (Preview / Published) – Client Credentials

- Used when **Preview/Published** variants need to:
  - Create checkout sessions.
  - Perform purely backend operations on behalf of C1.
- Flow characteristics:
  - App server is the **OAuth client**.
  - No interactive C1/C2 login during checkout.
  - Tokens are obtained using **Client Credentials Grant** (client_id + client_secret).

Implementation details for this flow live in the app runtime / checkout services (not shown in the snippets here), but they use the same **per‑App client registration** model described next.

---

## 4. Why Per‑App Client Registration (No “Master Client ID”)

### 4.1 Redirect URI Constraints

- OAuth clients must pre‑register allowed **redirect URIs**.
- Each App instance has its own **Agent URL** and corresponding `/oauth/.../callback` endpoint.
- A single master client would require:
  - Either an unbounded set of redirect URIs, which providers usually do **not** allow.
  - Or dynamic redirect URIs that bypass strict allow‑lists, which is not acceptable for security.

Per‑App client registration lets us:

- Register exact redirect URIs for each App.
- Keep provider configuration simple and strict.

### 4.2 Isolation and Blast Radius

Per‑App clients give us:

- **Security isolation**:
  - If one App’s client credentials are compromised or misconfigured, only that App is affected.
- **Revocation isolation**:
  - C1 (or we) can revoke access for a specific App without impacting others.
- **Config isolation**:
  - Different Apps can have different scopes, environments, or providers over time.

### 4.3 Operational Simplicity

- Each App has:
  - Its own **client_id / client_secret**.
  - Its own **redirect URIs**.
- The App Builder provisioning flow knows exactly which OAuth client belongs to which App.

---

## 5. Per‑App Client Registration Lifecycle

When the Control Plane warms up a new pre-provisioned App instance:

1. **Provisioning service registers an OAuth client** with the provider:
   - Redirect URIs include:
     - `https://<app-agent-host>/oauth/<provider>/callback`
   - Scopes are set to the fixed set we require (see `OAuthScopes` in `auth-service.ts`).

2. **Client credentials are stored with the App**:
   - For the backend runtime of that App, we configure environment variables:
     - `GODADDY_OAUTH_CLIENT_ID`
     - `GODADDY_OAUTH_CLIENT_SECRET`
     - `OAUTH_REDIRECT_URI` (App‑specific callback)
   - `AuthService.getConfig()` reads these at runtime:
     ```ts
     function getConfig() {
       return {
         apiUrl: process.env.GODADDY_BASE_URL || "https://api.dev-godaddy.com",
         authEndpoint:
           process.env.GODADDY_OAUTH_AUTH_ENDPOINT || "/v2/oauth2/authorize",
         tokenEndpoint:
           process.env.GODADDY_OAUTH_TOKEN_ENDPOINT || "/v2/oauth2/token",
         clientId: process.env.GODADDY_OAUTH_CLIENT_ID || "",
         clientSecret: process.env.GODADDY_OAUTH_CLIENT_SECRET || "",
         redirectUri:
           process.env.OAUTH_REDIRECT_URI ||
           "http://localhost:4000/oauth/godaddy/callback",
       };
     }
     ```

3. **App → Provider calls**:
   - Agent tools and checkout flows from this App always use the **App’s own** client_id/client_secret/redirectUri.

---

## 6. Runtime Flow for Agent (Authorization Code + PKCE)

This is the core flow implemented in the provided files.

### 6.1 App‑Scoped Identity (`appId`)

Every AI‑lib tool that needs OAuth requires `context.metadata.appId`. Examples:

- `oauth-tool.ts` – `oauthConnect`
- `commerce-tools.ts` – `commerceGetStore`, `commerceSetupStore`, `commerceSearchStoreProducts`, `commerceAddStoreProducts`

`appId` identifies the specific App instance. All tokens and PKCE state are keyed by this.

### 6.2 Getting / Ensuring an Access Token

Entry points:

- `oauthConnect` tool:
  ```ts
  const appId = context?.metadata?.appId as string;
  const result = await AuthService.getAccessToken({ appId });
  ```
- Commerce tools:
  ```ts
  const { accessToken } = await AuthService.getAccessToken({ appId });
  ```

The core logic is in `AuthService.getAccessToken`:

1. **Load current OAuth client config** for this App:

   ```ts
   const config = getConfig();
   const {
     appId,
     provider = "godaddy",
     redirectUri = config.redirectUri,
   } = params;
   ```

2. **Check for an existing token** for `{ appId, provider }`:
   - Uses `OAuthTokenRepository` + `TokenStore`:
     ```ts
     const record = repo.findOne(appId, provider);
     const stored = TokenStore.findValid({ appId, provider });
     ```
   - Each App has only **one token per provider**, regardless of which tool requested it.

3. **If token is valid** (not about to expire), return it:

   ```ts
   return { accessToken: stored.accessToken, expiresAt: stored.expiresAt };
   ```

4. **If token is expired**, attempt **refresh**:
   - Refresh uses the same scopes and `config.clientId`.
   - If refresh succeeds, return the new token.
   - If refresh fails, or scopes mismatch, fall through to a new OAuth flow.

5. **If no valid token**, initiate a new Authorization Code + PKCE flow:
   - Generate PKCE values and state, store them in `pkceStateStore` keyed by `state`:
     ```ts
     pkceStateStore.set(state, {
       appId,
       codeVerifier,
       scopes: OAuthScopes,
       redirectUri,
       createdAt: Date.now(),
     });
     ```
   - Construct the provider authorization URL:
     ```ts
     const authParams = new URLSearchParams({
       response_type: "code",
       client_id: config.clientId,
       redirect_uri: redirectUri,
       scope: scopeKey,
       state,
       code_challenge: codeChallenge,
       code_challenge_method: "S256",
     });
     const authRedirectUrl = `${config.apiUrl}${config.authEndpoint}?${authParams.toString()}`;
     ```
   - **Throw `AuthRequiredError`** with the redirect URL, state, and scopes:
     ```ts
     throw new AuthRequiredError(authRedirectUrl, state, OAuthScopes);
     ```

### 6.3 Frontend Handling of `AuthRequiredError`

Tools wrap this error into a structured response:

- `oauthConnect`:

  ```ts
  if (err instanceof AuthRequiredError) {
    return {
      success: true,
      authRequired: true,
      authRequest: {
        type: 'auth_request',
        provider: 'godaddy',
        scopes: err.scopes,
        redirectUrl: err.redirectUrl,
        state: err.state,
        ...
      },
    };
  }
  ```

- Commerce tools (`needAuth(...)` in `commerce-tools.ts`):
  ```ts
  if (err instanceof AuthRequiredError) {
    return needAuth(
      { code: ErrorCodes.AUTH_REQUIRED, message: 'Authentication required to proceed.' },
      {
        auth: {
          provider: 'godaddy',
          scopes: err.scopes,
          redirectUrl: err.redirectUrl,
          state: err.state,
        },
      },
      ...
    );
  }
  ```

Frontends:

- Open `redirectUrl` in a popup.
- C1 completes authorization at the provider.
- Provider redirects back to the App’s `redirectUri` with `code` and `state`.

### 6.4 Exchanging the Authorization Code

On the callback route, the backend calls `AuthService.exchangeCode`:

```ts
const { accessToken, expiresAt } = await AuthService.exchangeCode({
  code,
  state,
});
```

`exchangeCode`:

1. **Validates `state`** using `pkceStateStore`:
   - Ensures the state exists and is not older than 10 minutes.
2. **Exchanges `code` for tokens** using the App’s client config:
   ```ts
   const tokenUrl = `${config.apiUrl}${config.tokenEndpoint}`;
   const body = new URLSearchParams({
     grant_type: "authorization_code",
     client_id: config.clientId,
     client_secret: config.clientSecret,
     code,
     redirect_uri: redirectUri,
     code_verifier: codeVerifier,
   });
   ```
3. **Validates scopes**:
   - Ensures provider‑returned `scope` includes all required `OAuthScopes`.
4. **Saves tokens to `TokenStore`**, keyed by `{ appId, provider: 'godaddy' }`.
5. **Deletes PKCE state** for that `state`.
6. **Notifies listeners via WebSocket**:
   ```ts
   io.emit("oauth:result", {
     success: true,
     appId,
     state,
     provider: "godaddy",
     expiresAt,
     scopes: [...new Set(scopes)].sort(),
   });
   ```

Importantly:

- The **AI Agent never sees the raw access token**:
  - `oauthConnect` returns only metadata (`provider`, `scopes`, `expiresAt`), not `accessToken`.
  - Commerce tools use the token server‑side and return only business data.

---

## 7. Token Storage and Isolation

- Tokens are keyed by **App ID + provider**:
  - Ensures strict isolation between Apps.
- We maintain **one token per App per provider**:
  - All tools for that App reuse it.
  - Simplifies revocation and rotation.
- Scopes:
  - Defined centrally as `OAuthScopes` in `auth-service.ts`:
    ```ts
    export const OAuthScopes = [
      "commerce.store:read",
      "commerce.product:read",
      "commerce.product:write",
      "commerce.onboarding-application:write",
      "commerce.onboarding-application:read",
    ];
    ```
  - Tools can’t customize scopes; they always request this fixed set.
  - `exchangeCode` validates that granted scopes cover the required set.

---

## 8. App Variants (Client Credentials) – Conceptual View

While the code snippets above focus on the interactive C1 → Agent flow, the **same per‑App client registration** underpins Preview/Published checkout:

- Each App has its own **client_id / client_secret** (from provisioning).
- Checkout / backend services for Preview/Published:
  - Use **Client Credentials Grant** with those credentials.
  - Obtain App‑scoped access tokens server‑side.
  - Use those tokens to create checkout sessions / payments for C2, on behalf of C1.
- There is **no interactive OAuth step** for C2:
  - C2 never authorizes directly with the provider.
  - All actions are mediated by the App using C1’s previously granted authority.

This keeps:

- UX for C2 simple.
- Security strong, because:
  - Tokens never leave the server.
  - Each App has isolated credentials and tokens.

---

## 9. Why This Architecture

**Summary of benefits:**

- **Correctness under provider constraints**:
  - Works with strict redirect‑URI whitelisting.
- **Isolation by design**:
  - Per‑App clients, tokens, and environment config.
- **Clear mental model**:
  - C1 ↔ Agent uses Auth Code + PKCE.
  - App ↔ Provider (for C2) uses Client Credentials.
- **Developer ergonomics**:
  - Tools only need `context.metadata.appId`.
  - They call `AuthService.getAccessToken` and handle `AuthRequiredError`.
  - No tool ever manipulates raw tokens directly.

This is why we do not use a “Master Client ID”: per‑App client registration is the simplest model that satisfies provider constraints, gives us the required isolation, and maps cleanly onto our App/Agent architecture.

## 10. OpenFGA Integration

At pre-provisioning, when the Control Plane (Airo) provisions OAuth clients for a customer (C1), it must also establish the corresponding authorization relationships in OpenFGA so that:

- Each OAuth client is owned by the correct `airo_application`.
- Each App Variant (Preview/Published) has the required permissions (e.g. `product_read`) for its client‑credentials flows.

### 10.1 Relevant OpenFGA model (excerpt)

We rely on the following types and relations in the OpenFGA model:

```fga
type airo_application
  relations
    define owner: [customer]

type oauth_client
  relations
    define owner: [airo_application]

type commerce_store
  relations
    # simplified for clarity; allows oauth_client to be assigned directly
    define product_read: [oauth_client] or ...
```

> Note: The `oauth_client` type must expose an `owner` relation to `airo_application` as shown above.

### 10.2 Pre-provisioning client registration flow

When an app is pre-provisioned, we perform the following steps:

1. **Create the OAuth client in the IdP**
   - Airo creates/provisions an OAuth client for the App Variant (e.g. Preview, Published) and receives a `client_id`.

2. **Create the OAuth client entity in OpenFGA and set ownership**

   Conceptually, we create the `oauth_client` object in OpenFGA by writing its first tuple and link it to the owning `airo_application`:

   ```fga
   oauth_client:<client_id>#owner @airo_application:<app_id>
   ```

   - `client_id`: the ID of the OAuth client created in the IdP.
   - `app_id`: the identifier of the `airo_application` that owns this client.

   This ensures that the Airo application is recognized as the owner of the OAuth client in the authorization graph.

3. **Grant `product_read` to the App Variant’s OAuth client on the Store**

   App Variants (Preview/Published) use the client‑credentials flow to call the commerce catalog API for a specific store. To allow this, we must grant `product_read` to the OAuth client **on the specific store entity**.

   Given the `commerce_store` object associated with the customer:

   ```text
   commerce_store:<store_id>
   ```

   we write the following tuple:

   ```fga
   commerce_store:<store_id>#product_read @oauth_client:<client_id>
   ```

   This grants `product_read` on that specific store to the OAuth client, enabling the App Variant to read product data via the client‑credentials flow.

4. **Additional permissions (future extensions)**

   For flows that require additional capabilities (e.g. creating orders during checkout, such as an `order_create` permission), we will:
   - Extend the OpenFGA model with the appropriate relation(s) (e.g. `define order_create: [oauth_client]` on the relevant type).
   - Write analogous tuples at client registration time, following the same pattern as `product_read`.

   For now, the minimum requirement for App Variants that only need product access is to create the `product_read` tuples as shown above.

### 10.3 When this runs

All OpenFGA updates above happen during the **Pre-Provisioning / Client Registration** phase, immediately after the OAuth client is successfully created in the IdP for a specific `(C1, app_id, variant)` combination. From a product perspective, this should be treated as a single logical operation: if either the OAuth client creation or the OpenFGA tuple writes fail, the app installation / variant provisioning should be rolled back or retried.
