/**
 * sso-jwt.ts — mint an `sso-jwt` bearer token via assume-role.
 *
 * Vendored pattern from `cdk/lambda/watchtower/src/gocode-auth.ts` (ledger B1):
 * assume the generic S2S IAM-JWT role, then `IamTokenClient.getToken()` against
 * the SSO host. Both Beacon `/api/ask` and the GoCode fallback consume the same
 * `sso-jwt` (different upstreams/allow-lists, same mint mechanism). The token is
 * cached per role+host for the life of the execution environment.
 */
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { IamTokenClient } from 'gd-auth-client';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

const REGION: string = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-2';
const stsClient: STSClient = new STSClient({ region: REGION });

// Cache the minted token; IamTokenClient refreshes in the background before expiry.
const tokenCache = new Map<string, Promise<string>>();

async function assumeRole(roleArn: string): Promise<AwsCredentials> {
  const resp = await stsClient.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: 'sp-transcript-record-processing',
      DurationSeconds: 900,
    })
  );
  if (!resp.Credentials) {
    throw new Error('AssumeRole returned no credentials');
  }
  return {
    accessKeyId: resp.Credentials.AccessKeyId as string,
    secretAccessKey: resp.Credentials.SecretAccessKey as string,
    sessionToken: resp.Credentials.SessionToken as string,
  };
}

async function getJwt(creds: AwsCredentials, ssoHost: string): Promise<string> {
  const client = new IamTokenClient(ssoHost, {
    credentialProviderChain: () =>
      Promise.resolve({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      }),
  });
  client.once('background_error', (err: Error) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'sp-transcript-record-processing.sso_jwt.background_error',
        host: ssoHost,
        error: err.message,
      })
    );
  });
  return client.getToken();
}

/** Assume `roleArn` and return an `sso-jwt` bearer token (cached per role+host). */
export function mintSsoJwt(roleArn: string, ssoHost: string): Promise<string> {
  const cacheKey = `${roleArn}|${ssoHost}`;
  const cached: Promise<string> | undefined = tokenCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const minted: Promise<string> = assumeRole(roleArn).then((creds) => getJwt(creds, ssoHost));
  tokenCache.set(cacheKey, minted);
  // Drop the cache entry on failure so the next invocation retries the mint.
  minted.catch(() => tokenCache.delete(cacheKey));
  return minted;
}
