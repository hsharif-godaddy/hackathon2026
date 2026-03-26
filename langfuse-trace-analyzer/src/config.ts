export interface Config {
  langfuse: {
    publicKey: string;
    secretKey: string;
    baseUrl: string;
  };
  elasticsearch: {
    endpoint: string;
    apiKey?: string;
    user?: string;
    password?: string;
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function load(): Config {
  const apiKey = process.env['ES_API_KEY'];
  const user = process.env['ES_USER'];
  const password = process.env['ES_PASSWORD'];

  if (!apiKey && !user) {
    throw new Error('Either ES_API_KEY or ES_USER+ES_PASSWORD must be set');
  }

  if (user && !password) {
    throw new Error('ES_PASSWORD is required when ES_USER is set');
  }

  return {
    langfuse: {
      publicKey: requireEnv('LANGFUSE_PUBLIC_KEY'),
      secretKey: requireEnv('LANGFUSE_SECRET_KEY'),
      baseUrl: requireEnv('LANGFUSE_BASE_URL').replace(/\/+$/, ''),
    },
    elasticsearch: {
      endpoint: requireEnv('ES_ENDPOINT').replace(/\/+$/, ''),
      apiKey,
      user,
      password,
    },
  };
}
