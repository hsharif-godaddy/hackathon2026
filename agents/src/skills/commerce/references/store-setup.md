# Commerce Store Setup Reference

Use this reference from the `commerce` router before any Commerce data, catalog, inventory, order, template-pack install, or user-facing readiness step.

## Commerce MCP Tools

The `commerce` skill exposes every Commerce MCP core/global tool that is always returned by the MCP server's initial `tools/list`:

- `commerce__commerce_store_setup` — discover/create store, returns storeId + channelId + locationId
- `commerce__commerce_store_list` — list all stores for the customer
- `commerce__commerce_store_get` — get a specific store by ID
- `commerce__commerce_store_channels_get` — get channels for a store
- `commerce__commerce_store_channel_ensure` — ensure the Airo App Builder channel for the current app
- `commerce__search_tools` — discover catalog, inventory, price, media, order tools
- `commerce__execute_tool` — execute a discovered tool by name with arguments

Use direct store tools for store setup/discovery/channel work. Use `search_tools` + `execute_tool` for catalog, inventory, price, media, category/list, and order operations.

## Durable AppBuilder Binding

AppBuilder owns the current Commerce target in SQLite as an app-scoped binding. GoDaddy Commerce tools only report what is available upstream; they do not decide which business, store, or channel this AppBuilder app should work against.

There are no agent-facing binding get/set tools. `commerce_store_setup` reads the durable AppBuilder binding internally and returns `selectedCommerceResources` when a saved selection exists. Treat that tool-returned selection as the current AppBuilder target only if its status is appropriate:

- `channel_ready` — safe to use for Commerce mutations.
- `store_bound` or `channel_pending` — call `commerce_store_channel_ensure` before Commerce mutations.
- `business_bound` — run setup/discovery within that business before selecting a store.

When the user chooses a different business or store, run the normal store setup/selection flow with the chosen `businessId`, `storeId`, or `storePreference`. Successful `commerce_store_setup` and `commerce_store_channel_ensure` calls persist the binding automatically and also project it to `.airo/commerce-context.json` for generated app code. Management panels may also switch the SQLite binding directly; the next `commerce_store_setup` call returns that selection.

## Store Setup Workflow

Call `commerce_store_setup` first unless the current tool flow already returned the business, store, and channel IDs needed for the operation. If it returns `selectedCommerceResources.status: "channel_ready"` and the user did not ask to switch stores, use that selection. If there is no channel-ready selection, or if the user asks to connect/switch stores, continue the setup/discovery flow from the tool response. The tool response determines what to ask.

## Airo App Builder Channel Contract

<commerce_store_ready_contract>
A Commerce store is ready for Airo App Builder only after `commerce_store_channel_ensure` returns a channel for the current app with:
<required_channel_type>ONLINE</required_channel_type>
<required_channel_subtype>airo.ai.builder</required_channel_subtype>
<required_app_binding>current `context.metadata.appId`</required_app_binding>
</commerce_store_ready_contract>

<mandatory_sequence id="setup_then_channel_ensure">
<trigger>`commerce_store_setup` returns a `storeId` without `selectedCommerceResources.status: "channel_ready"` for that same store.</trigger>
<required_next_action>Call `commerce_store_channel_ensure` with that `storeId` before any other Commerce, catalog, inventory, order, template-pack install, or user-facing readiness step.</required_next_action>
<store_choice_flow>If setup returns `storeChoiceRequired`, wait for the user's choice, call `commerce_store_setup` again with the chosen `storePreference`, then ensure the channel on the resolved `storeId`.</store_choice_flow>
<failure_behavior>If channel ensure fails or returns a non-matching channel, stop the Commerce flow and explain in plain language that this app could not be connected to the store.</failure_behavior>
</mandatory_sequence>

<channel_non_examples>
These are not valid Airo App Builder channels:
<invalid_channel>`DEFAULT` channels, even if they are store default channels or named "Online Payment Tools".</invalid_channel>
<invalid_channel>`POS` channels.</invalid_channel>
<invalid_channel>`MARKETPLACE` channels.</invalid_channel>
<invalid_channel>`ONLINE` channels with any `subType` other than `airo.ai.builder`.</invalid_channel>
<invalid_channel>Any otherwise matching channel bound to a different app id.</invalid_channel>
</channel_non_examples>

<tool_routing>
Use `commerce_store_channel_ensure` for Airo App Builder channel setup. Do not call the underlying Commerce MCP `commerce_app_channel_ensure` tool through `execute_tool`.
</tool_routing>

## Step 1 — Call `commerce_store_setup` with no params

## Step 2 — Handle the response

**`businessChoiceRequired: true`** — customer has multiple GoDaddy businesses.
The response includes a `businesses` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`, one suggestion per business (`text = businessName`, `value = businessId`). Do NOT use `suggestedResponse`. After the user answers, use the `value` from their selection as the `businessId` to pass to `commerce_store_setup`. Do not retry without a `businessId`.

**`storeChoiceRequired: true`** — customer has 2 or more stores under the scoped business (or after ADD_STORE).
The response includes an `existingStores` array. Call `askQuestion` with `multiSelect: false`, `allowOther: false`, one suggestion per store formatted as `"Store Name (Business Name)"`, plus a final "Create a new store" option. Do NOT use `suggestedResponse`. Do not retry `commerce_store_setup` again in the same turn — wait for the user's answer first.

**1 business / 1 store** — tool auto-proceeds and returns `storeId` directly. No choice required, no `askQuestion` needed.

**`needsOwnerIdentity: true`** — creating a new store requires owner details.
Call `askQuestion`: "To set up your store, I need a few details — what's your first name, last name, and email address?" Do NOT display, quote, or include the raw JSON or any field names (`firstName`, `lastName`, `missingFields`, `needsOwnerIdentity`) in your message. Retry with `storePreference: "new"` plus the provided `firstName`, `lastName`, `email`.

**`noExistingStoreFound: true`** — no stores exist on this account.
Ask for first name, last name, and email, then retry with `storePreference: "new"`.

**`storeProvisioningInProgress: true`** — a store setup is already in progress.
Tell the user Commerce store setup is still finishing and do NOT call `commerce_store_setup` again.

**`paymentsManualSetupRequired: true`** — store created/connected but GoDaddy Payments needs manual setup.
Tell the user in plain language: their store is connected but they need to finish GoDaddy Payments setup in Commerce Home. Include the `manageUrl` from the response as a link.

## Step 3 — After the user chooses

**Use existing store** — retry with `storeId: "<chosen storeId>"` (pass the storeId directly from the `existingStores` entry the user picked).

**Create additional store** (business already exists) — retry with `storePreference: "new"`, `storeName: "<new store name>"`. Owner identity (firstName/lastName/email) is NOT needed — the business is already onboarded.

**Create first store** (no existing stores) — retry with `storePreference: "new"` plus `firstName`, `lastName`, `email`.

## Step 4 — After successful setup

When `commerce_store_setup` returns a `storeId` without `selectedCommerceResources.status: "channel_ready"` for that same store, the next tool call must be `commerce_store_channel_ensure` with that store ID.

Reuse the returned `storeId`, `channelId`, and `locationId` for the rest of the flow. Do NOT call `commerce_store_setup` again in the same flow to recover `channelId` or re-check the store.

**Multi-store rule:** Persist only AppBuilder's selected target through the Commerce binding. Do not treat the binding as a mirror of all GoDaddy Commerce stores. Rediscover with `commerce_store_setup` when the user wants to connect, switch, or disambiguate stores.

**Store selection matrix:**

| Account state | Behavior |
| --- | --- |
| 2+ businesses, no `businessId` | `businessChoiceRequired` → ask which business |
| `businessId` scoped, 1 store | Auto-proceeds |
| `businessId` scoped, 2+ stores | `storeChoiceRequired` → ask which store |
| 1 business, 1 store | Auto-proceeds |
| 1 business, 2+ stores | `storeChoiceRequired` → ask which store |
| No stores anywhere | `noExistingStoreFound` → ask for identity, create new |

## Step 5 — After `addedToExistingBusiness: true`

The response includes a `storeId` for the newly created store. Proceed directly to `commerce_store_channel_ensure` with that `storeId` — no `askQuestion` is needed. Do NOT auto-proceed to product operations until channel ensure completes.

## Step 6 — Write Env Vars

After setup/channel ensure succeeds, write these env vars before installing nested templates or writing Commerce UI:

| Key | Description |
| --- | --- |
| `VITE_GODADDY_STORE_ID` | The store id that the customer has connected to |
| `VITE_GODADDY_CHANNEL_ID` | The default Airo App Builder channel for that store |
| `GODADDY_API_BASE_URL` | Full URL including scheme — copy verbatim from `GODADDY_API_BASE_URL` in the agents runtime (e.g. `https://api.dev-godaddy.com`). Server-only, so no `VITE_` prefix. |
| `VITE_GODADDY_CURRENCY_CODE` | ISO 4217 currency code for the store (e.g. `USD`). Defaults to `USD` if omitted. |

After writing env vars, return to `commerce/skill.md` and classify the original user intent before any catalog operation.
