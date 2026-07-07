/**
 * Client for dcc-domain-attach-api-v2 service.
 *
 * Calls the /v1/domainConnect/generateSignature endpoint to produce the RSA
 * signature required by the Domain Connect spec. The signature is generated
 * server-side using the private key for the syncPubKeyDomain in our templates.
 */

import { logger } from '@/lib/request-context';

interface GenerateSignatureRequest {
  query: Record<string, string>;
}

interface GenerateSignatureResponse {
  signature: string;
  keyName: string;
}

interface DccApiError {
  code: string;
  message: string;
}

const SIGNATURE_FETCH_TIMEOUT_MS = 5000;
export const DCC_API_URL_TEST = 'https://domain-attach.api.test-godaddy.com';
export const DCC_API_URL_PROD = 'https://domain-attach.api.godaddy.com';

/**
 * Error thrown when Domain Connect signature generation fails. Carries the
 * original error as `cause`. The presence of this type signals to the catch
 * block that the failure has already been logged and should not be re-wrapped.
 */
export class DomainConnectSignatureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DomainConnectSignatureError';
  }
}

/**
 * Generates a cryptographic signature for Domain Connect URL parameters.
 * Uses the dcc-domain-attach-api-v2 service's /generateSignature endpoint.
 *
 * @param queryParams - Query parameters to sign (domain, redirect_uri, state, v1, dcv)
 * @param jwt - Customer SSO JWT for authenticating the request
 * @param baseUrl - DCC API base URL; callers in server-only code should resolve
 *   this from GASKET_ENV and pass it explicitly. Defaults to the test host via
 *   getDccDomainAttachApiUrl() when omitted (safe for unit tests).
 * @returns Signature and key name to add to the Domain Connect URL
 * @throws DomainConnectSignatureError if signature generation fails
 */
export async function generateDomainConnectSignature(
  queryParams: Record<string, string>,
  jwt: string,
  baseUrl?: string,
): Promise<GenerateSignatureResponse> {
  const resolvedBaseUrl: string = baseUrl ?? getDccDomainAttachApiUrl();
  const url: string = `${resolvedBaseUrl}/v1/domainConnect/generateSignature`;

  const requestId: string = crypto.randomUUID();

  logger.info('dcc.generate_signature.request', {
    message: 'Requesting Domain Connect signature',
    requestId,
    paramsCount: Object.keys(queryParams).length,
  });

  try {
    const response: Response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `sso-jwt ${jwt}`,
        'Content-Type': 'application/json',
        'X-Request-ID': requestId,
        'X-App-Key': process.env.DCC_APP_KEY || 'airo-app-builder',
      },
      body: JSON.stringify({ query: queryParams } satisfies GenerateSignatureRequest),
      signal: AbortSignal.timeout(SIGNATURE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      let errorMessage: string = `HTTP ${response.status}`;
      try {
        const errorBody: DccApiError = await response.json();
        errorMessage = errorBody.message || errorMessage;
      } catch {
        // Ignore JSON parse errors, use status code as message
      }

      logger.error('dcc.generate_signature.error', {
        message: 'Failed to generate signature',
        requestId,
        status: response.status,
        error: errorMessage,
      });

      throw new DomainConnectSignatureError(
        `Failed to generate Domain Connect signature: ${errorMessage}`,
      );
    }

    const result: unknown = await response.json();

    // Validate response structure to prevent a silent broken redirect: an
    // undefined signature/keyName would coerce to the string "undefined" in
    // the URL and fail obscurely at Cloudflare instead of via our 502 path.
    if (
      !result ||
      typeof result !== 'object' ||
      !('signature' in result) ||
      !('keyName' in result) ||
      typeof result.signature !== 'string' ||
      typeof result.keyName !== 'string' ||
      !result.signature ||
      !result.keyName
    ) {
      logger.error('dcc.generate_signature.invalid_response', {
        message: 'Signature service returned invalid response structure',
        requestId,
        hasSignature: !!result && typeof result === 'object' && 'signature' in result,
        hasKeyName: !!result && typeof result === 'object' && 'keyName' in result,
      });

      throw new DomainConnectSignatureError(
        'Failed to generate Domain Connect signature: Invalid response from signature service',
      );
    }

    const validatedResult: GenerateSignatureResponse = {
      signature: result.signature,
      keyName: result.keyName,
    };

    logger.info('dcc.generate_signature.success', {
      message: 'Domain Connect signature generated',
      requestId,
      keyName: validatedResult.keyName,
    });

    return validatedResult;
  } catch (error: unknown) {
    // Already-logged failures (non-ok HTTP, invalid response) re-throw as-is.
    if (error instanceof DomainConnectSignatureError) {
      throw error;
    }

    // Unexpected errors (network failure, timeout/abort, JSON parse) — log and wrap.
    logger.error('dcc.generate_signature.exception', {
      message: 'Exception during signature generation',
      requestId,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
    });

    throw new DomainConnectSignatureError(
      `Failed to generate Domain Connect signature: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { cause: error },
    );
  }
}

/**
 * Fallback URL resolver used when no explicit baseUrl is passed to
 * generateDomainConnectSignature. Honors DCC_DOMAIN_ATTACH_API_URL; otherwise
 * defaults to the test host. Production callers (url/route.ts) always resolve
 * the host from GASKET_ENV before calling, so this path is only reached in
 * tests and local dev.
 */
function getDccDomainAttachApiUrl(): string {
  return process.env.DCC_DOMAIN_ATTACH_API_URL ?? DCC_API_URL_TEST;
}
