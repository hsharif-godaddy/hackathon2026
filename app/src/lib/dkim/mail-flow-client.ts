import { logger } from '@/lib/request-context';
import { type DkimStatusResponse, DkimStatusResponseSchema } from './types';

const DEFAULT_VOX_MAIL_FLOW_URL = 'https://dev.email-record.myprofessionalmail.com/v1';

function getBaseUrl(): string {
  const url = process.env.VOX_MAIL_FLOW_API_URL;
  if (!url) {
    // Surface default-URL use — a prod deploy missing this env var would
    // otherwise silently poll the dev mail-flow cluster.
    logger.warn('dkim.mail-flow.base-url.default', { default: DEFAULT_VOX_MAIL_FLOW_URL });
    return DEFAULT_VOX_MAIL_FLOW_URL;
  }
  return url;
}

export class MailFlowClient {
  async getDkimStatus(domain: string): Promise<DkimStatusResponse> {
    return this.fetchStatus(getBaseUrl(), domain);
  }

  private async fetchStatus(baseUrl: string, domain: string): Promise<DkimStatusResponse> {
    // URL-encode the domain segment defensively. The status route only
    // checks for empty `?domain=`, so values like `foo.com?bypass=1` or
    // `foo/../admin` reach here intact and would mutate the upstream URL
    // shape if interpolated raw. Mail-flow probably rejects malformed
    // hosts, but encoding is the right contract regardless.
    const url = `${baseUrl}/domains/${encodeURIComponent(domain)}/dkim`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'airo-builder-bff' },
    });
    if (!res.ok) {
      // Match dkim-client.ts pattern: read the body so the error message
      // and structured-log entry surface what the upstream actually said.
      const responseBody = await res.text().catch(() => '');
      logger.warn('dkim.mail-flow.request.failed', {
        url,
        statusCode: res.status,
        responseBody,
      });
      throw new Error(
        `MailFlowClient: GET /domains/${domain}/dkim returned ${res.status} — ${responseBody}`,
      );
    }
    return DkimStatusResponseSchema.parse(await res.json());
  }
}
