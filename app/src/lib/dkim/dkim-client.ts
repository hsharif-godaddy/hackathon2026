import { logger } from '@/lib/request-context';
import { getDkimServiceToken } from './dkim-cert-token';
import {
  type DkimApiActivateResponse,
  DkimApiActivateResponseSchema,
  type DkimApiDeactivateResponse,
  DkimApiDeactivateResponseSchema,
} from './types';
import { DomainOrigin } from './utils';

const DEFAULT_VOX_DKIM_URL = 'https://dkim.int.dev-gdcorp.tools/v1';

function getBaseUrl(): string {
  const url = process.env.VOX_DKIM_API_URL;
  if (!url) {
    // Surface default-URL use so a prod deploy missing VOX_DKIM_API_URL
    // is visible in startup-time logs rather than silently routing to
    // the dev cluster.
    logger.warn('dkim.client.base-url.default', { default: DEFAULT_VOX_DKIM_URL });
    return DEFAULT_VOX_DKIM_URL;
  }
  return url;
}

export class DkimClient {
  constructor(private readonly shopperId: string) {}

  async activateDkim(
    domain: string,
    domainOrigin: DomainOrigin,
    nextRotation: string,
  ): Promise<DkimApiActivateResponse> {
    const res = await this.requestAt(getBaseUrl(), 'POST', '/onboard', {
      domain,
      shopperId: this.shopperId,
      nextRotation,
      domainOrigin,
    });
    return DkimApiActivateResponseSchema.parse(await res.json());
  }

  async deactivateDkim(domain: string): Promise<DkimApiDeactivateResponse> {
    const res = await this.requestAt(getBaseUrl(), 'POST', '/offboard', {
      domain,
      shopperId: this.shopperId,
    });
    return DkimApiDeactivateResponseSchema.parse(await res.json());
  }

  private async requestAt(
    baseUrl: string,
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    const jwt = await getDkimServiceToken();
    const url = `${baseUrl}${path}`;

    // Scrubbed log payload — DO NOT include the raw body.
    // The request body carries shopperId (PII in some surfaces) and
    // nextRotation (sensitive timing info). We log only the operationally
    // useful fields: which method/url and which domain is being acted on.
    // domainOrigin is included because it's the routing decision and
    // useful for grepping INTERNAL-vs-EXTERNAL traffic patterns.
    logger.info('dkim.client.request', {
      method,
      url,
      domain: body.domain,
      domainOrigin: body.domainOrigin,
    });

    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `sso-jwt ${jwt}`,
        'Content-Type': 'application/json',
        'X-App-Key': 'airo-builder-bff',
        'X-XSRF-TOKEN': '1',
        'User-Agent': 'airo-builder-bff',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '');
      // Same scrub on the failure path. responseBody is an upstream error
      // string (no caller PII), so we keep that.
      logger.error('dkim.client.request.failed', {
        method,
        url,
        domain: body.domain,
        domainOrigin: body.domainOrigin,
        statusCode: res.status,
        responseBody,
      });
      throw new Error(`DkimClient: ${method} ${path} returned ${res.status} — ${responseBody}`);
    }

    return res;
  }
}
