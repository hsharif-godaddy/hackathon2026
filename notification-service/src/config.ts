import { z } from 'zod';

const schema = z.object({
  KINESIS_STREAM_NAME: z.string().min(1),

  /** 72h-retention stream — reminder records replayed at AT_TIMESTAMP(now − 48h). */
  REMINDER_KINESIS_STREAM_NAME: z.string().min(1),

  /** 96h-retention stream — expiry records replayed at AT_TIMESTAMP(now − 72h). */
  EXPIRY_KINESIS_STREAM_NAME: z.string().min(1),

  MGMT_AIRO_BASE_URL: z.string().url(),
  MGMT_CERT: z.string().min(1),
  MGMT_KEY: z.string().min(1),
  SSO_LOGIN_URL: z.string().url().default('https://sso.test-godaddy.com/login'),

  SWITCHBOARD_ENV: z.enum(['development', 'test', 'production']).default('test'),
  SWITCHBOARD_APP: z.string().min(1).default('default|airo-app-builder'),

  APP_BASE_URL: z.string().url().default('https://airo-builder.godaddy.com'),

  MESSAGING_BASE_URL: z.string().url(),

  AWS_REGION: z.string().min(1).default('us-west-2'),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => i.path.join('.')).join(', ');
    throw new Error(`Invalid configuration — missing or invalid env vars: ${missing}`);
  }
  return result.data;
}

export const config: Config = load();

export function getSsoHost(): string {
  return config.SSO_LOGIN_URL.includes('test')
    ? 'sso.test-godaddy.com'
    : 'sso.godaddy.com';
}
