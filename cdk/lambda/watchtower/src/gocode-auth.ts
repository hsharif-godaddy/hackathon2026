import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { IamTokenClient } from 'gd-auth-client';

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}

async function assumeRole(roleArn: string): Promise<AwsCredentials> {
  const client = new STSClient({ region: 'us-west-2' });
  const resp = await client.send(new AssumeRoleCommand({
    RoleArn: roleArn,
    RoleSessionName: `watchtower-daily-${Date.now()}`,
    DurationSeconds: 900,
  }));
  if (!resp.Credentials) throw new Error('AssumeRole returned no credentials');
  return {
    accessKeyId: resp.Credentials.AccessKeyId!,
    secretAccessKey: resp.Credentials.SecretAccessKey!,
    sessionToken: resp.Credentials.SessionToken!,
  };
}

async function getJwt(creds: AwsCredentials, ssoHost: string): Promise<string> {
  const client = new IamTokenClient(ssoHost, {
    credentialProviderChain: () => Promise.resolve({
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey,
      sessionToken: creds.sessionToken,
    }),
  });
  client.once('background_error', (err: Error) => {
    console.warn('watchtower.gocode_auth.background_error host=%s msg=%s', ssoHost, err.message);
  });
  return client.getToken();
}

/** Assume the shared GoCode role and return an sso-jwt bearer token. */
export async function getGocodeJwt(roleArn: string, ssoHost: string): Promise<string> {
  const creds = await assumeRole(roleArn);
  return getJwt(creds, ssoHost);
}
