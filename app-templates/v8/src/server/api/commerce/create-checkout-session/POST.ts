/** TREAT AS IMMUTABLE - This file is protected by the file-edit tool
 *
 * Implements GoDaddy Commerce checkout session creation with OAuth and GraphQL.
 * Copy from template exactly as-is when implementing commerce checkout.
 */
import type { Request, Response } from "express";
import { existsSync, readFileSync } from "node:fs";

export function deriveCheckoutUrl(apiBaseUrl: string): string {
  try {
    const apiUrl = new URL(apiBaseUrl);
    const newHostname = `checkout.commerce.${apiUrl.hostname}`;
    return `${apiUrl.protocol}//${newHostname}`;
  } catch (error) {
    throw new Error(
      `Failed to derive checkout URL from GODADDY_API_BASE_URL: ${apiBaseUrl}`,
    );
  }
}

/**
 * Load commerce credentials from JSON config files
 * Both files use identical structure with SYSTEM_MANAGED wrapper:
 * {
 *   "FIELD_NAME": {
 *     "SYSTEM_MANAGED": true/false,
 *     "VALUE": "actual-value"
 *   }
 * }
 *
 * Reads from two sources with precedence:
 * 1. src/config/commerce-credentials.json (agent-managed, SYSTEM_MANAGED: false)
 * 2. /alloc/config.json (control plane managed, SYSTEM_MANAGED: true, takes precedence)
 *
 * Note: CHECKOUT_API_BASE_URL is derived from GODADDY_API_BASE_URL
 *
 * @returns Commerce credentials including derived checkoutApiBaseUrl
 * @throws Error if no config files found or credentials missing
 */
function getCommerceConfig() {
  const REQUIRED_FIELDS = [
    "GODADDY_OAUTH_CLIENT_ID",
    "GODADDY_OAUTH_CLIENT_SECRET",
    "STORE_ID",
    "GODADDY_API_BASE_URL",
    "CHANNEL_ID",
  ] as const;

  const allocConfigPath = "/alloc/config.json";
  const srcConfigPath = "./src/config/commerce-credentials.json";

  const extractedConfig: Record<string, string> = {};

  if (existsSync(srcConfigPath)) {
    try {
      const srcConfig = JSON.parse(readFileSync(srcConfigPath, "utf-8"));
      for (const field of REQUIRED_FIELDS) {
        if (srcConfig[field]?.VALUE) {
          extractedConfig[field] = srcConfig[field].VALUE;
        }
      }
      console.log(
        "[Commerce] Loaded from src/config/commerce-credentials.json:",
        Object.keys(extractedConfig).join(", "),
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse ${srcConfigPath}: Invalid JSON format`,
        );
      }
      console.warn(
        "[Commerce] Failed to parse src/config/commerce-credentials.json:",
        error,
      );
    }
  }

  if (existsSync(allocConfigPath)) {
    try {
      const allocConfig = JSON.parse(readFileSync(allocConfigPath, "utf-8"));
      const overriddenFields: string[] = [];

      for (const field of REQUIRED_FIELDS) {
        if (allocConfig[field]?.VALUE) {
          if (extractedConfig[field]) overriddenFields.push(field);
          extractedConfig[field] = allocConfig[field].VALUE;
        }
      }

      const loadedFields = REQUIRED_FIELDS.filter((f) => allocConfig[f]?.VALUE);
      if (loadedFields.length > 0) {
        console.log(
          "[Commerce] Loaded from /alloc/config.json:",
          loadedFields.join(", "),
          overriddenFields.length > 0
            ? `(overrode: ${overriddenFields.join(", ")})`
            : "",
        );
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse ${allocConfigPath}: Invalid JSON format`,
        );
      }
      console.warn("[Commerce] Failed to parse /alloc/config.json:", error);
    }
  }

  const missingFields = REQUIRED_FIELDS.filter(
    (field) => !extractedConfig[field],
  );
  if (missingFields.length > 0) {
    throw new Error(
      `Missing required Commerce credentials: ${missingFields.join(", ")}`,
    );
  }

  const checkoutApiBaseUrl = deriveCheckoutUrl(
    extractedConfig.GODADDY_API_BASE_URL,
  );
  console.log(
    "[Commerce] Config loaded - GODADDY_OAUTH_CLIENT_ID:",
    extractedConfig.GODADDY_OAUTH_CLIENT_ID.substring(0, 8) + "...",
    "STORE_ID:",
    extractedConfig.STORE_ID,
    "GODADDY_API_BASE_URL:",
    extractedConfig.GODADDY_API_BASE_URL,
    "CHECKOUT_API_BASE_URL (derived):",
    checkoutApiBaseUrl,
  );

  return {
    clientId: extractedConfig.GODADDY_OAUTH_CLIENT_ID,
    clientSecret: extractedConfig.GODADDY_OAUTH_CLIENT_SECRET,
    storeId: extractedConfig.STORE_ID,
    apiBaseUrl: extractedConfig.GODADDY_API_BASE_URL,
    checkoutApiBaseUrl,
    channelId: extractedConfig.CHANNEL_ID,
  };
}

let cachedCommerceConfig: ReturnType<typeof getCommerceConfig> | null = null;

function getCommerceConfigCached(): ReturnType<typeof getCommerceConfig> {
  if (!cachedCommerceConfig) {
    cachedCommerceConfig = getCommerceConfig();
  }
  return cachedCommerceConfig;
}

interface CreateCheckoutSessionRequest {
  skuId: string;
  quantity: number;
  returnUrl: string;
  successUrl: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

interface GraphQLCheckoutResponse {
  data?: {
    createCheckoutSession: {
      id: string;
      storeId: string;
      url: string;
    };
  };
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
  }>;
}

function transformUrlsForCommerce(
  returnUrl: string,
  successUrl: string,
): { returnUrl: string; successUrl: string } {
  let finalReturnUrl = returnUrl;
  let finalSuccessUrl = successUrl;

  if (returnUrl.includes("localhost")) {
    finalReturnUrl = returnUrl
      .replace(/localhost/, "success.preview.dev-godaddy.com")
      .replace(/^https:\/\//, "http://");
    console.warn(
      "[Commerce] ⚠️  Localhost in returnUrl transformed:",
      returnUrl,
      "→",
      finalReturnUrl,
    );
  } else if (returnUrl.startsWith("https://")) {
    finalReturnUrl = returnUrl.replace(/^https:\/\//, "http://");
  }

  if (successUrl.includes("localhost")) {
    finalSuccessUrl = successUrl
      .replace(/localhost/, "success.preview.dev-godaddy.com")
      .replace(/^https:\/\//, "http://");
    console.warn(
      "[Commerce] ⚠️  Localhost in successUrl transformed:",
      successUrl,
      "→",
      finalSuccessUrl,
    );
  } else if (successUrl.startsWith("https://")) {
    finalSuccessUrl = successUrl.replace(/^https:\/\//, "http://");
  }

  console.log(
    "[Commerce] URL transformation complete - returnUrl:",
    finalReturnUrl,
    "successUrl:",
    finalSuccessUrl,
  );
  return { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl };
}

async function getAccessToken(): Promise<string> {
  const config = getCommerceConfigCached();
  const clientId = config.clientId;
  const clientSecret = config.clientSecret;
  const apiBaseUrl = config.apiBaseUrl;
  const tokenUrl = `${apiBaseUrl}/v2/oauth2/token`;

  console.log(
    "[Commerce] Getting OAuth access token - URL:",
    tokenUrl,
    "ClientID:",
    clientId ? `${clientId.substring(0, 8)}...` : "MISSING",
  );

  if (!clientId || !clientSecret) {
    console.error("[Commerce] ❌ Missing OAuth credentials");
    throw new Error(
      "Missing required Commerce credentials (CLIENT_ID or CLIENT_SECRET)",
    );
  }

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "commerce.product:read",
  });

  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[Commerce] ❌ OAuth token request failed - Status:",
        response.status,
        "Error:",
        errorText,
      );
      throw new Error(
        `OAuth token request failed: ${response.status} - ${errorText}`,
      );
    }

    const tokenData = (await response.json()) as OAuthTokenResponse;
    console.log("[Commerce] ✓ OAuth token obtained - Status:", response.status);
    return tokenData.access_token;
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        "[Commerce] ❌ OAuth token fetch error -",
        error.name + ":",
        error.message,
        error.stack,
      );
    } else {
      console.error("[Commerce] ❌ OAuth token fetch error:", error);
    }
    throw error;
  }
}

async function createCheckoutSession(
  accessToken: string,
  params: CreateCheckoutSessionRequest,
): Promise<{ id: string; storeId: string; url: string }> {
  const config = getCommerceConfigCached();
  const storeId = config.storeId;
  const checkoutApiBaseUrl = config.checkoutApiBaseUrl;
  const channelId = config.channelId;

  console.log(
    "[Commerce] Creating checkout session - StoreID:",
    storeId,
    "CheckoutURL:",
    checkoutApiBaseUrl,
    "ChannelID:",
    channelId,
    "SKU:",
    params.skuId,
    "Qty:",
    params.quantity,
  );

  if (!storeId) {
    console.error("[Commerce] ❌ Missing Store ID");
    throw new Error("Missing required Commerce STORE_ID");
  }

  const graphqlQuery = {
    query: `
			mutation CreateCheckoutSession($input: MutationCreateCheckoutSessionInput!) {
				createCheckoutSession(input: $input) {
					id
					storeId
					url
				}
			}
		`,
    variables: {
      input: {
        environment: "dev",
        storeId,
        storeName: "My Store",
        channelId,
        customerId: null,
        returnUrl: params.returnUrl,
        successUrl: params.successUrl,
        enableShipping: false,
        enableLocalPickup: false,
        enableBillingAddressCollection: true,
        enableShippingAddressCollection: false,
        enablePhoneCollection: false,
        enableTaxCollection: false,
        enablePaymentMethodCollection: true,
        paymentMethods: {
          card: {
            processor: "godaddy",
            checkoutTypes: ["standard"],
          },
        },
        lineItems: [
          {
            skuId: params.skuId,
            quantity: params.quantity,
          },
        ],
      },
    },
  };

  console.log(
    "[Commerce] Sending GraphQL request to",
    checkoutApiBaseUrl,
    "with Bearer token",
    accessToken.substring(0, 20) + "...",
  );

  try {
    const response = await fetch(checkoutApiBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(graphqlQuery),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "[Commerce] ❌ GraphQL request failed - Status:",
        response.status,
        "Error:",
        errorText,
      );
      throw new Error(
        `GraphQL request failed: ${response.status} - ${errorText}`,
      );
    }

    const graphqlData = (await response.json()) as GraphQLCheckoutResponse;

    if (graphqlData.errors?.length) {
      const errorMessages = graphqlData.errors.map((e) => e.message).join(", ");
      console.error(
        "[Commerce] ❌ GraphQL errors -",
        errorMessages,
        JSON.stringify(graphqlData.errors),
      );
      throw new Error(`GraphQL errors: ${errorMessages}`);
    }

    if (!graphqlData.data?.createCheckoutSession) {
      console.error(
        "[Commerce] ❌ No checkout session data in response",
        JSON.stringify(graphqlData),
      );
      throw new Error("No checkout session data returned from API");
    }

    const session = graphqlData.data.createCheckoutSession;
    console.log(
      "[Commerce] ✓ Checkout session created - ID:",
      session.id,
      "URL:",
      session.url,
    );

    return session;
  } catch (error) {
    if (error instanceof Error) {
      console.error(
        "[Commerce] ❌ Checkout session creation error -",
        error.name + ":",
        error.message,
        error.stack,
      );
    } else {
      console.error("[Commerce] ❌ Checkout session creation error:", error);
    }
    throw error;
  }
}

export default async function handler(req: Request, res: Response) {
  console.log(
    "\n[Commerce] ========== CREATE CHECKOUT SESSION REQUEST ==========",
  );
  console.log("[Commerce] Request body:", JSON.stringify(req.body, null, 2));

  try {
    const { skuId, quantity, returnUrl, successUrl } =
      req.body as Partial<CreateCheckoutSessionRequest>;

    if (!skuId || !quantity || !returnUrl || !successUrl) {
      const missing = [
        !skuId && "skuId",
        !quantity && "quantity",
        !returnUrl && "returnUrl",
        !successUrl && "successUrl",
      ].filter(Boolean);
      console.error(
        "[Commerce] ❌ Missing required fields:",
        missing.join(", "),
      );
      res.status(400).json({
        success: false,
        error:
          "Missing required fields: skuId, quantity, returnUrl, successUrl",
      });
      return;
    }

    const { returnUrl: finalReturnUrl, successUrl: finalSuccessUrl } =
      transformUrlsForCommerce(returnUrl, successUrl);
    const accessToken = await getAccessToken();
    const checkoutSession = await createCheckoutSession(accessToken, {
      skuId,
      quantity,
      returnUrl: finalReturnUrl,
      successUrl: finalSuccessUrl,
    });

    console.log(
      `[Commerce] ✓ Checkout session created and returning response ====================================\n`,
    );

    res.json({
      success: true,
      checkoutSessionId: checkoutSession.id,
      checkoutUrl: checkoutSession.url,
      storeId: checkoutSession.storeId,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    const stack = error instanceof Error && error.stack ? error.stack : "";
    console.error(
      "[Commerce] ❌ CHECKOUT SESSION CREATION FAILED -",
      errorMessage,
      stack,
    );
    console.error(
      "[Commerce] =================================================\n",
    );
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}
